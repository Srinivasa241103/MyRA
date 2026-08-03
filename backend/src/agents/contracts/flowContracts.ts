import { z } from "zod";

/**
 * FND-01 contract version. This version is independent of graph, prompt, tool,
 * and API versions so that each can evolve without silently changing a flow.
 */
export const FLOW_CONTRACT_SCHEMA_VERSION = "2.0.0" as const;

export const SUPPORTED_FLOWS = [
  "simple_lookup",
  "cross_source_answer",
  "meeting_brief",
  "schedule_meeting",
  "email_compose",
  "email_reply",
  "post_meeting_followup",
] as const;

export const SupportedFlowSchema = z.enum(SUPPORTED_FLOWS);
export type SupportedFlow = z.infer<typeof SupportedFlowSchema>;

export const AGENT_RUN_STATUSES = [
  "created",
  "planning",
  "researching",
  "synthesizing",
  "verifying",
  "waiting_for_clarification",
  "waiting_for_approval",
  "executing_action",
  "verifying_action",
  "curating_memory",
  "completed",
  "partially_completed",
  "failed",
  "cancelled",
] as const;

export const AgentRunStatusSchema = z.enum(AGENT_RUN_STATUSES);
export type AgentRunStatus = z.infer<typeof AgentRunStatusSchema>;

export const FLOW_RESULT_STATUSES = [
  "success",
  "partial_success",
  "clarification_required",
  "approval_required",
  "rejected",
  "failure",
] as const;

export const FlowResultStatusSchema = z.enum(FLOW_RESULT_STATUSES);
export type FlowResultStatus = z.infer<typeof FlowResultStatusSchema>;

export const FLOW_CONTRACT_OWNERS = [
  "rag_fast_path",
  "context_research",
  "meeting_briefing",
  "calendar_scheduling",
  "gmail_communication",
  "post_meeting_followup",
] as const;

export const FlowContractOwnerSchema = z.enum(FLOW_CONTRACT_OWNERS);
export type FlowContractOwner = z.infer<typeof FlowContractOwnerSchema>;

export const EVIDENCE_SOURCES = [
  "gmail",
  "calendar",
  "slack",
  "notion",
  "drive",
  "memory",
  "index",
  "user_input",
  "action_receipt",
] as const;

export const EvidenceSourceSchema = z.enum(EVIDENCE_SOURCES);
export type EvidenceSource = z.infer<typeof EvidenceSourceSchema>;

/**
 * Stable internal capability names. Provider-specific names stay below the
 * future Tool Gateway and must not leak into the flow contract.
 */
export const FLOW_TOOL_NAMES = [
  "indexed_search",
  "memory_search",
  "gmail_search",
  "gmail_get_thread",
  "gmail_get_message",
  "calendar_list_events",
  "calendar_get_event",
  "calendar_free_busy",
  "calendar_create_event",
  "slack_search",
  "slack_get_thread",
  "notion_search",
  "notion_get_page",
  "drive_search",
  "drive_get_file",
  "gmail_send_message",
  "gmail_send_reply",
] as const;

export const FlowToolNameSchema = z.enum(FLOW_TOOL_NAMES);
export type FlowToolName = z.infer<typeof FlowToolNameSchema>;

const ScopedIdentifierSchema = z.union([
  z.string().trim().min(1),
  z.number().int().nonnegative(),
]);

const NonEmptyStringArraySchema = z.array(z.string().trim().min(1)).min(1);

export const FlowRequestSchema = z
  .object({
    schemaVersion: z.literal(FLOW_CONTRACT_SCHEMA_VERSION),
    requestId: z.string().trim().min(1),
    userId: ScopedIdentifierSchema,
    conversationId: ScopedIdentifierSchema,
    flow: SupportedFlowSchema,
    input: z.string().trim().min(1),
  })
  .strict();

export type FlowRequest = z.infer<typeof FlowRequestSchema>;

const FlowResultBaseSchema = z.object({
  schemaVersion: z.literal(FLOW_CONTRACT_SCHEMA_VERSION),
  requestId: z.string().trim().min(1),
  runId: z.string().trim().min(1),
  flow: SupportedFlowSchema,
});

