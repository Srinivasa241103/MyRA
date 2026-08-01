import Retriever, {
  type RetrieveOptions,
  type RetrievalOutcome,
} from "../retrieval/retriever.js";
import {
  buildContextResult,
  type ContextBuildResult,
} from "../retrieval/contextBuilder.js";
import {
  QueryTransformer,
  type QueryTransformResult,
} from "../retrieval/queryTransformer.js";
import type { RankedSearchResult } from "../retrieval/hybridSearchExecutor.js";
import MemoryService from "./memoryService.js";
import LLMService, { resolveLLMSelection } from "./llmService.js";
import { logger } from "../../utils/logger.js";
import { buildPrompt } from "./prompts.js";
import { LLM_INVOCATION_TYPES } from "../../utils/constants.js";
import type { OwnerId } from "../vectorStores/vectorStore.js";

export interface QueryPipelineOptions extends RetrieveOptions {
  enableQueryRewrite?: boolean;
  contextMaxTokens?: number;
  maxChunksPerDocument?: number;
}

export interface QueryPipelineInput {
  query: string;
  conversationId: string;
  userId: OwnerId;
  llmProvider?: string;
  model?: string | null;
  options?: QueryPipelineOptions;
  stream?: QueryPipelineStreamOptions;
}

export interface QueryPipelineStreamStatus {
  stage: string;
  flow: "rag";
  detail?: string | null;
  cancellable: boolean;
}

export interface QueryPipelineStreamOptions {
  signal?: AbortSignal;
  onStatus?: (status: QueryPipelineStreamStatus) => void | Promise<void>;
  onContext?: (sources: RankedSearchResult[]) => void | Promise<void>;
  onToken?: (text: string) => void | Promise<void>;
}

export interface QueryPipelineRetrievalMetadata {
  queryTransform: QueryTransformResult;
  plan: RetrievalOutcome["plan"];
  clarification: RetrievalOutcome["clarification"];
  diagnostics: RetrievalOutcome["diagnostics"];
  context: {
    estimatedTokens: number;
    selectedChunkCount: number;
    excludedChunkCount: number;
  };
}

export interface QueryPipelineResponse {
  answer: string;
  sources: RankedSearchResult[];
  conversationId: string;
  provider: string;
  model: string | null;
  duration: number;
  retrieval: QueryPipelineRetrievalMetadata;
  clarificationRequired: boolean;
  stopped: boolean;
}

interface QueryPipelineDependencies {
  retriever?: Retriever;
  queryTransformer?: QueryTransformer;
  memoryService?: MemoryService;
  llmService?: LLMService;
}

function contextMetadata(
  context: ContextBuildResult<RankedSearchResult>,
): QueryPipelineRetrievalMetadata["context"] {
  return {
    estimatedTokens: context.estimatedTokens,
    selectedChunkCount: context.chunks.length,
    excludedChunkCount: context.excludedChunkCount,
  };
}

function buildRetrievalMetadata(
  queryTransform: QueryTransformResult,
  retrieval: RetrievalOutcome,
  context: ContextBuildResult<RankedSearchResult>,
): QueryPipelineRetrievalMetadata {
  return {
    queryTransform,
    plan: retrieval.plan,
    clarification: retrieval.clarification,
    diagnostics: retrieval.diagnostics,
    context: contextMetadata(context),
  };
}

export default class QueryPipeline {
  private readonly retriever: Retriever;
  private readonly queryTransformer: QueryTransformer;
  private readonly memoryService: MemoryService;
  private readonly llmService: LLMService;

  constructor({
    retriever = new Retriever(),
    queryTransformer = new QueryTransformer(),
    memoryService = new MemoryService(),
    llmService = new LLMService(),
  }: QueryPipelineDependencies = {}) {
    this.retriever = retriever;
    this.queryTransformer = queryTransformer;
    this.memoryService = memoryService;
    this.llmService = llmService;
  }

