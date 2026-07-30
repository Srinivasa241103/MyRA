import QueryPipeline from "./query/queryPipeline.js";
import { logger } from "../utils/logger.js";
import ConversationRepository from "../database/conversationsRepo.js";
import { v4 as uuidv4 } from "uuid";

export default class RagChain {
    constructor() {
        this.querypipe = new QueryPipeline();
        this.conversationRepo = new ConversationRepository();
    }

    async chat({
        userMessage,
        conversationId = null,
        userId,
        llmProvider = 'OpenAI',
        model = null,
        RetrieveOptions = {}
    }) {
        try {
            if (!userId) throw new Error("user id is missing");

            if (!conversationId) {
                conversationId = uuidv4();
                logger.info("Created new conversation", { conversationId });
            }

            logger.info("Chat resuest", {
                conversationId,
                messageLength: userMessage.length,
            })

            const ragParams = {
                query: userMessage,
                conversationId,
                userId,
                llmProvider,
                model,
                options: RetrieveOptions
            }
            const response = await this.querypipe.run(ragParams);

            return {
                success: true,
                conversationId,
                response: response.answer,
                provider: response.provider,
                model: response.model,
                sourcedDocuments: response.sources.map((doc) => ({
                    content: doc.content,
                    source: doc.document.id,
                    type: doc.source_type,
                    metadata: doc.document.metadata,
                }))
            }
        } catch (error) {
            logger.error("Error in chat", { error: error.message });
            return {
                success: false,
                error: error.message,
                conversationId,
            };
        }
    }
}
