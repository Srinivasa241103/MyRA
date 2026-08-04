/**
 * `agents` — the LangGraph agent runtime.
 *
 * Layer 4, the top of the V2 stack: the Supervisor graph, its nodes, the
 * capability subagents, and the deterministic policies that bound them. It
 * orchestrates the layers below and nothing depends on it except `evaluation`.
 *
 * Two rules this module lives by, both enforced by the FND-07 architecture test:
 *   * It reaches external systems only through `tools` — never a provider SDK,
 *     never a credential store. An agent that can read a refresh token is an
 *     agent that can leak one into a prompt.
 *   * The shared contracts it is built on live in `agents/contracts`, which is a
 *     layer-0 boundary of its own. Depending on the contracts is not depending on
 *     the runtime.
 *
 * Populated by AGT-01…AGT-07 (state, checkpointing, supervisor, planner/worker
 * loop, interrupts, run API).
 */

// No public surface yet — the packages above populate this barrel.
// The boundary is declared now so later code lands inside it rather
// than beside it.
export {};
