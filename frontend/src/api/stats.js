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
  sessions:  [3, 5, 2, 7, 8, 4, 6, 9, 5, 7, 11, 6, 8, 10],
  calEvents: [2, 4, 3, 6, 5, 1, 3, 4, 7, 2,  5, 6,  3,  4],
};

// ── Single unified API call ───────────────────────────────────────────────────

export const statsApi = {
  /**
   * GET /stats/all?range=14d
   * Returns all stats in one response.
   */
  getAll: async (range = "14d") => {
    try {
      const res = await fetch(
        `${API_BASE_URL}/stats/all?range=${range}`,
        { headers: getHeaders(), credentials: "include" }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const d = json.data ?? json;
      const pick = (val, fallback) => (Array.isArray(val) && val.length > 0 ? val : fallback);
      return {
        emails:    pick(d.emails,    DUMMY.emails),
        tokens:    pick(d.tokens,    DUMMY.tokens),
        reminders: pick(d.reminders, DUMMY.reminders),
        cost:      pick(d.cost,      DUMMY.cost),
        sessions:  pick(d.sessions,  DUMMY.sessions),
        calEvents: pick(d.calEvents, DUMMY.calEvents),
      };
    } catch {
      return { ...DUMMY };
    }
  },
};
