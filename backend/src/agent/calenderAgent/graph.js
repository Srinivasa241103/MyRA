import { StateGraph, END, MemorySaver } from "@langchain/langgraph";
import calendarAgentState from "./state.js";
import nodes from "./nodes.js";
import { logger } from "../../utils/logger.js";

// Entry router: if the user has already confirmed/rejected, skip straight to
// the right node instead of re-running parse_intent.
function routeFromStart(state) {
  if (state.confirmationStatus === "confirmed") {
    logger.info("[Agent] Route: __start__ → create_event (user confirmed)");
    return "create_event";
  }
  if (state.confirmationStatus === "rejected") {
    logger.info("[Agent] Route: __start__ → END (user rejected)");
    return END;
  }
  logger.info("[Agent] Route: __start__ → parse_intent");
  return "parse_intent";
}

function routeAfterParsing(state) {
  if (state.missingFields.length > 0) {
    logger.info("[Agent] Route: parse_intent → ask_for_missing_info", { missingFields: state.missingFields });
    return "ask_for_missing_info";
  }
  logger.info("[Agent] Route: parse_intent → check_conflicts");
  return "check_conflicts";
}

function routeAfterConflictsCheck(state) {
  if (state.conflicts.length > 0) {
    logger.info("[Agent] Route: check_conflicts → suggest_slots");
    return "suggest_slots";
  }
  logger.info("[Agent] Route: check_conflicts → await_confirmation");
  return "await_confirmation";
}

const workflow = new StateGraph({ channels: calendarAgentState });

workflow
  .addNode("parse_intent", nodes.parseIntent)
  .addNode("ask_for_missing_info", nodes.askForMissingInfo)
  .addNode("check_conflicts", nodes.checkConflicts)
  .addNode("suggest_slots", nodes.suggestAlternativeSlots)
  .addNode("await_confirmation", nodes.awaitConfirmation)
  .addNode("create_event", nodes.createCalendarEvent);

workflow
  .addConditionalEdges("__start__", routeFromStart, {
    parse_intent: "parse_intent",
    create_event: "create_event",
    [END]: END,
  })
  .addConditionalEdges("parse_intent", routeAfterParsing, {
    ask_for_missing_info: "ask_for_missing_info",
    check_conflicts: "check_conflicts",
  })
  .addConditionalEdges("check_conflicts", routeAfterConflictsCheck, {
    suggest_slots: "suggest_slots",
    await_confirmation: "await_confirmation",
  })
  // These nodes all stop and return to the user — no loops
  .addEdge("ask_for_missing_info", END)
  .addEdge("suggest_slots", END)
  .addEdge("await_confirmation", END)
  .addEdge("create_event", END);

const checkpointer = new MemorySaver();
export const calendarAgentGraph = workflow.compile({ checkpointer });

const nextCalendarStage = (node, update = {}) => {
  if (node === "parse_intent") {
    return update.missingFields?.length > 0
      ? "calendar_confirmation"
      : "calendar_check";
  }
  if (node === "check_conflicts") {
    return update.conflicts?.length > 0
      ? "calendar_slots"
      : "calendar_confirmation";
  }
  if (node === "suggest_slots") return "calendar_slots";
  if (["ask_for_missing_info", "await_confirmation"].includes(node)) {
    return "calendar_confirmation";
  }
  if (node === "create_event") return "calendar_create";
  return null;
};

export async function invokeCalendarAgent(
  input,
  config,
  { onStatus, signal } = {},
) {
  let finalState = null;
  const stream = await calendarAgentGraph.stream(input, {
    ...config,
    ...(signal ? { signal } : {}),
    streamMode: ["updates", "values"],
  });

  for await (const event of stream) {
    const [mode, data] = Array.isArray(event) ? event : ["values", event];
    if (mode === "values") {
      finalState = data;
      continue;
    }

    if (mode === "updates" && data && typeof data === "object") {
      const [node, update] = Object.entries(data)[0] ?? [];
      const stage = nextCalendarStage(node, update);
      if (stage) await onStatus?.(stage);
    }
  }

  if (finalState) return finalState;
  const snapshot = await calendarAgentGraph.getState(config);
  return snapshot.values;
}
