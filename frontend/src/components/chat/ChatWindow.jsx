import { useEffect, useRef, useState, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import TypingIndicator from "./TypingIndicator";
import { useChatStore } from "../../store/chatStore";
import { useAuthStore } from "../../store/authStore";
import { useVoiceRecorder } from "../../hooks/useVoiceRecorder";
import { DEFAULT_LLM_MODEL_ID, LLM_MODEL_OPTIONS, getLlmModelOption } from "../../constants/llmModels";
import {
  CalendarDays,
  Check,
  Mail,
  Mic,
  Moon,
  PanelLeft,
  Paperclip,
  Pause,
  Pencil,
  Play,
  RefreshCw,
  Send,
  Sparkles,
  Sun,
  Trash2,
  X,
} from "lucide-react";

// ── ChatWindow — exact MyRA design replica ───────────────────────────────────

function ChatWindow({ onNavigate, onToggleSidebar, theme = "light", onThemeChange = () => {} }) {
  const {
    messages,
    isTyping,
    conversationId,
    sendMessage,
    sendVoiceMessage,
    pendingConfirmation,
    confirmAction,
    clearPendingMessage,
    agentActive,
    deleteConversation,
  } = useChatStore();
  const { user } = useAuthStore();
  const [draft, setDraft] = useState("");
  const [selectedModelId, setSelectedModelId] = useState(DEFAULT_LLM_MODEL_ID);
  const [voiceError, setVoiceError] = useState(null);
  const [isDeletingChat, setIsDeletingChat] = useState(false);
  const {
    isSupported: voiceSupported,
    isRecording: voiceRecording,
    durationMs: voiceDurationMs,
    startRecording: startVoiceRecording,
    stopRecording: stopVoiceRecording,
  } = useVoiceRecorder();
  const scrollRef = useRef(null);
  const textareaRef = useRef(null);
  const firstName = user?.name?.split(" ")[0] || "there";
  const [displayTagline, setDisplayTagline] = useState("");
  const tagline = useMemo(() => {
    return TAGLINES[Math.floor(Math.random() * TAGLINES.length)];
  }, []);
  const selectedModelOption = useMemo(() => getLlmModelOption(selectedModelId), [selectedModelId]);

  // Send any message queued from the home page
  useEffect(() => {
    const { pendingMessage, pendingModelSelection } = useChatStore.getState();
    if (pendingMessage) {
      clearPendingMessage();
      if (pendingModelSelection?.id) {
        setSelectedModelId(pendingModelSelection.id);
      }
      sendMessage(pendingMessage, null, pendingModelSelection ?? selectedModelOption);
    }
  }, [clearPendingMessage, selectedModelOption, sendMessage]);

  useEffect(() => {
    let index = 0;

    const timer = setInterval(() => {
      setDisplayTagline(tagline.slice(0, index + 1));
      index++;

      if (index >= tagline.length) {
        clearInterval(timer);
      }
    }, 35);

    return () => clearInterval(timer);
  }, [tagline]);

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
    sendMessage(text, null, selectedModelOption);
  };

  const handleDeleteChat = async () => {
    if (isDeletingChat) return;
    setIsDeletingChat(true);
    try {
      await deleteConversation(conversationId);
    } finally {
      setIsDeletingChat(false);
    }
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

  const handleVoiceToggle = () => {
    if (voiceRecording) {
      stopVoiceRecording();
      return;
    }

    setVoiceError(null);

    startVoiceRecording({ maxDurationMs: 30000 })
      .then((recording) => {
        if (recording?.blob) {
          sendVoiceMessage(recording);
        }
      })
      .catch((error) => {
        setVoiceError(error.message || "Could not record audio.");
      });
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
            <div className="col" style={{ gap: 1 }}>
              <strong style={{ fontSize: 14, color: "var(--text-2)" }}>New chat</strong>
              <span className="muted" style={{ fontSize: 11 }}>Ask anything about your inbox, calendar, or notes</span>
            </div>
          </div>
          <div className="row gap-2" style={{ alignItems: "center" }}>
            <span className="myra-badge model-badge">{selectedModelOption.displayName}</span>
            <button
              className="myra-btn ghost icon sm"
              onClick={() => onThemeChange(theme === "dark" ? "light" : "dark")}
              aria-label={theme === "dark" ? "Use light theme" : "Use dark theme"}
            >
              {theme === "dark"
                ? <Sun size={17} strokeWidth={1.7} />
                : <Moon size={17} strokeWidth={1.7} />}
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

        {/* Empty state body */}
        <div className="myra-chat-empty myra-glow">
          <div className="myra-chat-empty-mark">M</div>
          <h1 className="display">A new conversation</h1>
          <p>
            Hi, {firstName}. {displayTagline}
            <span className="typing-cursor">|</span>
          </p>

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
              voiceSupported={voiceSupported}
              voiceRecording={voiceRecording}
              voiceDurationMs={voiceDurationMs}
              voiceError={voiceError}
              onVoiceToggle={handleVoiceToggle}
              selectedModelId={selectedModelId}
              onModelChange={setSelectedModelId}
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
          <div className="col" style={{ gap: 1 }}>
            <strong style={{ fontSize: 14, color: "var(--text-2)" }}>{chatTitle}</strong>
            <span className="muted" style={{ fontSize: 11 }}>
              {messages.length} message{messages.length !== 1 ? "s" : ""} · today
            </span>
          </div>
        </div>
          <div className="row gap-2" style={{ alignItems: "center" }}>
          <span className="myra-badge model-badge">{selectedModelOption.displayName}</span>
          <button
            className="myra-btn ghost icon sm"
            onClick={() => onThemeChange(theme === "dark" ? "light" : "dark")}
            aria-label={theme === "dark" ? "Use light theme" : "Use dark theme"}
          >
            {theme === "dark"
              ? <Sun size={17} strokeWidth={1.7} />
              : <Moon size={17} strokeWidth={1.7} />}
          </button>
          <button className="myra-btn secondary sm myra-chat-topbar-hide-sm">
            <EditIcon /> Rename
          </button>
          <button
            className="myra-btn ghost sm icon myra-chat-topbar-hide-sm"
            aria-label={isDeletingChat ? "Deleting chat" : "Delete chat"}
            onClick={handleDeleteChat}
            disabled={isDeletingChat || isTyping}
          >
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

          {(() => {
            const interactiveTypes = ["recipient_choice", "draft_approval", "pending_send"];
            const lastInteractiveIdx = messages.reduce((last, m, i) =>
              (m.mode === "email_agent" && interactiveTypes.includes(m.emailResponse?.type)) ? i : last, -1);
            return messages.map((msg, idx) => {
              const readonly = (msg.isHistorical && !agentActive) ||
                (msg.mode === "email_agent" && interactiveTypes.includes(msg.emailResponse?.type) && idx !== lastInteractiveIdx);
              return <MessageTurn key={idx} msg={msg} setDraft={setDraft} readonly={readonly} />;
            });
          })()}

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
        voiceSupported={voiceSupported}
        voiceRecording={voiceRecording}
        voiceDurationMs={voiceDurationMs}
        voiceError={voiceError}
        onVoiceToggle={handleVoiceToggle}
        selectedModelId={selectedModelId}
        onModelChange={setSelectedModelId}
      />
    </div>
  );
}

// ── MessageTurn — renders one user or AI bubble ──────────────────────────────

function MessageTurn({ msg, setDraft, readonly = false }) {
  const isUser = msg.role === "user";

  if (isUser) {
    if (msg.type === "audio") {
      return <AudioMessageBubble msg={msg} />;
    }

    return (
      <div className="myra-bubble user myra-fade-in">
        {msg.text}
      </div>
    );
  }

  // Email agent: draft approval card
  if (msg.mode === "email_agent" && msg.emailResponse?.type === "recipient_choice") {
    return <RecipientChoiceCard data={msg.emailResponse} readonly={readonly} />;
  }

  if (msg.mode === "email_agent" && msg.emailResponse?.type === "draft_approval") {
    return <DraftApprovalCard data={msg.emailResponse} setDraft={setDraft} readonly={readonly} />;
  }

  if (msg.mode === "email_agent" && msg.emailResponse?.type === "pending_send") {
    return <PendingSendCard data={msg.emailResponse} readonly={readonly} />;
  }

  return (
    <div className={"myra-bubble assistant myra-fade-in" + (msg.isError ? " error" : "")}>
      {msg.text && (
        <div className="myra-markdown">
          <ReactMarkdown>{msg.text}</ReactMarkdown>
        </div>
      )}

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
          <span className="myra-badge warning">
            <MailSmIcon /> Email Agent
          </span>
        </div>
      )}
    </div>
  );
}

