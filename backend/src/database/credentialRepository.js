// src/database/credentialRepository.js
import { getPool } from "../config/dbConfig.js";

function requireUserId(userId) {
  if (userId === undefined || userId === null || String(userId).trim() === "") {
    throw new Error("userId is required for credential operations");
  }
}

export class CredentialRepository {
  constructor(db = getPool()) {
    this.db = db;
  }

  /**
   * Create or update credentials for a source
   * @param {Object} credential
   * @returns {Promise<Object>}
   */
  async insert(credential) {
    requireUserId(credential.user_id);
    const query = `
            INSERT INTO api_credentials
            (source, user_id, access_token, refresh_token, token_expires_at, scope)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (user_id, source)
            DO UPDATE SET
                access_token = EXCLUDED.access_token,
                refresh_token = EXCLUDED.refresh_token,
                token_expires_at = EXCLUDED.token_expires_at,
                scope = EXCLUDED.scope,
                updated_at = NOW()
            RETURNING *;`;

    const values = [
      credential.source,
      credential.user_id,
      credential.access_token,
      credential.refresh_token,
      credential.token_expires_at,
      credential.scope || null,
    ];

    const { rows } = await this.db.query(query, values);

    if (rows.length === 0) {
      throw new Error("Failed to save credentials");
    }

    return rows[0];
  }

