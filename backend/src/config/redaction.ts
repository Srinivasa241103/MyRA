/**
 * FND-05 — secret redaction.
 *
 * Every diagnostic surface that FND-05 introduces (startup validation errors,
 * readiness payloads, dependency probe failures) is reachable by an operator and,
 * in the case of `/health/ready`, by an unauthenticated caller. Driver errors
 * routinely embed connection strings, so redaction happens at the boundary that
 * produces the message rather than at each call site.
 *
 * The rule enforced here: a value that came from a secret-shaped environment
 * variable must never appear in any string this module returns.
 */

/** Environment variable names whose values must never be printed. */
const SECRET_NAME_PATTERN =
  /(PASSWORD|SECRET|TOKEN|API_KEY|APIKEY|PRIVATE_KEY|CREDENTIAL|_PWD|_DSN)/i;

/**
 * The one collision the pattern above cannot resolve on its own: "token" means
 * a credential in `TOKEN_ENCRYPTION_KEY` and a unit of model input in
 * `AGENT_MAX_TOKENS`. Model-token budgets arrive with the agent runtime and
 * will keep arriving, so the exception is spelled out rather than discovered
 * again each time. Deliberately anchored to the exact `*_MAX_TOKENS` form — an
 * exception is the dangerous direction, and a loose one would exempt a real
 * credential.
 */
const NUMERIC_LIMIT_NAME_PATTERN = /(^|_)MAX_TOKENS$/i;

/** Values shorter than this are too generic to search-and-replace safely. */
const MIN_REDACTABLE_SECRET_LENGTH = 4;

/** A credential is never a bare number; a limit almost always is. */
const NUMERIC_VALUE_PATTERN = /^\d+(\.\d+)?$/;

export const REDACTED = "[redacted]";

export function isSecretEnvName(name: string): boolean {
  if (NUMERIC_LIMIT_NAME_PATTERN.test(name)) return false;
  return SECRET_NAME_PATTERN.test(name);
}

/**
 * Describe whether a secret is configured without revealing any part of it.
 * Deliberately returns no prefix, suffix, or length hint.
 */
export function describeSecret(value: string | undefined | null): "set" | "unset" {
  return value !== undefined && value !== null && value.trim() !== "" ? "set" : "unset";
}

/**
 * Strip credentials from a URL while keeping the parts an operator needs in
 * order to diagnose a connection failure (scheme, host, port, path).
 * Falls back to a coarse regex when the value is not a parseable URL.
 */
export function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.username || url.password) {
      url.username = "";
      url.password = "";
      return url.toString().replace("//", `//${REDACTED}@`);
    }
    return url.toString();
  } catch {
    return value.replace(/\/\/[^/@\s]+@/g, `//${REDACTED}@`);
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replace every known secret substring in arbitrary text. Used on driver and
 * library error messages, which we do not control and which frequently inline
 * passwords, DSNs, and bearer tokens.
 */
export function redactText(text: string, secrets: Iterable<string> = []): string {
  let output = text;

  for (const secret of secrets) {
    if (typeof secret !== "string") continue;
    const trimmed = secret.trim();
    if (trimmed.length < MIN_REDACTABLE_SECRET_LENGTH) continue;
    output = output.replace(new RegExp(escapeRegExp(trimmed), "g"), REDACTED);
  }

  return redactUrl(output);
}

/**
 * Collect the secret-shaped values present in an environment-like object so
 * they can be scrubbed from downstream messages.
 */
export function collectSecretValues(
  env: Record<string, string | undefined> = process.env,
): string[] {
  const secrets: string[] = [];

  for (const [name, value] of Object.entries(env)) {
    if (!value || !isSecretEnvName(name)) continue;
    const trimmed = value.trim();
    // Defence in depth behind the name exception above. Harvesting a numeric
    // value would replace every occurrence of that number in every downstream
    // error message — a limit misclassified as a secret does not leak anything,
    // it corrupts the diagnostics the redaction exists to keep readable.
    if (NUMERIC_VALUE_PATTERN.test(trimmed)) continue;
    if (trimmed.length >= MIN_REDACTABLE_SECRET_LENGTH) secrets.push(trimmed);
  }

  return secrets;
}

export interface SafeErrorOptions {
  /** Dependency name to prefix the message with, e.g. "postgres". */
  dependency?: string;
  /** Extra secret values to scrub beyond those found in the environment. */
  secrets?: Iterable<string>;
  /** Environment to harvest secret values from. Injectable for tests. */
  env?: Record<string, string | undefined>;
}

/**
 * Normalize an unknown thrown value into a message that names the failing
 * dependency and carries no credentials.
 */
export function safeErrorMessage(error: unknown, options: SafeErrorOptions = {}): string {
  const { dependency, secrets = [], env = process.env } = options;

  const raw = error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : "unknown error";

  const scrubbed = redactText(raw, [...collectSecretValues(env), ...secrets]);
  return dependency ? `${dependency}: ${scrubbed}` : scrubbed;
}
