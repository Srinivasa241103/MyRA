import { useState, useEffect, useRef } from "react";
import { useAuthStore } from "../store/authStore";
import { authApi } from "../api/auth";
import socketService from "../service/socketService";
import useSyncStore from "../store/syncStore";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:9000";

const GMAIL_PHASE_LABELS = {
  starting: "Starting...",
  fetching: "Fetching emails...",
  normalizing: "Normalizing data...",
  storing: "Storing documents...",
  embedding_start: "Preparing embeddings...",
  embedding: "Generating embeddings...",
  complete: "Complete",
  error: "Failed",
};

const CALENDAR_PHASE_LABELS = {
  starting: "Starting...",
  fetching: "Fetching events...",
  normalizing: "Normalizing data...",
  storing: "Storing documents...",
  embedding_start: "Preparing embeddings...",
  embedding: "Generating embeddings...",
  complete: "Complete",
  error: "Failed",
};

// ── Icons ──────────────────────────────────────────────
const SaveIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
    <polyline points="17 21 17 13 7 13 7 21"/>
    <polyline points="7 3 7 8 15 8"/>
  </svg>
);

const MailIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect width="20" height="16" x="2" y="4" rx="2"/>
    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
  </svg>
);

const CalendarIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect width="18" height="18" x="3" y="4" rx="2" ry="2"/>
    <line x1="16" x2="16" y1="2" y2="6"/>
    <line x1="8" x2="8" y1="2" y2="6"/>
    <line x1="3" x2="21" y1="10" y2="10"/>
  </svg>
);

const MusicIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 18V5l12-2v13"/>
    <circle cx="6" cy="18" r="3"/>
    <circle cx="18" cy="16" r="3"/>
  </svg>
);

const DatabaseIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <ellipse cx="12" cy="5" rx="9" ry="3"/>
    <path d="M3 5V19A9 3 0 0 0 21 19V5"/>
    <path d="M3 12A9 3 0 0 0 21 12"/>
  </svg>
);

const SettingsIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>
);

const BellIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/>
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>
  </svg>
);

const SpinnerIcon = () => (
  <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
  </svg>
);