export const FlowSuccessResultSchema = FlowResultBaseSchema.extend({
  status: z.literal("success"),
  message: z.string().trim().min(1),
  evidenceIds: z.array(z.string().trim().min(1)),
  receiptIds: z.array(z.string().trim().min(1)).default([]),
}).strict();

export const FlowPartialSuccessResultSchema = FlowResultBaseSchema.extend({
  status: z.literal("partial_success"),
  message: z.string().trim().min(1),
  evidenceIds: z.array(z.string().trim().min(1)),
  warnings: NonEmptyStringArraySchema,
  unavailableSources: z.array(EvidenceSourceSchema).default([]),
}).strict();

export const FlowClarificationResultSchema = FlowResultBaseSchema.extend({
  status: z.literal("clarification_required"),
  clarification: z
    .object({
      id: z.string().trim().min(1),
      prompt: z.string().trim().min(1),
      missingFields: NonEmptyStringArraySchema,
      options: z.array(z.string().trim().min(1)).optional(),
    })
    .strict(),
}).strict();

export const FlowApprovalResultSchema = FlowResultBaseSchema.extend({
  status: z.literal("approval_required"),
  approval: z
    .object({
      proposalId: z.string().trim().min(1),
      proposalVersion: z.string().trim().min(1),
      payloadHash: z.string().regex(/^[a-f0-9]{64}$/i, "Expected a SHA-256 payload hash"),
      risk: z.enum(["medium", "high"]),
      summary: z.string().trim().min(1),
      expiresAt: z.iso.datetime({ offset: true }),
    })
    .strict(),
}).strict();

export const FlowRejectedResultSchema = FlowResultBaseSchema.extend({
  status: z.literal("rejected"),
  proposalId: z.string().trim().min(1),
  reason: z.string().trim().min(1).optional(),
}).strict();

export const FlowFailureResultSchema = FlowResultBaseSchema.extend({
  status: z.literal("failure"),
  error: z
    .object({
      code: z.string().trim().min(1),
      message: z.string().trim().min(1),
      retryable: z.boolean(),
    })
    .strict(),
}).strict();

export const FlowResultSchema = z.discriminatedUnion("status", [
  FlowSuccessResultSchema,
  FlowPartialSuccessResultSchema,
  FlowClarificationResultSchema,
  FlowApprovalResultSchema,
  FlowRejectedResultSchema,
  FlowFailureResultSchema,
]);

export type FlowResult = z.infer<typeof FlowResultSchema>;

export const EvidenceRequirementSchema = z
  .object({
    id: z.string().trim().min(1),
    description: z.string().trim().min(1),
    sources: z.array(EvidenceSourceSchema).min(1),
    requiredFor: z.enum(["response", "proposal", "execution", "completion"]),
    freshness: z.enum(["any", "live", "hydrated"]),
  })
  .strict();

export const ApprovalBoundarySchema = z
  .object({
    boundary: z.enum(["none", "before_external_write"]),
    granularity: z.enum([
      "not_applicable",
      "single_exact_proposal",
      "each_external_write",
    ]),
    exactPayloadBinding: z.boolean(),
    providerWriteTools: z.array(FlowToolNameSchema),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.boundary === "none") {
      if (value.granularity !== "not_applicable") {
        context.addIssue({
          code: "custom",
          path: ["granularity"],
          message: "A read-only flow cannot define approval granularity",
        });
      }

      if (value.exactPayloadBinding || value.providerWriteTools.length > 0) {
        context.addIssue({
          code: "custom",
          path: ["providerWriteTools"],
          message: "A read-only flow cannot expose provider write tools",
        });
      }
    }

    if (value.boundary === "before_external_write") {
      if (value.granularity === "not_applicable") {
        context.addIssue({
          code: "custom",
          path: ["granularity"],
          message: "A write flow must define an approval granularity",
        });
      }

      if (!value.exactPayloadBinding || value.providerWriteTools.length === 0) {
        context.addIssue({
          code: "custom",
          path: ["exactPayloadBinding"],
          message: "A write flow requires exact payload binding and a write tool",
        });
      }
    }
  });

