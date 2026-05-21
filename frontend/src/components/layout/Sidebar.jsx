import { useState, useRef, useEffect } from "react";
import { useAuthStore } from "../../store/authStore";
import { useChatStore } from "../../store/chatStore";
import useSyncStore from "../../store/syncStore";
import { authApi } from "../../api/auth";

function Sidebar({ onNavigate, currentPage, isExpanded = true, onToggle }) {
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const { user, isAuthenticated, logout } = useAuthStore();
  const {
    conversations, conversationsLoading, conversationsError,
    loadConversations, loadConversation, conversationId, resetChat,
  } = useChatStore();
  const { calendar, triggerCalendarSync } = useSyncStore();
  const profileMenuRef = useRef(null);

  useEffect(() => {
    if (isAuthenticated) loadConversations();
  }, [isAuthenticated]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target)) {
        setShowProfileMenu(false);
      }
    };
    if (showProfileMenu) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showProfileMenu]);

  const getInitials = (name) => {
    if (!name) return "U";
    return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
  };

  const handleProfileClick = () => {
    if (isAuthenticated) setShowProfileMenu(!showProfileMenu);
    else onNavigate("login");
  };

  const handleLogout = async () => {
    try {
      await authApi.logout();
      logout();
      setShowProfileMenu(false);
      onNavigate("login");
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  const handleCalendarSync = async () => {
    if (!user?.id || calendar.isSyncing) return;
    try {
      await triggerCalendarSync(user.id, "incremental");
    } catch (error) {
      console.error("Calendar sync error:", error);
    }
  };

  // Group conversations by recency
  const grouped = groupConversations(conversations);

  const iconOnly = !isExpanded;

  return (
    <div className={"myra-sidebar" + (iconOnly ? " icon-only" : "")}>
      {/* Header */}
      <div className="myra-sidebar-header">
        {!iconOnly && (
          <button
            style={{ background: "none", border: 0, cursor: "pointer", padding: 0 }}
            onClick={() => onNavigate("home")}
            aria-label="Home"
          >
            <Logo />
          </button>
        )}
        <button
          className="myra-btn ghost icon sm"
          onClick={onToggle}
          title={isExpanded ? "Collapse sidebar" : "Expand sidebar"}
        >
          <SidebarToggleIcon />
        </button>
      </div>

      {/* New Chat */}
      <div className="myra-sidebar-newchat">
        <button
          className="myra-btn primary"
          style={{ width: "100%" }}
          onClick={() => { resetChat(); onNavigate("chat"); }}
        >
          <PlusIcon />
          <span className="sidebar-newchat-text">New chat</span>
        </button>
      </div>

      {/* Main nav links */}
      <div style={{ margin: "0 12px 4px" }}>
        {[
          { id: "home",     label: "Home",     icon: <HomeIcon /> },
          { id: "stats",    label: "Stats",    icon: <StatsIcon /> },
          { id: "settings", label: "Settings", icon: <SettingsNavIcon /> },
        ].map(({ id, label, icon }) => (
          <button
            key={id}
            className={"myra-sidebar-item" + (currentPage === id ? " active" : "")}
            style={{ borderLeft: "none", marginLeft: 0, width: "100%" }}
            onClick={() => onNavigate(id)}
            title={label}
          >
            {icon}
            <span className="item-title">{label}</span>
          </button>
        ))}
      </div>

      {/* Calendar Sync button */}
      {isAuthenticated && (
        <div style={{ margin: "0 12px 8px" }}>
          <button
            onClick={handleCalendarSync}
            disabled={calendar.isSyncing}
            className="myra-sidebar-item"
            style={{ borderLeft: "none", marginLeft: 0, width: "100%" }}
            title={calendar.isSyncing ? "Syncing…" : "Sync Calendar"}
          >
            {calendar.isSyncing ? <SpinnerIcon /> : <CalendarIcon />}
            <span className="item-title">
              {calendar.isSyncing
                ? (calendar.syncMessage || "Syncing…")
                : calendar.syncPhase === "complete"
                ? "Calendar synced"
                : calendar.syncPhase === "error"
                ? "Sync failed — retry"
                : "Sync Calendar"}
            </span>
          </button>
        </div>
      )}

      {/* Chat History */}
      <div className="myra-sidebar-list">
        {isAuthenticated ? (
          conversationsLoading ? (
            !iconOnly && (
              <div style={{ padding: "8px 4px", display: "flex", flexDirection: "column", gap: 6 }}>
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    style={{
                      height: 32, borderRadius: "var(--radius-md)",
                      background: "var(--bg-2)",
                      animation: "myra-fade-in .6s ease infinite alternate",
                    }}
                  />
                ))}
              </div>
            )
          ) : conversationsError ? (
            !iconOnly && (
              <div style={{ padding: "8px 12px" }}>
                <p style={{ fontSize: 12, color: "var(--danger)", marginBottom: 4 }}>Failed to load history</p>
                <button
                  onClick={loadConversations}
                  style={{ fontSize: 12, color: "var(--accent)", background: "none", border: 0, cursor: "pointer" }}
                >
                  Retry
                </button>
              </div>
            )
          ) : (
            <>
              {grouped.today.length > 0 && (
                <>
                  {!iconOnly && <div className="myra-sidebar-section-label">Today</div>}
                  {grouped.today.map((c) => (
                    <ConversationItem
                      key={c.conversationId}
                      chat={c}
                      isActive={c.conversationId === conversationId}
                      iconOnly={iconOnly}
                      onSelect={() => { loadConversation(c.conversationId); onNavigate("chat"); }}
                    />
                  ))}
                </>
              )}
              {grouped.week.length > 0 && (
                <>
                  {!iconOnly && <div className="myra-sidebar-section-label">This week</div>}
                  {grouped.week.map((c) => (
                    <ConversationItem
                      key={c.conversationId}
                      chat={c}
                      isActive={c.conversationId === conversationId}
                      iconOnly={iconOnly}
                      onSelect={() => { loadConversation(c.conversationId); onNavigate("chat"); }}
                    />
                  ))}
                </>
              )}
              {grouped.earlier.length > 0 && (
                <>
                  {!iconOnly && <div className="myra-sidebar-section-label">Earlier</div>}
                  {grouped.earlier.map((c) => (
                    <ConversationItem
                      key={c.conversationId}
                      chat={c}
                      isActive={c.conversationId === conversationId}
                      iconOnly={iconOnly}
                      onSelect={() => { loadConversation(c.conversationId); onNavigate("chat"); }}
                    />
                  ))}
                </>
              )}
              {conversations.length === 0 && !iconOnly && (
                <p style={{ fontSize: 12, color: "var(--text-muted)", padding: "16px 12px", textAlign: "center" }}>
                  No chat history yet
                </p>
              )}
            </>
          )
        ) : (
          !iconOnly && (
            <div style={{ padding: "16px 12px", textAlign: "center" }}>
              <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
                Sign in to save your chat history
              </p>
              <button
                onClick={() => onNavigate("login")}
                className="myra-btn ghost sm"
              >
                Sign in
              </button>
            </div>
          )
        )}
      </div>

      {/* Footer with profile */}
      <div className="myra-sidebar-footer" ref={profileMenuRef} style={{ position: "relative" }}>
        <button
          className="myra-sidebar-item"
          style={{ borderLeft: "none", marginLeft: 0, width: "100%", padding: "0 10px" }}
          onClick={handleProfileClick}
          title={isAuthenticated && user ? user.name : "Sign in"}
        >
          <div className="myra-avatar sm" style={{ flexShrink: 0 }}>
            {isAuthenticated && user?.picture
              ? <img src={user.picture} alt={user.name || "Profile"} onError={(e) => { e.target.style.display = "none"; }} />
              : <span>{isAuthenticated && user ? getInitials(user.name) : <UserIcon />}</span>}
          </div>
          {!iconOnly && (
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                <span className="sidebar-user-name">
                  {isAuthenticated && user ? user.name : "Sign in"}
                </span>
              </div>
              {isAuthenticated && user?.email && (
                <div style={{ fontSize: 11, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {user.email}
                </div>
              )}
            </div>
          )}
        </button>

        {/* Profile dropdown */}
        {showProfileMenu && isAuthenticated && (
          <div className="myra-profile-menu">
            <button
              className="myra-profile-menu-item"
              onClick={() => { setShowProfileMenu(false); onNavigate("profile"); }}
            >
              <SettingsIcon /> Settings &amp; Profile
            </button>
            <button
              className="myra-profile-menu-item danger"
              onClick={handleLogout}
            >
              <LogoutIcon /> Log out
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Conversation item ────────────────────────────────────────────────────────

function ConversationItem({ chat, isActive, iconOnly, onSelect }) {
  return (
    <button
      className={"myra-sidebar-item" + (isActive ? " active" : "")}
      onClick={onSelect}
      title={chat.title}
    >
      <ChatIcon />
      <span className="item-title">{chat.title}</span>
    </button>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function groupConversations(conversations) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(todayStart);
  weekStart.setDate(todayStart.getDate() - 7);

  const today = [], week = [], earlier = [];
  for (const c of conversations) {
    const d = new Date(c.updatedAt || c.createdAt || 0);
    if (d >= todayStart) today.push(c);
    else if (d >= weekStart) week.push(c);
    else earlier.push(c);
  }
  return { today, week, earlier };
}

// ── Icons ────────────────────────────────────────────────────────────────────

function Logo() {
  return (
    <div className="myra-logo sm">
      <span className="mark">
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 19V6l7 9 7-9v13" />
          <circle cx="12" cy="20.5" r="1.2" fill="currentColor" stroke="none" />
        </svg>
      </span>
      <span className="word">My<b>RA</b></span>
    </div>
  );
}

function SidebarToggleIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d="M21 12a8 8 0 0 1-11.5 7.2L4 21l1.7-5.5A8 8 0 1 1 21 12z" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ animation: "spin 0.8s linear infinite", flexShrink: 0 }}>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </svg>
  );
}

function UserIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-7 8-7s8 3 8 7" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1A2 2 0 1 1 4.4 17l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9c.3.6.9 1 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" /><path d="M21 12H9" />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function StatsIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  );
}

function SettingsNavIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1A2 2 0 1 1 4.4 17l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9c.3.6.9 1 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}

export default Sidebar;