  async run({
    query,
    conversationId,
    userId,
    llmProvider = "OpenAI",
    model = null,
    options = {},
    stream,
  }: QueryPipelineInput): Promise<QueryPipelineResponse> {
    try {
      if (!query?.trim()) throw new Error("Query is missing");
      if (!conversationId) throw new Error("conversation id is missing");
      if (!userId) throw new Error("user id is missing");

      logger.info("Starting RAG chain", { conversationId, userId });
      const startTime = Date.now();
      const messageHistory = await this.memoryService.loadHistory(
        conversationId,
        userId,
      );
      await stream?.onStatus?.({
        stage: "query_refinement",
        flow: "rag",
        detail: null,
        cancellable: false,
      });
      const queryTransform = await this.queryTransformer.transform({
        query,
        history: messageHistory,
        userId,
        conversationId,
        llmProvider,
        model,
        enabled: options.enableQueryRewrite ?? true,
      });

      stream?.signal?.throwIfAborted();
      await stream?.onStatus?.({
        stage: "collecting_data",
        flow: "rag",
        detail: null,
        cancellable: false,
      });

      const retrievalStartTime = Date.now();
      const retrievalResult = await this.retriever.retrieveWithDiagnostics(
        queryTransform.query,
        userId,
        {
          ...options,
          conversationId,
          llmProvider,
          model,
          enableRerank: options.enableRerank ?? true,
        },
      );
      const retrievalDuration = Date.now() - retrievalStartTime;

      stream?.signal?.throwIfAborted();
      await stream?.onStatus?.({
        stage: "building_context",
        flow: "rag",
        detail: `${retrievalResult.chunks.length} relevant item${retrievalResult.chunks.length === 1 ? "" : "s"}`,
        cancellable: false,
      });

      const contextResult = buildContextResult(retrievalResult.chunks, {
        maxTokens: options.contextMaxTokens,
        maxChunksPerDocument: options.maxChunksPerDocument,
      });
      const retrievalMetadata = buildRetrievalMetadata(
        queryTransform,
        retrievalResult,
        contextResult,
      );
      await stream?.onContext?.(contextResult.chunks);

      if (retrievalResult.clarification) {
        const selection = resolveLLMSelection(llmProvider, model);
        const answer = retrievalResult.clarification.message;
        const totalDuration = Date.now() - startTime;

        await this.memoryService.saveConversation(
          userId,
          conversationId,
          query,
          answer,
          {
            sourceCount: 0,
            retrievalDuration,
            clarificationRequired: true,
            clarificationReason: retrievalResult.clarification.reason,
            retrieval: retrievalMetadata,
            llmProvider: selection.provider,
            llmModel: selection.model,
            streamStatus: "complete",
          },
        );

        await stream?.onToken?.(answer);

        logger.info("Query pipeline returned a retrieval clarification", {
          conversationId,
          userId,
          totalDuration,
          reason: retrievalResult.clarification.reason,
        });

        return {
          answer,
          sources: [],
          conversationId,
          provider: selection.provider,
          model: selection.model ?? null,
          duration: totalDuration,
          retrieval: retrievalMetadata,
          clarificationRequired: true,
          stopped: false,
        };
      }

      logger.info("Built retrieval context", {
        conversationId,
        selectedChunks: contextResult.chunks.length,
        estimatedTokens: contextResult.estimatedTokens,
        excludedChunks: contextResult.excludedChunkCount,
      });

      const messages = buildPrompt({
        history: messageHistory,
        context: contextResult.text,
        question: query,
      });
      await stream?.onStatus?.({
        stage: "generating",
        flow: "rag",
        detail: null,
        cancellable: true,
      });
      const llmResponse = stream
        ? await this.llmService.generateResponseStream(
          llmProvider,
          messages,
          userId,
          conversationId,
          {
            model,
            invocationType: LLM_INVOCATION_TYPES.RAG_CHAT,
            signal: stream.signal,
            onToken: stream.onToken,
          },
        )
        : await this.llmService.generateResponse(
          llmProvider,
          messages,
          userId,
          conversationId,
          {
            model,
            invocationType: LLM_INVOCATION_TYPES.RAG_CHAT,
          },
        );

      if (llmResponse.answer) {
        await this.memoryService.saveConversation(
          userId,
          conversationId,
          query,
          llmResponse.answer,
          {
            sourceCount: contextResult.chunks.length,
            sourceType: [...new Set(contextResult.chunks.map((result) => result.source_type))],
            retrievalDuration,
            llmDuration: llmResponse.duration,
            llmProvider: llmResponse.provider,
            llmModel: llmResponse.model,
            clarificationRequired: false,
            retrieval: retrievalMetadata,
            streamStatus: llmResponse.stopped ? "stopped" : "complete",
          },
        );
      }

      const totalDuration = Date.now() - startTime;
      logger.info("Query pipeline completed", {
        conversationId,
        userId,
        totalDuration,
        retrievalDuration,
        llmDuration: llmResponse.duration,
        sourceCount: contextResult.chunks.length,
      });

      return {
        answer: llmResponse.answer,
        sources: contextResult.chunks,
        conversationId,
        provider: llmResponse.provider,
        model: llmResponse.model ?? null,
        duration: totalDuration,
        retrieval: retrievalMetadata,
        clarificationRequired: false,
        stopped: Boolean(llmResponse.stopped),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("Error in query pipeline", { error: message });
      const pipelineError = new Error(`query pipeline failed: ${message}`);
      if (error && typeof error === "object" && "partialAnswer" in error) {
        (pipelineError as Error & { partialAnswer?: string }).partialAnswer =
          String(error.partialAnswer || "");
      }
      throw pipelineError;
    }
  }
}
