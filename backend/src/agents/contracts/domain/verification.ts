import { z } from "zod";
import {
  DomainSchemaVersionSchema,
  IdentifierSchema,
  IsoDateTimeSchema,
  UserIdSchema,
} from "./common.js";

export const VerificationIssueSchema = z.object({
  code: IdentifierSchema,
  category: z.enum([
    "missing_evidence",
    "stale_evidence",
    "contradiction",
    "entity_mismatch",
    "date_mismatch",
    "action_mismatch",
    "policy_violation",
    "success_criterion",
  ]),
  message: z.string().trim().min(1),
  criterion: z.string().trim().min(1).optional(),
  evidenceIds: z.array(IdentifierSchema).default([]),
  retryable: z.boolean(),
}).strict();

const VerificationBaseShape = {
  schemaVersion: DomainSchemaVersionSchema,
  id: IdentifierSchema,
  runId: IdentifierSchema,
  userId: UserIdSchema,
  evidenceIds: z.array(IdentifierSchema).default([]),
  checkedCriteria: z.array(z.string().trim().min(1)).min(1),
  verifiedAt: IsoDateTimeSchema,
};

export const PassedVerificationResultSchema = z.object({
  ...VerificationBaseShape,
  status: z.literal("pass"),
  issues: z.array(VerificationIssueSchema).max(0),
}).strict();

export const ReviseVerificationResultSchema = z.object({
  ...VerificationBaseShape,
  status: z.literal("revise"),
  issues: z.array(VerificationIssueSchema).min(1),
  namedGap: z.string().trim().min(1),
}).strict();

export const BlockedVerificationResultSchema = z.object({
  ...VerificationBaseShape,
  status: z.literal("blocked"),
  issues: z.array(VerificationIssueSchema).min(1),
  reason: z.string().trim().min(1),
}).strict();

export const VerificationResultSchema = z.discriminatedUnion("status", [
  PassedVerificationResultSchema,
  ReviseVerificationResultSchema,
  BlockedVerificationResultSchema,
]);

export type VerificationIssue = z.infer<typeof VerificationIssueSchema>;
export type VerificationResult = z.infer<typeof VerificationResultSchema>;
