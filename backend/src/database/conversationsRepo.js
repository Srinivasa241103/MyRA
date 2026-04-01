import { pool } from "../config/dbConfig.js";

export default class ConversationRepository {
  async getConversationHistory(conversationId) {
    const query = `
                SELECT user_message, assistant_message, created_at
                FROM conversations
                WHERE conversation_id = $1
                AND is_deleted = false OR is_deleted IS NULL
                ORDER BY created_at ASC
                LIMIT 20;`;

    return await pool.query(query, [conversationId]);
  }

  async saveChatConversation({
    conversation_id,
    user_message,
    assistant_message,
    metadata = {},
  }) {
    const query = `
                INSERT INTO conversations (conversation_id, user_message, assistant_message, metadata)
                VALUES ($1, $2, $3, $4);`;

    const values = [conversation_id, user_message, assistant_message, metadata];
    await pool.query(query, values);
  }

  async getHistory(conversationId, limit = 20) {
    const query = `
              SELECT 
                COUNT(*) as message_count,
                MIN(created_at) as first_message,
                MAX(created_at) as last_message
              FROM conversations
              WHERE conversation_id = $1
            `;

    const { rows } = await pool.query(query, [conversationId]);
    return rows[0];
  }

  async clear(conversationId) {
    const query = `
              UPDATE conversations
              SET is_deleted = true
              WHERE conversation_id = $1;
             `;
    await pool.query(query, [conversationId]);
    return;
  }
}
