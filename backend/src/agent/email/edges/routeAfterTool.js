/**
 * Conditional edge — runs after toolNode executes.
 *
 * Branches on the state fields the tools wrote, in priority order:
 *   1. pendingSelection set      -> "selection"  (lookup returned candidates; block for a human pick)
 *   2. draft awaiting sign-off   -> "approval"   (HITL gate before send/save)
 *   3. anything else             -> "agent"      (let the planner react to the tool result)
 *
 * Never returns END — a tool finishing is never the end of the loop; the planner
 * always gets to react to it.
 */
const routeAfterTool = (state) => {
    if (state.pendingSelection !== null) return "selection";

    if (state.currentDraft !== null && state.approvalStatus === "pending") return "approval";

    return "agent";
}

export { routeAfterTool };