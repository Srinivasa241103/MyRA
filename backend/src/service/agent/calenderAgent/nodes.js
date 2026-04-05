import { ChatAnthropic } from "@langchain/anthropic";
import {
  getGoogleCalendarClient,
  findFreeSlotsForDay,
} from "../../sources/GoogleCalendarDataSource.js";
import { logger } from "../../../utils/logger.js";

const llm = new ChatAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: "claude-haiku-4-5-20251001",
  maxTokens: 1024,
});

// Fallback for scripts/cron jobs that don't go through the HTTP layer
const DEFAULT_USER_ID = process.env.SYNC_USER_ID;

function addOneHour(timeStr) {
  const [h, m] = timeStr.split(":").map(Number);
  return `${String((h + 1) % 24).padStart(2, "0")}:${String(m).padStart(
    2,
    "0"
  )}`;
}

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString("en-IN", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

const parseIntent = async (state) => {
  logger.info("[Agent] Node: parse_intent", { userMessage: state.userMessage, userId: state.userId });

  // If we're mid-collection, tell the LLM which field the user is answering
  // so short replies like "6:00 pm" or "today" are interpreted correctly.
  const collectionHint =
    state.missingFields?.length > 0
      ? `The assistant just asked the user for: "${state.missingFields[0]}". The user's reply is their answer to that specific question.`
      : "";

  const alreadyCollected = Object.entries(state.eventDetails || {})
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join(", ");

  const extractionPrompt = `
    Extract calendar event details from this user message: "${state.userMessage}"
    Today's date is ${new Date().toISOString().split("T")[0]}.
    ${collectionHint}
    ${alreadyCollected ? `Already collected: ${alreadyCollected}` : ""}
    Extract whatever is present in the message. Return null for fields not mentioned.
    Return JSON only, no markdown:
    {
      "title": string | null,
      "date": "YYYY-MM-DD" | null,
      "startTime": "HH:MM" (24hr) | null,
      "endTime": "HH:MM" (24hr) | null,
      "description": string | null,
      "attendees": [email strings] | [],
      "location": string | null
    }
    `;

  const response = await llm.invoke(extractionPrompt);

  let extracted;
  try {
    extracted = JSON.parse(response.content);
  } catch {
    extracted = {};
  }

  // Only keep non-null values so the state reducer never overwrites
  // a previously collected field with null from a follow-up message.
  const newDetails = Object.fromEntries(
    Object.entries(extracted).filter(([, v]) => v !== null && v !== undefined)
  );

  // Determine missing fields against the MERGED state (existing + newly extracted),
  // not just the current message extraction.
  const mergedDetails = { ...state.eventDetails, ...newDetails };
  const required = ["title", "date", "startTime"];
  const missing = required.filter((f) => !mergedDetails[f]);

  logger.info("[Agent] parse_intent result", { extracted: newDetails, missingFields: missing });

  return {
    eventDetails: newDetails,
    missingFields: missing,
    messages: [{ role: "user", content: state.userMessage }],
  };
};

const askForMissingInfo = async (state) => {
  logger.info("[Agent] Node: ask_for_missing_info", { missingFields: state.missingFields });

  const fieldDescriptions = {
    title: "What should the event be called?",
    date: "What date? (e.g. 'tomorrow', 'April 10th')",
    startTime: "What time should it start?",
  };

  const firstMissing = state.missingFields[0];
  const question = fieldDescriptions[firstMissing];

  logger.info("[Agent] Asking user for field", { field: firstMissing });

  return {
    responseToUser: question,
    messages: [{ role: "assistant", content: question }],
  };
};

const checkConflicts = async (state) => {
  const { date, startTime, endTime } = state.eventDetails;
  const userId = state.userId ?? DEFAULT_USER_ID;

  logger.info("[Agent] Node: check_conflicts", { userId, date, startTime, endTime });

  const startDateTime = `${date}T${startTime}:00`;
  const endDateTime = endTime
    ? `${date}T${endTime}:00`
    : `${date}T${addOneHour(startTime)}:00`;

  const calendar = await getGoogleCalendarClient(userId);

  const response = await calendar.events.list({
    calendarId: "primary",
    timeMin: new Date(startDateTime).toISOString(),
    timeMax: new Date(endDateTime).toISOString(),
    singleEvents: true,
  });

  const conflicts = response.data.items || [];

  if (conflicts.length > 0) {
    logger.info("[Agent] Conflicts found, fetching free slots", {
      conflictCount: conflicts.length,
      conflicts: conflicts.map((e) => e.summary),
    });
    const freeSlots = await findFreeSlotsForDay(calendar, date);
    return {
      conflicts: conflicts.map((e) => ({
        title: e.summary,
        time: e.start.dateTime,
      })),
      suggestedSlots: freeSlots,
    };
  }

  logger.info("[Agent] No conflicts found, proceeding to confirmation");
  return { conflicts, suggestedSlots: [] };
};

const suggestAlternativeSlots = async (state) => {
  logger.info("[Agent] Node: suggest_slots", {
    conflictCount: state.conflicts.length,
    availableSlots: state.suggestedSlots.length,
  });

  const conflictNames = state.conflicts.map((c) => c.title).join(", ");
  const slots = state.suggestedSlots.slice(0, 3); // Show top 3 options

  const slotText = slots
    .map((s, i) => `${i + 1}. ${s.start} - ${s.end}`)
    .join("\n");

  const message = `You already have: ${conflictNames} at that time.\n\nAvailable slots on that day:\n${slotText}\n\nWhich one works, or suggest a different time?`;

  return {
    responseToUser: message,
    messages: [{ role: "assistant", content: message }],
    confirmationStatus: null, // Reset, waiting for new input
  };
};

const awaitConfirmation = async (state) => {
  logger.info("[Agent] Node: await_confirmation", { eventDetails: state.eventDetails });

  const { title, date, startTime, endTime, attendees, location } =
    state.eventDetails;

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
};

const createCalendarEvent = async (state) => {
  const { title, date, startTime, endTime, description, attendees, location } =
    state.eventDetails;
  const userId = state.userId ?? DEFAULT_USER_ID;

  logger.info("[Agent] Node: create_event", { userId, title, date, startTime, endTime, attendees });

  const calendar = await getGoogleCalendarClient(userId);

  const event = {
    summary: title,
    description: description || "",
    start: {
      dateTime: new Date(`${date}T${startTime}:00`).toISOString(),
      timeZone: "Asia/Kolkata", // Your timezone
    },
    end: {
      dateTime: new Date(
        `${date}T${endTime || addOneHour(startTime)}:00`
      ).toISOString(),
      timeZone: "Asia/Kolkata",
    },
    attendees: attendees.map((email) => ({ email })),
    location: location || "",
  };

  const created = await calendar.events.insert({
    calendarId: "primary",
    requestBody: event,
    sendUpdates: attendees.length > 0 ? "all" : "none",
  });

  logger.info("[Agent] Event created successfully", { eventId: created.data.id, title, date });

  const successMsg = `✅ Event "${title}" created for ${formatDate(
    date
  )} at ${startTime}. ${
    attendees.length > 0 ? `Invites sent to ${attendees.join(", ")}.` : ""
  }`;

  return {
    responseToUser: successMsg,
    confirmationStatus: "confirmed",
    messages: [{ role: "assistant", content: successMsg }],
  };
};

export default {
  parseIntent,
  askForMissingInfo,
  checkConflicts,
  suggestAlternativeSlots,
  awaitConfirmation,
  createCalendarEvent,
};