export const FlowContractSchema = z
  .object({
    schemaVersion: z.literal(FLOW_CONTRACT_SCHEMA_VERSION),
    flow: SupportedFlowSchema,
    displayName: z.string().trim().min(1),
    releaseTier: z.enum(["core", "p1"]),
    owner: FlowContractOwnerSchema,
    description: z.string().trim().min(1),
    successCriteria: NonEmptyStringArraySchema,
    allowedResultStatuses: z.array(FlowResultStatusSchema).min(1),
    evidence: z
      .object({
        materialClaimsRequireEvidence: z.boolean(),
        sameUserAndRunRequired: z.literal(true),
        citationHydrationRequired: z.boolean(),
        minimumDistinctSourcesForSuccess: z.number().int().nonnegative(),
        requirements: z.array(EvidenceRequirementSchema).min(1),
      })
      .strict(),
    allowedTools: z.array(FlowToolNameSchema).min(1),
    approval: ApprovalBoundarySchema,
    nonGoals: NonEmptyStringArraySchema,
  })
  .strict()
  .superRefine((value, context) => {
    const approvalStatuses = new Set(["approval_required", "rejected"]);
    const exposesApproval = value.allowedResultStatuses.some((status) =>
      approvalStatuses.has(status),
    );

    if (value.approval.boundary === "none" && exposesApproval) {
      context.addIssue({
        code: "custom",
        path: ["allowedResultStatuses"],
        message: "A read-only flow cannot return approval or rejection results",
      });
    }

    if (
      value.approval.boundary === "before_external_write" &&
      (!value.allowedResultStatuses.includes("approval_required") ||
        !value.allowedResultStatuses.includes("rejected"))
    ) {
      context.addIssue({
        code: "custom",
        path: ["allowedResultStatuses"],
        message: "A write flow must support approval and rejection results",
      });
    }

    for (const tool of value.approval.providerWriteTools) {
      if (!value.allowedTools.includes(tool)) {
        context.addIssue({
          code: "custom",
          path: ["allowedTools"],
          message: `Write tool ${tool} must also be present in allowedTools`,
        });
      }
    }
  });

export type FlowContract = z.infer<typeof FlowContractSchema>;

const READ_RESULT_STATUSES = [
  "success",
  "partial_success",
  "clarification_required",
  "failure",
] as const satisfies readonly FlowResultStatus[];

const WRITE_RESULT_STATUSES = [
  "success",
  "partial_success",
  "clarification_required",
  "approval_required",
  "rejected",
  "failure",
] as const satisfies readonly FlowResultStatus[];

const READ_ONLY_APPROVAL: z.input<typeof ApprovalBoundarySchema> = {
  boundary: "none",
  granularity: "not_applicable",
  exactPayloadBinding: false,
  providerWriteTools: [],
};

