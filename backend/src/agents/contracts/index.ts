/**
 * `agents/contracts` — the shared V2 contract surface (FND-01 and FND-02).
 *
 * Layer 0, despite living inside `src/agents/`. The flow contracts and the
 * domain schemas — `AgentRun`, `Plan`, `ToolCall`, `EvidenceItem`,
 * `ActionProposal`, `MemoryCandidate`, and the rest — are the vocabulary every
 * other module speaks. They import nothing but Zod, and they must keep
 * importing nothing but Zod.
 *
 * FND-07 treats this directory as a boundary separate from the agent runtime
 * around it. `evidence`, `memory`, `tools`, and the repositories may depend on
 * these types without depending on the graph; depending on `agents` itself
 * would be a layering inversion, and the architecture test rejects it.
 */

export * from "./flowContracts.js";
export * from "./domain/index.js";
