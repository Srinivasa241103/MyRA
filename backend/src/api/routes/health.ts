/**
 * FND-05.5 — health endpoints.
 *
 * Three endpoints answering three different questions:
 *
 *   /health/live     Should this process be restarted?
 *   /health/ready    Should this process receive traffic?
 *   /health/startup  Has this process finished booting?
 *
 * The separation is the point. A liveness check that consults dependencies
 * turns a Postgres blip into a restart loop — every instance fails liveness, is
 * killed, boots, fails again, and the restarts do nothing to fix the database.
 * Liveness therefore performs no I/O.
 *
 * All three are unauthenticated, so no response may carry a secret or
 * unnecessary internal detail. Probe messages are suppressed in production;
 * dependency name and status are always reported, which is what the FND-05
 * requirement to "name the unavailable dependency" asks for.
 *
 * Readiness verdicts come from the FND-05.4 registry, which owns the aggregate
 * rules. This module never recomputes them.
 */

import { Router, type Request, type Response, type Router as ExpressRouter } from "express";
import {
  aggregateProbeStatus,
  isReadyFromProbes,
  missingRequiredProbes,
  type AggregateStatus,
  type ProbeResult,
  type ProbeRunResult,
  type ProbeRunner,
} from "../../observability/health/probeContract.js";
import {
  getProbeRunner,
  MISSING_REQUIRED_PROBES_DETAIL,
  PROBE_DEADLINE_DETAIL,
  PROBE_RUNNER_UNREGISTERED_DETAIL,
  unavailableProbeResult,
} from "../../observability/health/probeRegistration.js";
import {
  readinessState,
  type ReadinessState,
} from "../../observability/health/readinessState.js";
import { safeErrorMessage } from "../../config/redaction.js";
import { getRuntimeConfig } from "../../config/runtimeConfig.js";

/** Default probe-result reuse window. Bounds probe load under health-check polling. */
const DEFAULT_PROBE_CACHE_TTL_MS = 1_000;
const FALLBACK_PROBE_TIMEOUT_MS = 2_000;
/** Head-room between the per-probe budget and the router's own outer bound. */
const DEFAULT_DEADLINE_MARGIN_MS = 500;

export interface HealthDependencyView {
  name: string;
  status: ProbeResult["status"];
  required: boolean;
  latencyMs: number;
  detail?: string;
}

export interface HealthResponseBody {
  status: AggregateStatus;
  phase: string;
  uptimeMs: number;
  checkedAt: string;
  dependencies?: HealthDependencyView[];
}

export interface CreateHealthRouterOptions {
  /** Overrides the registered runner. Tests inject a fake; boot uses registration. */
  runProbes?: ProbeRunner | null;
  readiness?: ReadinessState;
  /** Suppresses probe messages when false. Defaults to `!isProduction`. */
  exposeDetail?: boolean;
  /** Per-probe budget handed to the registry. Defaults to readinessProbeTimeoutMs. */
  probeTimeoutMs?: number;
  /** Set to 0 to disable result reuse. */
  cacheTtlMs?: number;
  /** Outer bound on a whole probe run. Defaults to probeTimeoutMs + 500ms. */
  deadlineMs?: number;
  now?: () => number;
}

/**
 * Read config lazily and defensively. The router is constructed at import time
 * by `app.js`, which can precede configuration validation, and tests build it
 * with no environment at all. Failure falls back to the safe choice: hide detail.
 */
function resolveExposeDetail(explicit: boolean | undefined): boolean {
  if (explicit !== undefined) return explicit;
  try {
    return !getRuntimeConfig().server.isProduction;
  } catch {
    return false;
  }
}

function resolveProbeTimeout(explicit: number | undefined): number {
  if (explicit !== undefined) return explicit;
  try {
    return getRuntimeConfig().runtime.readinessProbeTimeoutMs;
  } catch {
    return FALLBACK_PROBE_TIMEOUT_MS;
  }
}

function toDependencyView(probe: ProbeResult, exposeDetail: boolean): HealthDependencyView {
  const view: HealthDependencyView = {
    name: probe.name,
    status: probe.status,
    required: probe.required,
    latencyMs: probe.latencyMs,
  };

  // The registry redacts probe details already, but an unauthenticated endpoint
  // should not rely on that alone: details still carry internal facts such as
  // pending migration names, so production omits the field entirely.
  if (exposeDetail && probe.detail) view.detail = probe.detail;
  return view;
}

/**
 * Health responses must never be cached. A cached 200 would keep routing
 * traffic to an instance that has since started draining.
 */
function sendHealth(res: Response, statusCode: number, body: HealthResponseBody): void {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  res.status(statusCode).json(body);
}