function AudioMessageBubble({ msg }) {
  const audioRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;

    const handleTimeUpdate = () => {
      if (!audio.duration) return;
      setProgress(audio.currentTime / audio.duration);
    };
    const handleEnded = () => {
      setIsPlaying(false);
      setProgress(0);
    };

    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("ended", handleEnded);
    return () => {
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("ended", handleEnded);
    };
  }, []);

  const togglePlayback = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (audio.paused) {
      audio.play();
      setIsPlaying(true);
    } else {
      audio.pause();
      setIsPlaying(false);
    }
  };

  return (
    <div className={"myra-audio-bubble myra-fade-in" + (msg.status === "error" ? " error" : "")}>
      <audio ref={audioRef} src={msg.audioUrl} preload="metadata" />
      <button className="myra-audio-play" onClick={togglePlayback} aria-label={isPlaying ? "Pause voice message" : "Play voice message"}>
        {isPlaying ? <PauseIcon /> : <PlayIcon />}
      </button>
      <div className="myra-audio-body">
        <div className="myra-audio-wave" style={{ "--voice-progress": progress }}>
          {Array.from({ length: 24 }).map((_, index) => (
            <span key={index} style={{ height: `${waveHeight(index)}px` }} />
          ))}
        </div>
        <div className="myra-audio-meta">
          <span>{formatAudioDuration(msg.durationMs)}</span>
          <span>{msg.status === "sending" ? "Sending..." : msg.status === "error" ? "Not sent" : "Voice message"}</span>
        </div>
      </div>
    </div>
  );
}

