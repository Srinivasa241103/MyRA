import { z } from "zod";
import {
  ActionRiskSchema,
  DomainSchemaVersionSchema,
  IdentifierSchema,
  IsoDateTimeSchema,
  JsonObjectSchema,
  Sha256Schema,
  UserIdSchema,
} from "./common.js";
import { ToolErrorSchema } from "./tools.js";

export const ActionProposalStatusSchema = z.enum([
  "proposed",
  "waiting_for_approval",
  "approved",
  "rejected",
  "expired",
]);

export const ActionProposalSchema = z.object({
  schemaVersion: DomainSchemaVersionSchema,
  id: IdentifierSchema,
  actionId: IdentifierSchema,
  runId: IdentifierSchema,
  userId: UserIdSchema,
  connector: IdentifierSchema,
  actionType: IdentifierSchema,
  proposalVersion: z.string().trim().min(1),
  risk: ActionRiskSchema,
  status: ActionProposalStatusSchema,
  requiresApproval: z.literal(true),
  normalizedPayload: JsonObjectSchema,
  payloadHash: Sha256Schema,
  evidenceIds: z.array(IdentifierSchema).default([]),
  createdAt: IsoDateTimeSchema,
  expiresAt: IsoDateTimeSchema,
}).strict().superRefine((proposal, context) => {
  if (Date.parse(proposal.expiresAt) <= Date.parse(proposal.createdAt)) {
    context.addIssue({
      code: "custom",
      path: ["expiresAt"],
      message: "Action proposal expiry must be after creation",
    });
  }
});

export const ApprovalDecisionSchema = z.object({
  schemaVersion: DomainSchemaVersionSchema,
  id: IdentifierSchema,
  proposalId: IdentifierSchema,
  actionId: IdentifierSchema,
  runId: IdentifierSchema,
  userId: UserIdSchema,
  proposalVersion: z.string().trim().min(1),
  payloadHash: Sha256Schema,
  decision: z.enum(["approve", "reject"]),
  decidedAt: IsoDateTimeSchema,
  reason: z.string().trim().min(1).optional(),
}).strict();

export const ActionVerificationSchema = z.object({
  status: z.enum(["verified", "mismatch", "pending", "unavailable"]),
  verifiedAt: IsoDateTimeSchema.optional(),
  discrepancies: z.array(z.string().trim().min(1)).default([]),
  details: JsonObjectSchema.default({}),
}).strict().superRefine((verification, context) => {
  if (verification.status === "verified" && !verification.verifiedAt) {
    context.addIssue({
      code: "custom",
      path: ["verifiedAt"],
      message: "A verified action must include verifiedAt",
    });
  }
  if (
    verification.status === "mismatch" &&
    verification.discrepancies.length === 0
  ) {
    context.addIssue({
      code: "custom",
      path: ["discrepancies"],
      message: "A verification mismatch must name at least one discrepancy",
    });
  }
});

const ActionReceiptBaseShape = {
  schemaVersion: DomainSchemaVersionSchema,
  id: IdentifierSchema,
  proposalId: IdentifierSchema,
  actionId: IdentifierSchema,
  approvalDecisionId: IdentifierSchema,
  runId: IdentifierSchema,
  userId: UserIdSchema,
  connector: IdentifierSchema,
  actionType: IdentifierSchema,
  proposalVersion: z.string().trim().min(1),
  payloadHash: Sha256Schema,
  idempotencyKey: IdentifierSchema,
  executedAt: IsoDateTimeSchema,
  verification: ActionVerificationSchema,
};

export const SuccessfulActionReceiptSchema = z.object({
  ...ActionReceiptBaseShape,
  outcome: z.literal("succeeded"),
  externalId: IdentifierSchema,
  providerResult: JsonObjectSchema,
}).strict();

export const FailedActionReceiptSchema = z.object({
  ...ActionReceiptBaseShape,
  outcome: z.literal("failed"),
  error: ToolErrorSchema,
}).strict();

export const UnknownActionReceiptSchema = z.object({
  ...ActionReceiptBaseShape,
  outcome: z.literal("unknown"),
  error: ToolErrorSchema,
  reconciliationRequired: z.literal(true),
  reconciliationMetadata: JsonObjectSchema,
}).strict();

export const ActionReceiptSchema = z.discriminatedUnion("outcome", [
  SuccessfulActionReceiptSchema,
  FailedActionReceiptSchema,
  UnknownActionReceiptSchema,
]);

export type ActionProposalStatus = z.infer<typeof ActionProposalStatusSchema>;
export type ActionProposal = z.infer<typeof ActionProposalSchema>;
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;
export type ActionVerification = z.infer<typeof ActionVerificationSchema>;
export type ActionReceipt = z.infer<typeof ActionReceiptSchema>;
