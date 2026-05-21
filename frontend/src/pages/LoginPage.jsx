import { useState } from "react";
import { authApi } from "../api/auth";

function LoginPage({ onNavigate }) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleGoogleLogin = async () => {
    setIsLoading(true);
    setError(null);
    try {
      await authApi.loginWithGoogle();
    } catch (err) {
      setError("Failed to connect to Google. Please try again.");
      setIsLoading(false);
    }
  };

  return (
    <div
      style={{
        height: "100%",
        width: "100%",
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        background: "var(--bg-0)",
      }}
    >
      {/* Left panel — editorial */}
      <div
        style={{
          background: "var(--parchment)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "48px",
          overflow: "hidden",
          position: "relative",
        }}
      >
        {/* Decorative circles */}
        <div style={{
          position: "absolute", top: -60, right: -60,
          width: 240, height: 240, borderRadius: "50%",
          background: "rgba(196,148,90,.12)",
          pointerEvents: "none",
        }} />
        <div style={{
          position: "absolute", bottom: -40, left: -40,
          width: 180, height: 180, borderRadius: "50%",
          background: "rgba(122,74,46,.08)",
          pointerEvents: "none",
        }} />

        <div style={{ maxWidth: 420, position: "relative" }}>
          <span className="myra-badge accent" style={{ marginBottom: 20, display: "inline-flex" }}>Personal AI · v1.0</span>
          <h2 className="display" style={{ fontSize: 42, marginBottom: 16 }}>
            Your retrieval assistant —<br />
            <em style={{ fontStyle: "italic", fontWeight: 600 }}>quietly</em> in the background.
          </h2>
          <p style={{ fontSize: 15, color: "var(--text-2)", lineHeight: 1.65 }}>
            MyRA reads your inbox, calendar, and notes — then answers your questions, drafts replies, and helps run your day.
          </p>
          <div style={{ display: "flex", gap: 10, marginTop: 28, flexWrap: "wrap" }}>
            <SourcePill icon={<MailIcon />} label="Gmail" />
            <SourcePill icon={<CalendarIcon />} label="Calendar" />
            <SourcePill icon={<FileTextIcon />} label="Notes" />
            <SourcePill icon={<DatabaseIcon />} label="Drive" />
          </div>
        </div>
      </div>

      {/* Right panel — sign in form */}
      <div style={{ display: "grid", placeItems: "center", padding: "32px 16px", background: "var(--bg-0)" }}>
        <div style={{ width: "100%", maxWidth: 380 }}>
          {/* Logo */}
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 32 }}>
            <div className="myra-logo" style={{ fontSize: 22 }}>
              <span className="mark">
                <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 19V6l7 9 7-9v13" />
                  <circle cx="12" cy="20.5" r="1.2" fill="currentColor" stroke="none" />
                </svg>
              </span>
              <span className="word">My<b>RA</b></span>
            </div>
          </div>

          <div style={{ textAlign: "center", marginBottom: 28 }}>
            <h1 className="display lg" style={{ marginBottom: 8, fontSize: 30 }}>Welcome back.</h1>
            <p className="muted">Sign in to your retrieval assistant.</p>
          </div>

          {error && (
            <div
              style={{
                marginBottom: 16, padding: "10px 14px",
                borderRadius: "var(--radius-md)",
                background: "rgba(160,48,48,.08)",
                border: "1px solid rgba(160,48,48,.25)",
                color: "var(--danger)", fontSize: 13,
              }}
            >
              {error}
            </div>
          )}

          <div className="col gap-3">
            {/* Google sign-in */}
            <button
              onClick={handleGoogleLogin}
              disabled={isLoading}
              className="myra-btn secondary lg"
              style={{ width: "100%", justifyContent: "center" }}
            >
              {isLoading ? (
                <SpinnerIcon />
              ) : (
                <GoogleColorIcon />
              )}
              {isLoading ? "Connecting…" : "Continue with Google"}
            </button>

            {/* Divider */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "4px 0" }}>
              <div className="myra-divider" style={{ flex: 1 }} />
              <span className="muted" style={{ fontSize: 11 }}>or</span>
              <div className="myra-divider" style={{ flex: 1 }} />
            </div>

            {/* Guest access */}
            <button
              onClick={() => onNavigate("chat")}
              className="myra-btn ghost lg"
              style={{ width: "100%", justifyContent: "center", border: "1px solid var(--border)" }}
            >
              Continue as Guest
            </button>

            <p className="muted" style={{ fontSize: 12, textAlign: "center", marginTop: 8 }}>
              Guest mode doesn't save chat history.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Small helper components ──────────────────────────────────────────────────

function SourcePill({ icon, label }) {
  return (
    <span className="myra-source-pill" style={{ cursor: "default" }}>
      {icon}{label}
    </span>
  );
}

function SpinnerIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ animation: "spin 0.8s linear infinite" }}
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </svg>
  );
}

function GoogleColorIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  );
}

function MailIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7l-10 7L2 7"/>
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
    </svg>
  );
}

function FileTextIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>
    </svg>
  );
}

function DatabaseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="5" rx="9" ry="3"/>
      <path d="M3 5v6c0 1.7 4 3 9 3s9-1.3 9-3V5"/>
      <path d="M3 11v6c0 1.7 4 3 9 3s9-1.3 9-3v-6"/>
    </svg>
  );
}

export default LoginPage;
