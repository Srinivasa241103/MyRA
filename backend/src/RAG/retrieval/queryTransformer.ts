import { z } from "zod";
import LLMService from "../query/llmService.js";
import { logger } from "../../utils/logger.js";
import { LLM_INVOCATION_TYPES } from "../../utils/constants.js";
import type { OwnerId } from "../vectorStores/vectorStore.js";

export interface ConversationMessage {
  role: "user" | "assistant" | string;
  content: string;
}

export type QueryTransformReason =
  | "disabled"
  | "no_history"
  | "standalone"
  | "context_dependent"
  | "rewrite_failed";

export interface QueryTransformInput {
  query: string;
  history?: ConversationMessage[];
  userId: OwnerId;
  conversationId: string;
  llmProvider?: string;
  model?: string | null;
  enabled?: boolean;
}

export interface QueryTransformResult {
  originalQuery: string;
  query: string;
  rewritten: boolean;
  attempted: boolean;
  reason: QueryTransformReason;
  error?: string;
}

interface QueryTransformerDependencies {
  llmService?: Pick<LLMService, "generateStructuredResponse">;
}

const MAX_HISTORY_MESSAGES = 6;
const MAX_HISTORY_CHARS_PER_MESSAGE = 1500;

const REWRITE_SCHEMA = z.object({
  standaloneQuery: z.string().trim().min(1).max(1000),
});

const FOLLOW_UP_PREFIX_PATTERN =
  /^\s*(?:and\b|also\b|then\b|what\s+about\b|how\s+about\b|which\s+one\b|the\s+same\b)/i;

const CONTEXT_REFERENCE_PATTERN =
  /\b(?:it|its|those|these|them|they|their|he|his|she|her|same|former|latter)\b|\b(?:this|that)\s+(?:email|message|event|meeting|one|person|sender|organizer)\b|\b(?:the|which)\s+(?:latest\s+|oldest\s+)?ones?\b/i;

const SHORT_TEMPORAL_FOLLOW_UP_PATTERN =
  /^\s*(?:today|yesterday|tomorrow|last\s+week|this\s+week|latest|newest|oldest|earliest|and\s+(?:today|yesterday|tomorrow|last\s+week|this\s+week|the\s+latest|the\s+oldest))\s*[?.!]*\s*$/i;

function normalizeQuery(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function messageText(message: ConversationMessage): string {
  const role = message.role === "assistant" ? "Assistant" : "User";
  return `${role}: ${message.content.slice(0, MAX_HISTORY_CHARS_PER_MESSAGE)}`;
}

function buildRewriteMessages(
  query: string,
  history: ConversationMessage[],
): Array<{ role: "system" | "user"; content: string }> {
  const historyText = history
    .slice(-MAX_HISTORY_MESSAGES)
    .map(messageText)
    .join("\n");

  return [
    {
      role: "system",
      content: [
        "Rewrite a context-dependent personal-data search query as one standalone query.",
        "Preserve the user's source, person, topic, and time constraints from the conversation.",
        "Do not answer the query and do not add facts that are absent from the conversation.",
        "Return only the required structured output.",
      ].join(" "),
    },
    {
      role: "user",
      content: `Conversation:\n${historyText}\n\nFollow-up query:\n${query}`,
    },
  ];
}

export function isContextDependentQuery(query: string): boolean {
  const normalized = normalizeQuery(query);
  if (!normalized) return false;

  return FOLLOW_UP_PREFIX_PATTERN.test(normalized) ||
    CONTEXT_REFERENCE_PATTERN.test(normalized) ||
    SHORT_TEMPORAL_FOLLOW_UP_PATTERN.test(normalized);
}

function fallbackResult(
  query: string,
  reason: QueryTransformReason,
  attempted = false,
  error?: string,
): QueryTransformResult {
  return {
    originalQuery: query,
    query,
    rewritten: false,
    attempted,
    reason,
    ...(error ? { error } : {}),
  };
}

export class QueryTransformer {
  private readonly llmService: Pick<LLMService, "generateStructuredResponse">;

  constructor({ llmService = new LLMService() }: QueryTransformerDependencies = {}) {
    this.llmService = llmService;
  }

  async transform({
    query,
    history = [],
    userId,
    conversationId,
    llmProvider = "OpenAI",
    model = null,
    enabled = true,
  }: QueryTransformInput): Promise<QueryTransformResult> {
    const normalizedQuery = normalizeQuery(query);
    if (!normalizedQuery) {
      throw new Error("Query transformation requires a non-empty query");
    }

    if (!enabled) return fallbackResult(normalizedQuery, "disabled");
    if (history.length === 0) return fallbackResult(normalizedQuery, "no_history");
    if (!isContextDependentQuery(normalizedQuery)) {
      return fallbackResult(normalizedQuery, "standalone");
    }

    try {
      const response = await this.llmService.generateStructuredResponse({
        llmProvider,
        model,
        schema: REWRITE_SCHEMA,
        messages: buildRewriteMessages(normalizedQuery, history),
        userId,
        conversationId,
        invocationType: LLM_INVOCATION_TYPES.QUERY_REWRITE,
        temperature: 0,
        maxTokens: 200,
        structuredConfig: { name: "standalone_retrieval_query" },
      }) as z.infer<typeof REWRITE_SCHEMA>;

      const rewrittenQuery = normalizeQuery(response.standaloneQuery);
      if (!rewrittenQuery || rewrittenQuery.toLowerCase() === normalizedQuery.toLowerCase()) {
        return fallbackResult(normalizedQuery, "context_dependent", true);
      }

      return {
        originalQuery: normalizedQuery,
        query: rewrittenQuery,
        rewritten: true,
        attempted: true,
        reason: "context_dependent",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn("Query rewrite failed; using the original query", {
        conversationId,
        error: message,
      });
      return fallbackResult(normalizedQuery, "rewrite_failed", true, message);
    }
  }
}
