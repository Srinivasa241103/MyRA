const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:2020";

const TOKEN_KEY = "myra_auth_token";

function getHeaders() {
  const token = localStorage.getItem(TOKEN_KEY);
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function safeFetch(url) {
  const res = await fetch(url, { headers: getHeaders(), credentials: "include" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.data ?? data;
}

// ── Dummy data (fallback when API is unavailable) ─────────────────────────────

export const DUMMY = {
  emails: [38, 42, 31, 56, 47, 22, 18, 51, 64, 39, 43, 58, 29, 47],
  tokens: [
    { name: "Claude Haiku 4.5",  value: 1240000, color: "#7A4A2E" },
    { name: "GPT-4o",            value: 720000,  color: "#C9845A" },
    { name: "Gemini 1.5 Pro",    value: 410000,  color: "#D4A96A" },
    { name: "Llama 3.1 (local)", value: 280000,  color: "#8C6A4A" },
  ],
  reminders: [
    { day: "Mon", set: 6, done: 5 }, { day: "Tue", set: 4, done: 4 },
    { day: "Wed", set: 8, done: 6 }, { day: "Thu", set: 5, done: 5 },
    { day: "Fri", set: 9, done: 7 }, { day: "Sat", set: 2, done: 2 },
    { day: "Sun", set: 3, done: 1 },
  ],
  cost: [
    { provider: "Claude", spend: 18.42 },
    { provider: "OpenAI", spend: 11.07 },
    { provider: "Gemini", spend: 4.20  },
    { provider: "Local",  spend: 0.00  },
  ],
  chatSessions: [3, 5, 2, 7, 8, 4, 6, 9, 5, 7, 11, 6, 8, 10],
  calEvents:    [2, 4, 3, 6, 5, 1, 3, 4, 7, 2,  5, 6,  3,  4],
};

// ── API calls with dummy fallback ─────────────────────────────────────────────

export const statsApi = {
  /** GET /stats/emails?range=14d → number[] (daily email counts) */
  getEmails: async (range = "14d") => {
    try {
      return await safeFetch(`${API_BASE_URL}/stats/emails?range=${range}`);
    } catch {
      return DUMMY.emails;
    }
  },

  /** GET /stats/tokens?range=30d → { name, value, color }[] */
  getTokens: async (range = "30d") => {
    try {
      return await safeFetch(`${API_BASE_URL}/stats/tokens?range=${range}`);
    } catch {
      return DUMMY.tokens;
    }
  },

  /** GET /stats/reminders?range=7d → { day, set, done }[] */
  getReminders: async (range = "7d") => {
    try {
      return await safeFetch(`${API_BASE_URL}/stats/reminders?range=${range}`);
    } catch {
      return DUMMY.reminders;
    }
  },

  /** GET /stats/cost?range=30d → { provider, spend }[] */
  getCost: async (range = "30d") => {
    try {
      return await safeFetch(`${API_BASE_URL}/stats/cost?range=${range}`);
    } catch {
      return DUMMY.cost;
    }
  },

  /** GET /stats/sessions?range=14d → number[] (daily session counts) */
  getSessions: async (range = "14d") => {
    try {
      return await safeFetch(`${API_BASE_URL}/stats/sessions?range=${range}`);
    } catch {
      return DUMMY.chatSessions;
    }
  },

  /** GET /stats/calendar?range=14d → number[] (daily calendar event counts) */
  getCalendar: async (range = "14d") => {
    try {
      return await safeFetch(`${API_BASE_URL}/stats/calendar?range=${range}`);
    } catch {
      return DUMMY.calEvents;
    }
  },

  /** Fetch all stats in parallel, always returns something */
  getAll: async (range = "14d") => {
    const [emails, tokens, reminders, cost, sessions, calEvents] = await Promise.all([
      statsApi.getEmails(range),
      statsApi.getTokens(range),
      statsApi.getReminders(range),
      statsApi.getCost(range),
      statsApi.getSessions(range),
      statsApi.getCalendar(range),
    ]);
    return { emails, tokens, reminders, cost, sessions, calEvents };
  },
};
