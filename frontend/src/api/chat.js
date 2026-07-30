const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:2020";

const authHeaders = () => {
  const token = localStorage.getItem("myra_auth_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export const chatApi = {
  sendMessage: async (
    message,
    conversationId = null,
    confirmationStatus = null,
    agentActive = false,
    activeAgentMode = null,
    modelSelection = null,
  ) => {
    const response = await fetch(`${API_BASE_URL}/chat/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      credentials: "include",
      body: JSON.stringify({
        message,
        conversationId,
        confirmationStatus,
        agentActive,
        activeAgentMode,
        provider: modelSelection?.provider,
        model: modelSelection?.model,
      }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const error = new Error(data.error || `Chat request failed: ${response.status}`);
      error.data = data;
      throw error;
    }

    return response.json();
  },

  getEmailStatus: async (conversationId) => {
    const response = await fetch(`${API_BASE_URL}/chat/email-status/${conversationId}`, {
      method: "GET",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error(`Failed to read email status: ${response.status}`);
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
      const data = await response.json().catch(() => ({}));
      const error = new Error(data.error || `Failed to fetch history: ${response.status}`);
      error.data = data;
      error.status = response.status;
      throw error;
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

  deleteConversation: async (conversationId) => {
    const response = await fetch(`${API_BASE_URL}/chat/conversation/${conversationId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      credentials: "include",
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const error = new Error(data.error || `Failed to delete conversation: ${response.status}`);
      error.data = data;
      error.status = response.status;
      throw error;
    }

    return response.json();
  },

  sendVoiceMessage: async ({
    audio,
    conversationId = null,
    language = "en-IN",
    durationMs = null,
    wakeWord = null,
  }) => {
    const formData = new FormData();
    const extension = audio.type?.includes("mp4") ? "mp4" : "webm";
    formData.append("audio", audio, `command.${extension}`);
    if (conversationId) formData.append("conversationId", conversationId);
    if (language) formData.append("language", language);
    if (durationMs !== null) formData.append("durationMs", String(durationMs));
    if (wakeWord) formData.append("wakeWord", wakeWord);

    const voicePath = import.meta.env.VITE_VOICE_CHAT_PATH || "/api/voice-chat";
    const response = await fetch(`${API_BASE_URL}${voicePath}`, {
      method: "POST",
      headers: { ...authHeaders() },
      credentials: "include",
      body: formData,
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const error = new Error(data.error || `Voice chat request failed: ${response.status}`);
      error.data = data;
      throw error;
    }

    return response.json();
  },
};
