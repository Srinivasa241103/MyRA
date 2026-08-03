import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { Pool } from "pg";
import { ActionRepository } from "../../src/database/foundation/actionRepository.js";
import { AgentRunRepository } from "../../src/database/foundation/agentRunRepository.js";
import { AuditEventRepository } from "../../src/database/foundation/auditEventRepository.js";
import { ConnectorInstallationRepository } from "../../src/database/foundation/connectorInstallationRepository.js";
import { EvidenceRepository } from "../../src/database/foundation/evidenceRepository.js";
import { runMigrations } from "../../src/database/migrations/migrationRunner.js";

const connectionString = process.env.FND_TEST_DATABASE_URL;

if (!connectionString) {
  test("FND-03 PostgreSQL integration suite", { skip: "Set FND_TEST_DATABASE_URL" }, () => {});
} else {
  const databaseName = new URL(connectionString).pathname.slice(1);
  if (!databaseName.startsWith("myra_fnd_test")) {
    throw new Error("FND_TEST_DATABASE_URL must target a database named myra_fnd_test*");
  }

  const pool = new Pool({ connectionString });
  const agentRuns = new AgentRunRepository(pool);
  const evidence = new EvidenceRepository(pool);
  const actions = new ActionRepository(pool);
  const connectors = new ConnectorInstallationRepository(pool);
  const audit = new AuditEventRepository(pool);

  const userA = 101;
  const userB = 202;
  const runId = randomUUID();
  const contentHash = "c".repeat(64);
  const payloadHash = "a".repeat(64);

  before(async () => {
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
  });

  after(async () => {
    await pool.end();
  });

  test("ordered migrations apply to an empty database and rerun without mutation", async () => {
    const firstRun = await runMigrations({ pool });
    assert.deepEqual(firstRun.applied.map((migration) => migration.name), [
      "0001_fnd_03_foundation.sql",
    ]);

    const beforeRerun = await pool.query<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public'",
    );
    const secondRun = await runMigrations({ pool });
    const afterRerun = await pool.query<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public'",
    );

    assert.equal(secondRun.applied.length, 0);
    assert.deepEqual(secondRun.skipped, ["0001_fnd_03_foundation.sql"]);
    assert.equal(afterRerun.rows[0].count, beforeRerun.rows[0].count);
  });

  test("run, evidence, connector, and audit repositories enforce user scope", async () => {
    await agentRuns.create({
      id: runId,
      userId: userA,
      conversationId: randomUUID(),
      requestId: randomUUID(),
      flow: "cross_source_answer",
      schemaVersion: "2.0.0",
      flowContractVersion: "2.0.0",
      requestPayload: { query: "synthetic project status" },
      state: {
        kind: "active",
        status: "created",
        enteredAt: new Date().toISOString(),
      },
      budgetLimits: { maxSteps: 10, maxRetries: 2 },
      budgetUsage: { steps: 0, retries: 0 },
    });

    assert.equal((await agentRuns.findById(userA, runId))?.id, runId);
    assert.equal(await agentRuns.findById(userB, runId), null);
    assert.equal(
      await agentRuns.updateStatus({ userId: userB, runId, status: "failed" }),
      null,
    );
    assert.equal((await agentRuns.findById(userA, runId))?.status, "created");

    const evidenceId = randomUUID();
    await evidence.create({
      id: evidenceId,
      runId,
      userId: userA,
      source: "gmail",
      sourceRecordId: "fixture-message-1",
      content: "Synthetic evidence only",
      retrievedAt: new Date(),
      freshness: "recent_index",
      contentHash,
    });
    assert.equal((await evidence.findById(userA, evidenceId))?.id, evidenceId);
    assert.equal(await evidence.findById(userB, evidenceId), null);
    assert.deepEqual(await evidence.listForRun(userB, runId), []);

    await connectors.save({
      id: randomUUID(),
      userId: userA,
      connector: "gmail",
      scopes: ["gmail.readonly"],
      capabilities: ["search", "fetch"],
      credentialReference: "fixture-credential-reference",
    });
    assert.equal((await connectors.findByConnector(userA, "gmail"))?.connector, "gmail");
    assert.equal(await connectors.findByConnector(userB, "gmail"), null);
    assert.equal(await connectors.updateStatus(userB, "gmail", "revoked"), null);

    await audit.append({
      userId: userA,
      runId,
      eventType: "run.created",
      entityType: "agent_run",
      entityId: runId,
    });
    assert.equal((await audit.listForEntity(userA, "agent_run", runId)).length, 1);
    assert.equal((await audit.listForEntity(userB, "agent_run", runId)).length, 0);
  });

  test("action transitions bind approval and idempotency to the same user and payload", async () => {
    const proposalId = randomUUID();
    await actions.createProposal({
      id: proposalId,
      actionId: randomUUID(),
      runId,
      userId: userA,
      connector: "calendar",
      actionType: "calendar.create_event",
      toolName: "calendar_create_event",
      risk: "medium",
      schemaVersion: "2.0.0",
      proposalVersion: "1",
      normalizedPayload: { title: "Synthetic review" },
      payloadHash,
      expiresAt: new Date(Date.now() + 60_000),
    });

    assert.equal(await actions.findProposalById(userB, proposalId), null);
    assert.equal((await actions.markWaitingForApproval(userA, proposalId))?.status, "waiting_for_approval");
    await actions.recordApproval({
      id: randomUUID(),
      userId: userA,
      proposalId,
      proposalHash: payloadHash,
      decision: "approve",
    });

    const idempotencyKey = `calendar:${randomUUID()}`;
    const claimed = await actions.claimExecution({
      userId: userA,
      proposalId,
      idempotencyKey,
      requestHash: payloadHash,
    });
    assert.equal(claimed.claimed, true);

    const replay = await actions.claimExecution({
      userId: userA,
      proposalId,
      idempotencyKey,
      requestHash: payloadHash,
    });
    assert.equal(replay.claimed, false);

    const receiptId = randomUUID();
    await actions.completeExecution({
      receiptId,
      userId: userA,
      proposalId,
      provider: "google_calendar",
      externalId: "fixture-event-1",
      status: "succeeded",
      providerPayloadHash: payloadHash,
      providerResult: { id: "fixture-event-1" },
      verificationStatus: "verified",
    });
    assert.equal((await actions.findReceiptByProposal(userA, proposalId))?.id, receiptId);
    assert.equal(await actions.findReceiptByProposal(userB, proposalId), null);
  });

  test("database constraints reject duplicate idempotency keys and invalid states", async () => {
    const secondProposalId = randomUUID();
    await actions.createProposal({
      id: secondProposalId,
      actionId: randomUUID(),
      runId,
      userId: userA,
      connector: "calendar",
      actionType: "calendar.create_event",
      toolName: "calendar_create_event",
      risk: "medium",
      schemaVersion: "2.0.0",
      proposalVersion: "1",
      normalizedPayload: { title: "Second synthetic review" },
      payloadHash: "b".repeat(64),
      expiresAt: new Date(Date.now() + 60_000),
    });

    const existingKey = await pool.query<{ idempotency_key: string }>(
      "SELECT idempotency_key FROM idempotency_records WHERE user_id = $1 LIMIT 1",
      [userA],
    );
    await assert.rejects(
      pool.query(
        `INSERT INTO idempotency_records (
           proposal_id, user_id, idempotency_key, request_hash
         ) VALUES ($1, $2, $3, $4)`,
        [secondProposalId, userA, existingKey.rows[0].idempotency_key, "b".repeat(64)],
      ),
      (error: unknown) =>
        typeof error === "object" && error !== null && "code" in error && error.code === "23505",
    );

    await assert.rejects(
      pool.query(
        `UPDATE agent_runs SET status = 'not_a_real_status' WHERE id = $1 AND user_id = $2`,
        [runId, userA],
      ),
      (error: unknown) =>
        typeof error === "object" && error !== null && "code" in error && error.code === "23514",
    );
  });
}
