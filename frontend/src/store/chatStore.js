import { create } from "zustand";
import { chatApi } from "../api/chat";

export const useChatStore = create((set, get) => ({
  messages: [],
  isTyping: false,
  conversationId: null,
  error: null,

  conversations: [],
  conversationsLoading: false,
  conversationsError: null,

  sendMessage: async (text) => {
    const { conversationId } = get();

    set((state) => ({
      messages: [...state.messages, { role: "user", text }],
      isTyping: true,
      error: null,
    }));

    try {
      const result = await chatApi.sendMessage(text, conversationId);

      if (result.success) {
        const newConversationId = result.conversationId;

        set((state) => ({
          messages: [
            ...state.messages,
            {
              role: "ai",
              text: result.response,
              context: result.context,
              metadata: result.metadata,
            },
          ],
          isTyping: false,
          conversationId: newConversationId,
        }));

        // Refresh conversations list so the new one appears in sidebar
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
      }));
    }
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

      // Flatten [ {user_message, assistant_message} ] → [ {role,text}, {role,text} ]
      const messages = history.flatMap((entry) => [
        { role: "user", text: entry.user_message },
        { role: "ai", text: entry.assistant_message },
      ]);

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
      error: null,
    }),
}));
