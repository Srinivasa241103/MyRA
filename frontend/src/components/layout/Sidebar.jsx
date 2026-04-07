import { useState, useRef, useEffect } from "react";
import { sidebarStyles } from "../../styles/sidebar.styles";
import { useAuthStore } from "../../store/authStore";
import { useChatStore } from "../../store/chatStore";
import useSyncStore from "../../store/syncStore";
import { authApi } from "../../api/auth";

function Sidebar({ onNavigate, currentPage }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const { user, isAuthenticated, logout } = useAuthStore();
  const { conversations, conversationsLoading, conversationsError, loadConversations, loadConversation, conversationId, resetChat } = useChatStore();
  const { calendar, triggerCalendarSync } = useSyncStore();
  const profileMenuRef = useRef(null);

  useEffect(() => {
    if (isAuthenticated) {
      loadConversations();
    }
  }, [isAuthenticated]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target)) {
        setShowProfileMenu(false);
      }
    };

    if (showProfileMenu) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showProfileMenu]);

  const getInitials = (name) => {
    if (!name) return "U";
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const handleProfileClick = () => {
    // Debug logs
    console.log("=== Profile Debug ===");
    console.log("isAuthenticated:", isAuthenticated);
    console.log("user:", user);
    console.log("user.picture:", user?.picture);
    console.log("user.name:", user?.name);
    console.log("==================");
    
    if (isAuthenticated) {
      setShowProfileMenu(!showProfileMenu);
    } else {
      onNavigate("login");
    }
  };

  const handleSettingsClick = () => {
    setShowProfileMenu(false);
    onNavigate("profile");
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

  const ChatIcon = () => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={sidebarStyles.chatIcon}
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );

  const SidebarIcon = () => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <line x1="9" y1="3" x2="9" y2="21" />
    </svg>
  );

  return (
    <div
      className={`${sidebarStyles.sidebar} ${isExpanded ? sidebarStyles.sidebarExpanded : sidebarStyles.sidebarCollapsed}`}
    >
      {/* Header with toggle button */}
      <div className={isExpanded ? sidebarStyles.header : sidebarStyles.headerCollapsed}>
        {isExpanded && <span className={sidebarStyles.logo}>Myra</span>}
        <button
          className={sidebarStyles.toggleButton}
          onClick={() => setIsExpanded(!isExpanded)}
          title={isExpanded ? "Close sidebar" : "Open sidebar"}
        >
          <SidebarIcon />
        </button>
      </div>

      {/* New Chat button - only shown when expanded */}
      {isExpanded && (
        <div className={sidebarStyles.newChatSection}>
          <button
            className={sidebarStyles.newChatButton}
            onClick={() => { resetChat(); onNavigate("chat"); }}
            title="New Chat"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            <span>New Chat</span>
          </button>

          {/* Calendar Sync button — only for authenticated users */}
          {isAuthenticated && (
            <button
              onClick={handleCalendarSync}
              disabled={calendar.isSyncing}
              title={calendar.isSyncing ? calendar.syncMessage || "Syncing..." : "Sync Google Calendar"}
              className="w-full flex items-center gap-2 px-3 py-2 mt-1 rounded-lg text-sm text-slate-300 hover:bg-slate-700/60 hover:text-white transition disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {calendar.isSyncing ? (
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin flex-shrink-0">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                  <path d="M17 14l-5 5-2-2" />
                </svg>
              )}
              <span className="truncate">
                {calendar.isSyncing
                  ? `${calendar.syncMessage || "Syncing..."}`
                  : calendar.syncPhase === "complete"
                  ? "Calendar Synced"
                  : calendar.syncPhase === "error"
                  ? "Sync Failed — Retry"
                  : "Sync Calendar"}
              </span>
            </button>
          )}
        </div>
      )}

      {/* Calendar sync icon — collapsed sidebar */}
      {!isExpanded && isAuthenticated && (
        <div className="flex justify-center mt-1 px-2">
          <button
            onClick={handleCalendarSync}
            disabled={calendar.isSyncing}
            title={calendar.isSyncing ? "Syncing calendar..." : "Sync Calendar"}
            className="p-2 rounded-lg hover:bg-slate-700/60 transition text-slate-400 hover:text-white disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {calendar.isSyncing ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin">
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
                <path d="M17 14l-5 5-2-2" />
              </svg>
            )}
          </button>
        </div>
      )}

      {/* Chat History Section */}
      <div className={isExpanded ? sidebarStyles.historySection : sidebarStyles.historySectionCollapsed}>
        {isExpanded && (
          <h3 className={sidebarStyles.historyTitle}>Chat History</h3>
        )}

        {isAuthenticated ? (
          conversationsLoading ? (
            isExpanded && (
              <div className="flex flex-col gap-2 px-2 mt-1">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-8 rounded-lg bg-slate-700/50 animate-pulse" />
                ))}
              </div>
            )
          ) : conversationsError ? (
            isExpanded && (
              <div className="px-3 mt-2">
                <p className="text-xs text-red-400">Failed to load history</p>
                <button
                  onClick={loadConversations}
                  className="text-xs text-purple-400 hover:text-purple-300 mt-1 transition"
                >
                  Retry
                </button>
              </div>
            )
          ) : conversations.length > 0 ? (
            conversations.map((chat) => (
              <button
                key={chat.conversationId}
                className={`${isExpanded ? sidebarStyles.historyItem : sidebarStyles.historyItemCollapsed} ${chat.conversationId === conversationId ? "bg-[#2A2A35] text-white" : ""}`}
                onClick={() => {
                  loadConversation(chat.conversationId);
                  onNavigate("chat");
                }}
                title={chat.title}
              >
                {isExpanded ? (
                  <span className="truncate text-sm">{chat.title}</span>
                ) : (
                  <ChatIcon />
                )}
              </button>
            ))
          ) : (
            isExpanded && <p className={sidebarStyles.emptyHistory}>No chat history yet</p>
          )
        ) : (
          isExpanded ? (
            <div className={sidebarStyles.loginPrompt}>
              <p className="mb-3">Sign in to save your chat history</p>
              <button
                onClick={() => onNavigate("login")}
                className="text-purple-400 hover:text-purple-300 transition font-medium"
              >
                Sign in
              </button>
            </div>
          ) : (
            <div className={sidebarStyles.loginPromptCollapsed}>
              <button
                onClick={() => onNavigate("login")}
                className="p-2 rounded-lg hover:bg-slate-800/80 transition"
                title="Sign in"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-slate-400"
                >
                  <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                  <polyline points="10 17 15 12 10 7" />
                  <line x1="15" x2="3" y1="12" y2="12" />
                </svg>
              </button>
            </div>
          )
        )}
      </div>

      {/* Footer with profile */}
      <div className={isExpanded ? sidebarStyles.footer : sidebarStyles.footerCollapsed}>
        <div ref={profileMenuRef} className="relative">
          <button
            className={isExpanded ? sidebarStyles.profileButton : sidebarStyles.profileButtonCollapsed}
            onClick={handleProfileClick}
            title={isAuthenticated && user ? user.name : "Sign in"}
          >
            {isAuthenticated && user?.picture ? (
              <img
                src={user.picture}
                alt={user.name || "Profile"}
                className="w-9 h-9 rounded-full object-cover flex-shrink-0"
                onError={(e) => {
                  console.error("Image failed to load:", user.picture);
                  e.target.style.display = 'none';
                }}
              />
            ) : (
              <div className={sidebarStyles.profileAvatar}>
                {isAuthenticated && user ? getInitials(user.name) : (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                )}
              </div>
            )}
            {isExpanded && (
              <div className={sidebarStyles.profileInfo}>
                {isAuthenticated && user ? (
                  <>
                    <p className={sidebarStyles.profileName}>{user.name}</p>
                    <p className={sidebarStyles.profileEmail}>{user.email}</p>
                  </>
                ) : (
                  <p className={sidebarStyles.profileName}>Sign in</p>
                )}
              </div>
            )}
          </button>

          {/* Profile Dropdown Menu */}
          {showProfileMenu && isAuthenticated && (
            <div className={sidebarStyles.profileMenu}>
              <button
                onClick={handleSettingsClick}
                className={sidebarStyles.profileMenuItem}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                Settings
              </button>
              <button
                onClick={handleLogout}
                className={`${sidebarStyles.profileMenuItem} ${sidebarStyles.profileMenuItemDanger}`}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" x2="9" y1="12" y2="12" />
                </svg>
                Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Sidebar;