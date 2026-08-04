/**
 * `evaluation` — the offline quality harness.
 *
 * Layer 5. Golden datasets, deterministic evaluators, semantic judges, and the
 * runners that replay them. It may import any module — that is the point of a
 * harness — and nothing in the running system may import it, so evaluation code
 * can never end up on a request path.
 *
 * Populated by QLT-01…QLT-05.
 */

// No public surface yet — the packages above populate this barrel.
// The boundary is declared now so later code lands inside it rather
// than beside it.
export {};
