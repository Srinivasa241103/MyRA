import { useEffect, useRef, useState, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import ResponseActivity from "./ResponseActivity";
import { useChatStore } from "../../store/chatStore";
import { useAuthStore } from "../../store/authStore";
import { useVoiceRecorder } from "../../hooks/useVoiceRecorder";
import { DEFAULT_LLM_MODEL_ID, LLM_MODEL_OPTIONS, getLlmModelOption } from "../../constants/llmModels";
import {
  CalendarDays,
  Mail,
  Mic,
  Moon,
  PanelLeft,
  Paperclip,
  Pause,
  Pencil,
  Play,
  Send,
  Sparkles,
  Square,
  Sun,
  Trash2,
} from "lucide-react";

// ── ChatWindow — exact MyRA design replica ───────────────────────────────────

function ChatWindow({ onNavigate, onToggleSidebar, theme = "light", onThemeChange = () => {} }) {
  const {
    messages,
    isTyping,
    conversationId,
    sendMessage,
    sendVoiceMessage,
    clearPendingMessage,
    deleteConversation,
    stopGenerating,
    canStopStreaming,
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
  const shouldStickToBottomRef = useRef(true);
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
      sendMessage(pendingMessage, pendingModelSelection ?? selectedModelOption);
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

  // Follow streamed content only while the reader remains near the bottom.
  useEffect(() => {
    if (!scrollRef.current || !shouldStickToBottomRef.current) return undefined;
    const frame = requestAnimationFrame(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [messages, isTyping]);

  const handleChatScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    const distanceFromBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight;
    shouldStickToBottomRef.current = distanceFromBottom < 120;
  };

  const handleSend = () => {
    if (isTyping) return;
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    sendMessage(text, selectedModelOption);
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
              voiceSupported={voiceSupported}
              voiceRecording={voiceRecording}
              voiceDurationMs={voiceDurationMs}
              voiceError={voiceError}
              onVoiceToggle={handleVoiceToggle}
              selectedModelId={selectedModelId}
              onModelChange={setSelectedModelId}
              isTyping={isTyping}
              canStopStreaming={canStopStreaming}
              onStop={stopGenerating}
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
      <div className="myra-chat-scroll" ref={scrollRef} onScroll={handleChatScroll}>
        <div className="myra-chat-scroll-inner">
          {/* Date system bubble */}
          <div className="myra-bubble system">{todayLabel}</div>

          {messages.map((msg, idx) => (
            <MessageTurn key={idx} msg={msg} />
          ))}

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
        voiceSupported={voiceSupported}
        voiceRecording={voiceRecording}
        voiceDurationMs={voiceDurationMs}
        voiceError={voiceError}
        onVoiceToggle={handleVoiceToggle}
        selectedModelId={selectedModelId}
        onModelChange={setSelectedModelId}
        isTyping={isTyping}
        canStopStreaming={canStopStreaming}
        onStop={stopGenerating}
      />
    </div>
  );
}

// ── MessageTurn — renders one user or AI bubble ──────────────────────────────

function MessageTurn({ msg }) {
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

  if (msg.isStreaming && !msg.text?.trim()) {
    return <ResponseActivity activity={msg.activity} />;
  }

  return (
    <div className={"myra-bubble assistant myra-fade-in" + (msg.isError ? " error" : "")}>
      {msg.text && (
        <div className={"myra-markdown" + (msg.isStreaming ? " is-streaming" : "")}>
          <ReactMarkdown>{msg.text}</ReactMarkdown>
          {msg.isStreaming && <span className="myra-stream-caret" aria-hidden="true" />}
        </div>
      )}

      {msg.streamStatus === "stopped" && (
        <div className="myra-stream-note">Stopped</div>
      )}
      {msg.streamStatus === "interrupted" && (
        <div className="myra-stream-note error">Connection interrupted</div>
      )}

      {/* Source pills */}
      {msg.context?.selectedDocuments > 0 && (
        <div className="src-row" style={{ marginTop: 10 }}>
          <span className="myra-source-pill">
            <span className="dot" />
            {msg.context.selectedDocuments} document{msg.context.selectedDocuments !== 1 ? "s" : ""}
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

// ── Composer — the input area at bottom ─────────────────────────────────────

function Composer({ draft, setDraft, textareaRef, onSend, onKeyDown, onInput, voiceSupported, voiceRecording, voiceDurationMs, voiceError, onVoiceToggle, selectedModelId, onModelChange, isTyping, canStopStreaming, onStop }) {
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
            {isTyping && canStopStreaming ? (
              <button
                className="myra-btn icon sm myra-stream-stop"
                onClick={onStop}
                aria-label="Stop generating"
                title="Stop generating"
              >
                <Square size={12} fill="currentColor" strokeWidth={1.8} />
              </button>
            ) : (
              <button
                className={"myra-btn icon sm" + (draft.trim() && !isTyping ? " primary" : "")}
                style={!draft.trim() || isTyping ? { background: "var(--bg-3)", color: "var(--text-muted)", cursor: "not-allowed" } : {}}
                onClick={onSend}
                disabled={!draft.trim() || isTyping}
                aria-label="Send"
              >
                <SendIcon />
              </button>
            )}
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
function CalendarSmIcon() {
  return <CalendarDays size={12} strokeWidth={1.7} />;
}
function MailSmIcon() {
  return <Mail size={12} strokeWidth={1.7} />;
}
function SparklesSmIcon() {
  return <Sparkles size={12} strokeWidth={1.7} />;
}
export default ChatWindow;
