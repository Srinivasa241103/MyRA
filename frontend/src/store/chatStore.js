import { create } from "zustand";
import { chatApi } from "../api/chat";

// Normalise the email agent's agentResponse into something the UI can safely
// render. The response is either a plain string (clarify question) or a
// structured object (draft_approval, success, cancelled, error).
const normalizeEmailResponse = (response) => {
  if (response === null || response === undefined) {
    return { text: null, emailResponse: null };
  }
  if (typeof response === "string") {
    return { text: response, emailResponse: null };
  }
  if (response.type === "draft_approval") {
    // Full card — keep as emailResponse; text is the instructions line
    return { text: null, emailResponse: response };
  }
  // success, cancelled, error — all have a message field
  return { text: response.message ?? "Done.", emailResponse: null };
};

export const useChatStore = create((set, get) => ({
  messages: [],
  isTyping: false,
  conversationId: null,
  pendingConfirmation: false,
  agentActive: false,
  error: null,
  pendingMessage: null,

  conversations: [],
  conversationsLoading: false,
  conversationsError: null,

  sendMessage: async (text, confirmationStatus = null) => {
    const { conversationId, agentActive } = get();

    set((state) => ({
      messages: [...state.messages, { role: "user", text }],
      isTyping: true,
      error: null,
    }));

    try {
      const result = await chatApi.sendMessage(text, conversationId, confirmationStatus, agentActive);

      if (result.success) {
        let messageEntry;

        if (result.mode === "email_agent") {
          const { text: normText, emailResponse } = normalizeEmailResponse(result.response);
          messageEntry = {
            role: "ai",
            text: normText,
            emailResponse,
            emailStatus: result.emailStatus ?? null,
            mode: result.mode,
            context: result.context,
            metadata: result.metadata,
          };
        } else {
          messageEntry = {
            role: "ai",
            text: result.response,
            mode: result.mode ?? null,
            context: result.context,
            metadata: result.metadata,
          };
        }

        set((state) => ({
          messages: [...state.messages, messageEntry],
          isTyping: false,
          conversationId: result.conversationId,
          pendingConfirmation: result.pendingConfirmation ?? false,
          agentActive: result.agentActive ?? false,
        }));

        get().loadConversations();
      } else {
        set((state) => ({
          messages: [
            ...state.messages,
            {
              role: "ai",
              text: result.error || "Sorry, I couldn't process your request.",
              isError: true,
            },
          ],
          isTyping: false,
          error: result.error,
          pendingConfirmation: false,
          agentActive: false,
        }));
      }
    } catch (error) {
      set((state) => ({
        messages: [
          ...state.messages,
          {
            role: "ai",
            text: "Something went wrong. Please try again.",
            isError: true,
          },
        ],
        isTyping: false,
        error: error.message,
        pendingConfirmation: false,
        agentActive: false,
      }));
    }
  },

  confirmAction: async (status) => {
    const label = status === "confirmed" ? "Yes, create it" : "Cancel";
    get().sendMessage(label, status);
  },

  loadConversations: async () => {
    set({ conversationsLoading: true, conversationsError: null });
    try {
      const data = await chatApi.getConversations();
      const conversations = data?.data?.conversations ?? data?.conversations ?? [];
      set({ conversations, conversationsLoading: false });
    } catch (error) {
      set({ conversationsError: error.message, conversationsLoading: false });
    }
  },

  loadConversation: async (conversationId) => {
    set({ isTyping: true, error: null });
    try {
      const data = await chatApi.getHistory(conversationId);
      const history = data?.data?.history ?? data?.history ?? [];

      const messages = history.flatMap((entry) => {
        let aiMsg;
        // Detect email agent responses stored as JSON strings
        try {
          const parsed = JSON.parse(entry.assistant_message);
          if (parsed && typeof parsed === "object" && parsed.type) {
            const { text: normText, emailResponse } = normalizeEmailResponse(parsed);
            aiMsg = { role: "ai", text: normText, emailResponse, mode: "email_agent", isHistorical: true };
          } else {
            aiMsg = { role: "ai", text: entry.assistant_message, isHistorical: true };
          }
        } catch {
          aiMsg = { role: "ai", text: entry.assistant_message, isHistorical: true };
        }
        return [{ role: "user", text: entry.user_message, isHistorical: true }, aiMsg];
      });

      set({ messages, conversationId, isTyping: false });
    } catch (error) {
      set({
        isTyping: false,
        error: "Failed to load conversation.",
      });
    }
  },

  resetChat: () =>
    set({
      messages: [],
      isTyping: false,
      conversationId: null,
      pendingConfirmation: false,
      agentActive: false,
      error: null,
      pendingMessage: null,
    }),

  startNewChat: (text = null) =>
    set({
      messages: [],
      isTyping: false,
      conversationId: null,
      pendingConfirmation: false,
      agentActive: false,
      error: null,
      pendingMessage: text,
    }),

  clearPendingMessage: () => set({ pendingMessage: null }),
}));
