/**
 * FND-05 — validated runtime configuration.
 *
 * Replaces the import-time `process.exit(1)` in `environment.js` for all V2 code.
 * Two properties matter and are both tested:
 *
 *   1. Validation is *pure and total* — `loadRuntimeConfig(env)` takes an
 *      environment, reports **every** problem at once, and throws rather than
 *      killing the process. The entrypoint decides what a failure means; a test
 *      can assert on it.
 *   2. No secret reaches a diagnostic surface. `ConfigValidationError` names the
 *      offending variables, never their values, and `describeRuntimeConfig`
 *      produces a log-safe summary.
 *
 * `environment.js` is intentionally left untouched so the existing V1 runtime
 * keeps working; migrating its callers is separate cleanup, not FND-05 risk.
 */

import { z } from "zod";
import { describeSecret, isSecretEnvName } from "./redaction.js";

export const RUNTIME_CONFIG_SCHEMA_VERSION = "2.0.0" as const;

/* -------------------------------------------------------------------------- */
/* primitives                                                                  */
/* -------------------------------------------------------------------------- */

const RequiredString = (label: string) =>
  z.string({ error: `${label} is required` }).trim().min(1, `${label} must not be empty`);

const Port = (label: string) =>
  z.coerce
    .number({ error: `${label} must be a number` })
    .int(`${label} must be an integer`)
    .min(1, `${label} must be between 1 and 65535`)
    .max(65535, `${label} must be between 1 and 65535`);

const PositiveInt = (label: string) =>
  z.coerce
    .number({ error: `${label} must be a number` })
    .int(`${label} must be an integer`)
    .positive(`${label} must be greater than zero`);

/** Accepts the shell-ish truthy spellings people actually put in .env files. */
const BooleanFlag = z
  .string()
  .transform((value) => ["1", "true", "yes", "on"].includes(value.trim().toLowerCase()));

export const NodeEnvSchema = z.enum(["development", "test", "production"]);
export const VectorStoreSchema = z.enum(["pgvector", "chroma"]);
export const MigrationModeSchema = z.enum(["auto", "verify"]);

export type NodeEnvName = z.infer<typeof NodeEnvSchema>;
export type VectorStoreName = z.infer<typeof VectorStoreSchema>;
/** `auto` applies pending migrations on boot; `verify` only reports drift. */
export type MigrationMode = z.infer<typeof MigrationModeSchema>;

/* -------------------------------------------------------------------------- */
/* error                                                                       */
/* -------------------------------------------------------------------------- */

export interface ConfigIssue {
  /** Environment variable name, e.g. "DB_PASSWORD". */
  variable: string;
  message: string;
}

/**
 * Thrown — never `process.exit` — so callers choose the failure behaviour and
 * tests can assert on the full issue list.
 */
export class ConfigValidationError extends Error {
  readonly issues: ConfigIssue[];

  constructor(issues: ConfigIssue[]) {
    const detail = issues.map((issue) => `  - ${issue.variable}: ${issue.message}`).join("\n");
    super(
      `Invalid runtime configuration (${issues.length} problem${issues.length === 1 ? "" : "s"}):\n${detail}`,
    );
    this.name = "ConfigValidationError";
    this.issues = issues;
  }

  get variables(): string[] {
    return [...new Set(this.issues.map((issue) => issue.variable))];
  }
}

/* -------------------------------------------------------------------------- */
/* schema                                                                      */
/* -------------------------------------------------------------------------- */

const DEFAULTS = {
  PORT: "2020",
  NODE_ENV: "development",
  VECTOR_STORE: "pgvector",
  CHROMA_HOST: "localhost",
  CHROMA_PORT: "8000",
  CHROMA_COLLECTION: "myra_chunks_v1",
  REDIS_URL: "redis://localhost:6379",
  DB_MAX_CONNECTIONS: "10",
  READINESS_PROBE_TIMEOUT_MS: "2000",
  SHUTDOWN_DRAIN_TIMEOUT_MS: "10000",
} as const;

