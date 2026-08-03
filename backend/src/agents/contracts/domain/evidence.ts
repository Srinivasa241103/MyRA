import { z } from "zod";
import { EvidenceSourceSchema } from "../flowContracts.js";
import {
  DomainSchemaVersionSchema,
  IdentifierSchema,
  IsoDateTimeSchema,
  JsonObjectSchema,
  Sha256Schema,
  UserIdSchema,
} from "./common.js";

export const EvidenceFreshnessSchema = z.enum([
  "live",
  "recent_index",
  "stale_index",
  "memory",
  "user_input",
  "verified_action",
]);

export const EvidenceItemSchema = z.object({
  schemaVersion: DomainSchemaVersionSchema,
  id: IdentifierSchema,
  runId: IdentifierSchema,
  userId: UserIdSchema,
  source: EvidenceSourceSchema,
  sourceRecordId: IdentifierSchema,
  canonicalUrl: z.string().url().optional(),
  title: z.string().trim().min(1).optional(),
  content: z.string().trim().min(1),
  author: z.string().trim().min(1).optional(),
  occurredAt: IsoDateTimeSchema.optional(),
  retrievedAt: IsoDateTimeSchema,
  freshness: EvidenceFreshnessSchema,
  contentHash: Sha256Schema,
  toolCallId: IdentifierSchema.optional(),
  permissionScope: z.array(z.string().trim().min(1)).default([]),
  metadata: JsonObjectSchema,
}).strict().superRefine((evidence, context) => {
  const expectedFreshnessByVirtualSource = {
    memory: "memory",
    user_input: "user_input",
    action_receipt: "verified_action",
  } as const;
  const expectedFreshness =
    expectedFreshnessByVirtualSource[
      evidence.source as keyof typeof expectedFreshnessByVirtualSource
    ];

  if (expectedFreshness && evidence.freshness !== expectedFreshness) {
    context.addIssue({
      code: "custom",
      path: ["freshness"],
      message: `${evidence.source} evidence must use ${expectedFreshness} freshness`,
    });
  }

  if (
    evidence.source === "index" &&
    !["recent_index", "stale_index"].includes(evidence.freshness)
  ) {
    context.addIssue({
      code: "custom",
      path: ["freshness"],
      message: "Index evidence must use recent_index or stale_index freshness",
    });
  }

  if (
    !["memory", "user_input", "action_receipt"].includes(evidence.source) &&
    ["memory", "user_input", "verified_action"].includes(evidence.freshness)
  ) {
    context.addIssue({
      code: "custom",
      path: ["freshness"],
      message: `Connector evidence cannot use ${evidence.freshness} freshness`,
    });
  }
});

export const CitationSchema = z.object({
  schemaVersion: DomainSchemaVersionSchema,
  id: IdentifierSchema,
  runId: IdentifierSchema,
  userId: UserIdSchema,
  evidenceId: IdentifierSchema,
  ordinal: z.number().int().positive(),
  token: z.string().trim().min(1),
  claimIds: z.array(IdentifierSchema).min(1),
  source: EvidenceSourceSchema,
  title: z.string().trim().min(1).optional(),
  author: z.string().trim().min(1).optional(),
  occurredAt: IsoDateTimeSchema.optional(),
  retrievedAt: IsoDateTimeSchema,
  freshness: EvidenceFreshnessSchema,
  canonicalUrl: z.string().url().optional(),
  excerpt: z.string().trim().min(1).max(1_000).optional(),
}).strict();

export type EvidenceFreshness = z.infer<typeof EvidenceFreshnessSchema>;
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;
export type Citation = z.infer<typeof CitationSchema>;
