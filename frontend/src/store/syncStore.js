import { create } from "zustand";

const useSyncStore = create((set) => ({
  isSyncing: false,
  syncPhase: null,
  syncProgress: 0,
  syncMessage: null,
  syncError: null,
  lastSyncResult: null,

  setSyncStarted: () =>
    set({
      isSyncing: true,
      syncProgress: 0,
      syncPhase: "starting",
      syncMessage: "Starting sync...",
      syncError: null,
      lastSyncResult: null,
    }),

  setSyncProgress: (phase, progress, message) =>
    set({ syncPhase: phase, syncProgress: progress, syncMessage: message }),

  setSyncComplete: (result) =>
    set({
      isSyncing: false,
      syncProgress: 100,
      syncPhase: "complete",
      syncMessage: null,
      lastSyncResult: result,
    }),

  setSyncError: (errorMessage) =>
    set({
      isSyncing: false,
      syncPhase: "error",
      syncError: errorMessage,
    }),

  resetSync: () =>
    set({
      isSyncing: false,
      syncPhase: null,
      syncProgress: 0,
      syncMessage: null,
      syncError: null,
    }),
}));

export default useSyncStore;
