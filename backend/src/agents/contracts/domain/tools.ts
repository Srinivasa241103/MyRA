import { z } from "zod";
import {
  ActionRiskSchema,
  DomainSchemaVersionSchema,
  IdentifierSchema,
  IsoDateTimeSchema,
  JsonObjectSchema,
  JsonValueSchema,
  Sha256Schema,
  ToolModeSchema,
  UserIdSchema,
} from "./common.js";

export const ToolCallStatusSchema = z.enum([
  "pending",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "unknown",
]);

export const ToolCallSchema = z.object({
  schemaVersion: DomainSchemaVersionSchema,
  id: IdentifierSchema,
  runId: IdentifierSchema,
  userId: UserIdSchema,
  subtaskId: IdentifierSchema.optional(),
  toolName: IdentifierSchema,
  toolSchemaVersion: z.string().trim().min(1),
  connector: IdentifierSchema,
  capability: IdentifierSchema,
  mode: ToolModeSchema,
  risk: ActionRiskSchema,
  status: ToolCallStatusSchema,
  input: JsonObjectSchema,
  inputHash: Sha256Schema,
  retryCount: z.number().int().nonnegative(),
  startedAt: IsoDateTimeSchema.optional(),
  completedAt: IsoDateTimeSchema.optional(),
}).strict().superRefine((toolCall, context) => {
  if (
    toolCall.startedAt &&
    toolCall.completedAt &&
    Date.parse(toolCall.completedAt) < Date.parse(toolCall.startedAt)
  ) {
    context.addIssue({
      code: "custom",
      path: ["completedAt"],
      message: "completedAt cannot be before startedAt",
    });
  }
});

export const ToolErrorSchema = z.object({
  code: IdentifierSchema,
  category: z.enum([
    "timeout",
    "rate_limit",
    "authentication",
    "permission",
    "validation",
    "provider",
    "unavailable",
    "cancelled",
    "unknown",
  ]),
  message: z.string().trim().min(1),
  retryable: z.boolean(),
  details: JsonObjectSchema.optional(),
}).strict();

const ToolResultBaseShape = {
  schemaVersion: DomainSchemaVersionSchema,
  toolCallId: IdentifierSchema,
  runId: IdentifierSchema,
  userId: UserIdSchema,
  completedAt: IsoDateTimeSchema,
  durationMs: z.number().int().nonnegative(),
};

export const SuccessfulToolResultSchema = z.object({
  ...ToolResultBaseShape,
  status: z.literal("succeeded"),
  output: JsonValueSchema,
}).strict();

export const FailedToolResultSchema = z.object({
  ...ToolResultBaseShape,
  status: z.literal("failed"),
  error: ToolErrorSchema,
}).strict();

export const UnknownToolResultSchema = z.object({
  ...ToolResultBaseShape,
  status: z.literal("unknown"),
  error: ToolErrorSchema,
  reconciliationRequired: z.literal(true),
}).strict();

export const ToolResultSchema = z.discriminatedUnion("status", [
  SuccessfulToolResultSchema,
  FailedToolResultSchema,
  UnknownToolResultSchema,
]);

export type ToolCallStatus = z.infer<typeof ToolCallStatusSchema>;
export type ToolCall = z.infer<typeof ToolCallSchema>;
export type ToolError = z.infer<typeof ToolErrorSchema>;
export type ToolResult = z.infer<typeof ToolResultSchema>;
