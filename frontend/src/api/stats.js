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

// ── Single unified API call ───────────────────────────────────────────────────

const EMPTY_STATS = {
  emails: [],
  tokens: [],
  reminders: [],
  cost: [],
  sessions: [],
  calEvents: [],
};

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

      return {
        emails: Array.isArray(d.emails) ? d.emails : [],
        tokens: Array.isArray(d.tokens) ? d.tokens : [],
        reminders: Array.isArray(d.reminders) ? d.reminders : [],
        cost: Array.isArray(d.cost) ? d.cost : [],
        sessions: Array.isArray(d.sessions) ? d.sessions : [],
        calEvents: Array.isArray(d.calEvents) ? d.calEvents : [],
      };
    } catch {
      return { ...EMPTY_STATS };
    }
  },
};
