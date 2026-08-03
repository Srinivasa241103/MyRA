/**
 * FND-05.4 — probe registry.
 *
 * Implements the `ProbeRunner` port declared in `probeContract.ts` (the
 * FND-05.5 seam). Runs a set of probes in parallel, each bounded by its own
 * timeout, and aggregates the results with the contract's own rules. Two
 * invariants:
 *
 *   1. One hung dependency cannot hang the endpoint. Every probe races its
 *      timeout; the loser is reported `down` with a message that names it.
 *   2. Nothing a probe does can escape this module. A rejection, a thrown
 *      error, or a driver message embedding a connection string all surface
 *      as a redacted `down` result — never as a crash and never verbatim.
 */

import { safeErrorMessage } from "../../config/redaction.js";
import {
  aggregateProbeStatus,
  type ProbeResult,
  type ProbeRunOptions,
  type ProbeRunResult,
  type ProbeRunner,
} from "./probeContract.js";
import type { ProbeDefinition, ProbeOutcome } from "./probeTypes.js";

/** Mirrors the READINESS_PROBE_TIMEOUT_MS default in `runtimeConfig.ts`. */
export const DEFAULT_PROBE_TIMEOUT_MS = 2_000;

function probeTimeout(ms: number): { promise: Promise<never>; cancel: () => void } {
  let handle: NodeJS.Timeout;
  const promise = new Promise<never>((_resolve, reject) => {
    handle = setTimeout(() => reject(new Error(`probe timed out after ${ms}ms`)), ms);
  });
  return { promise, cancel: () => clearTimeout(handle) };
}

async function executeProbe(probe: ProbeDefinition, timeoutMs: number): Promise<ProbeResult> {
  const startedAt = performance.now();
  const timer = probeTimeout(timeoutMs);
  let outcome: ProbeOutcome;

  try {
    // Promise.race keeps a handler attached to the losing promise, so a probe
    // that rejects after its timeout already won cannot become an unhandled
    // rejection and take the process down with it.
    outcome = await Promise.race([probe.run(), timer.promise]);
  } catch (error) {
    outcome = {
      status: "down",
      detail: safeErrorMessage(error, { dependency: probe.name }),
    };
  } finally {
    timer.cancel();
  }

  return {
    name: probe.name,
    status: outcome.status,
    required: probe.required,
    latencyMs: outcome.latencyMs ?? Math.round(performance.now() - startedAt),
    ...(outcome.detail !== undefined ? { detail: outcome.detail } : {}),
  };
}

/**
 * Run every probe concurrently and aggregate. Never rejects: the readiness
 * endpoint turns this result into a 200 or a 503, so a throwing runner would
 * itself be an availability bug — the contract says as much.
 */
export async function runProbes(
  probes: readonly ProbeDefinition[],
  options: ProbeRunOptions = {},
): Promise<ProbeRunResult> {
  const { timeoutMs = DEFAULT_PROBE_TIMEOUT_MS } = options;
  const startedAt = performance.now();

  const results = await Promise.all(
    probes.map((probe) => executeProbe(probe, probe.timeoutMs ?? timeoutMs)),
  );

  return {
    status: aggregateProbeStatus(results),
    probes: results,
    durationMs: Math.round(performance.now() - startedAt),
  };
}

/**
 * Bind a probe set into a `ProbeRunner` for `setProbeRunner` — the FND-05.6
 * bootstrap wires it up with:
 *
 *   setProbeRunner(createProbeRunner(defaultProbes(config)));
 *
 * Accepts a thunk so the probe set can be rebuilt per run when needed;
 * per-call options (the router passes its configured timeout) win over the
 * defaults bound here.
 */
export function createProbeRunner(
  probes: readonly ProbeDefinition[] | (() => readonly ProbeDefinition[]),
  defaults: ProbeRunOptions = {},
): ProbeRunner {
  return (options = {}) => {
    const resolved = typeof probes === "function" ? probes() : probes;
    return runProbes(resolved, { timeoutMs: options.timeoutMs ?? defaults.timeoutMs });
  };
}
