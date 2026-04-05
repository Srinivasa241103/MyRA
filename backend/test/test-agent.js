// test/test-agent.js
// Tests intentRouter classification and calender agent node logic.
// Run: node test/test-agent.js

import dotenv from "dotenv";
dotenv.config();

import { routeIntent } from "../src/service/router/intentRouter.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ ${label}`);
    failed++;
  }
}

function section(title) {
  console.log(`\n${"─".repeat(55)}`);
  console.log(`  ${title}`);
  console.log(`${"─".repeat(55)}`);
}

// ─── Mock node helpers (stand-ins for unimplemented utils) ───────────────────
// nodes.js calls addOneHour, formatDate, getGoogleCalendarClient,
// findFreeSlotsForDay — these are not yet implemented. We reproduce the pure
// node logic inline here so we can test it without real API credentials.

function addOneHour(timeStr) {
  const [h, m] = timeStr.split(":").map(Number);
  return `${String((h + 1) % 24).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString("en-IN", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

// ─── Inline copies of pure nodes (no API calls) ──────────────────────────────

function askForMissingInfo(state) {
  const fieldDescriptions = {
    title: "What should the event be called?",
    date: "What date? (e.g. 'tomorrow', 'April 10th')",
    startTime: "What time should it start?",
  };
  const firstMissing = state.missingFields[0];
  return {
    responseToUser: fieldDescriptions[firstMissing],
    messages: [{ role: "assistant", content: fieldDescriptions[firstMissing] }],
  };
}

function suggestAlternativeSlots(state) {
  const conflictNames = state.conflicts.map((c) => c.title).join(", ");
  const slots = state.suggestedSlots.slice(0, 3);
  const slotText = slots.map((s, i) => `${i + 1}. ${s.start} - ${s.end}`).join("\n");
  const message = `You already have: ${conflictNames} at that time.\n\nAvailable slots on that day:\n${slotText}\n\nWhich one works, or suggest a different time?`;
  return {
    responseToUser: message,
    messages: [{ role: "assistant", content: message }],
    confirmationStatus: null,
  };
}

function awaitConfirmation(state) {
  const { title, date, startTime, endTime, attendees, location } = state.eventDetails;
  const preview = `
📅 Ready to create this event:

**${title}**
Date: ${formatDate(date)}
Time: ${startTime}${endTime ? ` - ${endTime}` : " (1 hour)"}
${location ? `Location: ${location}` : ""}
${attendees.length > 0 ? `Attendees: ${attendees.join(", ")}` : ""}

Shall I create this? (yes/no)
  `.trim();
  return {
    responseToUser: preview,
    confirmationStatus: "pending_confirmation",
    messages: [{ role: "assistant", content: preview }],
  };
}

// ─── Graph routing functions (mirrors graph.js, not exported from there) ──────

function routeAfterParsing(state) {
  return state.missingFields.length > 0 ? "ask_for_missing_info" : "check_conflicts";
}

function routeAfterConflictsCheck(state) {
  return state.conflicts.length > 0 ? "suggest_slots" : "await_confirmation";
}

function routeAfterConfirmation(state) {
  if (state.confirmationStatus === "confirmed") return "create_event";
  if (state.confirmationStatus === "rejected") return "END";
  return "await_confirmation";
}

// ─────────────────────────────────────────────────────────────────────────────
//  SECTION 1 — Intent Router
// ─────────────────────────────────────────────────────────────────────────────

section("Intent Router — LLM Classification");
console.log("  (Calling Gemini — may take a few seconds…)\n");

const INTENT_CASES = [
  // [userMessage, expectedIntent, description]
  ["Schedule a team meeting for tomorrow at 3pm",            "calendar_agent", "create event → calendar_agent"],
  ["Block 2 hours for deep work on Friday",                  "calendar_agent", "block time → calendar_agent"],
  ["What's on my calendar tomorrow?",                        "calendar_rag",   "read calendar → calendar_rag"],
  ["Am I free this Thursday afternoon?",                     "calendar_rag",   "availability check → calendar_rag"],
  ["What emails did I get from Rahul last week?",            "rag",            "email query → rag"],
  ["Summarise my week for me",                               "rag",            "summarise → rag"],
];

const VALID_INTENTS = ["rag", "calendar_agent", "calendar_rag"];

for (const [message, expected, label] of INTENT_CASES) {
  try {
    const intent = await routeIntent(message);
    assert(VALID_INTENTS.includes(intent), `Valid intent returned for: "${message}" → got "${intent}"`);
    assert(intent === expected, `${label} (expected "${expected}", got "${intent}")`);
  } catch (err) {
    console.error(`  ❌ routeIntent threw for "${message}":`, err.message);
    failed += 2;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  SECTION 2 — Graph routing functions
// ─────────────────────────────────────────────────────────────────────────────

section("Graph Routing Functions");

// routeAfterParsing
assert(
  routeAfterParsing({ missingFields: ["date", "startTime"] }) === "ask_for_missing_info",
  "routeAfterParsing → ask_for_missing_info when fields are missing"
);
assert(
  routeAfterParsing({ missingFields: [] }) === "check_conflicts",
  "routeAfterParsing → check_conflicts when all fields present"
);

// routeAfterConflictsCheck
assert(
  routeAfterConflictsCheck({ conflicts: [{ title: "Standup", time: "09:00" }] }) === "suggest_slots",
  "routeAfterConflictsCheck → suggest_slots when conflicts exist"
);
assert(
  routeAfterConflictsCheck({ conflicts: [] }) === "await_confirmation",
  "routeAfterConflictsCheck → await_confirmation when no conflicts"
);

// routeAfterConfirmation
assert(
  routeAfterConfirmation({ confirmationStatus: "confirmed" }) === "create_event",
  "routeAfterConfirmation → create_event on confirmed"
);
assert(
  routeAfterConfirmation({ confirmationStatus: "rejected" }) === "END",
  "routeAfterConfirmation → END on rejected"
);
assert(
  routeAfterConfirmation({ confirmationStatus: "pending_confirmation" }) === "await_confirmation",
  "routeAfterConfirmation → await_confirmation when still pending"
);

// ─────────────────────────────────────────────────────────────────────────────
//  SECTION 3 — Node: askForMissingInfo
// ─────────────────────────────────────────────────────────────────────────────

section("Node — askForMissingInfo");

{
  const result = askForMissingInfo({ missingFields: ["title"] });
  assert(result.responseToUser === "What should the event be called?", "asks for title");
  assert(result.messages[0].role === "assistant", "appends assistant message");
}
{
  const result = askForMissingInfo({ missingFields: ["date", "startTime"] });
  assert(result.responseToUser.includes("date"), "asks for date when date is first missing");
}
{
  const result = askForMissingInfo({ missingFields: ["startTime"] });
  assert(result.responseToUser === "What time should it start?", "asks for startTime");
}

// ─────────────────────────────────────────────────────────────────────────────
//  SECTION 4 — Node: suggestAlternativeSlots
// ─────────────────────────────────────────────────────────────────────────────

section("Node — suggestAlternativeSlots");

{
  const state = {
    conflicts: [{ title: "Standup", time: "09:00" }, { title: "1:1 with Manager", time: "10:00" }],
    suggestedSlots: [
      { start: "11:00", end: "12:00" },
      { start: "14:00", end: "15:00" },
      { start: "16:00", end: "17:00" },
      { start: "18:00", end: "19:00" }, // 4th slot should be trimmed
    ],
  };
  const result = suggestAlternativeSlots(state);
  assert(result.responseToUser.includes("Standup"), "mentions conflict names");
  assert(result.responseToUser.includes("1:1 with Manager"), "mentions all conflicts");
  assert(result.responseToUser.includes("11:00"), "includes first suggested slot");
  assert(!result.responseToUser.includes("18:00"), "trims to top 3 slots only");
  assert(result.confirmationStatus === null, "resets confirmationStatus to null");
  assert(result.messages[0].role === "assistant", "appends assistant message");
}

// ─────────────────────────────────────────────────────────────────────────────
//  SECTION 5 — Node: awaitConfirmation
// ─────────────────────────────────────────────────────────────────────────────

section("Node — awaitConfirmation");

{
  const state = {
    eventDetails: {
      title: "Team Sync",
      date: "2026-04-10",
      startTime: "14:00",
      endTime: "15:00",
      attendees: ["alice@example.com", "bob@example.com"],
      location: "Conference Room A",
    },
  };
  const result = awaitConfirmation(state);
  assert(result.confirmationStatus === "pending_confirmation", "sets confirmationStatus to pending_confirmation");
  assert(result.responseToUser.includes("Team Sync"), "preview contains event title");
  assert(result.responseToUser.includes("14:00 - 15:00"), "preview contains time range");
  assert(result.responseToUser.includes("Conference Room A"), "preview contains location");
  assert(result.responseToUser.includes("alice@example.com"), "preview contains attendees");
  assert(result.responseToUser.includes("Shall I create this?"), "preview has confirmation prompt");
  assert(result.messages[0].role === "assistant", "appends assistant message");
}

{
  // No endTime — should default to "(1 hour)"
  const state = {
    eventDetails: {
      title: "Focus Block",
      date: "2026-04-11",
      startTime: "09:00",
      endTime: null,
      attendees: [],
      location: null,
    },
  };
  const result = awaitConfirmation(state);
  assert(result.responseToUser.includes("(1 hour)"), "shows (1 hour) when endTime is null");
  assert(!result.responseToUser.includes("Attendees:"), "omits attendees section when empty");
  assert(!result.responseToUser.includes("Location:"), "omits location section when null");
}

// ─────────────────────────────────────────────────────────────────────────────
//  SECTION 6 — addOneHour helper (used in nodes)
// ─────────────────────────────────────────────────────────────────────────────

section("Helper — addOneHour");

assert(addOneHour("09:00") === "10:00", "09:00 → 10:00");
assert(addOneHour("23:00") === "00:00", "23:00 wraps to 00:00");
assert(addOneHour("13:30") === "14:30", "13:30 → 14:30");

// ─────────────────────────────────────────────────────────────────────────────
//  Summary
// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n${"═".repeat(55)}`);
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log(`${"═".repeat(55)}\n`);

if (failed > 0) process.exit(1);
