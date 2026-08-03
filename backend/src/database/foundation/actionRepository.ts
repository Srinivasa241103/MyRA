import type { Pool, PoolClient } from "pg";
import { getPool } from "../../config/dbConfig.js";
import type {
  ActionProposalStatus,
  ActionRisk,
  ApprovalDecision,
} from "../../agents/contracts/index.js";
import { withTransaction } from "../transaction.js";
import type { JsonObject, UserId } from "./types.js";
import { assertUserId } from "./types.js";

export interface CreateActionProposalInput {
  id: string;
  actionId: string;
  runId: string;
  userId: UserId;
  connector: string;
  actionType: string;
  toolName: string;
  risk: ActionRisk;
  schemaVersion: string;
  proposalVersion: string;
  normalizedPayload: JsonObject;
  payloadHash: string;
  evidenceIds?: string[];
  status?: ActionProposalStatus;
  expiresAt: Date | string;
}

export interface RecordApprovalInput {
  id: string;
  userId: UserId;
  proposalId: string;
  proposalHash: string;
  decision: ApprovalDecision["decision"];
  reason?: string;
}

export interface ClaimExecutionInput {
  userId: UserId;
  proposalId: string;
  idempotencyKey: string;
  requestHash: string;
}

interface CompleteExecutionBase {
  receiptId: string;
  userId: UserId;
  proposalId: string;
  provider: string;
  providerPayloadHash?: string | null;
  verificationStatus?: "pending" | "verified" | "mismatch" | "unavailable";
  details?: JsonObject;
}

export type CompleteExecutionInput = CompleteExecutionBase &
  (
    | {
        status: "succeeded";
        externalId: string;
        providerResult: JsonObject;
        error?: never;
        reconciliationMetadata?: never;
      }
    | {
        status: "failed";
        externalId?: string | null;
        providerResult?: never;
        error: JsonObject;
        reconciliationMetadata?: never;
      }
    | {
        status: "unknown";
        externalId?: string | null;
        providerResult?: never;
        error: JsonObject;
        reconciliationMetadata: JsonObject;
      }
  );

export class ActionStateConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActionStateConflictError";
  }
}

export class ActionRepository {
  constructor(private readonly pool: Pool = getPool()) {}

  async createProposal(input: CreateActionProposalInput): Promise<Record<string, unknown>> {
    assertUserId(input.userId);
    const result = await this.pool.query(
      `INSERT INTO action_proposals (
         id, action_id, run_id, user_id, connector, action_type, tool_name,
         risk, schema_version, proposal_version, normalized_payload,
         payload_hash, evidence_ids, status, expires_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
       )
       RETURNING *`,
      [
        input.id,
        input.actionId,
        input.runId,
        input.userId,
        input.connector,
        input.actionType,
        input.toolName,
        input.risk,
        input.schemaVersion,
        input.proposalVersion,
        input.normalizedPayload,
        input.payloadHash,
        input.evidenceIds ?? [],
        input.status ?? "proposed",
        input.expiresAt,
      ],
    );
    return result.rows[0];
  }

  async markWaitingForApproval(
    userId: UserId,
    proposalId: string,
  ): Promise<Record<string, unknown> | null> {
    assertUserId(userId);
    const result = await this.pool.query(
      `UPDATE action_proposals
       SET status = 'waiting_for_approval', updated_at = NOW()
       WHERE id = $1 AND user_id = $2 AND status = 'proposed'
       RETURNING *`,
      [proposalId, userId],
    );
    return result.rows[0] ?? null;
  }

  async findProposalById(
    userId: UserId,
    proposalId: string,
  ): Promise<Record<string, unknown> | null> {
    assertUserId(userId);
    const result = await this.pool.query(
      `SELECT * FROM action_proposals WHERE id = $1 AND user_id = $2`,
      [proposalId, userId],
    );
    return result.rows[0] ?? null;
  }

