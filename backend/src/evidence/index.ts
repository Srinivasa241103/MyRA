/**
 * `evidence` — the evidence ledger and citation service.
 *
 * Layer 1. Principle 6 of the architecture: tool and retrieval results become
 * normalized evidence *before* synthesis. This module owns that normalization,
 * the ledger they are recorded in, and the citation contract the UI renders.
 *
 * It never talks to providers. Evidence arrives from `tools`; this module stores,
 * deduplicates, and cites it. That is why `agents` can be given evidence without
 * being given credentials.
 *
 * Populated by EVD-01…EVD-03.
 */

// No public surface yet — the packages above populate this barrel.
// The boundary is declared now so later code lands inside it rather
// than beside it.
export {};