const RawEnvSchema = z.object({
  // server
  NODE_ENV: NodeEnvSchema.default(DEFAULTS.NODE_ENV),
  PORT: Port("PORT").default(Number(DEFAULTS.PORT)),
  CORS_ORIGIN: z.string().trim().optional(),
  FRONTEND_URL: z.string().trim().optional(),

  // postgres — the only hard dependency at every stage of the project
  DB_HOST: RequiredString("DB_HOST"),
  DB_PORT: Port("DB_PORT"),
  DB_NAME: RequiredString("DB_NAME"),
  DB_USER: RequiredString("DB_USER"),
  DB_PASSWORD: RequiredString("DB_PASSWORD"),
  DB_SSL: BooleanFlag.default(false),
  DB_MAX_CONNECTIONS: PositiveInt("DB_MAX_CONNECTIONS").default(
    Number(DEFAULTS.DB_MAX_CONNECTIONS),
  ),

  // vector store
  VECTOR_STORE: VectorStoreSchema.default(DEFAULTS.VECTOR_STORE),
  CHROMA_HOST: z.string().trim().default(DEFAULTS.CHROMA_HOST),
  CHROMA_PORT: Port("CHROMA_PORT").default(Number(DEFAULTS.CHROMA_PORT)),
  CHROMA_SSL: BooleanFlag.default(false),
  CHROMA_COLLECTION: z.string().trim().default(DEFAULTS.CHROMA_COLLECTION),
  CHROMA_API_KEY: z.string().trim().optional(),
  CHROMA_TENANT: z.string().trim().optional(),
  CHROMA_DATABASE: z.string().trim().optional(),

  // redis — client and probe land in 05.3/05.4; nothing consumes it until TOL-03
  REDIS_URL: z.string().trim().default(DEFAULTS.REDIS_URL),
  REDIS_REQUIRED: BooleanFlag.default(false),

  // auth
  JWT_SECRET: RequiredString("JWT_SECRET"),
  TOKEN_ENCRYPTION_KEY: RequiredString("TOKEN_ENCRYPTION_KEY"),

  // runtime behaviour
  MIGRATIONS_ON_BOOT: MigrationModeSchema.optional(),
  READINESS_PROBE_TIMEOUT_MS: PositiveInt("READINESS_PROBE_TIMEOUT_MS").default(
    Number(DEFAULTS.READINESS_PROBE_TIMEOUT_MS),
  ),
  SHUTDOWN_DRAIN_TIMEOUT_MS: PositiveInt("SHUTDOWN_DRAIN_TIMEOUT_MS").default(
    Number(DEFAULTS.SHUTDOWN_DRAIN_TIMEOUT_MS),
  ),
  ENABLE_CRON_JOBS: BooleanFlag.default(true),
});

/* -------------------------------------------------------------------------- */
/* shaped config                                                               */
/* -------------------------------------------------------------------------- */

export interface RuntimeConfig {
  readonly schemaVersion: typeof RUNTIME_CONFIG_SCHEMA_VERSION;
  readonly server: {
    readonly nodeEnv: NodeEnvName;
    readonly isDevelopment: boolean;
    readonly isProduction: boolean;
    readonly isTest: boolean;
    readonly port: number;
    readonly corsOrigins: string[];
  };
  readonly postgres: {
    readonly host: string;
    readonly port: number;
    readonly database: string;
    readonly user: string;
    readonly password: string;
    readonly ssl: boolean;
    readonly maxConnections: number;
  };
  readonly vector: {
    readonly provider: VectorStoreName;
    /** True when a Chroma API key selects Chroma Cloud over a local container. */
    readonly chromaCloud: boolean;
    readonly chromaHost: string;
    readonly chromaPort: number;
    readonly chromaSsl: boolean;
    readonly chromaCollection: string;
    readonly chromaApiKey?: string;
    readonly chromaTenant?: string;
    readonly chromaDatabase?: string;
  };
  readonly redis: {
    readonly url: string;
    /** Declarative requiredness: false until TOL-03 introduces locks and queues. */
    readonly required: boolean;
  };
  readonly auth: {
    readonly jwtSecret: string;
    readonly tokenEncryptionKey: string;
  };
  readonly runtime: {
    readonly migrationsOnBoot: MigrationMode;
    readonly readinessProbeTimeoutMs: number;
    readonly shutdownDrainTimeoutMs: number;
    readonly cronEnabled: boolean;
  };
}