function EmailAgentCard({ children }) {
  return (
    <div className="myra-fade-in" style={{ alignSelf: "flex-start", width: "100%", maxWidth: 580 }}>
      <div style={{
        border: "1px solid var(--border-strong)",
        borderRadius: "var(--radius-lg)",
        overflow: "hidden",
        background: "var(--color-elevated)",
      }}>
        {children}
      </div>
      <div style={{ marginTop: 6 }}>
        <span className="myra-badge warning">
          <MailSmIcon /> Email Agent
        </span>
      </div>
    </div>
  );
}

function RecipientChoiceCard({ data, readonly = false }) {
  const { sendMessage, isTyping } = useChatStore();
  const [email, setEmail] = useState("");
  const candidates = data.candidates ?? [];

  const submitEmail = () => {
    const value = email.trim();
    if (value) sendMessage(value);
  };

  return (
    <EmailAgentCard>
      <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
        <strong style={{ fontSize: 14, color: "var(--text-2)" }}>Choose recipient</strong>
        <p style={{ margin: "5px 0 0", fontSize: 12, color: "var(--text-muted)" }}>
          {data.prompt}
        </p>
      </div>

      {candidates.length > 0 && (
        <div style={{ padding: "10px 14px", display: "grid", gap: 8 }}>
          {candidates.map((candidate, index) => (
            <button
              key={`${candidate.email}-${index}`}
              className="myra-btn secondary sm"
              disabled={readonly || isTyping}
              onClick={() => sendMessage(String(index + 1))}
              style={{ justifyContent: "flex-start" }}
            >
              {candidate.name || "Recipient"} &lt;{candidate.email}&gt;
            </button>
          ))}
        </div>
      )}

      <div style={{ padding: "10px 14px", borderTop: "1px solid var(--border)", display: "flex", gap: 8 }}>
        <input
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submitEmail();
          }}
          disabled={readonly || isTyping}
          placeholder={data.placeholder || "name@example.com"}
          type="email"
          style={{
            flex: 1,
            minWidth: 0,
            border: "1px solid var(--border-strong)",
            borderRadius: "var(--radius-md)",
            padding: "8px 10px",
            background: "var(--color-elevated)",
            color: "var(--text-2)",
          }}
        />
        <button
          className="myra-btn primary sm"
          disabled={readonly || isTyping || !email.trim()}
          onClick={submitEmail}
        >
          Use email
        </button>
        <button
          className="myra-btn ghost sm"
          disabled={readonly || isTyping}
          onClick={() => sendMessage("cancel")}
        >
          Cancel
        </button>
      </div>
    </EmailAgentCard>
  );
}

