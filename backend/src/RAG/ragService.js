import QueryPipeline from "./query/queryPipeline.js";
import { logger } from "../utils/logger.js";
import { v4 as uuidv4 } from "uuid";

const toSourcedDocument = (doc) => ({
    content: doc.content,
    source: doc.document.id,
    type: doc.source_type,
    metadata: doc.document.metadata,
});

export default class RagChain {
    constructor() {
        this.querypipe = new QueryPipeline();
    }

    async chat({
        userMessage,
        conversationId = null,
        userId,
        llmProvider = 'OpenAI',
        model = null,
        RetrieveOptions = {},
        stream = null,
    }) {
        try {
            if (!userId) throw new Error("user id is missing");

            if (!conversationId) {
                conversationId = uuidv4();
                logger.info("Created new conversation", { conversationId });
            }

            logger.info("Chat request", {
                conversationId,
                messageLength: userMessage.length,
            })

            const ragParams = {
                query: userMessage,
                conversationId,
                userId,
                llmProvider,
                model,
                options: RetrieveOptions,
                stream: stream
                    ? {
                        ...stream,
                        onContext: async (documents) => {
                            await stream.onContext?.(documents.map(toSourcedDocument));
                        },
                    }
                    : undefined,
            }
            const response = await this.querypipe.run(ragParams);

            return {
                success: true,
                conversationId,
                response: response.answer,
                provider: response.provider,
                model: response.model,
                duration: response.duration,
                retrieval: response.retrieval,
                clarificationRequired: response.clarificationRequired,
                stopped: response.stopped,
                sourcedDocuments: response.sources.map(toSourcedDocument),
            }
        } catch (error) {
            logger.error("Error in chat", { error: error.message });
            return {
                success: false,
                error: error.message,
                partialResponse: error.partialAnswer || null,
                conversationId,
            };
        }
    }
}
