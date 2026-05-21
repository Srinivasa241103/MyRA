import { useEffect, useRef, useState } from "react";
import TypingIndicator from "./TypingIndicator";
import { useChatStore } from "../../store/chatStore";
import { useAuthStore } from "../../store/authStore";

// ── ChatWindow — exact MyRA design replica ───────────────────────────────────

function ChatWindow({ onNavigate, onToggleSidebar }) {
  const { messages, isTyping, sendMessage, pendingConfirmation, confirmAction, conversationId, clearPendingMessage } = useChatStore();
  const { user } = useAuthStore();
  const [draft, setDraft] = useState("");
  const scrollRef = useRef(null);
  const textareaRef = useRef(null);

  // Send any message queued from the home page
  useEffect(() => {
    const { pendingMessage } = useChatStore.getState();
    if (pendingMessage) {
      clearPendingMessage();
      sendMessage(pendingMessage);
    }
  }, []);

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  const handleSend = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    sendMessage(text);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e) => {
    const t = e.target;
    t.style.height = "auto";
    t.style.height = Math.min(t.scrollHeight, 120) + "px";
    setDraft(t.value);
  };

  const getInitials = (name) => {
    if (!name) return "U";
    return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
  };

  const todayLabel = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  // ── Empty state ────────────────────────────────────────────────────────────
  if (messages.length === 0) {
    return (
      <div className="myra-chat-main">
        {/* Topbar */}
        <div className="myra-chat-topbar">
          <div className="row gap-3" style={{ alignItems: "center" }}>
            {onToggleSidebar && (
              <button className="myra-btn ghost icon sm" onClick={onToggleSidebar} aria-label="Toggle sidebar">
                <SidebarIcon />
              </button>
            )}
            <button className="myra-btn ghost sm" onClick={() => onNavigate?.("home")} aria-label="Home">
              <HomeIcon /><span className="myra-btn-text">Home</span>
            </button>
            <div className="col" style={{ gap: 1 }}>
              <strong style={{ fontSize: 14, color: "var(--text-2)" }}>New chat</strong>
              <span className="muted" style={{ fontSize: 11 }}>Ask anything about your inbox, calendar, or notes</span>
            </div>
          </div>
          <div className="row gap-2" style={{ alignItems: "center" }}>
            <button
              className="myra-avatar sm"
              onClick={() => onNavigate?.("profile")}
              aria-label="Profile"
            >
              {user?.picture
                ? <img src={user.picture} alt={user?.name || "Profile"} style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%" }} />
                : getInitials(user?.name)}
            </button>
          </div>
        </div>

        {/* Empty state body */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px 24px" }}>
          <div style={{
            width: 60, height: 60, borderRadius: "50%",
            background: "var(--parchment)", border: "2px solid var(--border-strong)",
            display: "grid", placeItems: "center", marginBottom: 20, color: "var(--accent)",
          }}>
            <MyraMarkIcon size={28} />
          </div>
          <h2 style={{ fontSize: 22, fontWeight: 600, color: "var(--text-2)", marginBottom: 8, textAlign: "center" }}>
            How can I help you today?
          </h2>
          <p className="muted" style={{ fontSize: 14, textAlign: "center", marginBottom: 32, maxWidth: 420 }}>
            Ask me about your emails, schedule, or anything else.
          </p>

          {/* Suggestion chips */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", marginBottom: 32, maxWidth: 560 }}>
            {QUICK_SUGGESTIONS.map((s, i) => (
              <button
                key={i}
                className="myra-source-pill"
                style={{ height: 32, padding: "0 14px", cursor: "pointer", fontSize: 13, color: "var(--text-2)" }}
                onClick={() => { setDraft(s); textareaRef.current?.focus(); }}
              >
                {s}
              </button>
            ))}
          </div>

          {/* Inline composer */}
          <div style={{ width: "100%", maxWidth: 680 }}>
            <Composer
              draft={draft}
              setDraft={setDraft}
              textareaRef={textareaRef}
              onSend={handleSend}
              onKeyDown={handleKeyDown}
              onInput={handleInput}
              pendingConfirmation={pendingConfirmation}
              onConfirm={() => confirmAction("confirmed")}
              onReject={() => confirmAction("rejected")}
            />
          </div>
        </div>
      </div>
    );
  }

  // ── Active chat ────────────────────────────────────────────────────────────
  const firstMsg = messages[0];
  const chatTitle = firstMsg?.text?.slice(0, 48) + (firstMsg?.text?.length > 48 ? "…" : "") || "Conversation";

  return (
    <div className="myra-chat-main">
      {/* Topbar */}
      <div className="myra-chat-topbar">
        <div className="row gap-3" style={{ alignItems: "center" }}>
          {onToggleSidebar && (
            <button className="myra-btn ghost icon sm" onClick={onToggleSidebar} aria-label="Toggle sidebar">
              <SidebarIcon />
            </button>
          )}
          <button className="myra-btn ghost sm" onClick={() => onNavigate?.("home")} aria-label="Home">
            <HomeIcon /><span className="myra-btn-text">Home</span>
          </button>
          <div className="col" style={{ gap: 1 }}>
            <strong style={{ fontSize: 14, color: "var(--text-2)" }}>{chatTitle}</strong>
            <span className="muted" style={{ fontSize: 11 }}>
              {messages.length} message{messages.length !== 1 ? "s" : ""} · today
            </span>
          </div>
        </div>
        <div className="row gap-2" style={{ alignItems: "center" }}>
          <button className="myra-btn secondary sm myra-chat-topbar-hide-sm">
            <EditIcon /> Rename
          </button>
          <button className="myra-btn ghost sm icon myra-chat-topbar-hide-sm" aria-label="Delete chat">
            <TrashIcon />
          </button>
          <button
            className="myra-avatar sm"
            onClick={() => onNavigate?.("profile")}
            aria-label="Profile"
          >
            {user?.picture
              ? <img src={user.picture} alt={user?.name || "Profile"} style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%" }} />
              : getInitials(user?.name)}
          </button>
        </div>
      </div>

      {/* Messages scroll area */}
      <div className="myra-chat-scroll" ref={scrollRef}>
        <div className="myra-chat-scroll-inner">
          {/* Date system bubble */}
          <div className="myra-bubble system">{todayLabel}</div>

          {messages.map((msg, idx) => (
            <MessageTurn key={idx} msg={msg} setDraft={setDraft} />
          ))}

          {isTyping && (
            <div style={{ alignSelf: "flex-start" }}>
              <TypingIndicator />
            </div>
          )}
        </div>
      </div>

      {/* Composer */}
      <Composer
        draft={draft}
        setDraft={setDraft}
        textareaRef={textareaRef}
        onSend={handleSend}
        onKeyDown={handleKeyDown}
        onInput={handleInput}
        pendingConfirmation={pendingConfirmation}
        onConfirm={() => confirmAction("confirmed")}
        onReject={() => confirmAction("rejected")}
      />
    </div>
  );
}

// ── MessageTurn — renders one user or AI bubble ──────────────────────────────

function MessageTurn({ msg, setDraft }) {
  const isUser = msg.role === "user";

  if (isUser) {
    return (
      <div className="myra-bubble user myra-fade-in">
        {msg.text}
      </div>
    );
  }

  // Email agent: draft approval card
  if (msg.mode === "email_agent" && msg.emailResponse?.type === "draft_approval") {
    return <DraftApprovalCard data={msg.emailResponse} setDraft={setDraft} />;
  }

  return (
    <div className="myra-bubble assistant myra-fade-in" style={msg.isError ? { borderColor: "rgba(160,48,48,.3)", background: "rgba(160,48,48,.06)" } : {}}>
      {msg.text && <div style={{ whiteSpace: "pre-wrap" }}>{msg.text}</div>}

      {/* Source pills */}
      {msg.mode !== "agent" && msg.mode !== "email_agent" && msg.context?.selectedDocuments > 0 && (
        <div className="src-row" style={{ marginTop: 10 }}>
          <span className="myra-source-pill">
            <span className="dot" />
            {msg.context.selectedDocuments} document{msg.context.selectedDocuments !== 1 ? "s" : ""}
          </span>
        </div>
      )}

      {/* Agent mode badges */}
      {msg.mode === "agent" && (
        <div style={{ marginTop: 8 }}>
          <span className="myra-badge accent">
            <CalendarSmIcon /> Calendar Agent
          </span>
        </div>
      )}
      {msg.mode === "email_agent" && (
        <div style={{ marginTop: 8 }}>
          <span className="myra-badge accent" style={{ background: "rgba(59,130,246,.12)", color: "#2563eb" }}>
            <MailSmIcon /> Email Agent
          </span>
        </div>
      )}
    </div>
  );
}

// ── DraftApprovalCard — rendered when email agent returns a draft ─────────────

function DraftApprovalCard({ data, setDraft }) {
  const { sendMessage } = useChatStore();
  const { draft, meta, instructions } = data;

  const cardStyle = {
    border: "1px solid var(--border-strong)",
    borderRadius: 10,
    overflow: "hidden",
    background: "var(--bg-2)",
    marginBottom: 4,
  };
  const headerStyle = {
    padding: "10px 14px",
    borderBottom: "1px solid var(--border)",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    background: "var(--parchment)",
  };
  const bodyStyle = {
    padding: "12px 14px",
    fontSize: 13,
    lineHeight: 1.6,
    color: "var(--text-2)",
    whiteSpace: "pre-wrap",
    maxHeight: 260,
    overflowY: "auto",
  };
  const metaStyle = {
    padding: "8px 14px",
    borderTop: "1px solid var(--border)",
    fontSize: 12,
    color: "var(--text-muted)",
    background: "var(--bg-1)",
  };
  const actionsStyle = {
    padding: "10px 14px",
    borderTop: "1px solid var(--border)",
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    background: "var(--bg-1)",
  };

  return (
    <div className="myra-fade-in" style={{ alignSelf: "flex-start", width: "100%", maxWidth: 580 }}>
      <div style={cardStyle}>
        {/* Header */}
        <div style={headerStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <MailSmIcon />
            <span style={{ fontWeight: 600, fontSize: 13, color: "var(--text-2)" }}>
              {draft.subject || "Draft"}
            </span>
          </div>
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
            v{draft.version} · {draft.source}
          </span>
        </div>

        {/* Body */}
        <div style={bodyStyle}>{draft.body}</div>

        {/* Meta row */}
        <div style={metaStyle}>
          {meta.to && <span>To: <strong>{meta.to}</strong></span>}
          {meta.cc && <span style={{ marginLeft: 12 }}>CC: {meta.cc}</span>}
          <span style={{ marginLeft: 12 }}>Tone: {meta.tone}</span>
          {meta.totalVersions > 1 && <span style={{ marginLeft: 12 }}>{meta.totalVersions} versions</span>}
        </div>

        {/* Action buttons */}
        <div style={actionsStyle}>
          <button
            className="myra-btn primary sm"
            onClick={() => sendMessage("approve")}
          >
            <CheckIcon /> Approve
          </button>
          <button
            className="myra-btn secondary sm"
            onClick={() => { setDraft("Edit: "); }}
          >
            <EditIcon /> Edit
          </button>
          <button
            className="myra-btn secondary sm"
            onClick={() => sendMessage("regenerate")}
          >
            <RefreshIcon /> Regenerate
          </button>
          <button
            className="myra-btn ghost sm"
            onClick={() => sendMessage("cancel")}
            style={{ color: "var(--text-muted)" }}
          >
            <XIcon /> Cancel
          </button>
        </div>
      </div>

      {/* Instructions hint */}
      {instructions && (
        <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4, paddingLeft: 4 }}>
          {instructions}
        </p>
      )}

      <div style={{ marginTop: 6 }}>
        <span className="myra-badge accent" style={{ background: "rgba(59,130,246,.12)", color: "#2563eb" }}>
          <MailSmIcon /> Email Agent
        </span>
      </div>
    </div>
  );
}