  async recordApproval(input: RecordApprovalInput): Promise<Record<string, unknown>> {
    assertUserId(input.userId);

    const outcome = await withTransaction(
      async (client) => {
        const proposal = await client.query<{
          action_id: string;
          run_id: string;
          proposal_version: string;
          payload_hash: string;
          status: string;
          expires_at: Date;
        }>(
          `SELECT action_id, run_id, proposal_version, payload_hash, status, expires_at
           FROM action_proposals
           WHERE id = $1 AND user_id = $2
           FOR UPDATE`,
          [input.proposalId, input.userId],
        );
        const row = proposal.rows[0];
        if (!row) {
          throw new ActionStateConflictError("Action proposal was not found for this user");
        }
        if (row.status !== "waiting_for_approval") {
          throw new ActionStateConflictError(`Action proposal is already ${row.status}`);
        }
        if (row.payload_hash !== input.proposalHash) {
          throw new ActionStateConflictError("Approval does not match the stored proposal payload");
        }
        if (row.expires_at.getTime() <= Date.now()) {
          await client.query(
            `UPDATE action_proposals
             SET status = 'expired', updated_at = NOW()
             WHERE id = $1 AND user_id = $2`,
            [input.proposalId, input.userId],
          );
          return { kind: "expired" as const };
        }

        const approval = await client.query(
          `INSERT INTO action_approvals (
             id, proposal_id, action_id, run_id, user_id, proposal_version,
             decision, proposal_hash, reason
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING *`,
          [
            input.id,
            input.proposalId,
            row.action_id,
            row.run_id,
            input.userId,
            row.proposal_version,
            input.decision,
            input.proposalHash,
            input.reason ?? null,
          ],
        );
        await client.query(
          `UPDATE action_proposals
           SET status = $3, updated_at = NOW()
           WHERE id = $1 AND user_id = $2`,
          [
            input.proposalId,
            input.userId,
            input.decision === "approve" ? "approved" : "rejected",
          ],
        );
        return { kind: "recorded" as const, approval: approval.rows[0] };
      },
      { isolationLevel: "SERIALIZABLE" },
      this.pool,
    );

    if (outcome.kind === "expired") {
      throw new ActionStateConflictError("Action proposal has expired");
    }
    return outcome.approval;
  }

  async claimExecution(input: ClaimExecutionInput): Promise<{
    claimed: boolean;
    proposal: Record<string, unknown>;
    idempotencyRecord: Record<string, unknown>;
  }> {
    assertUserId(input.userId);

    return withTransaction(
      async (client) => {
        const proposalResult = await client.query(
          `SELECT * FROM action_proposals
           WHERE id = $1 AND user_id = $2
           FOR UPDATE`,
          [input.proposalId, input.userId],
        );
        const proposal = proposalResult.rows[0];
        if (!proposal) {
          throw new ActionStateConflictError("Action proposal was not found for this user");
        }

        if (proposal.status !== "approved") {
          throw new ActionStateConflictError(
            `Only an approved action can execute; current status is ${proposal.status}`,
          );
        }
        if (proposal.payload_hash !== input.requestHash) {
          throw new ActionStateConflictError(
            "Execution payload does not match the approved proposal payload",
          );
        }

        const inserted = await client.query(
          `INSERT INTO idempotency_records (
             proposal_id, user_id, idempotency_key, request_hash, status, locked_at
           ) VALUES ($1, $2, $3, $4, 'executing', NOW())
           ON CONFLICT (user_id, idempotency_key) DO NOTHING
           RETURNING *`,
          [
            input.proposalId,
            input.userId,
            input.idempotencyKey,
            input.requestHash,
          ],
        );

        if (inserted.rows.length === 0) {
          const existingResult = await client.query(
            `SELECT * FROM idempotency_records
             WHERE user_id = $1 AND idempotency_key = $2
             FOR UPDATE`,
            [input.userId, input.idempotencyKey],
          );
          const existing = existingResult.rows[0];
          if (
            !existing ||
            existing.proposal_id !== input.proposalId ||
            existing.request_hash !== input.requestHash
          ) {
            throw new ActionStateConflictError(
              "Idempotency key is already bound to a different action payload",
            );
          }
          return { claimed: false, proposal, idempotencyRecord: existing };
        }

        return {
          claimed: true,
          proposal,
          idempotencyRecord: inserted.rows[0],
        };
      },
      { isolationLevel: "SERIALIZABLE" },
      this.pool,
    );
  }

