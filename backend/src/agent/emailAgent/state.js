const DEFAULT_EMAIL_DETAILS = {
  to: [],
  cc: [],
  bcc: [],
  subject: null,
  bodyIntent: null,
  tone: "professional",
  isReply: false,
  replyReference: null,
};

const DEFAULT_ORIGINAL_EMAIL = {
  messageId: null,
  threadId: null,
  from: null,
  subject: null,
  bodyPreview: null,
  timestamp: null,
  inReplyTo: null,
  references: null,
};

const INITIAL_STATE = {
  userMessage: null,
  conversationId: null,
  userId: null,
  intent: null,
  status: "idle",
  // idle → parsing → resolving → clarifying → generating → reviewing
  //      → editing → sending → sent | saved_draft | cancelled | error
  mode: "save_draft", // 'save_draft' | 'send'  — NEVER default to 'send'
  emailDetails: { ...DEFAULT_EMAIL_DETAILS },
  originalEmail: { ...DEFAULT_ORIGINAL_EMAIL },

  missingFields: [],
  ambiguousFields: [],

  draftHistory: [],
  // Each entry: { version, subject, body, generatedAt, source }
  // source: 'generated' | 'edited' | 'regenerated'

  userFeedback: null,
  feedbackClassification: null,

  replyContextCandidates: [],
  // Populated when ambiguous: [{ messageId, threadId, from, subject, bodyPreview, score }]

  sentMessageId: null,
  savedDraftId: null,

  errors: [],
};

/**
 * Merges new emailDetails over existing ones.
 * Only updates a field if the new value is non-null and non-undefined.
 * Arrays (to, cc, bcc) are replaced only when the new value is a non-empty array.
 *
 * Why: parseEmailIntent runs on every turn. If Turn 1 captures 'to' and
 * Turn 2 only captures 'bodyIntent', we must not wipe 'to'.
 */
const mergeEmailDetails = (existing, incoming) => {
  if (!incoming) return existing;

  const merged = { ...existing };

  const scalarFields = [
    "subject",
    "bodyIntent",
    "tone",
    "isReply",
    "replyReference",
  ];
  for (const field of scalarFields) {
    if (incoming[field] !== null && incoming[field] !== undefined) {
      merged[field] = incoming[field];
    }
  }
  const arrayFields = ["to", "cc", "bcc"];
  for (const field of arrayFields) {
    if (Array.isArray(incoming[field]) && incoming[field].length > 0) {
      merged[field] = incoming[field];
    }
  }

  return merged;
};

const mergeOriginalEmail = (existing, incoming) => {
  if (!incoming) return existing;
  const merged = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (value !== null && value !== undefined) {
      merged[key] = value;
    }
  }
  return merged;
};

/**
 * Appends a new draft version to draftHistory.
 * Auto-increments version number.
 * Never call draftHistory.push() directly in a node — use this.
 */
const appendDraft = (existingHistory, newDraft) => {
  const version = existingHistory.length + 1;
  return [
    ...existingHistory,
    {
      version,
      subject: newDraft.subject,
      body: newDraft.body,
      generatedAt: new Date().toISOString(),
      source: newDraft.source || "generated",
    },
  ];
};

/**
 * Appends an error entry. Errors accumulate — never overwrite.
 */
const appendError = (existingErrors, error) => {
  return [
    ...existingErrors,
    {
      node: error.node,
      message: error.message,
      timestamp: new Date().toISOString(),
      retryable: error.retryable ?? false,
    },
  ];
};

/**
 * Returns the latest draft from draftHistory, or null if none yet.
 */
const getLatestDraft = (draftHistory) => {
  if (!draftHistory || draftHistory.length === 0) return null;
  return draftHistory[draftHistory.length - 1];
};

const validateStateShape = (state) => {
  const required = [
    "userMessage",
    "conversationId",
    "intent",
    "status",
    "mode",
    "emailDetails",
    "originalEmail",
    "missingFields",
    "ambiguousFields",
    "draftHistory",
    "userFeedback",
    "feedbackClassification",
    "replyContextCandidates",
    "sentMessageId",
    "savedDraftId",
    "errors",
  ];

  const missing = required.filter((key) => !(key in state));
  if (missing.length > 0) {
    throw new Error(`EmailAgentState is missing keys: ${missing.join(", ")}`);
  }

  if (!Array.isArray(state.draftHistory)) {
    throw new Error("draftHistory must be an array");
  }
  if (!Array.isArray(state.errors)) {
    throw new Error("errors must be an array");
  }
  if (!Array.isArray(state.missingFields)) {
    throw new Error("missingFields must be an array");
  }

  return true;
};

export {
  INITIAL_STATE,
  DEFAULT_EMAIL_DETAILS,
  DEFAULT_ORIGINAL_EMAIL,
  mergeEmailDetails,
  mergeOriginalEmail,
  appendDraft,
  appendError,
  getLatestDraft,
  validateStateShape,
};
