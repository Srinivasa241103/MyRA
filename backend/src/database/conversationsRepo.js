import { pool } from "../config/dbConfig.js";

export default class ConversationRepository {
  async getConversationHistory(conversationId) {
    const query = `
      SELECT user_message, assistant_message, created_at
      FROM conversations
      WHERE conversation_id = $1
        AND (is_deleted = false OR is_deleted IS NULL)
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

    const values = [conversation_id, user_message, assistant_message, JSON.stringify(metadata)];
    await pool.query(query, values);
  }

  /**
   * Returns all distinct conversations ordered by most recent activity.
   * Each entry has conversation_id, the first user message as title, and timestamps.
   */
  async getConversations(limit = 50) {
    const query = `
      WITH first_messages AS (
        SELECT DISTINCT ON (conversation_id)
          conversation_id,
          user_message AS title,
          created_at   AS started_at
        FROM conversations
        WHERE (is_deleted = false OR is_deleted IS NULL)
        ORDER BY conversation_id, created_at ASC
      ),
      last_activity AS (
        SELECT conversation_id, MAX(created_at) AS last_message_at
        FROM conversations
        WHERE (is_deleted = false OR is_deleted IS NULL)
        GROUP BY conversation_id
      )
      SELECT
        fm.conversation_id,
        fm.title,
        fm.started_at,
        la.last_message_at
      FROM first_messages fm
      JOIN last_activity la ON fm.conversation_id = la.conversation_id
      ORDER BY la.last_message_at DESC
      LIMIT $1;`;

    const { rows } = await pool.query(query, [limit]);
    return rows;
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
