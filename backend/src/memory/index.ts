/**
 * `memory` — the memory plane.
 *
 * Layer 1/2. Short-term conversation memory, the canonical long-term store
 * (episodic, semantic, prospective, procedural), the curator that decides what is
 * allowed to persist, and the repositories underneath.
 *
 * Principle 7: agents *propose* memory candidates; they do not write memory. The
 * curator and the deterministic policies decide. Keeping that decision inside
 * this module is what makes "no unverified memory writes" checkable rather than
 * aspirational.
 *
 * Populated by MEM-01…MEM-09.
 */

// No public surface yet — the packages above populate this barrel.
// The boundary is declared now so later code lands inside it rather
// than beside it.
export {};
