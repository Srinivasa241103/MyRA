/**
 * FND-05.5 — lifecycle phase.
 *
 * Tracks where the process is in its own lifecycle, independently of whether
 * dependencies are reachable. Readiness is the conjunction of the two:
 * `phase === "ready"` AND no required probe is down.
 *
 * Transitions are validated rather than assignable. The case that matters is
 * `draining -> ready`: startup work is asynchronous, so a probe or migration
 * step can still be in flight when SIGTERM arrives. If a late completion could
 * flip the phase back to ready, a draining instance would re-advertise itself
 * and receive traffic it is about to stop serving. Draining is terminal-ward.
 */

import { logger } from "../../utils/logger.js";

export type LifecyclePhase = "starting" | "ready" | "draining" | "stopped";

/** Adjacency for legal transitions. Self-transitions are allowed and are no-ops. */
const LEGAL_TRANSITIONS: Readonly<Record<LifecyclePhase, readonly LifecyclePhase[]>> =
  Object.freeze({
    starting: ["ready", "draining", "stopped"],
    // No path back to `starting`: a process never un-boots.
    ready: ["draining", "stopped"],
    // No path back to `ready`: see the module comment.
    draining: ["stopped"],
    stopped: [],
  });

export interface LifecycleSnapshot {
  readonly phase: LifecyclePhase;
  readonly uptimeMs: number;
  /** Set once startup completes; drives /health/startup. */
  readonly startupCompletedAt: string | null;
  readonly changedAt: string;
}

export interface ReadinessStateOptions {
  /** Injectable clock. Keeps uptime and timestamp assertions deterministic. */
  readonly now?: () => number;
}

export class ReadinessState {
  #phase: LifecyclePhase = "starting";
  #startedAt: number;
  #changedAt: number;
  #startupCompletedAt: number | null = null;
  readonly #now: () => number;

  constructor({ now = Date.now }: ReadinessStateOptions = {}) {
    this.#now = now;
    this.#startedAt = now();
    this.#changedAt = this.#startedAt;
  }

  get phase(): LifecyclePhase {
    return this.#phase;
  }

  /** True once startup finished, including migration verification. */
  get startupComplete(): boolean {
    return this.#startupCompletedAt !== null;
  }

  /**
   * Attempt a transition. Returns whether the phase changed.
   * An illegal transition is refused and logged, never thrown: shutdown paths
   * call these and must not fail on a race.
   */
  transitionTo(next: LifecyclePhase): boolean {
    if (next === this.#phase) return false;

    if (!LEGAL_TRANSITIONS[this.#phase].includes(next)) {
      logger.warn("Refused an illegal lifecycle transition", {
        from: this.#phase,
        to: next,
      });
      return false;
    }

    this.#phase = next;
    this.#changedAt = this.#now();
    logger.info("Lifecycle phase changed", { phase: next });
    return true;
  }

  /**
   * Record that startup finished. Separate from the phase because
   * /health/startup must stay 200 for the rest of the process lifetime — a
   * later drain does not un-complete startup.
   */
  markStartupComplete(): void {
    this.#startupCompletedAt ??= this.#now();
  }

  markReady(): boolean {
    const changed = this.transitionTo("ready");
    if (changed) this.markStartupComplete();
    return changed;
  }

  markDraining(): boolean {
    return this.transitionTo("draining");
  }

  markStopped(): boolean {
    return this.transitionTo("stopped");
  }

  /** True only in `ready`; draining and stopped must not advertise readiness. */
  get acceptsTraffic(): boolean {
    return this.#phase === "ready";
  }

  /**
   * True unless the process has stopped. Liveness answers "should this be
   * restarted", which is a different question from "should this get traffic" —
   * conflating them turns a dependency outage into a restart loop that cannot
   * fix it.
   */
  get alive(): boolean {
    return this.#phase !== "stopped";
  }

  snapshot(): LifecycleSnapshot {
    return {
      phase: this.#phase,
      uptimeMs: Math.max(0, this.#now() - this.#startedAt),
      startupCompletedAt: this.#startupCompletedAt === null
        ? null
        : new Date(this.#startupCompletedAt).toISOString(),
      changedAt: new Date(this.#changedAt).toISOString(),
    };
  }

  resetForTests(): void {
    this.#phase = "starting";
    this.#startedAt = this.#now();
    this.#changedAt = this.#startedAt;
    this.#startupCompletedAt = null;
  }
}

/** Process-wide instance used by the router and by the FND-05.6 bootstrap. */
export const readinessState = new ReadinessState();
