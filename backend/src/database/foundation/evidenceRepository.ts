import { getPool } from "../../config/dbConfig.js";
import type {
  EvidenceFreshness,
  EvidenceSource,
} from "../../agents/contracts/index.js";
import type { JsonObject, Queryable, UserId } from "./types.js";
import { assertUserId } from "./types.js";

export interface CreateEvidenceInput {
  id: string;
  runId: string;
  toolCallId?: string | null;
  userId: UserId;
  source: EvidenceSource;
  sourceRecordId: string;
  canonicalUrl?: string | null;
  title?: string | null;
  content: string;
  author?: string | null;
  occurredAt?: Date | string | null;
  retrievedAt: Date | string;
  freshness: EvidenceFreshness;
  contentHash: string;
  permissionScope?: string[];
  metadata?: JsonObject;
}

export class EvidenceRepository {
  constructor(private readonly db: Queryable = getPool()) {}

  async create(input: CreateEvidenceInput): Promise<Record<string, unknown>> {
    assertUserId(input.userId);
    const result = await this.db.query(
      `INSERT INTO evidence_items (
         id, run_id, tool_call_id, user_id, source, source_record_id,
         canonical_url, title, content, author, occurred_at, retrieved_at,
         freshness, content_hash, permission_scope, metadata
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
       )
       RETURNING *`,
      [
        input.id,
        input.runId,
        input.toolCallId ?? null,
        input.userId,
        input.source,
        input.sourceRecordId,
        input.canonicalUrl ?? null,
        input.title ?? null,
        input.content,
        input.author ?? null,
        input.occurredAt ?? null,
        input.retrievedAt,
        input.freshness,
        input.contentHash,
        input.permissionScope ?? [],
        input.metadata ?? {},
      ],
    );
    return result.rows[0];
  }

  async findById(
    userId: UserId,
    evidenceId: string,
  ): Promise<Record<string, unknown> | null> {
    assertUserId(userId);
    const result = await this.db.query(
      `SELECT * FROM evidence_items WHERE id = $1 AND user_id = $2`,
      [evidenceId, userId],
    );
    return result.rows[0] ?? null;
  }

  async listForRun(userId: UserId, runId: string): Promise<Record<string, unknown>[]> {
    assertUserId(userId);
    const result = await this.db.query(
      `SELECT * FROM evidence_items
       WHERE run_id = $1 AND user_id = $2
       ORDER BY created_at, id`,
      [runId, userId],
    );
    return result.rows;
  }
}
