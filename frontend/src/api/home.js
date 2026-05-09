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

// ── Dummy data ────────────────────────────────────────────────────────────────

export const DUMMY = {
  dailySummary: {
    unreadEmails: null,
    remindersDue: null,
    meetings: null,
  },
  upcomingEvents: [
    { time: "2:00 PM",  title: "Design crit — Onboarding v3", where: "Conf room A" },
    { time: "4:00 PM",  title: "1:1 with Priya",              where: "Google Meet" },
    { time: "Tomorrow", title: "Quarterly review prep",        where: "Block · 90 min" },
  ],
};

// ── API calls with dummy fallback ─────────────────────────────────────────────

export const homeApi = {
  /**
   * GET /stats/daily-summary
   * → { unreadEmails: number, remindersDue: number, meetings: number }
   */
  getDailySummary: async () => {
    try {
      return await safeFetch(`${API_BASE_URL}/stats/daily-summary`);
    } catch {
      return DUMMY.dailySummary;
    }
  },

  /**
   * GET /calendar/upcoming?limit=5
   * → { time: string, title: string, where: string }[]
   */
  getUpcomingEvents: async (limit = 5) => {
    try {
      return await safeFetch(`${API_BASE_URL}/calendar/upcoming?limit=${limit}`);
    } catch {
      return DUMMY.upcomingEvents;
    }
  },
};
