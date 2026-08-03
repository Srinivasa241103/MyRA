import { z } from "zod";
import {
  DomainSchemaVersionSchema,
  IdentifierSchema,
  IsoDateTimeSchema,
  JsonObjectSchema,
  UserIdSchema,
} from "./common.js";

export const MemoryTypeSchema = z.enum([
  "episodic",
  "semantic",
  "prospective",
  "procedural",
  "preference",
]);

export const MemorySensitivitySchema = z.enum([
  "normal",
  "sensitive",
  "restricted",
]);

export const MemoryFactClassSchema = z.enum([
  "stable",
  "volatile",
  "ephemeral",
]);

export const EntityReferenceSchema = z.object({
  entityType: IdentifierSchema,
  entityId: IdentifierSchema,
  label: z.string().trim().min(1).optional(),
  sourceRecordIds: z.array(IdentifierSchema).default([]),
}).strict();

export const MemoryCandidateSchema = z.object({
  schemaVersion: DomainSchemaVersionSchema,
  id: IdentifierSchema,
  runId: IdentifierSchema,
  userId: UserIdSchema,
  type: MemoryTypeSchema,
  subjectType: IdentifierSchema,
  subjectId: IdentifierSchema.optional(),
  content: z.string().trim().min(1),
  structuredValue: JsonObjectSchema.optional(),
  confidence: z.number().min(0).max(1),
  importance: z.number().min(0).max(1),
  sensitivity: MemorySensitivitySchema,
  factClass: MemoryFactClassSchema,
  provenance: z.enum([
    "verified_tool_result",
    "explicit_user_statement",
    "retrieved_source",
    "corroborated_memory",
  ]),
  validFrom: IsoDateTimeSchema.optional(),
  validUntil: IsoDateTimeSchema.optional(),
  expiresAt: IsoDateTimeSchema.optional(),
  extractedAt: IsoDateTimeSchema,
  evidenceIds: z.array(IdentifierSchema).min(1),
  relatedEntities: z.array(EntityReferenceSchema).default([]),
  extractionReason: z.string().trim().min(1),
}).strict().superRefine((candidate, context) => {
  if (
    candidate.validFrom &&
    candidate.validUntil &&
    Date.parse(candidate.validUntil) <= Date.parse(candidate.validFrom)
  ) {
    context.addIssue({
      code: "custom",
      path: ["validUntil"],
      message: "validUntil must be after validFrom",
    });
  }
  if (
    candidate.expiresAt &&
    Date.parse(candidate.expiresAt) <= Date.parse(candidate.extractedAt)
  ) {
    context.addIssue({
      code: "custom",
      path: ["expiresAt"],
      message: "expiresAt must be after extractedAt",
    });
  }
});

export type MemoryType = z.infer<typeof MemoryTypeSchema>;
export type MemorySensitivity = z.infer<typeof MemorySensitivitySchema>;
export type MemoryFactClass = z.infer<typeof MemoryFactClassSchema>;
export type EntityReference = z.infer<typeof EntityReferenceSchema>;
export type MemoryCandidate = z.infer<typeof MemoryCandidateSchema>;