  async completeExecution(input: CompleteExecutionInput): Promise<Record<string, unknown>> {
    assertUserId(input.userId);

    return withTransaction(
      async (client: PoolClient) => {
        const state = await client.query<{
          proposal_status: string;
          idempotency_record_id: string;
          idempotency_key: string;
          request_hash: string;
          action_id: string;
          approval_decision_id: string;
          run_id: string;
          connector: string;
          action_type: string;
          proposal_version: string;
          payload_hash: string;
        }>(
          `SELECT
             p.status AS proposal_status,
             i.id AS idempotency_record_id,
             i.idempotency_key,
             i.request_hash,
             p.action_id,
             a.id AS approval_decision_id,
             p.run_id,
             p.connector,
             p.action_type,
             p.proposal_version,
             p.payload_hash
           FROM action_proposals p
           JOIN idempotency_records i
             ON i.proposal_id = p.id AND i.user_id = p.user_id
           JOIN action_approvals a
             ON a.proposal_id = p.id
            AND a.user_id = p.user_id
            AND a.decision = 'approve'
           WHERE p.id = $1 AND p.user_id = $2
           FOR UPDATE OF p, i, a`,
          [input.proposalId, input.userId],
        );
        const current = state.rows[0];
        if (!current) {
          throw new ActionStateConflictError("Executing action was not found for this user");
        }
        if (current.proposal_status !== "approved") {
          throw new ActionStateConflictError(
            `Cannot complete an action in ${current.proposal_status} state`,
          );
        }
        if (current.request_hash !== current.payload_hash) {
          throw new ActionStateConflictError(
            "Stored execution payload does not match the approved proposal payload",
          );
        }
        if (
          input.providerPayloadHash &&
          input.providerPayloadHash !== current.payload_hash
        ) {
          throw new ActionStateConflictError(
            "Provider payload does not match the approved proposal payload",
          );
        }

        await client.query(
          `UPDATE idempotency_records
           SET status = $3, external_id = $4, updated_at = NOW()
           WHERE proposal_id = $1 AND user_id = $2`,
          [input.proposalId, input.userId, input.status, input.externalId ?? null],
        );
        const receipt = await client.query(
          `INSERT INTO action_receipts (
             id, proposal_id, action_id, approval_decision_id,
             idempotency_record_id, run_id, user_id, connector, provider,
             action_type, proposal_version, payload_hash, idempotency_key,
             external_id, status, provider_payload_hash, provider_result,
             error, reconciliation_required, reconciliation_metadata,
             verification_status, details
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
             $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22
           )
           RETURNING *`,
          [
            input.receiptId,
            input.proposalId,
            current.action_id,
            current.approval_decision_id,
            current.idempotency_record_id,
            current.run_id,
            input.userId,
            current.connector,
            input.provider,
            current.action_type,
            current.proposal_version,
            current.payload_hash,
            current.idempotency_key,
            input.externalId ?? null,
            input.status,
            input.providerPayloadHash ?? null,
            input.status === "succeeded" ? input.providerResult : null,
            input.status === "succeeded" ? null : input.error,
            input.status === "unknown",
            input.status === "unknown" ? input.reconciliationMetadata : null,
            input.verificationStatus ?? "pending",
            input.details ?? {},
          ],
        );
        return receipt.rows[0];
      },
      { isolationLevel: "SERIALIZABLE" },
      this.pool,
    );
  }

  async findReceiptByProposal(
    userId: UserId,
    proposalId: string,
  ): Promise<Record<string, unknown> | null> {
    assertUserId(userId);
    const result = await this.pool.query(
      `SELECT * FROM action_receipts WHERE proposal_id = $1 AND user_id = $2`,
      [proposalId, userId],
    );
    return result.rows[0] ?? null;
  }
}
