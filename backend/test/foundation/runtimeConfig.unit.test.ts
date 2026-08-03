/**
 * FND-05.1 — runtime configuration and secret redaction.
 *
 * The two invariants under test:
 *   1. Validation reports every problem at once and throws instead of exiting.
 *   2. No secret value reaches any diagnostic surface.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  ConfigValidationError,
  describeRuntimeConfig,
  loadRuntimeConfig,
  secretVariableNames,
} from "../../src/config/runtimeConfig.js";
import {
  collectSecretValues,
  describeSecret,
  isSecretEnvName,
  REDACTED,
  redactText,
  redactUrl,
  safeErrorMessage,
} from "../../src/config/redaction.js";

const DB_PASSWORD = "sup3r-s3cret-db-password";
const JWT_SECRET = "sup3r-s3cret-jwt-signing-key";
const TOKEN_ENCRYPTION_KEY = "sup3r-s3cret-token-encryption-key";
const CHROMA_API_KEY = "ck-sup3r-s3cret-chroma-api-key";

const ALL_SECRETS = [DB_PASSWORD, JWT_SECRET, TOKEN_ENCRYPTION_KEY, CHROMA_API_KEY];

/**
 * `assert.throws` returns undefined in node:assert, so capture the error
 * ourselves when the assertions need to inspect it.
 */
function captureConfigError(run: () => unknown): ConfigValidationError {
  try {
    run();
  } catch (error) {
    assert.ok(
      error instanceof ConfigValidationError,
      `expected ConfigValidationError, got ${(error as Error)?.name}`,
    );
    return error as ConfigValidationError;
  }
  assert.fail("expected loadRuntimeConfig to throw");
}

function baseEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: "development",
    DB_HOST: "localhost",
    DB_PORT: "5432",
    DB_NAME: "myra",
    DB_USER: "myra_app",
    DB_PASSWORD,
    JWT_SECRET,
    TOKEN_ENCRYPTION_KEY,
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* validation                                                                  */
/* -------------------------------------------------------------------------- */

test("a valid environment produces a frozen, fully shaped configuration", () => {
  const config = loadRuntimeConfig(baseEnv());

  assert.equal(config.server.nodeEnv, "development");
  assert.equal(config.server.isDevelopment, true);
  assert.equal(config.server.port, 2020, "PORT defaults to the documented dev port");
  assert.equal(config.postgres.database, "myra");
  assert.equal(config.postgres.port, 5432, "numeric env values are coerced");
  assert.equal(config.vector.provider, "pgvector");
  assert.equal(config.redis.required, false, "redis is optional until TOL-03");
  assert.equal(Object.isFrozen(config), true);
  assert.equal(Object.isFrozen(config.postgres), true);
});

test("every missing required variable is reported in a single failure", () => {
  const error = captureConfigError(() => loadRuntimeConfig({ NODE_ENV: "development" }));

  // A first-failure-wins validator would surface only one of these, forcing a
  // boot-fix-boot loop. All six must appear together.
  for (const variable of [
    "DB_HOST",
    "DB_PORT",
    "DB_NAME",
    "DB_USER",
    "DB_PASSWORD",
    "JWT_SECRET",
    "TOKEN_ENCRYPTION_KEY",
  ]) {
    assert.ok(
      error.variables.includes(variable),
      `expected ${variable} to be reported; got ${error.variables.join(", ")}`,
    );
  }
});

test("validation throws rather than terminating the process", () => {
  // Importing this module must never be able to kill a test runner, which is
  // exactly what environment.js does today via process.exit(1) at import time.
  assert.throws(() => loadRuntimeConfig({}), ConfigValidationError);
});

test("invalid values are rejected with an actionable message", () => {
  const error = captureConfigError(() => loadRuntimeConfig(baseEnv({ DB_PORT: "not-a-port" })));

  assert.deepEqual(error.variables, ["DB_PORT"]);
  assert.match(error.issues[0].message, /number/i);
});

test("out-of-range ports are rejected", () => {
  assert.throws(
    () => loadRuntimeConfig(baseEnv({ DB_PORT: "70000" })),
    ConfigValidationError,
  );
});

test("an unsupported vector store is rejected by name", () => {
  const error = captureConfigError(() => loadRuntimeConfig(baseEnv({ VECTOR_STORE: "pinecone" })));

  assert.deepEqual(error.variables, ["VECTOR_STORE"]);
});

/* -------------------------------------------------------------------------- */
/* conditional requirements                                                    */
/* -------------------------------------------------------------------------- */

test("local Chroma needs no tenant or database credentials", () => {
  const config = loadRuntimeConfig(baseEnv({ VECTOR_STORE: "chroma" }));

  assert.equal(config.vector.chromaCloud, false);
  assert.equal(config.vector.chromaHost, "localhost");
  assert.equal(config.vector.chromaPort, 8000);
});

test("Chroma Cloud requires tenant and database, and reports both at once", () => {
  const error = captureConfigError(() => loadRuntimeConfig(baseEnv({ VECTOR_STORE: "chroma", CHROMA_API_KEY })));

  assert.deepEqual(error.variables.sort(), ["CHROMA_DATABASE", "CHROMA_TENANT"]);
});

test("Chroma credentials are not required when the provider is pgvector", () => {
  const config = loadRuntimeConfig(baseEnv({ VECTOR_STORE: "pgvector", CHROMA_API_KEY }));
  assert.equal(config.vector.provider, "pgvector");
});

/* -------------------------------------------------------------------------- */
/* migration mode                                                              */
/* -------------------------------------------------------------------------- */