function PendingSendCard({ data, readonly = false }) {
  const { sendMessage, syncEmailStatus, isTyping } = useChatStore();
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, Date.parse(data.deadline) - Date.now())
  );
  const status = data.status ?? "pending_revoke";
  const terminal = ["sent", "revoked", "cancelled", "failed"].includes(status);

  useEffect(() => {
    if (readonly || terminal) return undefined;

    const refresh = () => {
      setRemaining(Math.max(0, Date.parse(data.deadline) - Date.now()));
      syncEmailStatus().catch(() => { });
    };

    refresh();
    const interval = window.setInterval(refresh, 750);
    return () => window.clearInterval(interval);
  }, [data.deadline, readonly, syncEmailStatus, terminal]);

  const seconds = Math.max(0, Math.ceil(remaining / 1000));
  const canRevoke = !readonly && !terminal && remaining > 0 && !isTyping;

  return (
    <EmailAgentCard>
      <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
        <strong style={{ fontSize: 14, color: "var(--text-2)" }}>
          {status === "sent" ? "Email sent" : status === "revoked" ? "Send revoked" : "Email pending"}
        </strong>
        <p style={{ margin: "5px 0 0", fontSize: 12, color: "var(--text-muted)" }}>
          {terminal
            ? `Status: ${status}`
            : remaining > 0
              ? `Sending in ${seconds} second${seconds === 1 ? "" : "s"}.`
              : "Sending now…"}
        </p>
      </div>

      <div style={{ padding: "10px 14px", fontSize: 12, color: "var(--text-2)" }}>
        <div>To: {data.recipient?.name ? `${data.recipient.name} <${data.recipient.email}>` : data.recipient?.email}</div>
        <div style={{ marginTop: 4 }}>Subject: {data.draft?.subject}</div>
      </div>

      <div style={{ padding: "10px 14px", borderTop: "1px solid var(--border)" }}>
        <button
          className="myra-btn secondary sm"
          disabled={!canRevoke}
          onClick={() => sendMessage("revoke")}
        >
          <XIcon /> Revoke send
        </button>
      </div>
    </EmailAgentCard>
  );
}

// ── DraftApprovalCard — rendered when email agent returns a draft ─────────────

function DraftApprovalCard({ data, setDraft, readonly = false }) {
  const { sendMessage, isTyping } = useChatStore();
  const { draft, meta = {}, instructions } = data;

  const cardStyle = {
    border: "1px solid var(--border-strong)",
    borderRadius: "var(--radius-lg)",
    overflow: "hidden",
    background: "var(--color-elevated)",
    marginBottom: 4,
    opacity: readonly ? 0.75 : 1,
  };
  const headerStyle = {
    padding: "10px 14px",
    borderBottom: "1px solid var(--border)",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    background: "var(--color-surface)",
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
    background: "var(--color-bg)",
  };
  const actionsStyle = {
    padding: "10px 14px",
    borderTop: "1px solid var(--border)",
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    alignItems: "center",
    background: "var(--color-bg)",
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
            v{draft.version} · {draft.source || "agent"}
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
          {readonly ? (
            <span style={{ fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
              Session ended · actions unavailable
            </span>
          ) : (
            <>
              <button
                className="myra-btn primary sm"
                disabled={isTyping}
                onClick={() => sendMessage("approve")}
              >
                <CheckIcon /> Approve
              </button>
              <button
                className="myra-btn secondary sm"
                disabled={isTyping}
                onClick={() => { setDraft("Edit: "); }}
              >
                <EditIcon /> Edit
              </button>
              <button
                className="myra-btn secondary sm"
                disabled={isTyping}
                onClick={() => sendMessage("regenerate")}
              >
                <RefreshIcon /> Regenerate
              </button>
              <button
                className="myra-btn ghost sm"
                disabled={isTyping}
                onClick={() => sendMessage("cancel")}
                style={{ color: "var(--text-muted)" }}
              >
                <XIcon /> Cancel
              </button>
            </>
          )}
        </div>
      </div>

      {/* Instructions hint — only shown during active session */}
      {!readonly && instructions && (
        <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4, paddingLeft: 4 }}>
          {instructions}
        </p>
      )}

      <div style={{ marginTop: 6 }}>
        <span className="myra-badge warning">
          <MailSmIcon /> Email Agent
        </span>
      </div>
    </div>
  );
}