function parseCorsOrigins(raw: string | undefined, fallback: string | undefined): string[] {
  const source = raw ?? fallback ?? "http://localhost:5173";
  return source
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

/**
 * Map a zod issue onto the environment variable a reader can act on, keeping the
 * message but discarding any received value (zod echoes values for some codes).
 */
function toConfigIssues(error: z.ZodError): ConfigIssue[] {
  return error.issues.map((issue) => {
    const variable = issue.path.length > 0 ? String(issue.path[0]) : "(config)";
    const message = issue.code === "invalid_type" && "received" in issue &&
        issue.received === "undefined"
      ? "is required but was not set"
      : issue.message;

    return { variable, message };
  });
}

/**
 * Requirements that depend on other values, expressed after the shape parse so
 * that a missing `DB_HOST` and a missing `CHROMA_TENANT` are reported together
 * rather than one boot attempt at a time.
 */
function validateConditionalRequirements(raw: z.infer<typeof RawEnvSchema>): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const usesChroma = raw.VECTOR_STORE === "chroma";
  const usesChromaCloud = Boolean(raw.CHROMA_API_KEY);

  if (usesChroma && usesChromaCloud) {
    if (!raw.CHROMA_TENANT) {
      issues.push({
        variable: "CHROMA_TENANT",
        message: "is required when CHROMA_API_KEY selects Chroma Cloud",
      });
    }
    if (!raw.CHROMA_DATABASE) {
      issues.push({
        variable: "CHROMA_DATABASE",
        message: "is required when CHROMA_API_KEY selects Chroma Cloud",
      });
    }
  }

  if (raw.NODE_ENV === "production" && raw.MIGRATIONS_ON_BOOT === "auto") {
    issues.push({
      variable: "MIGRATIONS_ON_BOOT",
      message: 'must not be "auto" in production; migrations are applied explicitly',
    });
  }

  return issues;
}

/**
 * Validate an environment and build the runtime configuration.
 * Pure: no I/O, no process mutation, no exit. Throws `ConfigValidationError`
 * carrying every problem found.
 */
export function loadRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
): RuntimeConfig {
  const parsed = RawEnvSchema.safeParse(env);

  if (!parsed.success) {
    throw new ConfigValidationError(toConfigIssues(parsed.error));
  }

  const raw = parsed.data;
  const conditionalIssues = validateConditionalRequirements(raw);
  if (conditionalIssues.length > 0) {
    throw new ConfigValidationError(conditionalIssues);
  }

  const isDevelopment = raw.NODE_ENV === "development";

  return Object.freeze({
    schemaVersion: RUNTIME_CONFIG_SCHEMA_VERSION,
    server: Object.freeze({
      nodeEnv: raw.NODE_ENV,
      isDevelopment,
      isProduction: raw.NODE_ENV === "production",
      isTest: raw.NODE_ENV === "test",
      port: raw.PORT,
      corsOrigins: Object.freeze(parseCorsOrigins(raw.CORS_ORIGIN, raw.FRONTEND_URL)) as string[],
    }),
    postgres: Object.freeze({
      host: raw.DB_HOST,
      port: raw.DB_PORT,
      database: raw.DB_NAME,
      user: raw.DB_USER,
      password: raw.DB_PASSWORD,
      ssl: raw.DB_SSL,
      maxConnections: raw.DB_MAX_CONNECTIONS,
    }),
    vector: Object.freeze({
      provider: raw.VECTOR_STORE,
      chromaCloud: Boolean(raw.CHROMA_API_KEY),
      chromaHost: raw.CHROMA_HOST,
      chromaPort: raw.CHROMA_PORT,
      chromaSsl: raw.CHROMA_SSL,
      chromaCollection: raw.CHROMA_COLLECTION,
      chromaApiKey: raw.CHROMA_API_KEY,
      chromaTenant: raw.CHROMA_TENANT,
      chromaDatabase: raw.CHROMA_DATABASE,
    }),
    redis: Object.freeze({
      url: raw.REDIS_URL,
      required: raw.REDIS_REQUIRED,
    }),
    auth: Object.freeze({
      jwtSecret: raw.JWT_SECRET,
      tokenEncryptionKey: raw.TOKEN_ENCRYPTION_KEY,
    }),
    runtime: Object.freeze({
      // Confirmed FND-05 decision: apply automatically in development only.
      migrationsOnBoot: raw.MIGRATIONS_ON_BOOT ?? (isDevelopment ? "auto" : "verify"),
      readinessProbeTimeoutMs: raw.READINESS_PROBE_TIMEOUT_MS,
      shutdownDrainTimeoutMs: raw.SHUTDOWN_DRAIN_TIMEOUT_MS,
      cronEnabled: raw.ENABLE_CRON_JOBS,
    }),
  }) as RuntimeConfig;
}