// ── Composer — the input area at bottom ─────────────────────────────────────

function Composer({ draft, setDraft, textareaRef, onSend, onKeyDown, onInput, pendingConfirmation, onConfirm, onReject }) {
  if (pendingConfirmation) {
    return (
      <div className="myra-composer">
        <div className="myra-composer-inner">
          <div className="myra-confirm-card">
            <p>Shall I go ahead and create this event?</p>
            <div className="myra-confirm-actions">
              <button className="myra-btn primary sm" onClick={onConfirm}>
                <CheckIcon /> Yes, create it
              </button>
              <button className="myra-btn secondary sm" onClick={onReject}>
                <XIcon /> Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="myra-composer">
      <div className="myra-composer-inner">
        {/* Main input box */}
        <div className="myra-composer-box">
          <button className="myra-btn ghost icon sm" aria-label="Attach file">
            <PaperclipIcon />
          </button>
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onInput={onInput}
            onKeyDown={onKeyDown}
            placeholder="Ask MyRA…"
            rows={1}
            style={{ minHeight: "24px" }}
          />
          <div className="myra-composer-tools">
            <button className="myra-btn ghost icon sm" aria-label="Voice input">
              <MicIcon />
            </button>
            <button
              className={"myra-btn icon sm" + (draft.trim() ? " primary" : "")}
              style={!draft.trim() ? { background: "var(--bg-3)", color: "var(--text-muted)", cursor: "not-allowed" } : {}}
              onClick={onSend}
              disabled={!draft.trim()}
              aria-label="Send"
            >
              <SendIcon />
            </button>
          </div>
        </div>

        {/* Hint row */}
        <div className="myra-composer-hint">
          <div className="myra-composer-hint-pills">
            <span className="myra-source-pill" style={{ cursor: "default" }}>
              <span className="dot" />All sources
            </span>
            <span className="myra-source-pill myra-source-pill--model" style={{ cursor: "default" }}>
              <SparklesSmIcon /><span className="myra-source-pill-label">Claude Haiku 4.5</span>
            </span>
          </div>
          <span className="myra-composer-hint-text">Enter to send · Shift+Enter newline</span>
        </div>
      </div>
    </div>
  );
}

// ── Quick suggestions for empty state ────────────────────────────────────────
const QUICK_SUGGESTIONS = [
  "What's important in my inbox today?",
  "What's on my calendar this week?",
  "Summarize my recent notes",
  "Draft a reply to my latest email",
];

// ── Icons ────────────────────────────────────────────────────────────────────
const IC = { fill: "none", stroke: "currentColor", strokeWidth: "1.8", strokeLinecap: "round", strokeLinejoin: "round" };

function SidebarIcon() {
  return <svg width={16} height={16} viewBox="0 0 24 24" {...IC}><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/></svg>;
}
function EditIcon() {
  return <svg width={14} height={14} viewBox="0 0 24 24" {...IC}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.1 2.1 0 1 1 3 3L12 15l-4 1 1-4z"/></svg>;
}
function TrashIcon() {
  return <svg width={14} height={14} viewBox="0 0 24 24" {...IC}><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>;
}
function PaperclipIcon() {
  return <svg width={16} height={16} viewBox="0 0 24 24" {...IC}><path d="m21 12-9 9a5 5 0 0 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8-8"/></svg>;
}
function MicIcon() {
  return <svg width={16} height={16} viewBox="0 0 24 24" {...IC}><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10a7 7 0 0 1-14 0M12 19v3"/></svg>;
}
function SendIcon() {
  return <svg width={14} height={14} viewBox="0 0 24 24" {...IC}><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>;
}
function CheckIcon() {
  return <svg width={13} height={13} viewBox="0 0 24 24" {...IC} strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>;
}
function XIcon() {
  return <svg width={13} height={13} viewBox="0 0 24 24" {...IC} strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
}
function CalendarSmIcon() {
  return <svg width={10} height={10} viewBox="0 0 24 24" {...IC}><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>;
}
function MailSmIcon() {
  return <svg width={11} height={11} viewBox="0 0 24 24" {...IC}><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 7 10-7"/></svg>;
}
function RefreshIcon() {
  return <svg width={13} height={13} viewBox="0 0 24 24" {...IC}><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>;
}
function SparklesSmIcon() {
  return <svg width={12} height={12} viewBox="0 0 24 24" {...IC}><path d="M12 3v4M12 17v4M3 12h4M17 12h4"/><path d="m6 6 2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/></svg>;
}
function HomeIcon() {
  return <svg width={14} height={14} viewBox="0 0 24 24" {...IC}><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>;
}
function MyraMarkIcon({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 19V6l7 9 7-9v13" />
      <circle cx="12" cy="20.5" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

export default ChatWindow;