test("migrations auto-apply in development and verify-only elsewhere", () => {
  assert.equal(
    loadRuntimeConfig(baseEnv({ NODE_ENV: "development" })).runtime.migrationsOnBoot,
    "auto",
  );
  assert.equal(
    loadRuntimeConfig(baseEnv({ NODE_ENV: "test" })).runtime.migrationsOnBoot,
    "verify",
  );
  assert.equal(
    loadRuntimeConfig(baseEnv({ NODE_ENV: "production" })).runtime.migrationsOnBoot,
    "verify",
  );
});

test("production can never be configured to auto-apply migrations", () => {
  const error = captureConfigError(() => loadRuntimeConfig(baseEnv({ NODE_ENV: "production", MIGRATIONS_ON_BOOT: "auto" })));

  assert.deepEqual(error.variables, ["MIGRATIONS_ON_BOOT"]);
});

/* -------------------------------------------------------------------------- */
/* secret containment                                                          */
/* -------------------------------------------------------------------------- */

test("no secret value appears in a validation error message", () => {
  const error = captureConfigError(() => loadRuntimeConfig(baseEnv({ DB_PORT: "not-a-port", DB_PASSWORD })));

  const serialized = `${error.message}${JSON.stringify(error.issues)}`;
  for (const secret of ALL_SECRETS) {
    assert.equal(
      serialized.includes(secret),
      false,
      "a validation error must never echo a secret value",
    );
  }
});

test("the safe summary reports secrets only as set or unset", () => {
  const config = loadRuntimeConfig(
    baseEnv({ VECTOR_STORE: "chroma", CHROMA_API_KEY, CHROMA_TENANT: "t", CHROMA_DATABASE: "d" }),
  );
  const summary = describeRuntimeConfig(config);
  const serialized = JSON.stringify(summary);

  for (const secret of ALL_SECRETS) {
    assert.equal(serialized.includes(secret), false, "summary leaked a secret value");
  }

  assert.equal(summary.secrets.DB_PASSWORD, "set");
  assert.equal(summary.secrets.CHROMA_API_KEY, "set");
  assert.equal(summary.vector.mode, "cloud");
  assert.equal(summary.postgres.database, "myra", "non-secret values stay visible");
});

test("an unset secret is reported as unset, not omitted", () => {
  const summary = describeRuntimeConfig(loadRuntimeConfig(baseEnv()));
  assert.equal(summary.secrets.CHROMA_API_KEY, "unset");
});

test("redis credentials are stripped from the summary host", () => {
  const config = loadRuntimeConfig(
    baseEnv({ REDIS_URL: "redis://admin:r3dis-p4ssword@cache.internal:6380" }),
  );
  const serialized = JSON.stringify(describeRuntimeConfig(config));

  assert.equal(serialized.includes("r3dis-p4ssword"), false);
  assert.match(serialized, /cache\.internal:6380/);
});

/* -------------------------------------------------------------------------- */
/* redaction helpers                                                           */
/* -------------------------------------------------------------------------- */

test("secret-shaped variable names are recognised", () => {
  for (const name of ["DB_PASSWORD", "JWT_SECRET", "CHROMA_API_KEY", "TOKEN_ENCRYPTION_KEY"]) {
    assert.equal(isSecretEnvName(name), true, `${name} should be treated as secret`);
  }
  for (const name of ["DB_HOST", "PORT", "VECTOR_STORE", "CHROMA_COLLECTION"]) {
    assert.equal(isSecretEnvName(name), false, `${name} should not be treated as secret`);
  }
});

test("driver errors carrying a connection string are scrubbed", () => {
  // node-postgres and node-redis both inline the DSN in connection failures.
  const raw = new Error(
    `connect ECONNREFUSED postgres://myra_app:${DB_PASSWORD}@localhost:5432/myra`,
  );
  const message = safeErrorMessage(raw, { dependency: "postgres", env: baseEnv() });

  assert.equal(message.includes(DB_PASSWORD), false, "the DSN password survived redaction");
  assert.match(message, /^postgres: /, "the failing dependency must be named");
  assert.match(message, /ECONNREFUSED/, "the diagnosable part must survive");
});

test("URL userinfo is removed while host and path remain", () => {
  const redacted = redactUrl("redis://user:hunter2@cache.internal:6380/3");

  assert.equal(redacted.includes("hunter2"), false);
  assert.equal(redacted.includes("user:"), false);
  assert.match(redacted, /cache\.internal:6380/);
  assert.ok(redacted.includes(REDACTED));
});

test("collectSecretValues harvests only secret-shaped variables", () => {
  const collected = collectSecretValues(baseEnv());

  assert.ok(collected.includes(DB_PASSWORD));
  assert.ok(collected.includes(JWT_SECRET));
  assert.equal(collected.includes("localhost"), false, "non-secret values must not be scrubbed");
});

test("short values are not used as redaction patterns", () => {
  // Redacting a 2-character secret would corrupt unrelated text.
  const redacted = redactText("the host is localhost and the port is 5432", ["ab"]);
  assert.equal(redacted, "the host is localhost and the port is 5432");
});

test("non-Error throwables are normalised safely", () => {
  assert.match(safeErrorMessage("boom", { dependency: "redis" }), /^redis: boom$/);
  assert.match(safeErrorMessage(undefined, { dependency: "redis" }), /unknown error/);
});

test("describeSecret never reveals length or content", () => {
  assert.equal(describeSecret(DB_PASSWORD), "set");
  assert.equal(describeSecret(""), "unset");
  assert.equal(describeSecret("   "), "unset");
  assert.equal(describeSecret(undefined), "unset");
});

test("the declared secret variables match the schema", () => {
  assert.deepEqual(
    secretVariableNames().sort(),
    ["CHROMA_API_KEY", "DB_PASSWORD", "JWT_SECRET", "TOKEN_ENCRYPTION_KEY"],
  );
});
