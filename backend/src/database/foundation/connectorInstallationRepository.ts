import { getPool } from "../../config/dbConfig.js";
import type { JsonObject, Queryable, UserId } from "./types.js";
import { assertUserId } from "./types.js";

export interface SaveConnectorInstallationInput {
  id: string;
  userId: UserId;
  connector: string;
  status?: string;
  capabilities?: string[];
  scopes?: string[];
  credentialReference: string;
  metadata?: JsonObject;
}

export class ConnectorInstallationRepository {
  constructor(private readonly db: Queryable = getPool()) {}

  async save(input: SaveConnectorInstallationInput): Promise<Record<string, unknown>> {
    assertUserId(input.userId);
    const result = await this.db.query(
      `INSERT INTO connector_installations (
         id, user_id, connector, status, capabilities, scopes,
         credential_reference, metadata
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (user_id, connector)
       DO UPDATE SET
         status = EXCLUDED.status,
         capabilities = EXCLUDED.capabilities,
         scopes = EXCLUDED.scopes,
         credential_reference = EXCLUDED.credential_reference,
         metadata = EXCLUDED.metadata,
         updated_at = NOW()
       RETURNING *`,
      [
        input.id,
        input.userId,
        input.connector,
        input.status ?? "connected",
        input.capabilities ?? [],
        input.scopes ?? [],
        input.credentialReference,
        input.metadata ?? {},
      ],
    );
    return result.rows[0];
  }

  async findByConnector(
    userId: UserId,
    connector: string,
  ): Promise<Record<string, unknown> | null> {
    assertUserId(userId);
    const result = await this.db.query(
      `SELECT * FROM connector_installations
       WHERE user_id = $1 AND connector = $2`,
      [userId, connector],
    );
    return result.rows[0] ?? null;
  }

  async updateStatus(
    userId: UserId,
    connector: string,
    status: string,
  ): Promise<Record<string, unknown> | null> {
    assertUserId(userId);
    const result = await this.db.query(
      `UPDATE connector_installations
       SET status = $3, updated_at = NOW()
       WHERE user_id = $1 AND connector = $2
       RETURNING *`,
      [userId, connector, status],
    );
    return result.rows[0] ?? null;
  }
}
