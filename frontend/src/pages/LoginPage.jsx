import { useState } from "react";
import {
  CalendarDays,
  Check,
  Globe2,
  Mail,
  Moon,
  Sun,
} from "lucide-react";
import { authApi } from "../api/auth";

function LoginPage({ onNavigate, theme = "light", onThemeChange = () => {} }) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const isDark = theme === "dark";

  const handleGoogleLogin = async () => {
    setIsLoading(true);
    setError(null);
    try {
      await authApi.loginWithGoogle();
    } catch {
      setError("Failed to connect to Google. Please try again.");
      setIsLoading(false);
    }
  };

  return (
    <div className="myra-login-layout">
      <button
        className="myra-login-theme-toggle myra-btn ghost icon sm"
        onClick={() => onThemeChange(isDark ? "light" : "dark")}
        aria-label={isDark ? "Use light theme" : "Use dark theme"}
        type="button"
      >
        {isDark
          ? <Sun size={17} strokeWidth={1.7} />
          : <Moon size={17} strokeWidth={1.7} />}
      </button>

      <main className="myra-login-primary">
        <div className="myra-login-content">
          <div className="myra-logo myra-login-logo">
            <span className="mark">M</span>
            <span className="word">MyRA</span>
          </div>

          <h1 className="display">Your chief of staff for mail, calendar and notes.</h1>
          <p className="myra-login-lede">
            Sign in with Google to let MyRA read the context you choose. Nothing
            moves, sends, or schedules without your approval.
          </p>

          {error && <div className="myra-login-error">{error}</div>}

          <div className="myra-login-actions">
            <button
              onClick={handleGoogleLogin}
              disabled={isLoading}
              className="myra-btn secondary lg"
              type="button"
            >
              <Globe2 size={18} strokeWidth={1.7} />
              {isLoading ? "Connecting..." : "Continue with Google"}
            </button>
            <button
              onClick={() => onNavigate("chat")}
              className="myra-btn ghost"
              type="button"
            >
              Continue as guest
            </button>
          </div>

          <div className="myra-login-trust">
            <p><Check size={15} strokeWidth={1.7} />Read-only scopes by default. Sending mail always waits for approval.</p>
            <p><Check size={15} strokeWidth={1.7} />Your mail and documents are never used to train models.</p>
            <p><Check size={15} strokeWidth={1.7} />Revoke access or delete synced data at any time.</p>
          </div>

          <div className="myra-login-legal">
            <a href="/privacy" onClick={(event) => { event.preventDefault(); onNavigate("privacy"); }}>
              Privacy Policy
            </a>
            <a href="/terms" onClick={(event) => { event.preventDefault(); onNavigate("terms"); }}>
              Terms of Service
            </a>
          </div>
        </div>
      </main>

      <aside className="myra-login-preview" aria-label="Preview of the MyRA workspace">
        <div className="myra-login-preview-stack">
          <article className="myra-card">
            <span className="myra-card-kicker">This morning</span>
            <p>Connect your account to see the items that need you today.</p>
          </article>
          <article className="myra-card">
            <div className="myra-login-preview-meta">
              <span className="myra-badge success"><CalendarDays size={13} strokeWidth={1.7} />Calendar Agent</span>
              <span>No action yet</span>
            </div>
            <p>No calendar data yet.</p>
          </article>
          <article className="myra-card">
            <div className="myra-login-preview-meta">
              <span className="myra-badge warning"><Mail size={13} strokeWidth={1.7} />Email Agent</span>
              <span>Approval required</span>
            </div>
            <p>Drafts remain private until you review and approve them.</p>
          </article>
          <span className="myra-login-preview-caption">A preview of your workspace</span>
        </div>
      </aside>
    </div>
  );
}

export default LoginPage;
