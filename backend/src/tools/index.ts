/**
 * `tools` — the Tool Gateway.
 *
 * Layer 2, and the only doorway between the agent runtime and the outside
 * world. Gmail, Calendar, Slack, Notion, Drive, indexed RAG, and memory are all
 * *tools* here, not source agents (principle 4): one registry, one typed
 * definition shape, one place that resolves credentials, enforces permissions,
 * validates inputs and outputs, applies timeouts and retries, attaches
 * correlation and idempotency identifiers, redacts secrets, and normalizes
 * results into evidence.
 *
 * The module splits in two on purpose:
 *
 *   tools/core      registry, gateway, policy boundary   (this surface)
 *   tools/adapters  provider-specific implementations    (below the gateway)
 *
 * Adapters may not import the gateway, and nothing outside `tools/**` may
 * import an adapter. That is what "keep provider adapters below the Tool
 * Gateway" means in FND-07, and the architecture test checks both directions —
 * otherwise a provider's tool names leak into the graph and the gateway's
 * policy, redaction, and idempotency guarantees become optional.
 *
 * Populated by TOL-01…TOL-04.
 */

// No public surface yet — the packages above populate this barrel.
// The boundary is declared now so later code lands inside it rather
// than beside it.
export {};
