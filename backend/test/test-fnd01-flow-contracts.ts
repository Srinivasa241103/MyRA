import assert from "node:assert/strict";
import {
  FLOW_CONTRACT_SCHEMA_VERSION,
  FLOW_CONTRACTS,
  FlowContractSchema,
  FlowRequestSchema,
  FlowResultSchema,
  SUPPORTED_FLOWS,
  getFlowContract,
  parseFlowRequest,
  parseFlowResult,
} from "../src/agents/contracts/flowContracts.js";
import {
  VALID_FLOW_REQUEST_FIXTURES,
  VALID_FLOW_RESULT_FIXTURES,
} from "./fixtures/fnd01-flow-contract-fixtures.js";

function testValidFixtures(): void {
  for (const fixture of VALID_FLOW_REQUEST_FIXTURES) {
    assert.deepEqual(parseFlowRequest(fixture), fixture);
  }

  for (const fixture of VALID_FLOW_RESULT_FIXTURES) {
    assert.equal(parseFlowResult(fixture).schemaVersion, FLOW_CONTRACT_SCHEMA_VERSION);
  }
}

function testCompleteFlowRegistry(): void {
  assert.deepEqual(Object.keys(FLOW_CONTRACTS).sort(), [...SUPPORTED_FLOWS].sort());

  for (const flow of SUPPORTED_FLOWS) {
    const contract = getFlowContract(flow);
    assert.equal(contract.flow, flow);
    assert.equal(contract.schemaVersion, FLOW_CONTRACT_SCHEMA_VERSION);
    assert.ok(contract.owner.length > 0, `${flow} must have one contract owner`);
    assert.ok(contract.allowedTools.length > 0, `${flow} must define allowed tools`);
    assert.ok(
      contract.evidence.requirements.length > 0,
      `${flow} must define required evidence`,
    );
    assert.ok(contract.nonGoals.length > 0, `${flow} must define non-goals`);
    assert.equal(FlowContractSchema.safeParse(contract).success, true);
  }
}

function testReleaseAndApprovalBoundaries(): void {
  const coreFlows = SUPPORTED_FLOWS.filter(
    (flow) => FLOW_CONTRACTS[flow].releaseTier === "core",
  );
  const p1Flows = SUPPORTED_FLOWS.filter(
    (flow) => FLOW_CONTRACTS[flow].releaseTier === "p1",
  );

  assert.deepEqual(coreFlows, [
    "simple_lookup",
    "cross_source_answer",
    "meeting_brief",
    "schedule_meeting",
  ]);
  assert.deepEqual(p1Flows, [
    "email_compose",
    "email_reply",
    "post_meeting_followup",
  ]);

  for (const flow of [
    "simple_lookup",
    "cross_source_answer",
    "meeting_brief",
  ] as const) {
    const contract = FLOW_CONTRACTS[flow];
    assert.equal(contract.approval.boundary, "none");
    assert.deepEqual(contract.approval.providerWriteTools, []);
    assert.equal(contract.allowedResultStatuses.includes("approval_required"), false);
  }

  for (const flow of [
    "schedule_meeting",
    "email_compose",
    "email_reply",
    "post_meeting_followup",
  ] as const) {
    const contract = FLOW_CONTRACTS[flow];
    assert.equal(contract.approval.boundary, "before_external_write");
    assert.equal(contract.approval.exactPayloadBinding, true);
    assert.ok(contract.approval.providerWriteTools.length > 0);
    assert.equal(contract.allowedResultStatuses.includes("approval_required"), true);
    assert.equal(contract.allowedResultStatuses.includes("rejected"), true);
  }
}

function testInvalidFlowAndStatusesFailClearly(): void {
  const unsupportedFlow = FlowRequestSchema.safeParse({
    schemaVersion: FLOW_CONTRACT_SCHEMA_VERSION,
    requestId: "request-invalid-flow",
    userId: 42,
    conversationId: "conversation-1",
    flow: "delete_everything",
    input: "Delete everything",
  });
  assert.equal(unsupportedFlow.success, false);
  if (!unsupportedFlow.success) {
    assert.deepEqual(unsupportedFlow.error.issues[0].path, ["flow"]);
    assert.match(unsupportedFlow.error.issues[0].message, /expected one of/i);
  }

  const invalidStatus = FlowResultSchema.safeParse({
    schemaVersion: FLOW_CONTRACT_SCHEMA_VERSION,
    requestId: "request-invalid-status",
    runId: "run-invalid-status",
    flow: "simple_lookup",
    status: "completed",
    message: "This status belongs to run state, not flow results.",
    evidenceIds: [],
  });
  assert.equal(invalidStatus.success, false);
  if (!invalidStatus.success) {
    assert.deepEqual(invalidStatus.error.issues[0].path, ["status"]);
  }

  const wrongVersion = FlowRequestSchema.safeParse({
    ...VALID_FLOW_REQUEST_FIXTURES[0],
    schemaVersion: "1.0.0",
  });
  assert.equal(wrongVersion.success, false);
  if (!wrongVersion.success) {
    assert.deepEqual(wrongVersion.error.issues[0].path, ["schemaVersion"]);
  }
}

function testInvalidApprovalFailsClearly(): void {
  const fixture = VALID_FLOW_RESULT_FIXTURES.find(
    (candidate) =>
      typeof candidate === "object" &&
      candidate !== null &&
      "status" in candidate &&
      candidate.status === "approval_required",
  );
  assert.ok(fixture && typeof fixture === "object");

  const invalidApproval = FlowResultSchema.safeParse({
    ...fixture,
    approval: {
      ...(fixture as { approval: Record<string, unknown> }).approval,
      payloadHash: "not-a-hash",
    },
  });
  assert.equal(invalidApproval.success, false);
  if (!invalidApproval.success) {
    assert.deepEqual(invalidApproval.error.issues[0].path, ["approval", "payloadHash"]);
    assert.match(invalidApproval.error.issues[0].message, /sha-256/i);
  }
}

testValidFixtures();
testCompleteFlowRegistry();
testReleaseAndApprovalBoundaries();
testInvalidFlowAndStatusesFailClearly();
testInvalidApprovalFailsClearly();

console.log("FND-01 flow contract tests passed");

