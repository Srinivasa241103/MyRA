/**
 * `freshness` — the deterministic freshness contract.
 *
 * Layer 1. FRS-01 is a pure function by design: given a query's temporal intent,
 * a volatility manifest, and index age, it decides live-fetch versus indexed
 * retrieval. No I/O, no clock reads that are not passed in, no model call — so
 * its verdict is reproducible and testable, and a stale answer is traceable to an
 * input rather than to chance.
 *
 * Populated by FRS-01 (contract), FRS-02 (write-behind), FRS-03 (citation
 * hydration).
 */

// No public surface yet — the packages above populate this barrel.
// The boundary is declared now so later code lands inside it rather
// than beside it.
export {};
