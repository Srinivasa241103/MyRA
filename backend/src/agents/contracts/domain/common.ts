import { z } from "zod";

/**
 * FND-02 domain contract version. It evolves independently from the FND-01
 * flow contract while starting at the same V2 baseline.
 */
export const DOMAIN_CONTRACT_SCHEMA_VERSION = "2.0.0" as const;

export const DomainSchemaVersionSchema = z.literal(
  DOMAIN_CONTRACT_SCHEMA_VERSION,
);

export const IdentifierSchema = z.string().trim().min(1).max(200);

/**
 * Existing MyRA repositories use numeric IDs while newer boundaries may use
 * opaque string IDs. Both remain explicit and non-empty/non-negative.
 */
export const UserIdSchema = z.union([
  z.string().trim().min(1).max(200),
  z.number().int().nonnegative(),
]);

export const IsoDateTimeSchema = z.iso.datetime({ offset: true });

export const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i, {
  message: "Expected a SHA-256 hash encoded as 64 hexadecimal characters",
});

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

export const JsonObjectSchema: z.ZodType<JsonObject> = z.record(
  z.string(),
  JsonValueSchema,
);

export const AgentCapabilitySchema = z.enum([
  "research",
  "scheduling",
  "communication",
  "knowledge",
  "verification",
  "memory",
]);

export const ActionRiskSchema = z.enum(["low", "medium", "high"]);

/** Only side-effecting proposals reach an approval interrupt. */
export const ApprovableActionRiskSchema = ActionRiskSchema.exclude(["low"]);

export const ToolModeSchema = z.enum([
  "read",
  "draft",
  "write",
  "destructive",
  "prohibited",
]);

export type UserId = z.infer<typeof UserIdSchema>;
export type AgentCapability = z.infer<typeof AgentCapabilitySchema>;
export type ActionRisk = z.infer<typeof ActionRiskSchema>;
export type ApprovableActionRisk = z.infer<typeof ApprovableActionRiskSchema>;
export type ToolMode = z.infer<typeof ToolModeSchema>;
