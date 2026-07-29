import { useState, useEffect, useRef } from "react";
import { authApi } from "../api/auth";

function LoginPage({ onNavigate, theme = "warm", onThemeChange = () => {} }) {
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
      {/* Theme toggle */}
      <button
        className="myra-login-theme-toggle"
        onClick={() => onThemeChange(isDark ? "warm" : "dark")}
        aria-label="Toggle colour theme"
        aria-pressed={isDark}
        type="button"
      >
        {isDark ? "☀ Warm Pastel" : "🌙 Dark Pro"}
      </button>

      {/* Left panel — animated editorial art */}
      <div className="myra-login-hero">
        <div className="myra-login-art">
          <DoodleLayer />
          <div className="myra-login-art-top">
            <span className="myra-badge accent">Personal AI · v1.0</span>
          </div>
          <div className="myra-login-art-center">
            <Typewriter />
          </div>
          <div className="myra-login-art-bottom">
            <SourcePill icon={<MailIcon />} label="Gmail" />
            <SourcePill icon={<CalendarIcon />} label="Calendar" />
            <SourcePill icon={<FileTextIcon />} label="Notes" />
            <SourcePill icon={<DatabaseIcon />} label="Drive" />
          </div>
        </div>
      </div>

      {/* Right panel — sign in form */}
      <div className="myra-login-form-panel">
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

// ── Animated doodle layer ────────────────────────────────────────────────────

/* Doodle vocabulary (0..100 box; pathLength=1 → draw/erase via dashoffset) */
const DOODLES = [
  "M52 50 C52 44 44 44 44 50 C44 58 56 58 56 47 C56 36 39 36 39 50 C39 65 63 65 63 45", // spiral
  "M5 50 Q20 22 35 50 T65 50 T95 50",                                                    // wave
  "M50 8 L61 38 L93 38 L67 58 L77 92 L50 71 L23 92 L33 58 L7 38 L39 38 Z",               // star
  "M4 62 C20 62 18 28 40 30 C62 32 58 72 80 60 C92 53 94 42 96 40",                      // loop
  "M5 42 L25 62 L45 42 L65 62 L85 42",                                                   // zigzag
  "M56 5 L30 52 L49 52 L41 95 L74 40 L53 40 Z",                                          // lightning
  "M50 86 C8 56 20 12 50 38 C80 12 92 56 50 86 Z",                                       // heart
  "M50 9 C73 7 92 28 91 50 C90 73 71 92 50 91 C27 90 9 71 10 49 C11 27 28 11 50 9 Z",    // wobbly circle
  "M8 32 C40 8 60 92 92 50 M76 41 L92 50 L82 65",                                        // curly arrow
  "M50 18 L50 82 M22 50 L78 50 M31 31 L69 69 M69 31 L31 69",                             // sparkle
  "M14 18 H86 V62 H44 L29 82 V62 H14 Z",                                                 // speech bubble
  "M50 12 L88 80 L12 80 Z",                                                              // triangle
];
const PALETTE = ["#E8714C", "#2BB6A3", "#E0A93B", "#7E6BE0", "#4FB477", "#4C8DE8", "#E0588A"];
const PLACEMENTS = [
  { doodle: 0,  top: "8%",  left: "9%",  size: 92,  dur: 7.5, delay: 0.0,  rot: -12 },
  { doodle: 2,  top: "5%",  left: "62%", size: 70,  dur: 9.0, delay: 1.1,  rot: 14 },
  { doodle: 1,  top: "22%", left: "74%", size: 120, dur: 8.0, delay: 0.5,  rot: 8 },
  { doodle: 9,  top: "33%", left: "3%",  size: 78,  dur: 6.5, delay: 1.8,  rot: 0 },
  { doodle: 3,  top: "63%", left: "70%", size: 128, dur: 9.5, delay: 0.3,  rot: -6 },
  { doodle: 5,  top: "70%", left: "10%", size: 84,  dur: 7.0, delay: 2.2,  rot: 10 },
  { doodle: 6,  top: "83%", left: "44%", size: 76,  dur: 8.5, delay: 1.4,  rot: -8 },
  { doodle: 4,  top: "88%", left: "76%", size: 90,  dur: 6.8, delay: 0.8,  rot: 6 },
  { doodle: 7,  top: "47%", left: "85%", size: 64,  dur: 10.0, delay: 2.6, rot: 0 },
  { doodle: 8,  top: "16%", left: "30%", size: 88,  dur: 8.2, delay: 3.0,  rot: 0 },
  { doodle: 10, top: "55%", left: "2%",  size: 96,  dur: 9.2, delay: 1.6,  rot: -4 },
  { doodle: 11, top: "78%", left: "30%", size: 60,  dur: 7.8, delay: 2.9,  rot: 12 },
];
const DOTS = [
  { top: "12%", left: "48%", c: 0, s: 9,  d: 0.0 },
  { top: "40%", left: "20%", c: 3, s: 7,  d: 1.2 },
  { top: "58%", left: "55%", c: 1, s: 11, d: 0.6 },
  { top: "73%", left: "62%", c: 2, s: 8,  d: 1.9 },
  { top: "30%", left: "55%", c: 6, s: 7,  d: 2.5 },
  { top: "92%", left: "16%", c: 5, s: 9,  d: 0.9 },
];

function DoodleLayer() {
  return (
    <div className="myra-login-doodles" aria-hidden="true">
      {PLACEMENTS.map((p, i) => (
        <svg
          key={i}
          className="doodle"
          viewBox="0 0 100 100"
          style={{
            top: p.top, left: p.left, width: p.size, height: p.size,
            "--rot": p.rot + "deg", "--dur": p.dur + "s", "--delay": p.delay + "s",
            color: PALETTE[i % PALETTE.length],
          }}
        >
          <path d={DOODLES[p.doodle]} pathLength="1" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ))}
      {DOTS.map((d, i) => (
        <span
          key={"dot" + i}
          className="doodle-dot"
          style={{ top: d.top, left: d.left, width: d.s, height: d.s, background: PALETTE[d.c], "--delay": d.d + "s" }}
        />
      ))}
    </div>
  );
}

// ── Typewriter headline ──────────────────────────────────────────────────────

const PHRASES = [
  "Your retrieval assistant.",
  "Quietly in the background.",
  "It reads. It drafts. It runs your day.",
  "Just ask — MyRA remembers.",
];

function Typewriter() {
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [txt, setTxt] = useState(reduce ? PHRASES[0] : "");
  const st = useRef({ p: 0, c: 0, del: false });

  useEffect(() => {
    if (reduce) return;
    let timer;
    const tick = () => {
      const s = st.current;
      const full = PHRASES[s.p];
      if (!s.del) {
        s.c++;
        setTxt(full.slice(0, s.c));
        if (s.c >= full.length) { s.del = true; timer = setTimeout(tick, 1500); return; }
        timer = setTimeout(tick, 52 + Math.random() * 40);
      } else {
        s.c--;
        setTxt(full.slice(0, s.c));
        if (s.c <= 0) { s.del = false; s.p = (s.p + 1) % PHRASES.length; timer = setTimeout(tick, 420); return; }
        timer = setTimeout(tick, 26);
      }
    };
    timer = setTimeout(tick, 700);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <h2 className="myra-login-type"><span>{txt}</span>{!reduce && <span className="cursor" />}</h2>
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
