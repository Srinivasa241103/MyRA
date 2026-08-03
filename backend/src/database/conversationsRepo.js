import { getPool } from "../config/dbConfig.js";

function requireUserId(userId) {
  if (userId === undefined || userId === null || String(userId).trim() === "") {
    throw new Error("userId is required for conversation operations");
  }
}

export default class ConversationRepository {
  constructor(db = getPool()) {
    this.db = db;
  }

  async getConversationHistory(conversationId, userId, limit = 20) {
    requireUserId(userId);
    const query = `
      SELECT user_message, assistant_message, metadata, created_at
      FROM (
        SELECT user_message, assistant_message, metadata, created_at
        FROM conversations
        WHERE conversation_id = $1 AND user_id = $2
          AND is_deleted IS NULL
        ORDER BY created_at DESC
        LIMIT $3
      ) recent_messages
      ORDER BY created_at ASC;`;

    return await this.db.query(query, [conversationId, userId, limit]);
  }

  async getConversationStatus(conversationId, userId) {
    requireUserId(userId);
    const query = `
      SELECT
        COUNT(*)::int AS total_count,
        COUNT(*) FILTER (WHERE is_deleted IS NULL)::int AS active_count
      FROM conversations
      WHERE user_id = $1 AND conversation_id = $2;
    `;

    const { rows } = await this.db.query(query, [userId, conversationId]);
    const row = rows[0] ?? { total_count: 0, active_count: 0 };

    return {
      exists: row.total_count > 0,
      active: row.active_count > 0,
      totalCount: row.total_count,
      activeCount: row.active_count,
    };
  }

  async saveChatConversation({
    conversation_id,
    user_message,
    assistant_message,
    metadata = {},
    userId,
  }) {
    requireUserId(userId);
    const query = `
      INSERT INTO conversations (conversation_id, user_message, assistant_message, metadata, user_id)
      VALUES ($1, $2, $3, $4, $5);`;

    const values = [conversation_id, user_message, assistant_message, JSON.stringify(metadata), userId];
    await this.db.query(query, values);
  }

  /**
   * Returns all distinct conversations ordered by most recent activity.
   * Each entry has conversation_id, the first user message as title, and timestamps.
   */
  async getConversations(limit = 50, userId) {
    requireUserId(userId);
    const query = `
      WITH first_messages AS (
        SELECT DISTINCT ON (conversation_id)
          conversation_id,
          user_message AS title,
          created_at   AS started_at
        FROM conversations
        WHERE is_deleted IS NULL AND user_id = $2
        ORDER BY conversation_id, created_at ASC
      ),
      last_activity AS (
        SELECT conversation_id, MAX(created_at) AS last_message_at
        FROM conversations
        WHERE is_deleted IS NULL AND user_id = $2  
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

    const { rows } = await this.db.query(query, [limit, userId]);
    return rows;
  }

  async clear(conversationId, userId) {
    requireUserId(userId);
    const query = `
      UPDATE conversations
      SET is_deleted = true
      WHERE user_id = $1 AND conversation_id = $2
        AND is_deleted IS NULL;
    `;
    const result = await this.db.query(query, [userId, conversationId]);
    return result.rowCount;
  }
}
