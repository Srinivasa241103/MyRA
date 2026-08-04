/**
 * `connectors` — provider sessions and credentials.
 *
 * Layer 0, and deliberately the *bottom* of the tool stack. This module owns
 * connector installations, OAuth credentials, token refresh, scope state, and MCP
 * client sessions. It knows about Google and MCP; it knows nothing about tools,
 * agents, evidence, or actions.
 *
 * The direction is the security boundary. `tools/adapters` may reach down here
 * for a session; `agents`, `evidence`, and `memory` may not reach here at all.
 * The FND-07 architecture test enforces both halves.
 *
 * Populated by CON-01…CON-05.
 */

// No public surface yet — the packages above populate this barrel.
// The boundary is declared now so later code lands inside it rather
// than beside it.
export {};
