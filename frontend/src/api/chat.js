const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:9000";

const authHeaders = () => {
  const token = localStorage.getItem("myra_auth_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export const chatApi = {
  sendMessage: async (message, conversationId = null, confirmationStatus = null, agentActive = false) => {
    const response = await fetch(`${API_BASE_URL}/chat/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      credentials: "include",
      body: JSON.stringify({ message, conversationId, confirmationStatus, agentActive }),
    });

    if (!response.ok) {
      throw new Error(`Chat request failed: ${response.status}`);
    }

    return response.json();
  },

  createConversation: async () => {
    const response = await fetch(`${API_BASE_URL}/chat/conversation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error(`Failed to create conversation: ${response.status}`);
    }

    return response.json();
  },

  getHistory: async (conversationId, limit = 50) => {
    const response = await fetch(
      `${API_BASE_URL}/chat/history/${conversationId}?limit=${limit}`,
      {
        method: "GET",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        credentials: "include",
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch history: ${response.status}`);
    }

    return response.json();
  },

  getConversations: async () => {
    const response = await fetch(`${API_BASE_URL}/chat/conversations`, {
      method: "GET",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch conversations: ${response.status}`);
    }

    return response.json();
  },
};
