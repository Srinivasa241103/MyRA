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

export const userApi = {
  /**
   * PATCH /auth/user/name
   * Updates the app-level display name (user_name).
   * Returns { success, data: { user } }
   */
  updateUserName: async (userName) => {
    const res = await fetch(`${API_BASE_URL}/auth/user/name`, {
      method: "PATCH",
      headers: getHeaders(),
      credentials: "include",
      body: JSON.stringify({ userName }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }

    return data;
  },
};
