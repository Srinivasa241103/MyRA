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

const normalizeStoredMetadata = (value) => {
  let metadata = value;
  for (let attempt = 0; attempt < 2 && typeof metadata === "string"; attempt += 1) {
    try {
      metadata = JSON.parse(metadata);
    } catch {
      return {};
    }
  }
  return metadata && typeof metadata === "object" ? metadata : {};
};

const createLocalId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

let activeStreamController = null;

const normalizeAssistantMessage = (result) => {
  if (result.mode === "email_agent") {
    let normText;
    let emailResponse;
    if (result.emailResponse) {
      normText = null;
      emailResponse = result.emailResponse;
    } else {
      ({ text: normText, emailResponse } = normalizeEmailResponse(result.response));
    }
    return {
      role: "ai",
      text: normText,
      emailResponse,
      emailStatus: result.emailStatus ?? null,
      mode: result.mode,
      context: result.context,
      metadata: result.metadata,
    };
  }

  const response = result.response;
  const text = typeof response === "object" && response !== null
    ? response.message ?? response.text ?? JSON.stringify(response)
    : response;

  return {
    role: "ai",
    text,
    mode: result.mode ?? response?.type ?? null,
    context: result.context,
    metadata: result.metadata,
  };
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
  pendingModelSelection: null,
  activeStreamId: null,
  canStopStreaming: false,

  conversations: [],
  conversationsLoading: false,
  conversationsError: null,

  sendMessage: async (text, confirmationStatus = null, modelSelection = null) => {
    const { conversationId, agentActive, activeAgentMode, isTyping } = get();
    if (isTyping) return;

    const assistantId = createLocalId();
    const controller = new AbortController();
    activeStreamController = controller;

    set((state) => ({
      messages: [
        ...state.messages,
        { role: "user", text },
        {
          id: assistantId,
          role: "ai",
          text: "",
          isStreaming: true,
          activity: {
            stage: "routing",
            flow: "general",
            detail: null,
            history: [],
          },
        },
      ],
      isTyping: true,
      error: null,
      activeStreamId: assistantId,
      canStopStreaming: false,
    }));

    const isCurrentStream = () => get().activeStreamId === assistantId;
    const updateAssistant = (updater) => {
      if (!isCurrentStream()) return;
      set((state) => ({
        messages: state.messages.map((message) =>
          message.id === assistantId ? updater(message) : message
        ),
      }));
    };

    try {
      const result = await chatApi.sendMessageStream(
        text,
        conversationId,
        confirmationStatus,
        agentActive,
        activeAgentMode,
        modelSelection,
        {
          signal: controller.signal,
          onEvent: (event) => {
            if (!isCurrentStream()) return;

            if (event.type === "start") {
              set({ conversationId: event.conversationId });
              return;
            }

            if (event.type === "status") {
              const status = event.data ?? {};
              updateAssistant((message) => {
                const previous = message.activity?.stage;
                const history = [...(message.activity?.history ?? [])];
                if (
                  previous &&
                  previous !== status.stage &&
                  !history.includes(previous)
                ) {
                  history.push(previous);
                }
                return {
                  ...message,
                  activity: {
                    stage: status.stage,
                    flow: status.flow,
                    detail: status.detail ?? null,
                    history: history.slice(-4),
                  },
                };
              });
              set({ canStopStreaming: Boolean(status.cancellable) });
              return;
            }

            if (event.type === "context") {
              updateAssistant((message) => ({
                ...message,
                context: event.data,
              }));
              return;
            }

            if (event.type === "delta") {
              const delta = event.data?.text ?? "";
              if (!delta) return;
              updateAssistant((message) => ({
                ...message,
                text: `${message.text ?? ""}${delta}`,
              }));
              return;
            }

            if (event.type === "result") {
              const normalized = normalizeAssistantMessage(event.data ?? {});
              updateAssistant((message) => ({
                ...message,
                ...normalized,
                id: assistantId,
                isStreaming: false,
                activity: null,
                streamStatus:
                  event.data?.metadata?.streamStatus ?? "complete",
              }));
              set({ canStopStreaming: false });
              return;
            }

            if (event.type === "done") {
              set({ canStopStreaming: false });
            }
          },
        },
      );

      if (result.success && isCurrentStream()) {
        set((state) => ({
          messages: state.messages.map((message) =>
            message.id === assistantId
              ? {
                ...message,
                ...normalizeAssistantMessage(result),
                id: assistantId,
                isStreaming: false,
                activity: null,
                streamStatus: result.metadata?.streamStatus ?? "complete",
              }
              : message
          ),
          isTyping: false,
          conversationId: result.conversationId,
          pendingConfirmation: result.pendingConfirmation ?? false,
          agentActive: result.agentActive ?? false,
          activeAgentMode: result.agentActive ? (result.mode ?? null) : null,
          activeStreamId: null,
          canStopStreaming: false,
        }));

        get().loadConversations();
      }
    } catch (error) {
      if (!isCurrentStream()) return;
      const stopped = error.name === "AbortError" || controller.signal.aborted;
      set((state) => ({
        messages: state.messages
          .map((message) => {
            if (message.id !== assistantId) return message;
            if (stopped && message.text?.trim()) {
              return {
                ...message,
                isStreaming: false,
                activity: null,
                streamStatus: "stopped",
              };
            }
            if (stopped) return null;
            if (message.text?.trim()) {
              return {
                ...message,
                isStreaming: false,
                activity: null,
                streamStatus: "interrupted",
                streamError: error.message,
              };
            }
            return {
              ...message,
              text: error.message || "Something went wrong. Please try again.",
              isStreaming: false,
              activity: null,
              isError: true,
            };
          })
          .filter(Boolean),
        isTyping: false,
        error: stopped ? null : error.message,
        pendingConfirmation: false,
        conversationId: error.data?.conversationId ?? state.conversationId,
        agentActive: error.data?.agentActive ?? state.agentActive,
        activeAgentMode: error.data?.agentActive
          ? (error.data?.mode ?? state.activeAgentMode)
          : null,
        activeStreamId: null,
        canStopStreaming: false,
      }));
    } finally {
      if (activeStreamController === controller) {
        activeStreamController = null;
      }
    }
  },

  stopGenerating: () => {
    const { canStopStreaming } = get();
    if (canStopStreaming) activeStreamController?.abort();
  },

  sendVoiceMessage: async ({ blob, audioUrl, durationMs, mimeType, wakeWord = null }) => {
    const { conversationId, isTyping } = get();
    if (isTyping) return;

    const localId = createLocalId();

    set((state) => ({
      messages: [
        ...state.messages,
        {
          id: localId,
          role: "user",
          type: "audio",
          audioUrl,
          durationMs,
          mimeType,
          status: "sending",
        },
      ],
      isTyping: true,
      error: null,
    }));

    try {
      const result = await chatApi.sendVoiceMessage({
        audio: blob,
        conversationId,
        durationMs,
        wakeWord,
      });

      if (result.success) {
        const messageEntry = normalizeAssistantMessage(result);

        set((state) => ({
          messages: [
            ...state.messages.map((message) =>
              message.id === localId ? { ...message, status: "sent" } : message
            ),
            messageEntry,
          ],
          isTyping: false,
          conversationId: result.conversationId ?? state.conversationId,
          pendingConfirmation: result.pendingConfirmation ?? false,
          agentActive: result.agentActive ?? false,
          activeAgentMode: result.agentActive ? (result.mode ?? null) : null,
        }));

        get().loadConversations();
      } else {
        set((state) => ({
          messages: state.messages.map((message) =>
            message.id === localId
              ? { ...message, status: "error", error: result.error || "Voice request failed." }
              : message
          ),
          isTyping: false,
          error: result.error,
          pendingConfirmation: false,
          agentActive: result.agentActive ?? false,
          activeAgentMode: result.agentActive ? (result.mode ?? null) : null,
        }));
      }
    } catch (error) {
      set((state) => ({
        messages: state.messages.map((message) =>
          message.id === localId
            ? { ...message, status: "error", error: error.message }
            : message
        ),
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
    activeStreamController?.abort();
    activeStreamController = null;
    set({
      isTyping: true,
      error: null,
      activeStreamId: null,
      canStopStreaming: false,
    });
    try {
      const data = await chatApi.getHistory(conversationId);
      const history = data?.data?.history ?? data?.history ?? [];

      const messages = history.flatMap((entry) => {
        let aiMsg;
        const metadata = normalizeStoredMetadata(entry.metadata);
        const historicalState = {
          metadata,
          mode: metadata.mode ?? null,
          streamStatus: metadata.streamStatus ?? null,
          isHistorical: true,
        };
        // Detect email agent responses stored as JSON strings
        try {
          const parsed = JSON.parse(entry.assistant_message);
          if (parsed && typeof parsed === "object" && parsed.type) {
            const { text: normText, emailResponse } = normalizeEmailResponse(parsed);
            aiMsg = {
              role: "ai",
              text: normText,
              emailResponse,
              ...historicalState,
              mode: metadata.mode ?? "email_agent",
            };
          } else {
            aiMsg = { role: "ai", text: entry.assistant_message, ...historicalState };
          }
        } catch {
          aiMsg = { role: "ai", text: entry.assistant_message, ...historicalState };
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
    } catch (error) {
      const chatMissing = error.status === 404;
      set({
        ...(chatMissing
          ? {
            messages: [],
            conversationId: null,
            pendingConfirmation: false,
            agentActive: false,
            activeAgentMode: null,
          }
          : {}),
        isTyping: false,
        error: error.message || "Failed to load conversation.",
      });
    }
  },

  deleteConversation: async (targetConversationId = null) => {
    const conversationId = targetConversationId ?? get().conversationId;

    if (!conversationId) {
      get().resetChat();
      return { success: true };
    }

    if (get().conversationId === conversationId) {
      activeStreamController?.abort();
    }

    try {
      const result = await chatApi.deleteConversation(conversationId);

      set((state) => {
        const isActiveConversation = state.conversationId === conversationId;
        return {
          conversations: state.conversations.filter(
            (conversation) => conversation.conversationId !== conversationId
          ),
          conversationsError: null,
          ...(isActiveConversation
            ? {
              messages: [],
              isTyping: false,
              conversationId: null,
              pendingConfirmation: false,
              agentActive: false,
              activeAgentMode: null,
              error: null,
              pendingMessage: null,
              pendingModelSelection: null,
              activeStreamId: null,
              canStopStreaming: false,
            }
            : {}),
        };
      });

      return result;
    } catch (error) {
      if (error.status === 404) {
        set((state) => {
          const isActiveConversation = state.conversationId === conversationId;
          return {
            conversations: state.conversations.filter(
              (conversation) => conversation.conversationId !== conversationId
            ),
            ...(isActiveConversation
              ? {
                messages: [],
                isTyping: false,
                conversationId: null,
                pendingConfirmation: false,
                agentActive: false,
                activeAgentMode: null,
                pendingMessage: null,
                pendingModelSelection: null,
                activeStreamId: null,
                canStopStreaming: false,
              }
              : {}),
            error: error.message || "Chat does not exist",
          };
        });
        return { success: false, error: error.message };
      }

      set({ error: error.message || "Failed to delete conversation." });
      throw error;
    }
  },

  resetChat: () => {
    activeStreamController?.abort();
    activeStreamController = null;
    set({
      messages: [],
      isTyping: false,
      conversationId: null,
      pendingConfirmation: false,
      agentActive: false,
      activeAgentMode: null,
      error: null,
      pendingMessage: null,
      pendingModelSelection: null,
      activeStreamId: null,
      canStopStreaming: false,
    });
  },

  startNewChat: (text = null, modelSelection = null) => {
    activeStreamController?.abort();
    activeStreamController = null;
    set({
      messages: [],
      isTyping: false,
      conversationId: null,
      pendingConfirmation: false,
      agentActive: false,
      activeAgentMode: null,
      error: null,
      pendingMessage: text,
      pendingModelSelection: modelSelection,
      activeStreamId: null,
      canStopStreaming: false,
    });
  },

  clearPendingMessage: () => set({ pendingMessage: null, pendingModelSelection: null }),
}));
