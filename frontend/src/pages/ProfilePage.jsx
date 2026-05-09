import { useState, useEffect, useRef } from "react";
import { useAuthStore } from "../store/authStore";
import { authApi } from "../api/auth";
import socketService from "../service/socketService";
import useSyncStore from "../store/syncStore";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:2020";

const GMAIL_PHASE_LABELS = {
  starting: "Starting…",
  fetching: "Fetching emails…",
  normalizing: "Normalizing data…",
  storing: "Storing documents…",
  embedding_start: "Preparing embeddings…",
  embedding: "Generating embeddings…",
  complete: "Complete",
  error: "Failed",
};

const CALENDAR_PHASE_LABELS = {
  starting: "Starting…",
  fetching: "Fetching events…",
  normalizing: "Normalizing data…",
  storing: "Storing documents…",
  embedding_start: "Preparing embeddings…",
  embedding: "Generating embeddings…",
  complete: "Complete",
  error: "Failed",
};

// ── Sync Progress Panel ──────────────────────────────────────────────────────
function SyncProgressPanel({ syncState, phaseLabels, onDismiss }) {
  const { isSyncing, syncPhase, syncProgress, syncMessage, syncError, lastSyncResult } = syncState;
  if (!isSyncing && syncPhase !== "complete" && syncPhase !== "error") return null;

  const isComplete = syncPhase === "complete";
  const isError = syncPhase === "error";

  return (
    <div className="myra-sync-panel">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12 }}>
        <span style={{ color: isError ? "var(--danger)" : isComplete ? "var(--success)" : "var(--text-2)" }}>
          {phaseLabels[syncPhase] || syncPhase}
        </span>
        {!isError && (
          <span className="muted" style={{ fontSize: 11 }}>{syncProgress}%</span>
        )}
      </div>
      {!isError && (
        <div className="myra-progress-bar">
          <div
            className={"fill" + (isComplete ? " success" : "")}
            style={{ width: `${syncProgress}%` }}
          />
        </div>
      )}
      {syncMessage && !isComplete && (
        <p style={{ fontSize: 11, color: "var(--text-muted)" }}>{syncMessage}</p>
      )}
      {isComplete && lastSyncResult && (
        <p style={{ fontSize: 11, color: "var(--success)" }}>
          {lastSyncResult.documentsAdded ?? lastSyncResult.processed ?? 0} new documents synced
        </p>
      )}
      {isError && syncError && (
        <div style={{
          padding: "8px 10px",
          borderRadius: "var(--radius-md)",
          background: "rgba(160,48,48,.08)",
          border: "1px solid rgba(160,48,48,.2)",
          fontSize: 12, color: "var(--danger)",
        }}>
          {syncError}
        </div>
      )}
      {(isComplete || isError) && (
        <button
          onClick={onDismiss}
          style={{ fontSize: 11, color: "var(--text-muted)", background: "none", border: 0, cursor: "pointer", padding: 0 }}
        >
          Dismiss
        </button>
      )}
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────
function ProfilePage({ onNavigate }) {
  const { user, logout } = useAuthStore();
  const [name, setName] = useState(user?.name || "");
  const [emailInput] = useState(user?.email || "");
  const [notifications, setNotifications] = useState(true);
  const [syncHistory, setSyncHistory] = useState([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  const gmailSyncIdRef = useRef(null);
  const calendarSyncIdRef = useRef(null);

  const {
    gmail, calendar,
    setSyncStarted, setSyncProgress, setSyncComplete, setSyncError, resetSync,
  } = useSyncStore();

  // WebSocket listeners
  useEffect(() => {
    const userId = user?.id || user?.sub || user?.email;
    if (!userId) return;
    const socket = socketService.connect(userId);

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
    }
    fetchSyncHistory();
  }, [user]);

  const fetchSyncHistory = async () => {
    setIsLoadingHistory(true);
    try {
      const userId = user?.id || user?.sub || user?.email;
      const response = await fetch(`${API_BASE_URL}/sync/history?userId=${userId}`, {
        method: "GET", credentials: "include",
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

  const handleGmailSync = async () => {
    setSyncStarted("gmail");
    try {
      const userId = user?.id || user?.sub || user?.email;
      const res = await fetch(`${API_BASE_URL}/sync/gmail`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, syncType: "incremental" }),
      });
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      const data = await res.json();
      if (data.success) {
        gmailSyncIdRef.current = data.data?.syncId || data.syncId || null;
      } else {
        setSyncError("gmail", data.message || "Failed to start sync");
      }
    } catch (error) {
      setSyncError("gmail", error.message || "Failed to start sync");
    }
  };

  const handleCalendarSync = async () => {
    setSyncStarted("calendar");
    try {
      const userId = user?.id || user?.sub || user?.email;
      const res = await fetch(`${API_BASE_URL}/sync/calendar`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, syncType: "incremental" }),
      });
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      const data = await res.json();
      if (data.success) {
        calendarSyncIdRef.current = data.data?.syncId || data.syncId || null;
      } else {
        setSyncError("calendar", data.message || "Failed to start calendar sync");
      }
    } catch (error) {
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

  const formatDate = (ds) => ds ? new Date(ds).toLocaleString() : "N/A";

  const getStatusVariant = (status) => {
    if (status === "success") return "success";
    if (status === "in_progress") return "info";
    return "danger";
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
    <div style={{ height: "100%", overflow: "hidden", display: "flex", flexDirection: "column", background: "var(--bg-0)" }}>
      {/* Top bar */}
      <div style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-1)", flexShrink: 0 }}>
        <div style={{ maxWidth: 900, margin: "0 auto", padding: "0 24px", height: 56, display: "flex", alignItems: "center", gap: 12 }}>
          <button
            onClick={() => window.history.back()}
            className="myra-btn ghost icon sm"
            aria-label="Go back"
          >
            <BackIcon />
          </button>
          <div style={{ flex: 1 }}>
            <strong style={{ fontSize: 15, color: "var(--text-2)" }}>Profile & Settings</strong>
            <div className="muted" style={{ fontSize: 11 }}>Manage your account and data connections</div>
          </div>
          <button className="myra-btn ghost sm" onClick={() => onNavigate("home")}>
            Home
          </button>
          <button className="myra-btn ghost sm" onClick={() => onNavigate("chat")}>
            Chat
          </button>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="myra-page" style={{ flex: 1 }}>
        <div style={{ maxWidth: 900, margin: "0 auto", padding: "24px", display: "flex", flexDirection: "column", gap: 20 }}>

          {/* ── 1. Profile Info ── */}
          <div className="myra-card">
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24, flexWrap: "wrap" }}>
              <div className="myra-avatar lg">
                {user.picture
                  ? <img src={user.picture} alt={user.name} style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%" }} />
                  : getInitials(user.name)}
              </div>
              <div style={{ flex: 1, minWidth: 160 }}>
                <h2 className="h2" style={{ marginBottom: 2 }}>{user.name || "—"}</h2>
                <p className="muted" style={{ fontSize: 13 }}>{user.email || "—"}</p>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div>
                <div className="myra-label" style={{ marginBottom: 6 }}>Display name</div>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="myra-input"
                />
              </div>
              <div>
                <div className="myra-label" style={{ marginBottom: 6 }}>Email</div>
                <input
                  type="email"
                  value={emailInput}
                  disabled
                  className="myra-input"
                  style={{ opacity: 0.6, cursor: "not-allowed" }}
                />
                <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>Managed by your Google account</p>
              </div>
            </div>

            <div style={{ marginTop: 16 }}>
              <button onClick={handleSaveProfile} className="myra-btn primary sm">
                <SaveIcon /> Save Changes
              </button>
            </div>
          </div>

          {/* ── 2. Data Connections ── */}
          <div className="myra-card">
            <div className="myra-card-header">
              <h3>Data Connections</h3>
            </div>
            <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>Manage connected accounts and data sources</p>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {/* Gmail */}
              <ConnectionRow
                icon={<MailIcon />}
                label="Email Account"
                sublabel={user.email || "Not connected"}
                status="Connected"
                statusVariant="success"
                isSyncing={gmail.isSyncing}
                onSync={handleGmailSync}
                syncLabel="Sync Gmail Now"
              >
                <SyncProgressPanel
                  syncState={gmail}
                  phaseLabels={GMAIL_PHASE_LABELS}
                  onDismiss={() => resetSync("gmail")}
                />
              </ConnectionRow>

              {/* Calendar */}
              <ConnectionRow
                icon={<CalendarIcon />}
                label="Google Calendar"
                sublabel={user.email || "Not connected"}
                status="Connected"
                statusVariant="success"
                isSyncing={calendar.isSyncing}
                onSync={handleCalendarSync}
                syncLabel="Sync Calendar Now"
              >
                <SyncProgressPanel
                  syncState={calendar}
                  phaseLabels={CALENDAR_PHASE_LABELS}
                  onDismiss={() => resetSync("calendar")}
                />
              </ConnectionRow>

              {/* Music — coming soon */}
              <div className="myra-connection-row" style={{ opacity: 0.55 }}>
                <div className="myra-connection-main">
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div className="myra-connection-icon"><MusicIcon /></div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-2)" }}>
                        Music
                        <span className="myra-badge" style={{ marginLeft: 8, fontSize: 10 }}>Coming soon</span>
                      </div>
                      <div className="muted" style={{ fontSize: 12 }}>Spotify</div>
                    </div>
                  </div>
                  <span className="muted" style={{ fontSize: 12 }}>Not connected</span>
                </div>
              </div>
            </div>
          </div>

          {/* ── 3. Preferences ── */}
          <div className="myra-card">
            <div className="myra-card-header"><h3>Preferences</h3></div>
            <div className="myra-settings-row">
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-2)" }}>Notifications</div>
                <div className="desc">Receive sync updates and alerts</div>
              </div>
              <Toggle on={notifications} onClick={() => setNotifications(!notifications)} />
            </div>
          </div>

          {/* ── 4. Sync History ── */}
          <div className="myra-card">
            <div className="myra-card-header">
              <h3>Sync History</h3>
              <button
                onClick={fetchSyncHistory}
                className="myra-btn ghost sm"
              >
                Refresh
              </button>
            </div>

            {isLoadingHistory ? (
              <p className="muted" style={{ textAlign: "center", padding: "24px 0" }}>Loading history…</p>
            ) : syncHistory.length === 0 ? (
              <p className="muted" style={{ textAlign: "center", padding: "24px 0" }}>No sync history yet.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {syncHistory.map((item, idx) => (
                  <div
                    key={idx}
                    style={{
                      background: "var(--bg-2)", borderRadius: "var(--radius-md)",
                      padding: "12px 14px", border: "1px solid var(--border)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 18 }}>
                          {item.source === "gmail" ? "✉" : item.source === "google_calendar" ? "📅" : "📄"}
                        </span>
                        <div>
                          <p style={{ fontSize: 13, fontWeight: 500, color: "var(--text-2)" }}>
                            {item.source === "google_calendar" ? "Google Calendar" : item.source}
                          </p>
                          <p style={{ fontSize: 11, color: "var(--text-muted)" }}>{formatDate(item.started_at || item.created_at)}</p>
                        </div>
                      </div>
                      <span className={"myra-badge " + getStatusVariant(item.status)}>{item.status}</span>
                    </div>
                    {item.stats && (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, paddingTop: 8, borderTop: "1px solid var(--border)" }}>
                        <div>
                          <p style={{ fontSize: 11, color: "var(--text-muted)" }}>Fetched</p>
                          <p style={{ fontSize: 13, fontWeight: 500, color: "var(--text-2)" }}>{item.stats.total_fetched ?? "—"}</p>
                        </div>
                        <div>
                          <p style={{ fontSize: 11, color: "var(--text-muted)" }}>New</p>
                          <p style={{ fontSize: 13, fontWeight: 500, color: "var(--text-2)" }}>{item.stats.new_documents ?? "—"}</p>
                        </div>
                      </div>
                    )}
                    {item.error_message && (
                      <p style={{ marginTop: 8, fontSize: 12, color: "var(--danger)" }}>{item.error_message}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── 5. Danger Zone ── */}
          <div className="myra-card" style={{ borderColor: "rgba(160,48,48,.25)" }}>
            <h3 style={{ color: "var(--danger)", marginBottom: 6 }}>Danger Zone</h3>
            <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>Irreversible and destructive actions</p>
            <button onClick={handleLogout} className="myra-btn danger sm">
              <LogoutIcon /> Log Out
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}

// ── Connection Row ───────────────────────────────────────────────────────────

function ConnectionRow({ icon, label, sublabel, status, statusVariant, isSyncing, onSync, syncLabel, children }) {
  return (
    <div className="myra-connection-row">
      <div className="myra-connection-main">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div className="myra-connection-icon">{icon}</div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-2)" }}>{label}</div>
            <div className="muted" style={{ fontSize: 12 }}>{sublabel}</div>
          </div>
        </div>
        <span className={"myra-badge " + statusVariant}>{status}</span>
      </div>
      <div className="myra-connection-expand">
        <button
          onClick={onSync}
          disabled={isSyncing}
          className={"myra-btn primary sm" + (isSyncing ? "" : "")}
          style={{ width: "100%", justifyContent: "center", marginBottom: 10 }}
        >
          {isSyncing ? <><SpinnerIcon />{syncLabel.replace("Sync", "Syncing")}</>  : syncLabel}
        </button>
        {children}
      </div>
    </div>
  );
}

// ── Toggle ───────────────────────────────────────────────────────────────────

function Toggle({ on, onClick }) {
  return (
    <button
      className={"myra-toggle" + (on ? " on" : "")}
      onClick={onClick}
      aria-pressed={on}
    />
  );
}

// ── Icons ────────────────────────────────────────────────────────────────────

function BackIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5M12 5l-7 7 7 7" />
    </svg>
  );
}

function SaveIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
      <polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>
    </svg>
  );
}

function MailIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7l-10 7L2 7"/>
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
    </svg>
  );
}

function MusicIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ animation: "spin 0.8s linear infinite", marginRight: 4 }}>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
      <polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>
    </svg>
  );
}

export default ProfilePage;
