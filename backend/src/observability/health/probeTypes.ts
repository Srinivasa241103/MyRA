/**
 * FND-05.4 — implementation-side probe types.
 *
 * The wire contract — `ProbeStatus`, `ProbeResult`, `ProbeRunResult`,
 * `ProbeRunner` — is owned by `probeContract.ts`, the seam FND-05.5 reads
 * from. This module re-exports it and adds only what the implementations
 * need: what a single probe *is* (`ProbeDefinition`) and what its `run`
 * resolves to (`ProbeOutcome`).
 *
 * Everything that crosses the seam must stay JSON-serializable and free of
 * secrets: readiness payloads are served to unauthenticated callers.
 */

import type { ProbeStatus } from "./probeContract.js";

export type {
  AggregateStatus,
  ProbeResult,
  ProbeRunOptions,
  ProbeRunResult,
  ProbeRunner,
  ProbeStatus,
} from "./probeContract.js";

/** What a probe's `run` resolves to. The registry fills in the rest. */
export interface ProbeOutcome {
  status: ProbeStatus;
  /**
   * Operator-facing description — the failure, or why the probe was skipped.
   * Must already be redacted by the probe; the FND-05.5 router additionally
   * suppresses it in production.
   */
  detail?: string;
  /** Self-measured latency, for probes that time themselves (e.g. Redis PING). */
  latencyMs?: number;
}

export interface ProbeDefinition {
  /** Dependency name surfaced in readiness payloads, e.g. "postgres". */
  name: string;
  /** Whether a `down` result must fail aggregate readiness. */
  required: boolean;
  /** Per-probe timeout override; falls back to the `runProbes` timeout. */
  timeoutMs?: number;
  /**
   * May throw or reject freely — the registry converts any failure into a
   * `down` result with a redacted message, so a probe bug or a hung driver
   * can never crash or hang the readiness endpoint.
   */
  run: () => Promise<ProbeOutcome>;
}
