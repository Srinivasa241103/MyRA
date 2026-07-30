import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  FileText,
  Mail,
  Mic,
  Paperclip,
  Send,
} from "lucide-react";
import { useAuthStore } from "../store/authStore";
import useSyncStore from "../store/syncStore";
import { homeApi } from "../api/home";
import { useChatStore } from "../store/chatStore";
import {
  DEFAULT_LLM_MODEL_ID,
  LLM_MODEL_OPTIONS,
  getLlmModelOption,
} from "../constants/llmModels";

const SUGGESTIONS = [
  "What did I miss overnight?",
  "Draft a reply to an important thread",
  "Find my notes from last week",
  "Free 45 minutes on my calendar",
];

const SOURCE_OPTIONS = [
  { id: "gmail", label: "Gmail", icon: <Mail size={13} strokeWidth={1.7} /> },
  { id: "calendar", label: "Calendar", icon: <CalendarDays size={13} strokeWidth={1.7} /> },
  { id: "notes", label: "Notes", icon: <FileText size={13} strokeWidth={1.7} /> },
];

function HomePage({ onNavigate }) {
  const { user } = useAuthStore();
  const { gmail, calendar } = useSyncStore();
  const { startNewChat } = useChatStore();
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const [draft, setDraft] = useState("");
  const [selectedModelId, setSelectedModelId] = useState(DEFAULT_LLM_MODEL_ID);
  const [selectedSources, setSelectedSources] = useState({
    gmail: true,
    calendar: true,
    notes: true,
  });
  const [attachedFile, setAttachedFile] = useState("");
  const [upcomingEvents, setUpcomingEvents] = useState(null);
  const [dailySummary, setDailySummary] = useState(null);

  useEffect(() => {
    let active = true;

    homeApi.getUpcomingEvents()
      .then((events) => {
        if (active) setUpcomingEvents(Array.isArray(events) ? events : []);
      })
      .catch(() => {
        if (active) setUpcomingEvents([]);
      });

    homeApi.getDailySummary()
      .then((summary) => {
        if (active) setDailySummary(summary || {});
      })
      .catch(() => {
        if (active) setDailySummary({});
      });

    return () => {
      active = false;
    };
  }, []);

  const selectedModelOption = getLlmModelOption(selectedModelId);
  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  }, []);
  const firstName = user?.user_name?.split(" ")[0] || user?.name?.split(" ")[0] || "there";
  const dateLabel = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const summaryRows = [
    {
      label: "Unread emails",
      value: dailySummary?.unreadEmails,
      note: "Messages waiting for review",
      tag: "Inbox",
    },
    {
      label: "Reminders due",
      value: dailySummary?.remindersDue,
      note: "Items that need attention",
      tag: "Action",
    },
    {
      label: "Meetings today",
      value: dailySummary?.meetings,
      note: "Events on your calendar",
      tag: "Today",
    },
  ];
  const hasSummaryData = summaryRows.some((row) => row.value !== null && row.value !== undefined);

  const sendPrompt = (prompt = draft) => {
    const text = prompt.trim();
    if (!text) return;
    startNewChat(text, selectedModelOption);
    onNavigate("chat");
  };

  const handleKeyDown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendPrompt();
    }
  };

  const toggleSource = (sourceId) => {
    setSelectedSources((current) => ({
      ...current,
      [sourceId]: !current[sourceId],
    }));
  };

  const sourceRows = [
    {
      id: "gmail",
      label: "Gmail",
      detail: user?.email || "No data yet",
      connected: Boolean(user),
      state: gmail,
    },
    {
      id: "calendar",
      label: "Google Calendar",
      detail: user?.email || "No data yet",
      connected: Boolean(user),
      state: calendar,
    },
  ];

  return (
    <div className="myra-page-inner myra-home-page">
      <header className="myra-page-opening">
        <h1 className="display">{greeting}, {firstName}.</h1>
        <p>
          {dateLabel}
          {dailySummary?.meetings != null ? ` | ${dailySummary.meetings} events today` : ""}
          {dailySummary?.unreadEmails != null ? ` | ${dailySummary.unreadEmails} unread` : ""}
        </p>
      </header>

      <section className="myra-card myra-home-composer-card myra-glow">
        <textarea
          ref={textareaRef}
          className="myra-home-prompt"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={'Ask MyRA anything - "what did I miss from an important thread?"'}
          rows={3}
        />

        <div className="myra-home-source-row" aria-label="Sources">
          {SOURCE_OPTIONS.map(({ id, label, icon }) => (
            <button
              key={id}
              className="myra-source-pill"
              aria-pressed={selectedSources[id]}
              onClick={() => toggleSource(id)}
              type="button"
            >
              {icon}
              {label}
            </button>
          ))}
          <button
            className="myra-source-pill"
            aria-pressed={Boolean(attachedFile)}
            onClick={() => fileInputRef.current?.click()}
            type="button"
            title={attachedFile || "Attach a file"}
          >
            <Paperclip size={13} strokeWidth={1.7} />
            {attachedFile || "Attachments"}
          </button>
          <input
            ref={fileInputRef}
            className="myra-visually-hidden"
            type="file"
            onChange={(event) => setAttachedFile(event.target.files?.[0]?.name || "")}
          />
        </div>

        <div className="myra-home-composer-footer">
          <label className="myra-model-select" aria-label="Select chat model">
            <select
              value={selectedModelId}
              onChange={(event) => setSelectedModelId(event.target.value)}
            >
              {LLM_MODEL_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.displayName}
                </option>
              ))}
            </select>
          </label>
          <span className="myra-composer-spacer" />
          <button className="myra-btn ghost icon sm" type="button" aria-label="Voice input">
            <Mic size={17} strokeWidth={1.7} />
          </button>
          <button
            className="myra-btn primary"
            disabled={!draft.trim()}
            onClick={() => sendPrompt()}
            type="button"
          >
            Ask MyRA
            <Send size={15} strokeWidth={1.8} />
          </button>
        </div>
      </section>

      <div className="myra-home-suggestions">
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            className="myra-source-pill"
            onClick={() => sendPrompt(suggestion)}
            type="button"
          >
            {suggestion}
          </button>
        ))}
      </div>

      <div className="myra-grid-home-split">
        <section className="myra-card myra-flat-card">
          <div className="myra-card-header">
            <h3>Daily summary</h3>
            <span className="muted">Live from connected data</span>
          </div>
          <div className="myra-card-rows">
            {dailySummary === null ? (
              <div className="myra-no-data-state">Loading summary...</div>
            ) : hasSummaryData ? (
              summaryRows.map((row) => (
                <div className="myra-data-row" key={row.label}>
                  <div className="myra-data-row-main">
                    <strong>{row.label}: {row.value ?? 0}</strong>
                    <span>{row.note}</span>
                  </div>
                  <span className="myra-badge warning">{row.tag}</span>
                </div>
              ))
            ) : (
              <div className="myra-no-data-state">No data yet</div>
            )}
          </div>
        </section>

        <section className="myra-card myra-flat-card">
          <div className="myra-card-header">
            <h3>Today</h3>
            <button className="myra-btn ghost sm" onClick={() => onNavigate("profile")}>
              Open calendar
            </button>
          </div>
          <div className="myra-card-rows">
            {upcomingEvents === null ? (
              <div className="myra-no-data-state">Loading calendar...</div>
            ) : upcomingEvents.length > 0 ? (
              upcomingEvents.map((event, index) => (
                <div className="myra-event-row" key={`${event.title}-${index}`}>
                  <span className="myra-event-time num">{event.time || "TBD"}</span>
                  <span className="myra-event-rule" />
                  <div className="myra-data-row-main">
                    <strong>{event.title || "Untitled event"}</strong>
                    <span>{event.where || "No location provided"}</span>
                  </div>
                </div>
              ))
            ) : (
              <div className="myra-no-data-state">No data yet</div>
            )}
          </div>
        </section>
      </div>

      <section className="myra-card myra-flat-card">
        <div className="myra-card-header">
          <h3>Connected sources</h3>
          <button className="myra-btn ghost sm" onClick={() => onNavigate("profile")}>
            Manage
            <ArrowRight size={14} strokeWidth={1.7} />
          </button>
        </div>
        <div className="myra-card-rows">
          {sourceRows.map((source) => {
            const hasError = source.connected && source.state.syncPhase === "error";
            const syncing = source.connected && source.state.isSyncing;
            return (
              <div className="myra-data-row" key={source.id}>
                <div className="myra-data-row-main">
                  <strong>{source.label}</strong>
                  <span>
                    {source.connected
                      ? `${source.detail} | No indexed count available yet`
                      : source.detail}
                  </span>
                </div>
                <span className={`myra-badge ${hasError ? "danger" : syncing ? "warning" : source.connected ? "success" : ""}`}>
                  {hasError ? "Sync failed" : syncing ? "Syncing" : source.connected ? "Connected" : "Not connected"}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <footer className="myra-home-footer">
        <a href="/privacy" onClick={(event) => { event.preventDefault(); onNavigate("privacy"); }}>
          Privacy Policy
        </a>
        <a href="/terms" onClick={(event) => { event.preventDefault(); onNavigate("terms"); }}>
          Terms of Service
        </a>
        <span>MyRA</span>
      </footer>
    </div>
  );
}

export default HomePage;
