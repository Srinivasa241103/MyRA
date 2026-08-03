/**
 * FND-05.5 — probe port.
 *
 * This is the seam between readiness reporting (FND-05.5) and the dependency
 * probes (FND-05.4). Only the *contract* lives here; the probe implementations
 * and the registry that runs them belong to FND-05.4, which re-exports these
 * types from `probeTypes.ts`.
 *
 * Keeping the contract separate lets readiness be implemented and fully tested
 * against fakes, and lets the two packages be built in parallel without either
 * importing the other's internals.
 */

/**
 * `degraded` and `skipped` are distinct on purpose:
 *
 *   skipped  — the dependency is not in use for this configuration, e.g. Chroma
 *              when VECTOR_STORE=pgvector. Absence of a result is not a fault.
 *   degraded — the dependency is in use and impaired, but readiness must not
 *              fail on it: either it is not required yet (Redis before TOL-03)
 *              or boot will repair the drift (pending migrations in `auto`).
 *
 * Collapsing these would either raise false alarms or hide real outages.
 */
export type ProbeStatus = "ok" | "degraded" | "down" | "skipped";

/** Aggregate health across all probes. `skipped` never appears here. */
export type AggregateStatus = "ok" | "degraded" | "down";

export interface ProbeResult {
  /** Stable dependency identifier, e.g. "postgres", "chroma", "redis", "migrations". */
  readonly name: string;
  readonly status: ProbeStatus;
  readonly latencyMs: number;
  /** Whether a `down` result must block readiness. */
  readonly required: boolean;
  /**
   * Operator-facing description — the failure, or why the probe was skipped.
   * Must already be redacted by the probe. The FND-05.5 router additionally
   * suppresses it in production.
   */
  readonly detail?: string;
}

export interface ProbeRunResult {
  readonly status: AggregateStatus;
  readonly probes: readonly ProbeResult[];
  readonly durationMs: number;
}

export interface ProbeRunOptions {
  /** Per-probe upper bound. A hung dependency must not hang the endpoint. */
  readonly timeoutMs?: number;
}

/**
 * Implemented by the FND-05.4 registry. Must never reject: a probe runner
 * reports status, it does not propagate failure. Readiness treats a rejection
 * as `down` defensively.
 */
export type ProbeRunner = (options?: ProbeRunOptions) => Promise<ProbeRunResult>;

/**
 * Readiness rule: only a *required* probe that is fully `down` blocks traffic.
 *
 * A required dependency that is merely `degraded` still serves — pulling the
 * instance out of rotation for slowness usually makes an incident worse by
 * concentrating load on the remaining instances.
 */
export function isReadyFromProbes(probes: readonly ProbeResult[]): boolean {
  return !probes.some((probe) => probe.required && probe.status === "down");
}

/**
 * Aggregate status across probes. `skipped` contributes nothing — a dependency
 * that is not in use cannot degrade the service.
 */
/**
 * Probes that must be present in every run.
 *
 * `isReadyFromProbes` asks "did anything fail?", which an empty set answers
 * with "no" — so a registry that registers nothing, throws while building its
 * probe list, or silently drops PostgreSQL would read as fully healthy. These
 * two are unconditional in FND-05.4's `defaultProbes`: Chroma may report
 * `skipped` under pgvector and Redis is optional until TOL-03, but PostgreSQL
 * and migrations are always present.
 */
export const EXPECTED_REQUIRED_PROBES = ["postgres", "migrations"] as const;

/**
 * Names from `EXPECTED_REQUIRED_PROBES` absent from a run.
 *
 * Kept separate from `isReadyFromProbes` on purpose: that predicate is called
 * with deliberately partial fixture sets across FND-05.4's tests, so folding a
 * presence requirement into it would be wrong as well as breaking. The router
 * applies both.
 */
export function missingRequiredProbes(probes: readonly ProbeResult[]): string[] {
  const present = new Set(probes.map((probe) => probe.name));
  return EXPECTED_REQUIRED_PROBES.filter((name) => !present.has(name));
}

export function aggregateProbeStatus(probes: readonly ProbeResult[]): AggregateStatus {
  let degraded = false;

  for (const probe of probes) {
    if (probe.status === "skipped") continue;
    if (probe.status === "down") {
      if (probe.required) return "down";
      degraded = true;
      continue;
    }
    if (probe.status === "degraded") degraded = true;
  }

  return degraded ? "degraded" : "ok";
}