  /**
   * Find credentials by source
   * @param {string|number} userId
   * @param {string} source
   * @returns {Promise<Object|null>}
   */
  async findBySource(userId, source) {
    requireUserId(userId);
    const query = `
            SELECT * FROM api_credentials
            WHERE user_id = $1 AND source = $2;`;

    const values = [userId, source];
    const { rows } = await this.db.query(query, values);

    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Find credentials by user ID and source
   * @param {string} userId
   * @param {string} source
   * @returns {Promise<Object|null>}
   */
  async findByUserAndSource(userId, source) {
    requireUserId(userId);
    const query = `
            SELECT * FROM api_credentials
            WHERE user_id = $1 AND source = $2;`;

    const values = [userId, source];
    const { rows } = await this.db.query(query, values);

    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Update credentials by ID
   * @param {string|number} userId
   * @param {string} id
   * @param {Object} updates
   * @returns {Promise<Object>}
   */
  async update(userId, id, updates) {
    requireUserId(userId);
    const setClauses = [];
    const values = [];
    let paramIndex = 1;

    if (updates.accessToken !== undefined) {
      setClauses.push(`access_token = $${paramIndex++}`);
      values.push(updates.accessToken);
    }
    if (updates.refreshToken !== undefined) {
      setClauses.push(`refresh_token = $${paramIndex++}`);
      values.push(updates.refreshToken);
    }
    if (updates.tokenExpiry !== undefined) {
      setClauses.push(`token_expires_at = $${paramIndex++}`);
      values.push(updates.tokenExpiry);
    }

    setClauses.push(`updated_at = NOW()`);
    values.push(id, userId);

    const query = `
            UPDATE api_credentials
            SET ${setClauses.join(", ")}
            WHERE id = $${paramIndex} AND user_id = $${paramIndex + 1}
            RETURNING *;`;

    const { rows } = await this.db.query(query, values);

    if (rows.length === 0) {
      throw new Error(`Credentials with id ${id} not found`);
    }

    return rows[0];
  }

  /**
   * Update access token (when refreshed)
   * @param {string|number} userId
   * @param {string} source
   * @param {string} accessToken
   * @param {Date} expiresAt
   * @returns {Promise<Object>}
   */
  async updateAccessToken(userId, source, accessToken, expiresAt) {
    requireUserId(userId);
    const query = `
            UPDATE api_credentials
            SET 
                access_token = $1,
                token_expires_at = $2,
                updated_at = NOW()
            WHERE user_id = $3 AND source = $4
            RETURNING *;`;

    const values = [accessToken, expiresAt, userId, source];
    const { rows } = await this.db.query(query, values);

    if (rows.length === 0) {
      throw new Error(`Credentials for ${source} not found`);
    }

    return rows[0];
  }

  /**
   * Check if token is expired or about to expire
   * @param {string|number} userId
   * @param {string} source
   * @param {number} bufferMinutes - Consider expired if expires within N minutes
   * @returns {Promise<boolean>}
   */
  async isTokenExpired(userId, source, bufferMinutes = 5) {
    requireUserId(userId);
    // Validate bufferMinutes is a safe number
    const safeBufferMinutes = parseInt(bufferMinutes, 10);
    if (isNaN(safeBufferMinutes) || safeBufferMinutes < 0) {
      throw new Error("bufferMinutes must be a positive number");
    }

    const query = `
            SELECT
                CASE
                    WHEN token_expires_at IS NULL THEN false
                    WHEN token_expires_at <= NOW() + INTERVAL '1 minute' * $3 THEN true
                    ELSE false
                END as is_expired
            FROM api_credentials
            WHERE user_id = $1 AND source = $2;`;

    const values = [userId, source, safeBufferMinutes];
    const { rows } = await this.db.query(query, values);

    if (rows.length === 0) {
      return true; // No credentials = consider expired
    }

    return rows[0].is_expired;
  }

  /**
   * Get all connected sources
   * @param {string|number} userId
   * @returns {Promise<Array>}
   */
  async getAllSources(userId) {
    requireUserId(userId);
    const query = `
            SELECT source, created_at, updated_at, token_expires_at
            FROM api_credentials
            WHERE user_id = $1
            ORDER BY source;`;

    const { rows } = await this.db.query(query, [userId]);

    return rows;
  }

  /**
   * Delete credentials for a source (disconnect)
   * @param {string|number} userId
   * @param {string} credentialId
   * @returns {Promise<boolean>}
   */
  async delete(userId, credentialId) {
    requireUserId(userId);
    const query = `
            DELETE FROM api_credentials
            WHERE user_id = $1 AND id = $2
            RETURNING *;`;

    const values = [userId, credentialId];
    const { rows } = await this.db.query(query, values);

    return rows.length > 0;
  }

  /**
   * Check if source is connected (has valid credentials)
   * @param {string|number} userId
   * @param {string} source
   * @returns {Promise<boolean>}
   */
  async isConnected(userId, source) {
    requireUserId(userId);
    const query = `
            SELECT 1 FROM api_credentials
            WHERE user_id = $1 AND source = $2;`;

    const values = [userId, source];
    const { rows } = await this.db.query(query, values);

    return rows.length > 0;
  }

  /**
   * Get credentials that need refresh (expired or about to expire)
   * @param {string|number} userId
   * @param {number} bufferMinutes
   * @returns {Promise<Array>}
   */
  async findExpiredCredentials(userId, bufferMinutes = 5) {
    requireUserId(userId);
    // Validate bufferMinutes is a safe number
    const safeBufferMinutes = parseInt(bufferMinutes, 10);
    if (isNaN(safeBufferMinutes) || safeBufferMinutes < 0) {
      throw new Error("bufferMinutes must be a positive number");
    }

    const query = `
            SELECT * FROM api_credentials
            WHERE user_id = $1
              AND (
                token_expires_at <= NOW() + INTERVAL '1 minute' * $2
                OR token_expires_at IS NULL
              );`;

    const values = [userId, safeBufferMinutes];
    const { rows } = await this.db.query(query, values);

    return rows;
  }

  /**
   * Update refresh token
   * @param {string|number} userId
   * @param {string} source
   * @param {string} refreshToken
   * @returns {Promise<Object>}
   */
  async updateRefreshToken(userId, source, refreshToken) {
    requireUserId(userId);
    const query = `
            UPDATE api_credentials
            SET
                refresh_token = $1,
                updated_at = NOW()
            WHERE user_id = $2 AND source = $3
            RETURNING *;`;

    const values = [refreshToken, userId, source];
    const { rows } = await this.db.query(query, values);

    if (rows.length === 0) {
      throw new Error(`Credentials for ${source} not found`);
    }

    return rows[0];
  }

  /**
   * Store OAuth tokens for a user (upsert)
   * @param {string} userId
   * @param {string} source
   * @param {Object} tokenData
   * @returns {Promise<Object>}
   */
  async storeOAuthTokens(userId, source, tokenData) {
    requireUserId(userId);
    const query = `
      INSERT INTO api_credentials (
        user_id,
        source,
        access_token,
        refresh_token,
        token_expires_at,
        scopes,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
      ON CONFLICT (user_id, source)
      DO UPDATE SET
        access_token = $3,
        refresh_token = COALESCE($4, api_credentials.refresh_token),
        token_expires_at = $5,
        scopes = $6,
        updated_at = NOW()
      RETURNING *`;

    const values = [
      userId,
      source,
      tokenData.accessToken,
      tokenData.refreshToken,
      tokenData.expiryDate,
      JSON.stringify(tokenData.scopes || []),
    ];

    const { rows } = await this.db.query(query, values);

    return rows[0];
  }

  /**
   * Get connected sources for a user
   * @param {string} userId
   * @returns {Promise<Array>}
   */
  async getConnectedSources(userId) {
    requireUserId(userId);
    const query = `
      SELECT
        source,
        token_expires_at,
        scopes,
        created_at
      FROM api_credentials
      WHERE user_id = $1`;

    const values = [userId];
    const { rows } = await this.db.query(query, values);

    return rows;
  }

  /**
   * Find active users who have credentials for any of the provided sources.
   * @param {string[]} sources
   * @returns {Promise<Array<{user_id: string|number, sources: string[]}>>}
   */
  async findUsersWithSources(sources = []) {
    if (!Array.isArray(sources) || sources.length === 0) {
      return [];
    }

    const query = `
      SELECT
        u.id AS user_id,
        ARRAY_AGG(DISTINCT c.source) AS sources
      FROM api_credentials c
      JOIN users u ON u.id::text = c.user_id::text
      WHERE c.source = ANY($1::text[])
        AND (u.status IS NULL OR u.status = 'active')
      GROUP BY u.id
      ORDER BY u.id`;

    const values = [sources];
    const { rows } = await this.db.query(query, values);

    return rows;
  }

  /**
   * Get user credentials by user ID and source
   * @param {string} userId
   * @param {string} source
   * @returns {Promise<Object|null>}
   */
  async getUserCredentials(userId, source) {
    requireUserId(userId);
    const query = `
      SELECT * FROM api_credentials
      WHERE user_id = $1 AND source = $2`;

    const values = [userId, source];
    const { rows } = await this.db.query(query, values);

    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Delete user credentials
   * @param {string} userId
   * @param {string} source
   * @returns {Promise<boolean>}
   */
  async deleteUserCredentials(userId, source) {
    requireUserId(userId);
    const query = `
      DELETE FROM api_credentials
      WHERE user_id = $1 AND source = $2
      RETURNING *`;

    const values = [userId, source];
    const { rows } = await this.db.query(query, values);

    return rows.length > 0;
  }
}
