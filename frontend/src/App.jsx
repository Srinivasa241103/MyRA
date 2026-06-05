import { useState, useEffect } from "react";
import ChatPage from "./pages/ChatPage";
import LoginPage from "./pages/LoginPage";
import ProfilePage from "./pages/ProfilePage";
import AuthCallbackPage from "./pages/AuthCallbackPage";
import HomePage from "./pages/HomePage";
import StatsPage from "./pages/StatsPage";
import SettingsPage from "./pages/SettingsPage";
import Sidebar from "./components/layout/Sidebar";
import { useAuthStore } from "./store/authStore";
import { authApi } from "./api/auth";

const THEME_STORAGE_KEY = "myra-theme";

// ── URL ↔ page mapping ────────────────────────────────────────────────────────
const PATH_TO_PAGE = {
  "/":              "home",
  "/chat":          "chat",
  "/stats":         "stats",
  "/settings":      "settings",
  "/profile":       "profile",
  "/login":         "login",
  "/auth/callback": "auth-callback",
};
const PAGE_TO_PATH = Object.fromEntries(Object.entries(PATH_TO_PAGE).map(([k, v]) => [v, k]));

function pageFromURL() {
  return PATH_TO_PAGE[window.location.pathname] ?? "home";
}

function App() {
  const [currentPage, setCurrentPage] = useState(pageFromURL);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [sidebarExpanded, setSidebarExpanded] = useState(!isMobile);
  const [theme, setTheme] = useState(() => {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (storedTheme === "dark" || storedTheme === "warm") return storedTheme;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "warm";
  });
  const { setUser, setLoading } = useAuthStore();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme === "dark" ? "dark" : "light";
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  // Handle window resize for mobile responsiveness
  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      // Collapse sidebar on mobile unless user just expanded
      if (mobile && sidebarExpanded) {
        setSidebarExpanded(false);
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [sidebarExpanded]);

  // Keep URL in sync and handle browser back/forward
  useEffect(() => {
    const onPop = () => setCurrentPage(pageFromURL());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    const checkAuth = async () => {
      if (currentPage === "auth-callback") return;
      setLoading(true);
      try {
        const user = await authApi.getCurrentUser();
        if (user) setUser(user);
      } catch (error) {
        console.error("Auth check failed:", error);
      } finally {
        setLoading(false);
      }
    };
    checkAuth();
  }, [setUser, setLoading, currentPage]);

  const handleNavigate = (page) => {
    const path = PAGE_TO_PATH[page] ?? "/";
    window.history.pushState({}, "", path);
    setCurrentPage(page);
    // Close sidebar on mobile after navigation
    if (isMobile) setSidebarExpanded(false);
  };

  const handleToggleSidebar = () => setSidebarExpanded((v) => !v);

  const renderPage = () => {
    switch (currentPage) {
      case "auth-callback": return <AuthCallbackPage onNavigate={handleNavigate} />;
      case "login":         return <LoginPage onNavigate={handleNavigate} theme={theme} onThemeChange={setTheme} />;
      case "profile":       return <ProfilePage onNavigate={handleNavigate} />;
      case "home":          return <HomePage onNavigate={handleNavigate} />;
      case "stats":         return <StatsPage onNavigate={handleNavigate} />;
      case "settings":      return <SettingsPage theme={theme} onThemeChange={setTheme} />;
      case "chat":
      default:
        return (
          <ChatPage
            onNavigate={handleNavigate}
            onToggleSidebar={handleToggleSidebar}
          />
        );
    }
  };

  // Full-screen pages (no sidebar, no topnav)
  if (currentPage === "auth-callback" || currentPage === "login") {
    return <div className="myra-app" data-theme={theme}>{renderPage()}</div>;
  }

  // Profile page — no sidebar, no topnav
  if (currentPage === "profile") {
    return <div className="myra-app" data-theme={theme}>{renderPage()}</div>;
  }

  // Pages with top nav but no sidebar
  if (currentPage === "home" || currentPage === "stats" || currentPage === "settings") {
    return (
      <div className="myra-app" data-theme={theme} style={{ display: "flex", flexDirection: "column" }}>
        <TopNav currentPage={currentPage} onNavigate={handleNavigate} />
        <div className="myra-page" style={{ flex: 1 }}>
          {renderPage()}
        </div>
      </div>
    );
  }

  // Chat page — sidebar + chat
  return (
    <div 
      className="myra-app" 
      data-theme={theme} 
      style={{ display: "flex" }}
      data-mobile={isMobile}
    >
      {isMobile && (
        <div 
          onClick={() => setSidebarExpanded(false)} 
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0, 0, 0, 0.5)",
            zIndex: 99,
            opacity: sidebarExpanded ? 1 : 0,
            pointerEvents: sidebarExpanded ? "auto" : "none",
            transition: "opacity 0.3s ease",
          }}
          aria-hidden="true"
        />
      )}
      <Sidebar
        onNavigate={handleNavigate}
        currentPage={currentPage}
        isExpanded={sidebarExpanded}
        onToggle={handleToggleSidebar}
        isMobile={isMobile}
      />
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", minWidth: 0 }}>
        {renderPage()}
      </div>
    </div>
  );
}

// ── Top nav (non-chat pages) ─────────────────────────────────────────────────
function TopNav({ currentPage, onNavigate }) {
  const { user, isAuthenticated } = useAuthStore();

  const getInitials = (name) => {
    if (!name) return "U";
    return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
  };

  const navItems = [
    { id: "home",     label: "Home" },
    { id: "chat",     label: "Chat" },
    { id: "stats",    label: "Stats" },
    { id: "profile",  label: "Profile" },
    { id: "settings", label: "Settings" },
  ];

  return (
    <nav className="myra-topnav">
      <div className="row gap-6" style={{ alignItems: "center" }}>
        <button
          style={{ background: "transparent", border: 0, cursor: "pointer", padding: 0 }}
          onClick={() => onNavigate("home")}
        >
          <Logo />
        </button>
        <div className="links">
          {navItems.map((n) => (
            <button
              key={n.id}
              className={"nav-link" + (currentPage === n.id ? " active" : "")}
              onClick={() => onNavigate(n.id)}
            >
              {n.label}
            </button>
          ))}
        </div>
      </div>
      <div className="topnav-right">
        <button
          className="myra-avatar"
          onClick={() => onNavigate("profile")}
          aria-label="Profile"
        >
          {isAuthenticated && user?.picture
            ? <img src={user.picture} alt={user.name || "Profile"} />
            : getInitials(user?.name)}
        </button>
      </div>
    </nav>
  );
}

function Logo() {
  return (
    <div className="myra-logo">
      <span className="mark" aria-hidden="true">
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 19V6l7 9 7-9v13" />
          <circle cx="12" cy="20.5" r="1.2" fill="currentColor" stroke="none" />
        </svg>
      </span>
      <span className="word">My<b>RA</b></span>
    </div>
  );
}

export default App;