// ── Composer — the input area at bottom ─────────────────────────────────────

function Composer({ draft, setDraft, textareaRef, onSend, onKeyDown, onInput, pendingConfirmation, onConfirm, onReject, voiceSupported, voiceRecording, voiceDurationMs, voiceError, onVoiceToggle, selectedModelId, onModelChange }) {
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
            <button
              className={
                "myra-btn ghost icon sm" +
                (voiceRecording ? " voice-recording" : "")
              }
              aria-label={voiceRecording ? "Stop voice recording" : "Voice input"}
              onClick={onVoiceToggle}
              disabled={!voiceSupported}
              title={
                voiceSupported
                  ? "Record voice message"
                  : "Voice recording is not supported"
              }
            >
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
            <label className="myra-model-select" aria-label="Select chat model">
              <SparklesSmIcon />
              <select
                value={selectedModelId}
                onChange={(event) => onModelChange(event.target.value)}
              >
                {LLM_MODEL_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.displayName}
                  </option>
                ))}
              </select>
            </label>
            <span className="myra-source-pill" style={{ cursor: "default" }}>
              <MailSmIcon />Gmail
            </span>
            <span className="myra-source-pill" style={{ cursor: "default" }}>
              <CalendarSmIcon />Calendar
            </span>
            <span className="myra-source-pill" style={{ cursor: "default" }}>
              <span className="dot" />All sources
            </span>
          </div>
          <span className="myra-composer-hint-text">Enter to send · Shift+Enter newline</span>
        </div>
        {(voiceRecording || voiceError) && (
          <div className={"myra-voice-status" + (voiceError ? " error" : "")}>
            {voiceError || `Recording voice ${formatAudioDuration(voiceDurationMs)}`}
          </div>
        )}

      </div>
    </div>
  );
}

function formatAudioDuration(ms = 0) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function waveHeight(index) {
  const pattern = [10, 16, 22, 14, 28, 20, 12, 24, 18, 30, 16, 22];
  return pattern[index % pattern.length];
}



const TAGLINES = [
  "Your emails, meetings, and notes — organized in one conversation.",
  "Let's turn today's information into action.",
  "Start with a question. Leave with clarity.",
  "Helping you stay ahead of your inbox and calendar.",
  "Less searching. More doing.",
  "Your personal AI chief of staff.",
  "Focus on decisions, not distractions.",
  "Everything important. Nothing overlooked.",
  "Ready when you are."
];

function SidebarIcon() {
  return <PanelLeft size={16} strokeWidth={1.7} />;
}
function EditIcon() {
  return <Pencil size={14} strokeWidth={1.7} />;
}
function TrashIcon() {
  return <Trash2 size={14} strokeWidth={1.7} />;
}
function PaperclipIcon() {
  return <Paperclip size={16} strokeWidth={1.7} />;
}
function MicIcon() {
  return <Mic size={16} strokeWidth={1.7} />;
}
function PlayIcon() {
  return <Play size={13} fill="currentColor" strokeWidth={1.7} />;
}
function PauseIcon() {
  return <Pause size={13} fill="currentColor" strokeWidth={1.7} />;
}
function SendIcon() {
  return <Send size={14} strokeWidth={1.8} />;
}
function CheckIcon() {
  return <Check size={13} strokeWidth={2.2} />;
}
function XIcon() {
  return <X size={13} strokeWidth={2.2} />;
}
function CalendarSmIcon() {
  return <CalendarDays size={12} strokeWidth={1.7} />;
}
function MailSmIcon() {
  return <Mail size={12} strokeWidth={1.7} />;
}
function RefreshIcon() {
  return <RefreshCw size={13} strokeWidth={1.7} />;
}
function SparklesSmIcon() {
  return <Sparkles size={12} strokeWidth={1.7} />;
}
export default ChatWindow;
