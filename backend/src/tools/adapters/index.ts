/**
 * `tools/adapters` — provider implementations, below the Tool Gateway.
 *
 * Each adapter turns one provider (Gmail, Calendar, an MCP server, indexed
 * RAG, memory) into the gateway's typed tool shape. Adapters may reach *down*
 * to `connectors` for a session and to the legacy RAG stack for retrieval;
 * they may not reach *up* to the gateway, the graph, or the action layer.
 *
 * This barrel is the gateway's view of them. Only `tools/**` may import it, so
 * an MCP server's raw tool names can never reach a prompt or a node directly
 * (plan §14.4).
 *
 * Populated by TOL-02, CON-01…CON-05.
 */

// No public surface yet — the packages above populate this barrel.
// The boundary is declared now so later code lands inside it rather
// than beside it.
export {};
