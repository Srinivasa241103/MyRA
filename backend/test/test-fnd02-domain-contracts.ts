import assert from "node:assert/strict";
import type { z } from "zod";
import {
  ActionProposalSchema,
  ActionReceiptSchema,
  AgentRunSchema,
  ApprovalDecisionSchema,
  CitationSchema,
  EvidenceItemSchema,
  InterruptRunStateSchema,
  MemoryCandidateSchema,
  PlanSchema,
  PlannedSubtaskSchema,
  TerminalRunStateSchema,
  ToolCallSchema,
  ToolResultSchema,
  VerificationResultSchema,
  assertJsonSerializable,
  roundTripContract,
  serializeContract,
} from "../src/agents/contracts/domain/index.js";
import { FND02_FIXTURES } from "./fixtures/fnd02-domain-contract-fixtures.js";

const CONTRACT_FIXTURES: Array<[
  string,
  z.ZodType<unknown>,
  unknown,
]> = [
  ["AgentRun", AgentRunSchema, FND02_FIXTURES.agentRun],
  ["Plan", PlanSchema, FND02_FIXTURES.plan],
  ["PlannedSubtask", PlannedSubtaskSchema, FND02_FIXTURES.plannedSubtask],
  ["ToolCall", ToolCallSchema, FND02_FIXTURES.toolCall],
  ["ToolResult", ToolResultSchema, FND02_FIXTURES.toolResult],
  ["EvidenceItem", EvidenceItemSchema, FND02_FIXTURES.evidenceItem],
  ["Citation", CitationSchema, FND02_FIXTURES.citation],
  ["ActionProposal", ActionProposalSchema, FND02_FIXTURES.actionProposal],
  ["ApprovalDecision", ApprovalDecisionSchema, FND02_FIXTURES.approvalDecision],
  ["ActionReceipt", ActionReceiptSchema, FND02_FIXTURES.actionReceipt],
  ["VerificationResult", VerificationResultSchema, FND02_FIXTURES.verificationResult],
  ["MemoryCandidate", MemoryCandidateSchema, FND02_FIXTURES.memoryCandidate],
  ["InterruptRunState", InterruptRunStateSchema, FND02_FIXTURES.clarificationInterrupt],
  ["TerminalRunState", TerminalRunStateSchema, FND02_FIXTURES.completedTerminalState],
];

function testRoundTripFixtures(): void {
  for (const [name, schema, fixture] of CONTRACT_FIXTURES) {
    const parsed = schema.parse(fixture);
    assert.deepEqual(
      roundTripContract(schema, fixture),
      parsed,
      `${name} must survive parse/serialize/parse`,
    );
  }
}

function testMissingUserScopeIsRejected(): void {
  for (const [name, schema, fixture] of CONTRACT_FIXTURES) {
    const { userId: _removed, ...withoutUser } = fixture as Record<string, unknown>;
    assert.equal(
      schema.safeParse(withoutUser).success,
      false,
      `${name} must reject a missing userId`,
    );
  }
}

function testInvalidActionRiskIsRejected(): void {
  assert.equal(
    ActionProposalSchema.safeParse({
      ...FND02_FIXTURES.actionProposal,
      risk: "critical",
    }).success,
    false,
  );
}

function testNonSerializableInterruptPayloadIsRejected(): void {
  const invalidInterrupt = {
    ...FND02_FIXTURES.clarificationInterrupt,
    payload: {
      ...FND02_FIXTURES.clarificationInterrupt.payload,
      context: { when: new Date() },
    },
  };

  assert.equal(InterruptRunStateSchema.safeParse(invalidInterrupt).success, false);
  assert.throws(
    () => serializeContract(InterruptRunStateSchema, invalidInterrupt),
    /invalid input|expected/i,
  );

  const circular: Record<string, unknown> = {};
  circular.self = circular;
  assert.throws(() => assertJsonSerializable(circular), /circular reference/i);
}

function testMalformedEvidenceIsRejected(): void {
  assert.equal(
    EvidenceItemSchema.safeParse({
      ...FND02_FIXTURES.evidenceItem,
      contentHash: "not-a-hash",
    }).success,
    false,
  );
  assert.equal(
    EvidenceItemSchema.safeParse({
      ...FND02_FIXTURES.evidenceItem,
      source: "memory",
      freshness: "live",
    }).success,
    false,
  );
  const { sourceRecordId: _removed, ...withoutProvenance } =
    FND02_FIXTURES.evidenceItem;
  assert.equal(EvidenceItemSchema.safeParse(withoutProvenance).success, false);
}

function testDiscriminatedStateAndOutcomeRules(): void {
  assert.equal(
    TerminalRunStateSchema.safeParse({
      ...FND02_FIXTURES.completedTerminalState,
      status: "failed",
    }).success,
    false,
  );
  assert.equal(
    ToolResultSchema.safeParse({
      ...FND02_FIXTURES.toolResult,
      status: "unknown",
    }).success,
    false,
  );
  assert.equal(
    VerificationResultSchema.safeParse({
      ...FND02_FIXTURES.verificationResult,
      status: "revise",
    }).success,
    false,
  );
}

testRoundTripFixtures();
testMissingUserScopeIsRejected();
testInvalidActionRiskIsRejected();
testNonSerializableInterruptPayloadIsRejected();
testMalformedEvidenceIsRejected();
testDiscriminatedStateAndOutcomeRules();

console.log("FND-02 domain contract tests passed");
