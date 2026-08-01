import ConversationRepository from "../../database/conversationsRepo.js";
import { logger } from "../../utils/logger.js";

export default class MemoryService {
    constructor() {
        this.conversationRepo = new ConversationRepository();
    }

    async loadHistory(conversationId, userId, limit = 20) {
        try {
            const result = await this.conversationRepo.getConversationHistory(
                conversationId,
                userId,
                limit
            );

            const messages = [];
            for (const row of result.rows) {
                messages.push(
                    { role: "user", content: row.user_message },
                    { role: "assistant", content: row.assistant_message }
                );
            }

            logger.info("Loaded conversation history", {
                conversationId,
                messageCount: messages.length,
            });
            return messages;
        } catch (error) {
            logger.error("Error loading conversation history", {
                conversationId,
                error: error.message,
            });
            return [];
        }
    }

    async saveConversation(
        userId,
        conversationId,
        userMessage,
        assistantMessage,
        metadata = {}
    ) {
        try {
            const conversationObject = {
                conversation_id: conversationId,
                user_message: userMessage,
                assistant_message: assistantMessage,
                metadata,
                userId,
            };
            await this.conversationRepo.saveChatConversation(conversationObject);

            logger.info("Saved conversation to database", { conversationId });
        } catch (error) {
            logger.error("Error saving conversation", {
                conversationId,
                error: error.message,
            });
            throw error;
        }
    }

}