/* -------------------------------------------------------------------------- */
/* safe summary                                                                */
/* -------------------------------------------------------------------------- */

export interface RuntimeConfigSummary {
  schemaVersion: string;
  nodeEnv: NodeEnvName;
  port: number;
  postgres: { host: string; port: number; database: string; user: string; ssl: boolean };
  vector: { provider: VectorStoreName; mode: "cloud" | "local"; host: string; port: number; collection: string };
  redis: { host: string; required: boolean };
  secrets: Record<string, "set" | "unset">;
  runtime: { migrationsOnBoot: MigrationMode; cronEnabled: boolean };
}

/**
 * Log-safe projection of the configuration. Secrets are reported only as
 * set/unset — never their value, length, or prefix.
 */
export function describeRuntimeConfig(config: RuntimeConfig): RuntimeConfigSummary {
  let redisHost = config.redis.url;
  try {
    const url = new URL(config.redis.url);
    redisHost = `${url.hostname}:${url.port || "6379"}`;
  } catch {
    redisHost = "(unparseable)";
  }

  return {
    schemaVersion: config.schemaVersion,
    nodeEnv: config.server.nodeEnv,
    port: config.server.port,
    postgres: {
      host: config.postgres.host,
      port: config.postgres.port,
      database: config.postgres.database,
      user: config.postgres.user,
      ssl: config.postgres.ssl,
    },
    vector: {
      provider: config.vector.provider,
      mode: config.vector.chromaCloud ? "cloud" : "local",
      host: config.vector.chromaHost,
      port: config.vector.chromaPort,
      collection: config.vector.chromaCollection,
    },
    redis: { host: redisHost, required: config.redis.required },
    secrets: {
      DB_PASSWORD: describeSecret(config.postgres.password),
      JWT_SECRET: describeSecret(config.auth.jwtSecret),
      TOKEN_ENCRYPTION_KEY: describeSecret(config.auth.tokenEncryptionKey),
      CHROMA_API_KEY: describeSecret(config.vector.chromaApiKey),
    },
    runtime: {
      migrationsOnBoot: config.runtime.migrationsOnBoot,
      cronEnabled: config.runtime.cronEnabled,
    },
  };
}

/** Names of the variables this module treats as secret. Used by tests and probes. */
export function secretVariableNames(): string[] {
  return Object.keys(RawEnvSchema.shape).filter(isSecretEnvName);
}

/* -------------------------------------------------------------------------- */
/* memoized accessor                                                           */
/* -------------------------------------------------------------------------- */

let cached: RuntimeConfig | undefined;

export function getRuntimeConfig(): RuntimeConfig {
  if (!cached) cached = loadRuntimeConfig();
  return cached;
}

export function resetRuntimeConfigForTests(): void {
  cached = undefined;
}
