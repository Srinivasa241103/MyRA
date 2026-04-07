import { create } from "zustand";
import { syncApi } from "../api/sync";

const useSyncStore = create((set, get) => ({
  // Gmail sync state
  gmail: {
    isSyncing: false,
    syncPhase: null,
    syncProgress: 0,
    syncMessage: null,
    syncError: null,
    lastSyncResult: null,
  },

  // Calendar sync state
  calendar: {
    isSyncing: false,
    syncPhase: null,
    syncProgress: 0,
    syncMessage: null,
    syncError: null,
    lastSyncResult: null,
  },

  // Generic setters keyed by source ("gmail" | "calendar")
  setSyncStarted: (source) =>
    set((state) => ({
      [source]: {
        ...state[source],
        isSyncing: true,
        syncProgress: 0,
        syncPhase: "starting",
        syncMessage: "Starting sync...",
        syncError: null,
        lastSyncResult: null,
      },
    })),

  setSyncProgress: (source, phase, progress, message) =>
    set((state) => ({
      [source]: { ...state[source], syncPhase: phase, syncProgress: progress, syncMessage: message },
    })),

  setSyncComplete: (source, result) =>
    set((state) => ({
      [source]: {
        ...state[source],
        isSyncing: false,
        syncProgress: 100,
        syncPhase: "complete",
        syncMessage: null,
        lastSyncResult: result,
      },
    })),

  setSyncError: (source, errorMessage) =>
    set((state) => ({
      [source]: {
        ...state[source],
        isSyncing: false,
        syncPhase: "error",
        syncError: errorMessage,
      },
    })),

  resetSync: (source) =>
    set((state) => ({
      [source]: {
        ...state[source],
        isSyncing: false,
        syncPhase: null,
        syncProgress: 0,
        syncMessage: null,
        syncError: null,
      },
    })),

  // Actions
  triggerCalendarSync: async (userId, syncType = "incremental") => {
    const { setSyncStarted, setSyncComplete, setSyncError } = get();
    setSyncStarted("calendar");
    try {
      const result = await syncApi.syncCalendar(userId, syncType);
      setSyncComplete("calendar", result);
      return result;
    } catch (error) {
      setSyncError("calendar", error.message);
      throw error;
    }
  },

  triggerGmailSync: async (userId, syncType = "incremental") => {
    const { setSyncStarted, setSyncComplete, setSyncError } = get();
    setSyncStarted("gmail");
    try {
      const result = await syncApi.syncGmail(userId, syncType);
      setSyncComplete("gmail", result);
      return result;
    } catch (error) {
      setSyncError("gmail", error.message);
      throw error;
    }
  },

  // WebSocket progress updates (called from socket listener)
  handleSyncProgress: (source, data) => {
    const { setSyncProgress } = get();
    setSyncProgress(source, data.phase, data.progress, data.message);
  },

  handleSyncComplete: (source, data) => {
    const { setSyncComplete } = get();
    setSyncComplete(source, data.summary);
  },

  handleSyncError: (source, data) => {
    const { setSyncError } = get();
    setSyncError(source, data.message);
  },
}));

export default useSyncStore;
