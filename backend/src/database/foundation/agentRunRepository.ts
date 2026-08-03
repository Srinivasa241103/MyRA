import { getPool } from "../../config/dbConfig.js";
import type {
  ActionRisk,
  AgentRunStatus,
  SupportedFlow,
  ToolCallStatus,
  ToolMode,
} from "../../agents/contracts/index.js";
import type { JsonObject, Queryable, UserId } from "./types.js";
import { assertUserId } from "./types.js";

export interface CreateAgentRunInput {
  id: string;
  userId: UserId;
  conversationId: string;
  requestId: string;
  flow: SupportedFlow | null;
  status?: AgentRunStatus;
  schemaVersion: string;
  flowContractVersion: string | null;
  graphVersion?: string | null;
  requestPayload: JsonObject;
  state: JsonObject;
  budgetLimits: JsonObject;
  budgetUsage: JsonObject;
}

export interface CreateAgentStepInput {
  id: string;
  userId: UserId;
  runId: string;
  stepKey: string;
  stepType: string;
  status?: string;
  attempt?: number;
  sequenceNumber: number;
  inputSummary?: JsonObject;
}

export interface CreateToolCallInput {
  id: string;
  userId: UserId;
  runId: string;
  stepId?: string | null;
  toolName: string;
  toolSchemaVersion: string;
  connector: string;
  capability: string;
  mode: ToolMode;
  risk: ActionRisk;
  status?: ToolCallStatus;
  argumentsHash: string;
}

export class AgentRunRepository {
  constructor(private readonly db: Queryable = getPool()) {}

  async create(input: CreateAgentRunInput): Promise<Record<string, unknown>> {
    assertUserId(input.userId);
    const result = await this.db.query(
      `INSERT INTO agent_runs (
         id, user_id, conversation_id, request_id, flow, status, schema_version,
         flow_contract_version, graph_version, request_payload, state,
         budget_limits, budget_usage
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [
        input.id,
        input.userId,
        input.conversationId,
        input.requestId,
        input.flow,
        input.status ?? "created",
        input.schemaVersion,
        input.flowContractVersion,
        input.graphVersion ?? null,
        input.requestPayload,
        input.state,
        input.budgetLimits,
        input.budgetUsage,
      ],
    );
    return result.rows[0];
  }

  async findById(userId: UserId, runId: string): Promise<Record<string, unknown> | null> {
    assertUserId(userId);
    const result = await this.db.query(
      `SELECT * FROM agent_runs WHERE id = $1 AND user_id = $2`,
      [runId, userId],
    );
    return result.rows[0] ?? null;
  }

  async updateStatus({
    userId,
    runId,
    status,
    errorCode = null,
    errorMessage = null,
  }: {
    userId: UserId;
    runId: string;
    status: AgentRunStatus;
    errorCode?: string | null;
    errorMessage?: string | null;
  }): Promise<Record<string, unknown> | null> {
    assertUserId(userId);
    const result = await this.db.query(
      `UPDATE agent_runs
       SET status = $3,
           error_code = $4,
           error_message = $5,
           started_at = CASE WHEN $3 = 'planning' THEN COALESCE(started_at, NOW()) ELSE started_at END,
           completed_at = CASE
             WHEN $3 IN ('completed', 'partially_completed', 'failed', 'cancelled') THEN NOW()
             ELSE NULL
           END,
           updated_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [runId, userId, status, errorCode, errorMessage],
    );
    return result.rows[0] ?? null;
  }

  async createStep(input: CreateAgentStepInput): Promise<Record<string, unknown>> {
    assertUserId(input.userId);
    const result = await this.db.query(
      `INSERT INTO agent_steps (
         id, run_id, user_id, step_key, step_type, status,
         attempt, sequence_number, input_summary
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        input.id,
        input.runId,
        input.userId,
        input.stepKey,
        input.stepType,
        input.status ?? "created",
        input.attempt ?? 1,
        input.sequenceNumber,
        input.inputSummary ?? {},
      ],
    );
    return result.rows[0];
  }

  async findStepById(
    userId: UserId,
    stepId: string,
  ): Promise<Record<string, unknown> | null> {
    assertUserId(userId);
    const result = await this.db.query(
      `SELECT * FROM agent_steps WHERE id = $1 AND user_id = $2`,
      [stepId, userId],
    );
    return result.rows[0] ?? null;
  }

  async createToolCall(input: CreateToolCallInput): Promise<Record<string, unknown>> {
    assertUserId(input.userId);
    const result = await this.db.query(
      `INSERT INTO tool_calls (
         id, run_id, step_id, user_id, tool_name, tool_schema_version,
         connector, capability, mode, risk, status, arguments_hash
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        input.id,
        input.runId,
        input.stepId ?? null,
        input.userId,
        input.toolName,
        input.toolSchemaVersion,
        input.connector,
        input.capability,
        input.mode,
        input.risk,
        input.status ?? "pending",
        input.argumentsHash,
      ],
    );
    return result.rows[0];
  }

  async findToolCallById(
    userId: UserId,
    toolCallId: string,
  ): Promise<Record<string, unknown> | null> {
    assertUserId(userId);
    const result = await this.db.query(
      `SELECT * FROM tool_calls WHERE id = $1 AND user_id = $2`,
      [toolCallId, userId],
    );
    return result.rows[0] ?? null;
  }
}
