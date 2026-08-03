/**
 * FND-05.5 — probe runner registration.
 *
 * `app.js` mounts the health router at import time, which is before the FND-05.6
 * bootstrap has validated configuration or built the probe set. Registering the
 * runner separately keeps app.js from importing the probe implementations and
 * lets the router resolve the runner per request rather than per mount.
 *
 * The bootstrap registers the runner produced by the FND-05.4 registry's
 * `createProbeRunner(defaultProbes(config), { timeoutMs })`.
 *
 * The default is deliberately fail-closed. With no runner registered, readiness
 * reports `down` and names the reason. An unregistered runner is a wiring bug,
 * and a fail-open default would ship it as a permanently green endpoint.
 */

import type { ProbeRunResult, ProbeRunner } from "./probeContract.js";

export const PROBE_RUNNER_UNREGISTERED_DETAIL = "probe runner not registered";

/** The runner exceeded the router's outer bound and was abandoned. */
export const PROBE_DEADLINE_DETAIL = "probe run exceeded its deadline";

/** The run omitted a probe that must always be present. */
export const MISSING_REQUIRED_PROBES_DETAIL = "required probes missing from the run";

let runner: ProbeRunner | null = null;

export function setProbeRunner(next: ProbeRunner | null): void {
  runner = next;
}

export function getProbeRunner(): ProbeRunner | null {
  return runner;
}

export function resetProbeRunnerForTests(): void {
  runner = null;
}

/**
 * Stand-in result for a probe run that could not be performed at all — an
 * unregistered runner, or a runner that breached its no-throw contract.
 */
export function unavailableProbeResult(detail: string): ProbeRunResult {
  return {
    status: "down",
    probes: [
      {
        name: "probes",
        status: "down",
        required: true,
        latencyMs: 0,
        detail,
      },
    ],
    durationMs: 0,
  };
}