export function createHealthRouter(options: CreateHealthRouterOptions = {}): ExpressRouter {
  const {
    readiness = readinessState,
    cacheTtlMs = DEFAULT_PROBE_CACHE_TTL_MS,
    now = Date.now,
  } = options;

  const exposeDetail = resolveExposeDetail(options.exposeDetail);
  const probeTimeoutMs = resolveProbeTimeout(options.probeTimeoutMs);
  const deadlineMs = options.deadlineMs ?? probeTimeoutMs + DEFAULT_DEADLINE_MARGIN_MS;
  const router = Router();

  let inFlight: Promise<ProbeRunResult> | null = null;
  let cached: { at: number; result: ProbeRunResult } | null = null;

  function resolveRunner(): ProbeRunner | null {
    // `undefined` means "not overridden"; an explicit `null` means "no runner".
    return options.runProbes !== undefined ? options.runProbes : getProbeRunner();
  }

  /**
   * Run the probes, reusing a recent summary and collapsing concurrent requests
   * into a single run.
   *
   * Both matter under health-check polling: a load balancer, an orchestrator,
   * and a dashboard can poll simultaneously, and without this every poll would
   * open its own Postgres, Chroma, and Redis connection — health checking
   * becoming its own source of load precisely when the system is struggling.
   */
  async function runProbesDeduplicated(): Promise<ProbeRunResult> {
    if (cacheTtlMs > 0 && cached && now() - cached.at < cacheTtlMs) {
      return cached.result;
    }
    if (inFlight) return inFlight;

    const runner = resolveRunner();
    if (!runner) return unavailableProbeResult(PROBE_RUNNER_UNREGISTERED_DETAIL);

    const settled = Promise.resolve()
      .then(() => runner({ timeoutMs: probeTimeoutMs }))
      .catch((error: unknown) =>
        // The registry contractually never rejects. Treat a breach as `down`
        // rather than letting it surface as a 500 from the health endpoint.
        unavailableProbeResult(safeErrorMessage(error, { dependency: "probes" })),
      );

    // `probeTimeoutMs` is the PER-PROBE budget handed to the registry — the
    // registry honouring it is an assumption, not a guarantee this module can
    // make. Without an outer bound, a runner that never settles leaves the
    // endpoint with no response at all, and the pending promise parked in
    // `inFlight` makes every later request hang too.
    const guarded = new Promise<ProbeRunResult>((resolve) => {
      const timer = setTimeout(() => {
        release(guarded);
        resolve(unavailableProbeResult(PROBE_DEADLINE_DETAIL));
      }, deadlineMs);
      // Never let a pending deadline hold the process (or a test runner) open.
      timer.unref?.();

      void settled.then((result) => {
        clearTimeout(timer);
        resolve(result);
      });
    });

    // Stamp at completion, not at start. Stamping at start makes an entry
    // already stale whenever a run outlasts the TTL — so the stampede guard
    // disappears exactly when probes are slow, which is during the outage it
    // exists to protect against. The abandoned run still lands here after a
    // deadline, warming the cache for the next request.
    void settled.then((result) => {
      cached = { at: now(), result };
      release(guarded);
    });

    inFlight = guarded;
    return guarded;
  }

  /** Free the single-flight slot only if this run still owns it. */
  function release(owner: Promise<ProbeRunResult>): void {
    if (inFlight === owner) inFlight = null;
  }

  /**
   * Liveness. Performs no I/O and never consults a dependency, so it stays 200
   * through any outage. It reports failure only once the process has stopped.
   */
  router.get("/live", (_req: Request, res: Response) => {
    const snapshot = readiness.snapshot();

    sendHealth(res, readiness.alive ? 200 : 503, {
      status: readiness.alive ? "ok" : "down",
      phase: snapshot.phase,
      uptimeMs: snapshot.uptimeMs,
      checkedAt: new Date(now()).toISOString(),
    });
  });

  /**
   * Readiness. The conjunction of lifecycle phase and dependency health.
   *
   * Phase is checked first and short-circuits the probe run — a draining
   * instance is leaving rotation regardless of how healthy its dependencies
   * are, and probing during shutdown only delays the drain.
   */
  router.get("/ready", async (_req: Request, res: Response) => {
    const snapshot = readiness.snapshot();

    if (!readiness.acceptsTraffic) {
      sendHealth(res, 503, {
        status: snapshot.phase === "starting" ? "degraded" : "down",
        phase: snapshot.phase,
        uptimeMs: snapshot.uptimeMs,
        checkedAt: new Date(now()).toISOString(),
        dependencies: [],
      });
      return;
    }

    const run = await runProbesDeduplicated();
    const probesPassed = isReadyFromProbes(run.probes);

    // A run can be green simply by being empty. Only worth checking when
    // nothing has already failed — an aborted run reports its own reason.
    const missing = probesPassed ? missingRequiredProbes(run.probes) : [];
    const dependencies = run.probes.map((probe) => toDependencyView(probe, exposeDetail));

    if (missing.length > 0) {
      dependencies.push({
        name: "probes",
        status: "down",
        required: true,
        latencyMs: 0,
        ...(exposeDetail
          ? { detail: `${MISSING_REQUIRED_PROBES_DETAIL}: ${missing.join(", ")}` }
          : {}),
      });
    }

    const ready = probesPassed && missing.length === 0;

    sendHealth(res, ready ? 200 : 503, {
      status: missing.length > 0 ? "down" : aggregateProbeStatus(run.probes),
      phase: snapshot.phase,
      uptimeMs: snapshot.uptimeMs,
      checkedAt: new Date(now()).toISOString(),
      dependencies,
    });
  });

  /**
   * Startup. Latches once boot completes and stays 200 for the rest of the
   * process lifetime — a later drain does not un-complete startup. Separating
   * this from readiness lets a slow boot (migration verification) have a
   * generous budget without loosening the ongoing readiness deadline.
   */
  router.get("/startup", (_req: Request, res: Response) => {
    const snapshot = readiness.snapshot();
    const complete = readiness.startupComplete;

    sendHealth(res, complete ? 200 : 503, {
      status: complete ? "ok" : "degraded",
      phase: snapshot.phase,
      uptimeMs: snapshot.uptimeMs,
      checkedAt: new Date(now()).toISOString(),
    });
  });

  return router;
}

export default createHealthRouter;
