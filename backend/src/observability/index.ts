/**
 * `observability` — the observability plane's public surface.
 *
 * Layer 0. Depends on no other V2 module; every other module may depend on it.
 * That direction is deliberate: telemetry that imports the things it observes
 * turns every trace or metric addition into a potential import cycle.
 *
 * Today this is FND-05's health plane (probes, readiness, boot/drain
 * lifecycle). OBS-01 adds tracing, metrics, and the immutable action audit
 * behind this same entry point.
 *
 * FND-07: code outside `src/observability/**` imports from here, never from a
 * file inside the module. Tests may still reach internals — they assert on
 * implementation, which is exactly what a public surface is not for.
 */

export {
  aggregateProbeStatus,
  EXPECTED_REQUIRED_PROBES,
  isReadyFromProbes,
  missingRequiredProbes,
  type AggregateStatus,
  type ProbeResult,
  type ProbeRunOptions,
  type ProbeRunResult,
  type ProbeRunner,
  type ProbeStatus,
} from "./health/probeContract.js";

export type { ProbeDefinition, ProbeOutcome } from "./health/probeTypes.js";

export {
  getProbeRunner,
  MISSING_REQUIRED_PROBES_DETAIL,
  PROBE_DEADLINE_DETAIL,
  PROBE_RUNNER_UNREGISTERED_DETAIL,
  resetProbeRunnerForTests,
  setProbeRunner,
  unavailableProbeResult,
} from "./health/probeRegistration.js";

export {
  readinessState,
  ReadinessState,
  type LifecyclePhase,
  type LifecycleSnapshot,
  type ReadinessStateOptions,
} from "./health/readinessState.js";

export {
  createProbeRunner,
  DEFAULT_PROBE_TIMEOUT_MS,
  runProbes,
} from "./health/registry.js";

export {
  chromaProbe,
  defaultProbes,
  migrationsProbe,
  postgresProbe,
  redisProbe,
  resolveChromaHeartbeat,
  type ChromaHeartbeatTarget,
  type ChromaProbeOptions,
  type MigrationsProbeOptions,
  type PostgresProbeOptions,
  type RedisProbeOptions,
} from "./health/probes.js";

export {
  isShutdownInFlight,
  resetLifecycleForTests,
  shutdown,
  startup,
  type HttpCloseResult,
  type LifecycleLogger,
  type ShutdownOptions,
  type StartupOptions,
  type StartupResult,
} from "./health/lifecycle.js";
