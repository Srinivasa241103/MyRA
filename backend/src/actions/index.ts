/**
 * `actions` — proposal, approval, execution, and receipt.
 *
 * Layer 3. Every external write in the system passes through here: an
 * `ActionProposal` is built, an approval interrupt binds to the exact typed
 * arguments and their hash, an idempotency key is recorded *before* the provider
 * is called, and an `ActionReceipt` plus post-action verification closes the
 * loop.
 *
 * The layering exists so a retried run cannot duplicate an email or an invite:
 * the graph asks this module to execute, this module asks `tools`, and neither
 * can be short-circuited by a model deciding to call a provider directly.
 *
 * Populated by CAL-05…CAL-08 (and COM-* for the P1 Gmail vertical).
 */

// No public surface yet — the packages above populate this barrel.
// The boundary is declared now so later code lands inside it rather
// than beside it.
export {};