// ── Toggle Switch ──────────────────────────────────────
function Toggle({ enabled, onChange }) {
  return (
    <button
      onClick={onChange}
      className={`relative w-12 h-6 rounded-full transition-colors duration-200 ${enabled ? "bg-purple-600" : "bg-[#2A2A35]"}`}
    >
      <div className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform duration-200 ${enabled ? "translate-x-6" : ""}`} />
    </button>
  );
}

// ── Sync Progress Panel ────────────────────────────────
function SyncProgressPanel({ syncState, phaseLabels, onDismiss }) {
  const { isSyncing, syncPhase, syncProgress, syncMessage, syncError, lastSyncResult } = syncState;
  if (!isSyncing && syncPhase !== "complete" && syncPhase !== "error") return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className={syncPhase === "error" ? "text-red-400" : syncPhase === "complete" ? "text-green-400" : "text-gray-300"}>
          {phaseLabels[syncPhase] || syncPhase}
        </span>
        {syncPhase !== "error" && (
          <span className="text-gray-500 text-xs">{syncProgress}%</span>
        )}
      </div>
      {syncPhase !== "error" && (
        <div className="w-full bg-[#2A2A35] rounded-full h-1.5">
          <div
            className={`h-1.5 rounded-full transition-all duration-500 ${syncPhase === "complete" ? "bg-green-500" : "bg-purple-500"}`}
            style={{ width: `${syncProgress}%` }}
          />
        </div>
      )}
      {syncMessage && syncPhase !== "complete" && (
        <p className="text-xs text-gray-500">{syncMessage}</p>
      )}
      {syncPhase === "complete" && lastSyncResult && (
        <p className="text-xs text-green-400">
          {lastSyncResult.documentsAdded ?? lastSyncResult.processed ?? 0} new documents synced
        </p>
      )}
      {syncPhase === "error" && syncError && (
        <div className="p-2 bg-red-900/20 border border-red-900/50 rounded text-xs text-red-400">
          {syncError}
        </div>
      )}
      {(syncPhase === "complete" || syncPhase === "error") && (
        <button onClick={onDismiss} className="text-xs text-gray-500 hover:text-gray-300 transition">
          Dismiss
        </button>
      )}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────
function ProfilePage({ onNavigate }) {
  const { user, logout } = useAuthStore();
  const [name, setName] = useState(user?.name || "");
  const [emailInput, setEmailInput] = useState(user?.email || "");
  const [gmailEnabled, setGmailEnabled] = useState(true);
  const [calendarEnabled, setCalendarEnabled] = useState(true);
  const [notifications, setNotifications] = useState(true);
  const [syncHistory, setSyncHistory] = useState([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  const gmailSyncIdRef = useRef(null);
  const calendarSyncIdRef = useRef(null);

  const {
    gmail,
    calendar,
    setSyncStarted,
    setSyncProgress,
    setSyncComplete,
    setSyncError,
    resetSync,
  } = useSyncStore();

  // ── WebSocket listeners ────────────────────────────
  useEffect(() => {
    const userId = user?.id || user?.sub || user?.email;
    if (!userId) return;

    const socket = socketService.connect(userId);

    // Gmail listeners
    const onGmailProgress = (data) => {
      if (gmailSyncIdRef.current && data.syncId !== String(gmailSyncIdRef.current)) return;
      setSyncProgress("gmail", data.phase, data.progress ?? 0, data.message);
    };
    const onGmailComplete = (data) => {
      if (gmailSyncIdRef.current && data.syncId !== String(gmailSyncIdRef.current)) return;
      setSyncComplete("gmail", data.summary || data);
      fetchSyncHistory();
    };
    const onGmailError = (data) => {
      if (gmailSyncIdRef.current && data.syncId !== String(gmailSyncIdRef.current)) return;
      setSyncError("gmail", data.error?.message || "Sync failed");
      fetchSyncHistory();
    };

    // Calendar listeners (backend emits with source "google_calendar")
    const onCalendarProgress = (data) => {
      if (calendarSyncIdRef.current && data.syncId !== String(calendarSyncIdRef.current)) return;
      setSyncProgress("calendar", data.phase, data.progress ?? 0, data.message);
    };
    const onCalendarComplete = (data) => {
      if (calendarSyncIdRef.current && data.syncId !== String(calendarSyncIdRef.current)) return;
      setSyncComplete("calendar", data.summary || data);
      fetchSyncHistory();
    };
    const onCalendarError = (data) => {
      if (calendarSyncIdRef.current && data.syncId !== String(calendarSyncIdRef.current)) return;
      setSyncError("calendar", data.error?.message || "Sync failed");
      fetchSyncHistory();
    };

    socket.on("sync:gmail:progress", onGmailProgress);
    socket.on("sync:gmail:complete", onGmailComplete);
    socket.on("sync:gmail:error", onGmailError);
    socket.on("sync:google_calendar:progress", onCalendarProgress);
    socket.on("sync:google_calendar:complete", onCalendarComplete);
    socket.on("sync:google_calendar:error", onCalendarError);

    return () => {
      socket.off("sync:gmail:progress", onGmailProgress);
      socket.off("sync:gmail:complete", onGmailComplete);
      socket.off("sync:gmail:error", onGmailError);
      socket.off("sync:google_calendar:progress", onCalendarProgress);
      socket.off("sync:google_calendar:complete", onCalendarComplete);
      socket.off("sync:google_calendar:error", onCalendarError);
    };
  }, [user]);

  useEffect(() => {
    if (user) {
      setName(user.name || "");
      setEmailInput(user.email || "");
    }
    fetchSyncHistory();
  }, [user]);

  const fetchSyncHistory = async () => {
    setIsLoadingHistory(true);
    try {
      const userId = user?.id || user?.sub || user?.email;
      const response = await fetch(`${API_BASE_URL}/sync/history?userId=${userId}`, {
        method: "GET",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();
      if (data.success) setSyncHistory(data.data.history);
    } catch (error) {
      console.error("Failed to fetch sync history:", error);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const handleGmailSyncNow = async () => {
    setSyncStarted("gmail");
    try {
      const userId = user?.id || user?.sub || user?.email;
      const response = await fetch(`${API_BASE_URL}/sync/gmail`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, syncType: "incremental" }),
      });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();
      if (data.success) {
        gmailSyncIdRef.current = data.data?.syncId || data.syncId || null;
      } else {
        setSyncError("gmail", data.message || "Failed to start sync");
      }
    } catch (error) {
      console.error("Failed to start Gmail sync:", error);
      setSyncError("gmail", error.message || "Failed to start sync");
    }
  };

  const handleCalendarSyncNow = async () => {
    setSyncStarted("calendar");
    try {
      const userId = user?.id || user?.sub || user?.email;
      const response = await fetch(`${API_BASE_URL}/sync/calendar`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, syncType: "incremental" }),
      });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();
      if (data.success) {
        calendarSyncIdRef.current = data.data?.syncId || data.syncId || null;
      } else {
        setSyncError("calendar", data.message || "Failed to start calendar sync");
      }
    } catch (error) {
      console.error("Failed to start Calendar sync:", error);
      setSyncError("calendar", error.message || "Failed to start calendar sync");
    }
  };

  const handleLogout = async () => {
    try {
      await authApi.logout();
      logout();
      onNavigate("login");
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  const handleSaveProfile = async () => {
    console.log("Saving profile:", { name, email: emailInput });
  };

  const formatDate = (dateString) =>
    dateString ? new Date(dateString).toLocaleString() : "N/A";

  const getStatusBadge = (status) => {
    const map = {
      success: "bg-green-500/20 text-green-400 border border-green-500/30",
      in_progress: "bg-purple-500/20 text-purple-400 border border-purple-500/30",
      failed: "bg-red-500/20 text-red-400 border border-red-500/30",
    };
    return map[status] || map.failed;
  };

  const getInitials = (name) => {
    if (!name) return "?";
    return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
  };

  if (!user) {
    onNavigate("login");
    return null;
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[#0D0D12]">
      {/* Header */}
      <div className="border-b border-[#2A2A35] bg-[#16161E]">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center gap-4">
          <button
            onClick={() => onNavigate("chat")}
            className="p-2 hover:bg-[#2A2A35] rounded-lg transition text-gray-400 hover:text-white"
          >
            ←
          </button>
          <div>
            <h1 className="text-xl font-semibold">Profile Settings</h1>
            <p className="text-gray-400 text-sm mt-0.5">Manage your account and data connections</p>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-6 space-y-6">

        {/* ── 1. Profile Info ─────────────────────────── */}
        <div className="bg-[#16161E] border border-[#2A2A35] rounded-xl p-6">
          <div className="flex items-center gap-4 mb-6">
            {user.picture ? (
              <img src={user.picture} alt={user.name} className="w-20 h-20 rounded-full object-cover" />
            ) : (
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white text-2xl font-semibold">
                {getInitials(user.name)}
              </div>
            )}
            <div className="flex-1">
              <h3 className="text-white text-xl">{user.name || "—"}</h3>
              <p className="text-gray-400 text-sm">{user.email || "—"}</p>
              <button className="mt-1 text-purple-400 hover:text-purple-300 text-sm transition-colors">
                Change profile picture
              </button>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-gray-400 text-sm mb-2">Full Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-[#0D0D12] border border-[#2A2A35] rounded-lg px-4 py-2 text-white focus:outline-none focus:border-purple-500 transition-colors"
              />
            </div>
            <div>
              <label className="block text-gray-400 text-sm mb-2">Email</label>
              <input
                type="email"
                value={emailInput}
                disabled
                className="w-full bg-[#0D0D12] border border-[#2A2A35] rounded-lg px-4 py-2 text-gray-500 cursor-not-allowed"
              />
              <p className="text-xs text-gray-600 mt-1">Managed by your Google account</p>
            </div>
          </div>

          <button
            onClick={handleSaveProfile}
            className="mt-6 flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition"
          >
            <SaveIcon />
            Save Changes
          </button>
        </div>

        {/* ── 2. Data Connections ─────────────────────── */}
        <div className="bg-[#16161E] border border-[#2A2A35] rounded-xl p-6">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-purple-400"><DatabaseIcon /></span>
            <h3 className="text-white font-semibold">Data Connections</h3>
          </div>
          <p className="text-gray-400 text-sm mb-6">Manage your connected accounts and data sources</p>

          <div className="space-y-3">

            {/* ── Gmail row ── */}
            <div className="bg-[#0D0D12] rounded-lg border border-[#2A2A35] overflow-hidden">
              <div className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center text-purple-400">
                    <MailIcon />
                  </div>
                  <div>
                    <p className="text-white font-medium">Email Account</p>
                    <p className="text-gray-400 text-sm">{user.email || "Not connected"}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-sm ${gmailEnabled ? "text-green-400" : "text-gray-500"}`}>
                    {gmailEnabled ? "Connected" : "Disconnected"}
                  </span>
                  <Toggle enabled={gmailEnabled} onChange={() => setGmailEnabled(!gmailEnabled)} />
                </div>
              </div>

              {gmailEnabled && (
                <div className="border-t border-[#2A2A35] px-4 py-4 space-y-3">
                  <button
                    onClick={handleGmailSyncNow}
                    disabled={gmail.isSyncing}
                    className="w-full px-4 py-2.5 bg-purple-600 hover:bg-purple-700 disabled:bg-[#2A2A35] disabled:cursor-not-allowed text-white text-sm rounded-lg transition font-medium flex items-center justify-center gap-2"
                  >
                    {gmail.isSyncing ? <><SpinnerIcon />Syncing emails...</> : "Sync Gmail Now"}
                  </button>
                  <SyncProgressPanel
                    syncState={gmail}
                    phaseLabels={GMAIL_PHASE_LABELS}
                    onDismiss={() => resetSync("gmail")}
                  />
                </div>
              )}
            </div>

            {/* ── Calendar row ── */}
            <div className="bg-[#0D0D12] rounded-lg border border-[#2A2A35] overflow-hidden">
              <div className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center text-blue-400">
                    <CalendarIcon />
                  </div>
                  <div>
                    <p className="text-white font-medium">Google Calendar</p>
                    <p className="text-gray-400 text-sm">{user.email || "Not connected"}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-sm ${calendarEnabled ? "text-green-400" : "text-gray-500"}`}>
                    {calendarEnabled ? "Connected" : "Disconnected"}
                  </span>
                  <Toggle enabled={calendarEnabled} onChange={() => setCalendarEnabled(!calendarEnabled)} />
                </div>
              </div>

              {calendarEnabled && (
                <div className="border-t border-[#2A2A35] px-4 py-4 space-y-3">
                  <button
                    onClick={handleCalendarSyncNow}
                    disabled={calendar.isSyncing}
                    className="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-[#2A2A35] disabled:cursor-not-allowed text-white text-sm rounded-lg transition font-medium flex items-center justify-center gap-2"
                  >
                    {calendar.isSyncing ? <><SpinnerIcon />Syncing calendar...</> : "Sync Calendar Now"}
                  </button>
                  <SyncProgressPanel
                    syncState={calendar}
                    phaseLabels={CALENDAR_PHASE_LABELS}
                    onDismiss={() => resetSync("calendar")}
                  />
                </div>
              )}
            </div>

            {/* ── Spotify row (coming soon) ── */}
            <div className="flex items-center justify-between p-4 bg-[#0D0D12] rounded-lg border border-[#2A2A35] opacity-60">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center text-green-400">
                  <MusicIcon />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-white font-medium">Music</p>
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#2A2A35] text-gray-400">Coming Soon</span>
                  </div>
                  <p className="text-gray-400 text-sm">Spotify</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-500">Not connected</span>
                <Toggle enabled={false} onChange={() => {}} />
              </div>
            </div>
          </div>
        </div>

        {/* ── 3. Preferences ──────────────────────────── */}
        <div className="bg-[#16161E] border border-[#2A2A35] rounded-xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-purple-400"><SettingsIcon /></span>
            <h3 className="text-white font-semibold">Preferences</h3>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-4 bg-[#0D0D12] rounded-lg border border-[#2A2A35]">
              <div className="flex items-center gap-3">
                <span className="text-gray-400"><BellIcon /></span>
                <div>
                  <p className="text-white font-medium">Notifications</p>
                  <p className="text-gray-400 text-sm">Receive sync updates and alerts</p>
                </div>
              </div>
              <Toggle enabled={notifications} onChange={() => setNotifications(!notifications)} />
            </div>
          </div>
        </div>

        {/* ── 4. Sync History ─────────────────────────── */}
        <div className="bg-[#16161E] border border-[#2A2A35] rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-white font-semibold">Sync History</h3>
            <button onClick={fetchSyncHistory} className="text-sm text-purple-400 hover:text-purple-300 transition">
              Refresh
            </button>
          </div>

          {isLoadingHistory ? (
            <p className="text-center py-8 text-gray-500">Loading history...</p>
          ) : syncHistory.length === 0 ? (
            <p className="text-center py-8 text-gray-500">No sync history yet.</p>
          ) : (
            <div className="space-y-3">
              {syncHistory.map((item, index) => (
                <div key={index} className="bg-[#0D0D12] rounded-lg p-4 border border-[#2A2A35]">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center text-purple-400 text-sm">
                        {item.source === "gmail" ? "✉" : item.source === "google_calendar" ? "📅" : "📄"}
                      </div>
                      <div>
                        <p className="font-medium capitalize text-white">
                          {item.source === "google_calendar" ? "Google Calendar" : item.source}
                        </p>
                        <p className="text-xs text-gray-500">{formatDate(item.started_at || item.created_at)}</p>
                      </div>
                    </div>
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusBadge(item.status)}`}>
                      {item.status}
                    </span>
                  </div>
                  {item.stats && (
                    <div className="grid grid-cols-2 gap-4 mt-3 pt-3 border-t border-[#2A2A35]">
                      <div>
                        <p className="text-xs text-gray-500">Fetched</p>
                        <p className="text-sm font-medium">{item.stats.total_fetched ?? "—"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">New</p>
                        <p className="text-sm font-medium">{item.stats.new_documents ?? "—"}</p>
                      </div>
                    </div>
                  )}
                  {item.error_message && (
                    <p className="mt-3 p-2 bg-red-900/20 border border-red-900/50 rounded text-xs text-red-400">
                      {item.error_message}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── 5. Danger Zone ──────────────────────────── */}
        <div className="bg-[#16161E] border border-red-900/30 rounded-xl p-6">
          <h3 className="text-red-400 text-lg font-semibold mb-2">Danger Zone</h3>
          <p className="text-gray-400 text-sm mb-4">Irreversible and destructive actions</p>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={handleLogout}
              className="px-4 py-2 bg-red-900/20 hover:bg-red-900/30 text-red-400 border border-red-900/50 rounded-lg transition"
            >
              Log Out
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}

export default ProfilePage;
