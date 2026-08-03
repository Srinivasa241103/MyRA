const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:9000";

const authHeaders = () => {
  const token = localStorage.getItem("myra_auth_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export const syncApi = {
  syncCalendar: async (syncType = "incremental") => {
    const response = await fetch(`${API_BASE_URL}/sync/calendar`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      credentials: "include",
      body: JSON.stringify({ syncType }),
    });

    if (!response.ok) {
      throw new Error(`Calendar sync failed: ${response.status}`);
    }

    return response.json();
  },

  syncGmail: async (syncType = "incremental") => {
    const response = await fetch(`${API_BASE_URL}/sync/gmail`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      credentials: "include",
      body: JSON.stringify({ syncType }),
    });

    if (!response.ok) {
      throw new Error(`Gmail sync failed: ${response.status}`);
    }

    return response.json();
  },
};
