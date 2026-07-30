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
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 4000);
  let res;
  try {
    res = await fetch(url, {
      headers: getHeaders(),
      credentials: "include",
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeoutId);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.data ?? data;
}

export const EMPTY_HOME_DATA = {
  dailySummary: {
    unreadEmails: null,
    remindersDue: null,
    meetings: null,
  },
  upcomingEvents: [],
};

export const homeApi = {
  /**
   * GET /stats/daily-summary
   * → { unreadEmails: number, remindersDue: number, meetings: number }
   */
  getDailySummary: async () => {
    try {
      return await safeFetch(`${API_BASE_URL}/stats/daily-summary`);
    } catch {
      return EMPTY_HOME_DATA.dailySummary;
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
      return EMPTY_HOME_DATA.upcomingEvents;
    }
  },
};
