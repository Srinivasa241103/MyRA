import { useRef, useState, useEffect } from "react";
import { useAuthStore } from "../store/authStore";
import useSyncStore from "../store/syncStore";
import { homeApi, DUMMY as HOME_DUMMY } from "../api/home";
import { useChatStore } from "../store/chatStore";
import { DEFAULT_LLM_MODEL_ID, LLM_MODEL_OPTIONS, getLlmModelOption } from "../constants/llmModels";

const SUGGESTIONS = [
  { icon: "mail",     title: "What's important in my inbox today?", sub: "Triage unread emails" },
  { icon: "calendar", title: "Reschedule my Friday block",          sub: "Move to next week" },
  { icon: "file",     title: "Summarize last week's notes",         sub: "Across recent docs" },
  { icon: "sparkles", title: "Draft a thank-you note",              sub: "For the team" },
];

function HomePage({ onNavigate }) {
  const { user } = useAuthStore();
  const { gmail, calendar } = useSyncStore();
  const { startNewChat } = useChatStore();
  const textareaRef = useRef(null);
  const [selectedModelId, setSelectedModelId] = useState(DEFAULT_LLM_MODEL_ID);
  const [upcomingEvents, setUpcomingEvents] = useState(HOME_DUMMY.upcomingEvents);
  const [dailySummary, setDailySummary] = useState(HOME_DUMMY.dailySummary);
  const selectedModelOption = getLlmModelOption(selectedModelId);

  useEffect(() => {
    homeApi.getUpcomingEvents().then(setUpcomingEvents).catch(() => {});
    homeApi.getDailySummary().then(setDailySummary).catch(() => {});
  }, []);

  const greeting = (() => {
    const h = new Date().getHours();
    return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  })();

  const firstName = user?.name?.split(" ")[0] || "there";

  const handleSend = () => {
    const text = textareaRef.current?.value?.trim();
    if (!text) return;
    startNewChat(text, selectedModelOption);
    onNavigate("chat");
  };

  const handleSuggestionClick = (text) => {
    startNewChat(text, selectedModelOption);
    onNavigate("chat");
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const connectedSources = [
    {
      id: "gmail", name: "Gmail",
      docs: "—", sync: "—",
      status: gmail.syncPhase === "error" ? "warning" : "success",
      statusLabel: gmail.isSyncing ? "syncing" : gmail.syncPhase === "complete" ? "connected" : "connected",
    },
    {
      id: "calendar", name: "Google Calendar",
      docs: "—", sync: "—",
      status: calendar.syncPhase === "error" ? "warning" : "success",
      statusLabel: calendar.isSyncing ? "syncing" : calendar.syncPhase === "complete" ? "connected" : "connected",
    },
  ];

  return (
    <div className="myra-page-inner" style={{ paddingTop: 40, paddingBottom: 40 }}>

      {/* ── Heading ── */}
      <div style={{ marginBottom: 36 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
          <div className="myra-label">{greeting}, {firstName}</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <a
              className="myra-btn ghost sm"
              href="/privacy"
              onClick={(event) => {
                event.preventDefault();
                onNavigate("privacy");
              }}
            >
              Privacy Policy
            </a>
            <a
              className="myra-btn ghost sm"
              href="/terms"
              onClick={(event) => {
                event.preventDefault();
                onNavigate("terms");
              }}
            >
              Terms
            </a>
          </div>
        </div>
        <h1 className="display xl" style={{ marginBottom: 10 }}>
          What can I retrieve for you today?
        </h1>
        <p className="muted" style={{ fontSize: 15, maxWidth: 540 }}>
          Across {connectedSources.length} connected sources — ask anything about your inbox, calendar, or notes.
        </p>
      </div>

      {/* ── Composer ── */}
      <div className="myra-card" style={{ padding: 16, marginBottom: 28 }}>
        <div className="myra-home-composer">
          <textarea
            ref={textareaRef}
            className="myra-input"
            placeholder="Ask MyRA anything — your inbox, calendar, notes…"
            style={{ minHeight: 56, padding: 12, flex: 1, resize: "none" }}
            onKeyDown={handleKeyDown}
          />
          <button
            className="myra-btn primary"
            style={{ height: 56, alignSelf: "stretch", paddingLeft: 20, paddingRight: 20, gap: 8 }}
            onClick={handleSend}
          >
            <SendIcon /> Ask
          </button>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <span className="myra-source-pill"><span className="dot" />Use all sources</span>
          <label className="myra-model-select" aria-label="Select chat model">
            <SparklesIcon />
            <select
              value={selectedModelId}
              onChange={(event) => setSelectedModelId(event.target.value)}
            >
              {LLM_MODEL_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label} - {option.detail}
                </option>
              ))}
            </select>
          </label>
          <span className="myra-source-pill"><MailIconTiny />Gmail</span>
          <span className="myra-source-pill"><CalendarIconTiny />Calendar</span>
          <span className="myra-source-pill"><FileIconTiny />Notes</span>
          <span className="myra-source-pill"><PaperclipIcon />Attach</span>
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
          MyRA uses connected Google data only to provide your requested assistant features.{" "}
          <a
            href="/privacy"
            onClick={(event) => {
              event.preventDefault();
              onNavigate("privacy");
            }}
          >
            Read the Privacy Policy
          </a>{" "}
          and{" "}
          <a
            href="/terms"
            onClick={(event) => {
              event.preventDefault();
              onNavigate("terms");
            }}
          >
            Terms of Service
          </a>.
        </p>
      </div>

      {/* ── Suggestions ── */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 }}>
          <h2 className="h3">Suggestions</h2>
          <button className="myra-btn ghost sm" style={{ gap: 6 }}>
            Refresh <SparklesIcon />
          </button>
        </div>
        <div className="myra-grid-suggestions">
          {SUGGESTIONS.map((s, i) => (
            <button
              key={i}
              className="myra-suggestion-card"
              style={{ border: "1px solid var(--border)" }}
              onClick={() => handleSuggestionClick(s.title)}
            >
              <div className="icon">
                {s.icon === "mail"     && <MailIconMed />}
                {s.icon === "calendar" && <CalendarIconMed />}
                {s.icon === "file"     && <FileIconMed />}
                {s.icon === "sparkles" && <SparklesIconMed />}
              </div>
              <h4>{s.title}</h4>
              <p>{s.sub}</p>
            </button>
          ))}
        </div>
      </div>

      {/* ── Today at a glance + Connected sources ── */}
      <div className="myra-grid-home-split">

        {/* Today at a glance */}
        <div className="myra-card">
          <div className="myra-card-header">
            <h3>Today at a glance</h3>
            <button className="myra-btn ghost sm" onClick={() => onNavigate("stats")}>
              See stats <ArrowRightIcon />
            </button>
          </div>

          {/* KPI tiles */}
          <div className="myra-grid-kpi-3" style={{ marginBottom: 16 }}>
            {[
              { label: "Unread emails", value: dailySummary.unreadEmails ?? "—", delta: dailySummary.unreadEmails == null ? "Sync to load" : "" },
              { label: "Reminders due", value: dailySummary.remindersDue ?? "—", delta: "" },
              { label: "Meetings",      value: dailySummary.meetings ?? "—",      delta: "" },
            ].map((k, i) => (
              <div
                key={i}
                style={{ background: "var(--bg-2)", borderRadius: "var(--radius-md)", padding: "12px 14px" }}
              >
                <div className="myra-label" style={{ marginBottom: 4 }}>{k.label}</div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 700, color: "var(--text-2)" }}>{k.value}</div>
                {k.delta && <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>{k.delta}</div>}
              </div>
            ))}
          </div>

          <div className="myra-divider" style={{ margin: "8px 0 16px" }} />

          <div className="myra-label" style={{ marginBottom: 10 }}>Upcoming</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {upcomingEvents.map((ev, i) => (
              <div key={i} style={{ display: "flex", gap: 12, alignItems: "center", padding: "6px 0" }}>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--accent)", width: 84, fontWeight: 500 }}>{ev.time}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: "var(--text-2)", fontWeight: 500 }}>{ev.title}</div>
                  <div className="muted" style={{ fontSize: 11 }}>{ev.where}</div>
                </div>
                <ArrowRightIcon />
              </div>
            ))}
          </div>
        </div>

        {/* Connected sources */}
        <div className="myra-card">
          <div className="myra-card-header">
            <h3>Connected sources</h3>
            <button className="myra-btn ghost sm" onClick={() => onNavigate("profile")}>
              Manage
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {connectedSources.map((s) => (
              <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 0" }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: "var(--parchment)", display: "grid", placeItems: "center", color: "var(--accent)", flexShrink: 0 }}>
                  {s.id === "gmail" ? <MailIconMed /> : <CalendarIconMed />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-2)" }}>{s.name}</div>
                  <div className="muted" style={{ fontSize: 11 }}>{s.docs} docs · {s.sync}</div>
                </div>
                <span className={"myra-badge " + s.status}>{s.statusLabel}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Icons ────────────────────────────────────────────────────────────────────
const svgBase = { fill: "none", stroke: "currentColor", strokeWidth: "1.8", strokeLinecap: "round", strokeLinejoin: "round" };

function SendIcon() {
  return <svg width={15} height={15} viewBox="0 0 24 24" {...svgBase}><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>;
}
function SparklesIcon() {
  return <svg width={12} height={12} viewBox="0 0 24 24" {...svgBase}><path d="M12 3v4M12 17v4M3 12h4M17 12h4"/><path d="m6 6 2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/></svg>;
}
function ArrowRightIcon() {
  return <svg width={14} height={14} viewBox="0 0 24 24" {...svgBase} style={{ color: "var(--text-muted)", flexShrink: 0 }}><path d="M5 12h14M13 5l7 7-7 7"/></svg>;
}

function MailIconTiny()     { return <svg width={12} height={12} viewBox="0 0 24 24" {...svgBase}><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7l-10 7L2 7"/></svg>; }
function CalendarIconTiny() { return <svg width={12} height={12} viewBox="0 0 24 24" {...svgBase}><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>; }
function FileIconTiny()     { return <svg width={12} height={12} viewBox="0 0 24 24" {...svgBase}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>; }
function PaperclipIcon()    { return <svg width={12} height={12} viewBox="0 0 24 24" {...svgBase}><path d="m21 12-9 9a5 5 0 0 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8-8"/></svg>; }

function MailIconMed()     { return <svg width={18} height={18} viewBox="0 0 24 24" {...svgBase}><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7l-10 7L2 7"/></svg>; }
function CalendarIconMed() { return <svg width={18} height={18} viewBox="0 0 24 24" {...svgBase}><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>; }
function FileIconMed()     { return <svg width={18} height={18} viewBox="0 0 24 24" {...svgBase}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>; }
function SparklesIconMed() { return <svg width={18} height={18} viewBox="0 0 24 24" {...svgBase}><path d="M12 3v4M12 17v4M3 12h4M17 12h4"/><path d="m6 6 2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/></svg>; }

export default HomePage;
