import {
  FLOW_CONTRACT_SCHEMA_VERSION,
  SUPPORTED_FLOWS,
  type FlowRequest,
} from "../../src/agents/contracts/flowContracts.js";

const resultBase = {
  schemaVersion: FLOW_CONTRACT_SCHEMA_VERSION,
  requestId: "request-fixture-1",
  runId: "run-fixture-1",
  flow: "schedule_meeting" as const,
};

export const VALID_FLOW_REQUEST_FIXTURES: FlowRequest[] = SUPPORTED_FLOWS.map(
  (flow, index) => ({
    schemaVersion: FLOW_CONTRACT_SCHEMA_VERSION,
    requestId: `request-${index + 1}`,
    userId: 42,
    conversationId: `conversation-${index + 1}`,
    flow,
    input: `Fixture request for ${flow}`,
  }),
);

export const VALID_FLOW_RESULT_FIXTURES: unknown[] = [
  {
    ...resultBase,
    status: "success",
    message: "The event was created and verified.",
    evidenceIds: ["evidence-calendar-1"],
    receiptIds: ["receipt-calendar-1"],
  },
  {
    ...resultBase,
    status: "partial_success",
    message: "A useful answer was produced from the available sources.",
    evidenceIds: ["evidence-calendar-1"],
    warnings: ["Slack was unavailable."],
    unavailableSources: ["slack"],
  },
  {
    ...resultBase,
    status: "clarification_required",
    clarification: {
      id: "clarification-1",
      prompt: "Which Rahul did you mean?",
      missingFields: ["attendee"],
      options: ["Rahul A", "Rahul B"],
    },
  },
  {
    ...resultBase,
    status: "approval_required",
    approval: {
      proposalId: "proposal-1",
      proposalVersion: "1",
      payloadHash: "a".repeat(64),
      risk: "medium",
      summary: "Create a 30-minute Project X review with Rahul.",
      expiresAt: "2026-08-03T18:30:00.000+05:30",
    },
  },
  {
    ...resultBase,
    status: "rejected",
    proposalId: "proposal-1",
    reason: "The proposed time no longer works.",
  },
  {
    ...resultBase,
    status: "failure",
    error: {
      code: "CONNECTOR_UNAVAILABLE",
      message: "Calendar is temporarily unavailable.",
      retryable: true,
    },
  },
];

