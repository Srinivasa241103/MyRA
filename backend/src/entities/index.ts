/**
 * `entities` — cross-source entity resolution.
 *
 * Layer 1. ENT-01 generalizes `RAG/retrieval/personResolver.ts` into a resolver
 * shared by retrieval, scheduling, and memory, so "Anand" resolves to one
 * identity everywhere instead of once per feature.
 *
 * Resolution is deterministic and returns candidates with confidence; deciding
 * what to do with an ambiguous match belongs to the caller (a clarification
 * interrupt in the graph, an attendee prompt in CAL-02) — not here.
 */

// No public surface yet — the packages above populate this barrel.
// The boundary is declared now so later code lands inside it rather
// than beside it.
export {};
