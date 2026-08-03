import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { Pool } from "pg";
import { ActionRepository } from "../../src/database/foundation/actionRepository.js";
import { AgentRunRepository } from "../../src/database/foundation/agentRunRepository.js";
import { AuditEventRepository } from "../../src/database/foundation/auditEventRepository.js";
import { ConnectorInstallationRepository } from "../../src/database/foundation/connectorInstallationRepository.js";
import { EvidenceRepository } from "../../src/database/foundation/evidenceRepository.js";
import {
  DEFAULT_MIGRATIONS_DIRECTORY,
  runMigrations,
} from "../../src/database/migrations/migrationRunner.js";

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
    const legacyDirectory = await mkdtemp(join(tmpdir(), "myra-fnd-legacy-"));
    try {
      await copyFile(
        join(DEFAULT_MIGRATIONS_DIRECTORY, "0001_fnd_03_foundation.sql"),
        join(legacyDirectory, "0001_fnd_03_foundation.sql"),
      );
      const firstRun = await runMigrations({ pool, directory: legacyDirectory });
      assert.deepEqual(firstRun.applied.map((migration) => migration.name), [
        "0001_fnd_03_foundation.sql",
      ]);
    } finally {
      await rm(legacyDirectory, { recursive: true, force: true });
    }

    const upgradeRunId = randomUUID();
    const upgradeProposalId = randomUUID();
    const upgradeHash = "8".repeat(64);
    await agentRuns.create({
      id: upgradeRunId,
      userId: userA,
      conversationId: randomUUID(),
      requestId: randomUUID(),
      flow: "schedule_meeting",
      schemaVersion: "2.0.0",
      flowContractVersion: "2.0.0",
      requestPayload: { query: "upgrade fixture" },
      state: { kind: "active", status: "created" },
      budgetLimits: { maxSteps: 5 },
      budgetUsage: { steps: 0 },
    });
    await actions.createProposal({
      id: upgradeProposalId,
      actionId: randomUUID(),
      runId: upgradeRunId,
      userId: userA,
      connector: "calendar",
      actionType: "calendar.create_event",
      toolName: "calendar_create_event",
      risk: "medium",
      schemaVersion: "2.0.0",
      proposalVersion: "1",
      normalizedPayload: { title: "Upgrade fixture" },
      payloadHash: upgradeHash,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await actions.markWaitingForApproval(userA, upgradeProposalId);
    const upgradeApproval = await actions.recordApproval({
      id: randomUUID(),
      userId: userA,
      proposalId: upgradeProposalId,
      proposalHash: upgradeHash,
      decision: "approve",
    });
    await pool.query(
      `INSERT INTO idempotency_records (
         proposal_id, user_id, idempotency_key, request_hash, status, locked_at
       ) VALUES ($1, $2, $3, $4, 'executing', NOW())`,
      [upgradeProposalId, userA, `upgrade:${randomUUID()}`, upgradeHash],
    );

    const upgradeRun = await runMigrations({ pool });
    assert.deepEqual(upgradeRun.applied.map((migration) => migration.name), [
      "0002_fnd_03_integrity_hardening.sql",
    ]);
    const upgradedIdempotency = await pool.query<{ approval_decision_id: string }>(
      `SELECT approval_decision_id
       FROM idempotency_records
       WHERE proposal_id = $1 AND user_id = $2`,
      [upgradeProposalId, userA],
    );
    assert.equal(
      upgradedIdempotency.rows[0].approval_decision_id,
      upgradeApproval.id,
    );

    const beforeRerun = await pool.query<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public'",
    );
    const secondRun = await runMigrations({ pool });
    const afterRerun = await pool.query<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public'",
    );

    assert.equal(secondRun.applied.length, 0);
    assert.deepEqual(secondRun.skipped, [
      "0001_fnd_03_foundation.sql",
      "0002_fnd_03_integrity_hardening.sql",
    ]);
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
    await assert.rejects(
      agentRuns.createStep({
        id: randomUUID(),
        userId: userB,
        runId,
        stepKey: "cross-user-step",
        stepType: "research",
        sequenceNumber: 0,
      }),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "23503",
    );

    const secondRunId = randomUUID();
    await agentRuns.create({
      id: secondRunId,
      userId: userA,
      conversationId: randomUUID(),
      requestId: randomUUID(),
      flow: "simple_lookup",
      schemaVersion: "2.0.0",
      flowContractVersion: "2.0.0",
      requestPayload: { query: "second synthetic run" },
      state: {
        kind: "active",
        status: "created",
        enteredAt: new Date().toISOString(),
      },
      budgetLimits: { maxSteps: 5, maxRetries: 1 },
      budgetUsage: { steps: 0, retries: 0 },
    });
    const secondRunStepId = randomUUID();
    await agentRuns.createStep({
      id: secondRunStepId,
      userId: userA,
      runId: secondRunId,
      stepKey: "second-run-step",
      stepType: "research",
      sequenceNumber: 0,
    });
    await assert.rejects(
      agentRuns.createToolCall({
        id: randomUUID(),
        userId: userA,
        runId,
        stepId: secondRunStepId,
        toolName: "indexed_search",
        toolSchemaVersion: "1.0.0",
        connector: "index",
        capability: "search",
        mode: "read",
        risk: "low",
        argumentsHash: "d".repeat(64),
      }),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "23503",
    );

    const secondRunToolCallId = randomUUID();
    await agentRuns.createToolCall({
      id: secondRunToolCallId,
      userId: userA,
      runId: secondRunId,
      toolName: "indexed_search",
      toolSchemaVersion: "1.0.0",
      connector: "index",
      capability: "search",
      mode: "read",
      risk: "low",
      argumentsHash: "e".repeat(64),
    });
    await assert.rejects(
      evidence.create({
        id: randomUUID(),
        runId,
        toolCallId: secondRunToolCallId,
        userId: userA,
        source: "index",
        sourceRecordId: "cross-run-evidence",
        content: "Must not link across runs",
        retrievedAt: new Date(),
        freshness: "recent_index",
        contentHash,
      }),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "23503",
    );

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
    await assert.rejects(
      evidence.create({
        id: randomUUID(),
        runId,
        userId: userB,
        source: "gmail",
        sourceRecordId: "cross-user-fixture",
        content: "Must not be stored",
        retrievedAt: new Date(),
        freshness: "live",
        contentHash,
      }),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "23503",
    );

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
    assert.equal(await actions.markWaitingForApproval(userB, proposalId), null);
    assert.equal(
      (await actions.markWaitingForApproval(userA, proposalId))?.status,
      "waiting_for_approval",
    );
    await assert.rejects(
      actions.recordApproval({
        id: randomUUID(),
        userId: userB,
        proposalId,
        proposalHash: payloadHash,
        decision: "approve",
      }),
      /not found for this user/,
    );
    await actions.recordApproval({
      id: randomUUID(),
      userId: userA,
      proposalId,
      proposalHash: payloadHash,
      decision: "approve",
    });
    await assert.rejects(
      actions.claimExecution({
        userId: userB,
        proposalId,
        idempotencyKey: `calendar:${randomUUID()}`,
        requestHash: payloadHash,
      }),
      /not found for this user/,
    );

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

    await pool.query(
      `UPDATE action_proposals
       SET created_at = NOW() - INTERVAL '2 minutes',
           expires_at = NOW() - INTERVAL '1 minute'
       WHERE id = $1 AND user_id = $2`,
      [proposalId, userA],
    );
    const completedReplay = await actions.claimExecution({
      userId: userA,
      proposalId,
      idempotencyKey,
      requestHash: payloadHash,
    });
    assert.equal(completedReplay.claimed, false);
    assert.equal(completedReplay.idempotencyRecord.status, "succeeded");
  });

  test("execution claims require a stored, exact, non-expired approval", async () => {
    const unapprovedProposalId = randomUUID();
    const unapprovedHash = "f".repeat(64);
    await actions.createProposal({
      id: unapprovedProposalId,
      actionId: randomUUID(),
      runId,
      userId: userA,
      connector: "calendar",
      actionType: "calendar.create_event",
      toolName: "calendar_create_event",
      risk: "medium",
      schemaVersion: "2.0.0",
      proposalVersion: "1",
      normalizedPayload: { title: "Unapproved synthetic review" },
      payloadHash: unapprovedHash,
      expiresAt: new Date(Date.now() + 60_000),
    });

    // Simulate an application bug attempting to advance only the proposal row.
    await pool.query(
      `UPDATE action_proposals
       SET status = 'approved'
       WHERE id = $1 AND user_id = $2`,
      [unapprovedProposalId, userA],
    );
    await assert.rejects(
      actions.claimExecution({
        userId: userA,
        proposalId: unapprovedProposalId,
        idempotencyKey: `calendar:${randomUUID()}`,
        requestHash: unapprovedHash,
      }),
      /matching stored approval decision/,
    );

    const expiredProposalId = randomUUID();
    const expiredHash = "9".repeat(64);
    await actions.createProposal({
      id: expiredProposalId,
      actionId: randomUUID(),
      runId,
      userId: userA,
      connector: "calendar",
      actionType: "calendar.create_event",
      toolName: "calendar_create_event",
      risk: "medium",
      schemaVersion: "2.0.0",
      proposalVersion: "1",
      normalizedPayload: { title: "Expired synthetic review" },
      payloadHash: expiredHash,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await actions.markWaitingForApproval(userA, expiredProposalId);
    await actions.recordApproval({
      id: randomUUID(),
      userId: userA,
      proposalId: expiredProposalId,
      proposalHash: expiredHash,
      decision: "approve",
    });
    await pool.query(
      `UPDATE action_proposals
       SET created_at = NOW() - INTERVAL '2 minutes',
           expires_at = NOW() - INTERVAL '1 minute'
       WHERE id = $1 AND user_id = $2`,
      [expiredProposalId, userA],
    );
    await assert.rejects(
      actions.claimExecution({
        userId: userA,
        proposalId: expiredProposalId,
        idempotencyKey: `calendar:${randomUUID()}`,
        requestHash: expiredHash,
      }),
      /proposal has expired/,
    );
    assert.equal(
      (await actions.findProposalById(userA, expiredProposalId))?.status,
      "expired",
    );
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
    await actions.markWaitingForApproval(userA, secondProposalId);
    const secondApproval = await actions.recordApproval({
      id: randomUUID(),
      userId: userA,
      proposalId: secondProposalId,
      proposalHash: "b".repeat(64),
      decision: "approve",
    });

    await assert.rejects(
      pool.query(
        `INSERT INTO idempotency_records (
           proposal_id, user_id, idempotency_key, request_hash
         ) VALUES ($1, $2, $3, $4)`,
        [secondProposalId, userA, `missing-approval:${randomUUID()}`, "b".repeat(64)],
      ),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "23502",
    );

    await assert.rejects(
      pool.query(
        `INSERT INTO idempotency_records (
           proposal_id, user_id, approval_decision_id, idempotency_key, request_hash
         ) VALUES ($1, $2, $3, $4, $5)`,
        [
          secondProposalId,
          userA,
          secondApproval.id,
          `mismatched:${randomUUID()}`,
          "c".repeat(64),
        ],
      ),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "23503",
    );

    const existingKey = await pool.query<{ idempotency_key: string }>(
      "SELECT idempotency_key FROM idempotency_records WHERE user_id = $1 LIMIT 1",
      [userA],
    );
    await assert.rejects(
      pool.query(
        `INSERT INTO idempotency_records (
           proposal_id, user_id, approval_decision_id, idempotency_key, request_hash
         ) VALUES ($1, $2, $3, $4, $5)`,
        [
          secondProposalId,
          userA,
          secondApproval.id,
          existingKey.rows[0].idempotency_key,
          "b".repeat(64),
        ],
      ),
      (error: unknown) =>
        typeof error === "object" && error !== null && "code" in error && error.code === "23505",
    );

    await assert.rejects(
      agentRuns.createToolCall({
        id: randomUUID(),
        userId: userA,
        runId,
        toolName: "indexed_search",
        toolSchemaVersion: "1.0.0",
        connector: "index",
        capability: "search",
        mode: "read",
        risk: "low",
        argumentsHash: "too-short",
      }),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "23514",
    );

    await assert.rejects(
      actions.createProposal({
        id: randomUUID(),
        actionId: randomUUID(),
        runId,
        userId: userA,
        connector: "calendar",
        actionType: "calendar.create_event",
        toolName: "calendar_create_event",
        risk: "low",
        schemaVersion: "2.0.0",
        proposalVersion: "1",
        normalizedPayload: { title: "Invalid low-risk write" },
        payloadHash: "7".repeat(64),
        expiresAt: new Date(Date.now() + 60_000),
      } as any),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "23514",
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
