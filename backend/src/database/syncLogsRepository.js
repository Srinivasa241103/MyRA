// services/database/SyncLogRepository.js
import { getPool } from "../config/dbConfig.js";

function requireUserId(userId) {
  if (userId === undefined || userId === null || String(userId).trim() === "") {
    throw new Error("userId is required for sync log operations");
  }
}

export class SyncLogRepository {
  constructor(db = getPool()) {
    this.db = db;
  }

  /**
   * Find sync log by ID
   * @param {number} id
   * @returns {Promise<Object|null>}
   */
  async findById(id, userId) {
    requireUserId(userId);
    const query = `
            SELECT * FROM sync_logs
            WHERE id = $1 AND user_id = $2;`;

    const values = [id, userId];
    const { rows } = await this.db.query(query, values);

    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Create a new sync log entry
   * @param {string} source
   * @param {number} userId
   * @returns {Promise<Object>}
   */
  async create(source, userId) {
    requireUserId(userId);
    const query = `
            INSERT INTO sync_logs
            (source, status, user_id)
            VALUES ($1, $2, $3)
            RETURNING *;`;

    const values = [source, "in_progress", userId];
    const { rows } = await this.db.query(query, values);

    if (rows.length === 0) {
      throw new Error("Failed to create sync log");
    }

    return rows[0];
  }

  /**
   * Update sync log when complete
   * @param {number} id
   * @param {Object} updates
   * @returns {Promise<Object>}
   */
  async complete(id, userId, updates) {
    requireUserId(userId);
    const query = `
            UPDATE sync_logs
            SET 
                sync_completed_at = NOW(),
                status = $1,
                documents_fetched = $2,
                documents_stored = $3,
                last_sync_timestamp = $4,
                error_message = $5
            WHERE id = $6 AND user_id = $7
            RETURNING *;`;

    const values = [
      updates.status || "success",
      updates.documentsFetched || 0,
      updates.documentsStored || 0,
      updates.lastSyncTimestamp || null,
      updates.error || null,
      id,
      userId,
    ];

    const { rows } = await this.db.query(query, values);

    if (rows.length === 0) {
      throw new Error(`Sync log with ID ${id} not found`);
    }

    return rows[0];
  }

  /**
   * Mark sync log as failed
   * @param {number} id
   * @param {string} errorMessage
   * @returns {Promise<Object>}
   */
  async fail(id, userId, errorMessage) {
    return this.complete(id, userId, {
      status: "failed",
      error: errorMessage,
      documentsFetched: 0,
      documentsStored: 0,
    });
  }

  /**
   * Get last successful sync for a source
   * @param {string} source
   * @param {number} userId
   * @returns {Promise<Object|null>}
   */
  async getLastSuccessfulSync(source, userId) {
    requireUserId(userId);
    const query = `
            SELECT * FROM sync_logs
            WHERE source = $1 AND status = 'success' AND user_id = $2
            ORDER BY sync_completed_at DESC
            LIMIT 1;`;

    const values = [source, userId];
    const { rows } = await this.db.query(query, values);

    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Get last sync (any status) for a source
   * @param {string} source
   * @param {number} userId
   * @returns {Promise<Object|null>}
   */
  async getLastSync(source, userId) {
    requireUserId(userId);
    const query = `
            SELECT * FROM sync_logs
            WHERE source = $1 AND user_id = $2
            ORDER BY sync_started_at DESC
            LIMIT 1;`;

    const values = [source, userId];
    const { rows } = await this.db.query(query, values);

    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Get all sync logs for a source belonging to a user
   * @param {string} source
   * @param {number} userId
   * @param {number} limit
   * @returns {Promise<Array>}
   */
  async findBySource(source, userId, limit = 5) {
    requireUserId(userId);
    const query = `
            SELECT * FROM sync_logs
            WHERE source = $1 AND user_id = $2
            ORDER BY sync_started_at DESC
            LIMIT $3;`;

    const values = [source, userId, limit];
    const { rows } = await this.db.query(query, values);

    return rows;
  }

  /**
   * Get all sync logs for a user (all sources)
   * @param {number} userId
   * @param {number} limit
   * @returns {Promise<Array>}
   */
  async findAll(userId, limit = 20) {
    requireUserId(userId);
    const query = `
            SELECT * FROM sync_logs
            WHERE user_id = $1
            ORDER BY sync_started_at DESC
            LIMIT $2;`;

    const values = [userId, limit];
    const { rows } = await this.db.query(query, values);

    return rows;
  }

  /**
   * Get sync statistics for a source belonging to a user
   * @param {string} source
   * @param {number} userId
   * @returns {Promise<Object>}
   */
  async getStats(source, userId) {
    requireUserId(userId);
    const query = `
            SELECT
                COUNT(*) as total_syncs,
                COUNT(CASE WHEN status = 'success' THEN 1 END) as successful_syncs,
                COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_syncs,
                COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as in_progress_syncs,
                SUM(documents_fetched) as total_documents_fetched,
                SUM(documents_stored) as total_documents_stored,
                MAX(sync_completed_at) as last_sync_time
            FROM sync_logs
            WHERE source = $1 AND user_id = $2;`;

    const values = [source, userId];
    const { rows } = await this.db.query(query, values);

    return rows[0];
  }

  /**
   * Check if a sync is currently in progress for a source belonging to a user
   * @param {string} source
   * @param {number} userId
   * @returns {Promise<boolean>}
   */
  async isSyncInProgress(source, userId) {
    requireUserId(userId);
    const query = `
            SELECT 1 FROM sync_logs
            WHERE source = $1 AND status = 'in_progress' AND user_id = $2
            LIMIT 1;`;

    const values = [source, userId];
    const { rows } = await this.db.query(query, values);

    return rows.length > 0;
  }

  /**
   * Delete old sync logs (cleanup)
   * @param {number} daysToKeep - Keep logs from last N days
   * @returns {Promise<number>} Number of deleted rows
   */
  async deleteOldLogs(daysToKeep = 30) {
    // Validate daysToKeep is a safe number
    const safeDaysToKeep = parseInt(daysToKeep, 10);
    if (isNaN(safeDaysToKeep) || safeDaysToKeep < 0) {
      throw new Error("daysToKeep must be a positive number");
    }

    const query = `
            DELETE FROM sync_logs
            WHERE sync_started_at < NOW() - INTERVAL '1 day' * $1
            RETURNING *;`;

    const values = [safeDaysToKeep];
    const { rows } = await this.db.query(query, values);

    return rows.length;
  }

  /**
   * Get sync logs by status for a user
   * @param {string} status - 'success', 'failed', or 'in_progress'
   * @param {number} userId
   * @param {number} limit
   * @returns {Promise<Array>}
   */
  async findByStatus(status, userId, limit = 10) {
    requireUserId(userId);
    const query = `
            SELECT * FROM sync_logs
            WHERE status = $1 AND user_id = $2
            ORDER BY sync_started_at DESC
            LIMIT $3;`;

    const values = [status, userId, limit];
    const { rows } = await this.db.query(query, values);

    return rows;
  }
}
