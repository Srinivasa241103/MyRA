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
  if (["draft_approval", "recipient_choice", "pending_send"].includes(response.type)) {
    return { text: null, emailResponse: response };
  }
  return { text: response.message ?? response.prompt ?? "Done.", emailResponse: null };
};

export const useChatStore = create((set, get) => ({
  messages: [],
  isTyping: false,
  conversationId: null,
  pendingConfirmation: false,
  agentActive: false,
  activeAgentMode: null,
  error: null,
  pendingMessage: null,

  conversations: [],
  conversationsLoading: false,
  conversationsError: null,

  sendMessage: async (text, confirmationStatus = null) => {
    const { conversationId, agentActive, activeAgentMode, isTyping } = get();
    if (isTyping) return;

    set((state) => ({
      messages: [...state.messages, { role: "user", text }],
      isTyping: true,
      error: null,
    }));

    try {
      const result = await chatApi.sendMessage(
        text,
        conversationId,
        confirmationStatus,
        agentActive,
        activeAgentMode,
      );

      if (result.success) {
        let messageEntry;

        if (result.mode === "email_agent") {
          // The backend now sends the structured draft/selection payload as
          // `emailResponse` (separate from the plain-text `response`).
          // Fall back to normalizing result.response for older-style replies.
          let normText, emailResponse;
          if (result.emailResponse) {
            normText = null;
            emailResponse = result.emailResponse;
          } else {
            ({ text: normText, emailResponse } = normalizeEmailResponse(result.response));
          }
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
          activeAgentMode: result.agentActive ? (result.mode ?? null) : null,
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
          agentActive: result.agentActive ?? false,
          activeAgentMode: result.agentActive ? (result.mode ?? null) : null,
        }));
      }
    } catch (error) {
      set((state) => ({
        messages: [
          ...state.messages,
          {
            role: "ai",
            text: error.message || "Something went wrong. Please try again.",
            isError: true,
          },
        ],
        isTyping: false,
        error: error.message,
        pendingConfirmation: false,
        conversationId: error.data?.conversationId ?? state.conversationId,
        agentActive: error.data?.agentActive ?? state.agentActive,
        activeAgentMode: error.data?.agentActive
          ? (error.data?.mode ?? state.activeAgentMode)
          : null,
      }));
    }
  },

  syncEmailStatus: async () => {
    const { conversationId } = get();
    if (!conversationId) return null;

    const status = await chatApi.getEmailStatus(conversationId);

    set((state) => {
      const messages = state.messages.map((message) => {
        if (message.emailResponse?.type !== "pending_send") return message;
        return {
          ...message,
          emailStatus: status.emailStatus,
          emailResponse: {
            ...message.emailResponse,
            status: status.emailStatus,
            deadline: status.revokeDeadline ?? message.emailResponse.deadline,
          },
        };
      });

      const terminal = ["sent", "revoked", "cancelled", "failed"].includes(status.emailStatus);
      const hasNotice = messages.some(message =>
        message.emailStatusNotice === status.emailStatus
      );

      if (terminal && status.response && !hasNotice) {
        messages.push({
          role: "ai",
          text: status.response,
          mode: "email_agent",
          emailStatus: status.emailStatus,
          emailStatusNotice: status.emailStatus,
        });
      }

      return {
        messages,
        agentActive: status.active,
        activeAgentMode: status.active ? "email_agent" : null,
      };
    });

    return status;
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

      const emailStatus = await chatApi.getEmailStatus(conversationId)
        .catch(() => null);

      if (emailStatus?.interrupt) {
        const lastEmailResponse = [...messages]
          .reverse()
          .find(message => message.emailResponse)?.emailResponse;

        if (lastEmailResponse?.type !== emailStatus.interrupt.type) {
          messages.push({
            role: "ai",
            text: null,
            emailResponse: emailStatus.interrupt,
            emailStatus: emailStatus.emailStatus,
            mode: "email_agent",
          });
        }
      } else if (
        ["sent", "revoked", "cancelled", "failed"].includes(emailStatus?.emailStatus)
        && emailStatus?.response
        && !messages.some(message => message.text === emailStatus.response)
      ) {
        messages.push({
          role: "ai",
          text: emailStatus.response,
          emailStatus: emailStatus.emailStatus,
          emailStatusNotice: emailStatus.emailStatus,
          mode: "email_agent",
        });
      }

      set({
        messages,
        conversationId,
        isTyping: false,
        agentActive: emailStatus?.active ?? false,
        activeAgentMode: emailStatus?.active ? "email_agent" : null,
      });
    } catch {
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
      activeAgentMode: null,
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
      activeAgentMode: null,
      error: null,
      pendingMessage: text,
    }),

  clearPendingMessage: () => set({ pendingMessage: null }),
}));