const RAW_FLOW_CONTRACTS: Record<SupportedFlow, z.input<typeof FlowContractSchema>> = {
  simple_lookup: {
    schemaVersion: FLOW_CONTRACT_SCHEMA_VERSION,
    flow: "simple_lookup",
    displayName: "Simple RAG answer",
    releaseTier: "core",
    owner: "rag_fast_path",
    description:
      "Answer a bounded lookup through the existing user-scoped indexed RAG path without entering the agent loop.",
    successCriteria: [
      "The indexed answer addresses the request without requiring cross-source orchestration.",
      "Every material factual claim resolves to same-user indexed evidence.",
    ],
    allowedResultStatuses: [...READ_RESULT_STATUSES],
    evidence: {
      materialClaimsRequireEvidence: true,
      sameUserAndRunRequired: true,
      citationHydrationRequired: true,
      minimumDistinctSourcesForSuccess: 1,
      requirements: [
        {
          id: "indexed_context",
          description:
            "Ranked, user-scoped indexed context whose cited source objects are hydrated before synthesis.",
          sources: ["index"],
          requiredFor: "response",
          freshness: "hydrated",
        },
      ],
    },
    allowedTools: [
      "indexed_search",
      "gmail_get_message",
      "calendar_get_event",
      "slack_get_thread",
      "notion_get_page",
      "drive_get_file",
    ],
    approval: READ_ONLY_APPROVAL,
    nonGoals: [
      "No live discovery search, external write, or durable-memory mutation; source reads are limited to citation hydration.",
      "No multi-agent planning when the fast-path contract is sufficient.",
    ],
  },
  cross_source_answer: {
    schemaVersion: FLOW_CONTRACT_SCHEMA_VERSION,
    flow: "cross_source_answer",
    displayName: "Cross-source answer",
    releaseTier: "core",
    owner: "context_research",
    description:
      "Answer a workplace knowledge question from normalized live, indexed, and memory evidence with explicit freshness and source health.",
    successCriteria: [
      "The answer satisfies the requested source and freshness constraints.",
      "Every material factual claim has a stable citation to hydrated evidence.",
      "Unavailable or conflicting sources are disclosed instead of hidden.",
    ],
    allowedResultStatuses: [...READ_RESULT_STATUSES],
    evidence: {
      materialClaimsRequireEvidence: true,
      sameUserAndRunRequired: true,
      citationHydrationRequired: true,
      minimumDistinctSourcesForSuccess: 1,
      requirements: [
        {
          id: "claim_evidence",
          description:
            "Hydrated evidence for each material factual claim, selected according to the freshness directive.",
          sources: ["gmail", "calendar", "slack", "notion", "drive", "memory", "index"],
          requiredFor: "response",
          freshness: "hydrated",
        },
      ],
    },
    allowedTools: [
      "indexed_search",
      "memory_search",
      "gmail_search",
      "gmail_get_thread",
      "gmail_get_message",
      "calendar_list_events",
      "calendar_get_event",
      "slack_search",
      "slack_get_thread",
      "notion_search",
      "notion_get_page",
      "drive_search",
      "drive_get_file",
    ],
    approval: READ_ONLY_APPROVAL,
    nonGoals: [
      "No external mutation or approval request.",
      "No claim of complete coverage when one or more requested sources are unavailable.",
    ],
  },
  meeting_brief: {
    schemaVersion: FLOW_CONTRACT_SCHEMA_VERSION,
    flow: "meeting_brief",
    displayName: "Meeting brief",
    releaseTier: "core",
    owner: "meeting_briefing",
    description:
      "Prepare a cited briefing for one resolved Calendar meeting using participant, discussion, document, decision, and commitment context.",
    successCriteria: [
      "The target meeting and attendees are resolved or a specific clarification is requested.",
      "Factual sections are cited and recommendations are visually distinct from retrieved facts.",
      "A full-success release fixture uses at least three source types.",
    ],
    allowedResultStatuses: [...READ_RESULT_STATUSES],
    evidence: {
      materialClaimsRequireEvidence: true,
      sameUserAndRunRequired: true,
      citationHydrationRequired: true,
      minimumDistinctSourcesForSuccess: 3,
      requirements: [
        {
          id: "meeting_identity",
          description: "Hydrated Calendar evidence identifying the meeting, time, and attendees.",
          sources: ["calendar"],
          requiredFor: "response",
          freshness: "hydrated",
        },
        {
          id: "briefing_context",
          description:
            "Hydrated cross-source evidence for discussions, documents, decisions, commitments, and blockers.",
          sources: ["gmail", "slack", "notion", "drive", "memory", "index"],
          requiredFor: "response",
          freshness: "hydrated",
        },
      ],
    },
    allowedTools: [
      "indexed_search",
      "memory_search",
      "gmail_search",
      "gmail_get_thread",
      "gmail_get_message",
      "calendar_list_events",
      "calendar_get_event",
      "slack_search",
      "slack_get_thread",
      "notion_search",
      "notion_get_page",
      "drive_search",
      "drive_get_file",
    ],
    approval: READ_ONLY_APPROVAL,
    nonGoals: [
      "No event creation, email send, Slack post, or Notion update.",
      "No presentation of suggested agenda items as sourced facts.",
    ],
  },
  schedule_meeting: {
    schemaVersion: FLOW_CONTRACT_SCHEMA_VERSION,
    flow: "schedule_meeting",
    displayName: "Schedule meeting",
    releaseTier: "core",
    owner: "calendar_scheduling",
    description:
      "Resolve scheduling intent and attendees, check live availability, present an immutable proposal, obtain approval, create exactly one event, and verify it.",
    successCriteria: [
      "Attendees, timezone, duration, and time range are resolved without invention.",
      "The exact provider-relevant event payload is approved before execution.",
      "Completion follows provider read-back and proves at most one event was created.",
    ],
    allowedResultStatuses: [...WRITE_RESULT_STATUSES],
    evidence: {
      materialClaimsRequireEvidence: true,
      sameUserAndRunRequired: true,
      citationHydrationRequired: true,
      minimumDistinctSourcesForSuccess: 1,
      requirements: [
        {
          id: "attendee_identity",
          description: "Evidence for each selected attendee and verified email address.",
          sources: ["gmail", "calendar", "slack", "notion", "drive"],
          requiredFor: "proposal",
          freshness: "hydrated",
        },
        {
          id: "live_availability",
          description: "Live Calendar free/busy evidence for the proposed slot.",
          sources: ["calendar"],
          requiredFor: "proposal",
          freshness: "live",
        },
        {
          id: "verified_event_receipt",
          description: "Provider read-back proving the created event matches the approved proposal.",
          sources: ["action_receipt"],
          requiredFor: "completion",
          freshness: "live",
        },
      ],
    },
    allowedTools: [
      "gmail_search",
      "gmail_get_message",
      "calendar_list_events",
      "calendar_get_event",
      "calendar_free_busy",
      "calendar_create_event",
    ],
    approval: {
      boundary: "before_external_write",
      granularity: "single_exact_proposal",
      exactPayloadBinding: true,
      providerWriteTools: ["calendar_create_event"],
    },
    nonGoals: [
      "No event deletion, bulk scheduling, permission change, or unapproved mutation.",
      "No claim that invitations were delivered beyond what provider verification establishes.",
    ],
  },
  email_compose: {
    schemaVersion: FLOW_CONTRACT_SCHEMA_VERSION,
    flow: "email_compose",
    displayName: "Compose and send email",
    releaseTier: "p1",
    owner: "gmail_communication",
    description:
      "Create an evidence-backed new-email proposal, obtain approval for its exact recipients and content, send once, and verify the sent message.",
    successCriteria: [
      "Recipients and material draft claims are supported by evidence or explicit user instruction.",
      "The exact recipient, subject, body, and attachment metadata are approved before send.",
      "Provider verification confirms one sent message and its final identifiers.",
    ],
    allowedResultStatuses: [...WRITE_RESULT_STATUSES],
    evidence: {
      materialClaimsRequireEvidence: true,
      sameUserAndRunRequired: true,
      citationHydrationRequired: true,
      minimumDistinctSourcesForSuccess: 1,
      requirements: [
        {
          id: "recipient_and_content_context",
          description:
            "Evidence or explicit user input supporting recipients and material factual content.",
          sources: ["user_input", "gmail", "calendar", "slack", "notion", "drive", "memory", "index"],
          requiredFor: "proposal",
          freshness: "hydrated",
        },
        {
          id: "verified_send_receipt",
          description: "Provider read-back confirming the sent message identifier and material fields.",
          sources: ["action_receipt"],
          requiredFor: "completion",
          freshness: "live",
        },
      ],
    },
    allowedTools: [
      "indexed_search",
      "memory_search",
      "gmail_search",
      "gmail_get_thread",
      "gmail_get_message",
      "calendar_get_event",
      "slack_search",
      "notion_search",
      "notion_get_page",
      "drive_search",
      "drive_get_file",
      "gmail_send_message",
    ],
    approval: {
      boundary: "before_external_write",
      granularity: "single_exact_proposal",
      exactPayloadBinding: true,
      providerWriteTools: ["gmail_send_message"],
    },
    nonGoals: [
      "Not part of the seven-day core release gate; implementation begins in P1.",
      "No bulk email, mailing-list expansion, or implicit recipient changes.",
    ],
  },
  email_reply: {
    schemaVersion: FLOW_CONTRACT_SCHEMA_VERSION,
    flow: "email_reply",
    displayName: "Reply to email",
    releaseTier: "p1",
    owner: "gmail_communication",
    description:
      "Resolve an exact Gmail thread and message, construct a correct reply proposal, obtain exact approval, send once, and verify the result.",
    successCriteria: [
      "The intended thread, target message, and reply recipients are unambiguous.",
      "The approved proposal preserves Gmail threading fields and exposes reply versus reply-all.",
      "Provider verification confirms one reply in the intended thread.",
    ],
    allowedResultStatuses: [...WRITE_RESULT_STATUSES],
    evidence: {
      materialClaimsRequireEvidence: true,
      sameUserAndRunRequired: true,
      citationHydrationRequired: true,
      minimumDistinctSourcesForSuccess: 1,
      requirements: [
        {
          id: "thread_and_recipient_context",
          description:
            "Hydrated Gmail thread evidence identifying the target message and deliberate recipients.",
          sources: ["gmail"],
          requiredFor: "proposal",
          freshness: "hydrated",
        },
        {
          id: "verified_reply_receipt",
          description: "Provider read-back confirming the sent reply, recipients, and thread.",
          sources: ["action_receipt"],
          requiredFor: "completion",
          freshness: "live",
        },
      ],
    },
    allowedTools: [
      "indexed_search",
      "memory_search",
      "gmail_search",
      "gmail_get_thread",
      "gmail_get_message",
      "calendar_get_event",
      "slack_search",
      "notion_search",
      "notion_get_page",
      "drive_search",
      "drive_get_file",
      "gmail_send_reply",
    ],
    approval: {
      boundary: "before_external_write",
      granularity: "single_exact_proposal",
      exactPayloadBinding: true,
      providerWriteTools: ["gmail_send_reply"],
    },
    nonGoals: [
      "Not part of the seven-day core release gate; implementation begins in P1.",
      "No automatic reply-all, thread guessing, or send after the target message changes.",
    ],
  },
  post_meeting_followup: {
    schemaVersion: FLOW_CONTRACT_SCHEMA_VERSION,
    flow: "post_meeting_followup",
    displayName: "Post-meeting follow-up",
    releaseTier: "p1",
    owner: "post_meeting_followup",
    description:
      "Turn supplied meeting notes and verified context into decisions, action items, memory candidates, and an optional approved Gmail follow-up.",
    successCriteria: [
      "Decisions, owners, deadlines, and factual claims trace to supplied notes or hydrated evidence.",
      "Each supported external write receives its own exact approval.",
      "Only verified successful actions can produce completed-action memory.",
    ],
    allowedResultStatuses: [...WRITE_RESULT_STATUSES],
    evidence: {
      materialClaimsRequireEvidence: true,
      sameUserAndRunRequired: true,
      citationHydrationRequired: true,
      minimumDistinctSourcesForSuccess: 1,
      requirements: [
        {
          id: "meeting_outcome_context",
          description:
            "Supplied notes and hydrated evidence supporting decisions, commitments, owners, and deadlines.",
          sources: ["user_input", "gmail", "calendar", "slack", "notion", "drive", "memory", "index"],
          requiredFor: "response",
          freshness: "hydrated",
        },
        {
          id: "verified_followup_receipt",
          description: "Provider read-back for any approved Gmail follow-up that was sent.",
          sources: ["action_receipt"],
          requiredFor: "completion",
          freshness: "live",
        },
      ],
    },
    allowedTools: [
      "indexed_search",
      "memory_search",
      "gmail_search",
      "gmail_get_thread",
      "gmail_get_message",
      "calendar_get_event",
      "slack_search",
      "slack_get_thread",
      "notion_search",
      "notion_get_page",
      "drive_search",
      "drive_get_file",
      "gmail_send_message",
    ],
    approval: {
      boundary: "before_external_write",
      granularity: "each_external_write",
      exactPayloadBinding: true,
      providerWriteTools: ["gmail_send_message"],
    },
    nonGoals: [
      "Not part of the seven-day core release gate; implementation follows the core Calendar vertical.",
      "Slack posting and Notion writing remain disabled until separately scoped and approved.",
      "No memory may represent an unknown or failed action as successful.",
    ],
  },
};

export const FLOW_CONTRACTS: Readonly<Record<SupportedFlow, FlowContract>> =
  Object.freeze(
    Object.fromEntries(
      SUPPORTED_FLOWS.map((flow) => {
        const contract = FlowContractSchema.parse(RAW_FLOW_CONTRACTS[flow]);

        if (contract.flow !== flow) {
          throw new Error(`Flow contract key ${flow} does not match ${contract.flow}`);
        }

        return [flow, Object.freeze(contract)];
      }),
    ) as Record<SupportedFlow, FlowContract>,
  );

export function getFlowContract(flow: SupportedFlow): FlowContract {
  return FLOW_CONTRACTS[flow];
}

export function parseFlowRequest(input: unknown): FlowRequest {
  return FlowRequestSchema.parse(input);
}

export function parseFlowResult(input: unknown): FlowResult {
  return FlowResultSchema.parse(input);
}
