import { getPool } from "../../config/dbConfig.js";
import type { JsonObject, Queryable, UserId } from "./types.js";
import { assertUserId } from "./types.js";

export interface AppendAuditEventInput {
  userId: UserId;
  runId?: string | null;
  eventType: string;
  entityType: string;
  entityId: string;
  details?: JsonObject;
}

export class AuditEventRepository {
  constructor(private readonly db: Queryable = getPool()) {}

  async append(input: AppendAuditEventInput): Promise<Record<string, unknown>> {
    assertUserId(input.userId);
    const result = await this.db.query(
      `INSERT INTO audit_events (
         user_id, run_id, event_type, entity_type, entity_id, details
       ) VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        input.userId,
        input.runId ?? null,
        input.eventType,
        input.entityType,
        input.entityId,
        input.details ?? {},
      ],
    );
    return result.rows[0];
  }

  async listForEntity(
    userId: UserId,
    entityType: string,
    entityId: string,
  ): Promise<Record<string, unknown>[]> {
    assertUserId(userId);
    const result = await this.db.query(
      `SELECT * FROM audit_events
       WHERE user_id = $1 AND entity_type = $2 AND entity_id = $3
       ORDER BY created_at, id`,
      [userId, entityType, entityId],
    );
    return result.rows;
  }
}
