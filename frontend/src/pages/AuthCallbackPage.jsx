import { useEffect, useState } from "react";
import { authApi } from "../api/auth";
import { useAuthStore } from "../store/authStore";

function AuthCallbackPage({ onNavigate }) {
  const [status, setStatus] = useState("processing");
  const [error, setError] = useState(null);
  const { setUser } = useAuthStore();

  useEffect(() => {
    const handleCallback = async () => {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const token = urlParams.get("token");
        const errorParam = urlParams.get("error");

        if (errorParam) {
          setStatus("error");
          setError(getErrorMessage(errorParam));
          return;
        }

        if (!token) {
          setStatus("error");
          setError("No authentication token received");
          return;
        }

        authApi.setToken(token);
        const user = await authApi.getCurrentUser();

        if (user) {
          setUser(user);
          setStatus("success");
          setTimeout(() => onNavigate("chat"), 1500);
        } else {
          setStatus("error");
          setError("Failed to get user information");
        }
      } catch (err) {
        console.error("Auth callback error:", err);
        setStatus("error");
        setError("Authentication failed. Please try again.");
      }
    };

    handleCallback();
  }, [setUser, onNavigate]);

  const getErrorMessage = (errorCode) => {
    const messages = {
      access_denied: "Access was denied. Please try again.",
      missing_code: "Authorization code is missing.",
      auth_failed: "Authentication failed. Please try again.",
    };
    return messages[errorCode] || "An error occurred during authentication.";
  };

  return (
    <div
      style={{
        height: "100%",
        width: "100%",
        display: "grid",
        placeItems: "center",
        background: "var(--bg-0)",
      }}
    >
      <div
        className="myra-card"
        style={{ width: "100%", maxWidth: 360, textAlign: "center" }}
      >
        {status === "processing" && (
          <>
            <div style={{ display: "grid", placeItems: "center", marginBottom: 20 }}>
              <SpinnerRing />
            </div>
            <h2 className="h2" style={{ marginBottom: 8 }}>Signing you in…</h2>
            <p className="muted">Please wait while we complete your authentication.</p>
          </>
        )}

        {status === "success" && (
          <>
            <div
              style={{
                width: 52, height: 52, borderRadius: "50%",
                background: "rgba(92,138,74,.15)",
                display: "grid", placeItems: "center",
                margin: "0 auto 20px",
                color: "var(--success)",
              }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <h2 className="h2" style={{ marginBottom: 8 }}>Welcome!</h2>
            <p className="muted">You've been signed in successfully. Redirecting…</p>
          </>
        )}

        {status === "error" && (
          <>
            <div
              style={{
                width: 52, height: 52, borderRadius: "50%",
                background: "rgba(160,48,48,.12)",
                display: "grid", placeItems: "center",
                margin: "0 auto 20px",
                color: "var(--danger)",
              }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
            </div>
            <h2 className="h2" style={{ marginBottom: 8 }}>Authentication Failed</h2>
            <p className="muted" style={{ marginBottom: 20 }}>{error}</p>
            <button
              onClick={() => onNavigate("login")}
              className="myra-btn secondary"
              style={{ width: "100%", justifyContent: "center" }}
            >
              Try Again
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function SpinnerRing() {
  return (
    <svg
      width="48" height="48" viewBox="0 0 48 48" fill="none"
      style={{ animation: "spin 0.9s linear infinite" }}
    >
      <circle cx="24" cy="24" r="20" stroke="var(--border)" strokeWidth="4" />
      <path d="M44 24a20 20 0 0 0-20-20" stroke="var(--accent)" strokeWidth="4" strokeLinecap="round" />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </svg>
  );
}

export default AuthCallbackPage;
