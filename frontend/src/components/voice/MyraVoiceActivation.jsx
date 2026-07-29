import { useCallback, useEffect, useRef, useState } from "react";
import { useChatStore } from "../../store/chatStore";

const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition || null;

const MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/wav",
];

const MAX_COMMAND_MS = 10000;
const MIN_COMMAND_MS = 1200;
const SILENCE_STOP_MS = 2500;
const VOLUME_THRESHOLD = 0.018;

function getSupportedMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  return MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function normalizeSpeech(text) {
  return text.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
}

// All recognised name spellings (what speech-to-text actually produces)
const NAME_VARIANTS = [
  "myra", "mira", "mayra", "mera", "meera", "myera",
  "my ra", "my rah", "meira", "maira",
];

// Prefixes that may or may not appear before the name
const WAKE_PREFIXES = ["hey", "hi", "ok", "okay", "aye", ""];

// Build a flat set of wake phrases from the cross-product
const WAKE_PHRASES = WAKE_PREFIXES.flatMap((prefix) =>
  NAME_VARIANTS.map((name) => (prefix ? `${prefix} ${name}` : name))
);

function isWakePhrase(text) {
  const normalized = normalizeSpeech(text);
  return WAKE_PHRASES.some((phrase) => {
    // Match the phrase anywhere but only when followed by end-of-string
    // or a non-letter character (so "mera" doesn't match inside "camera")
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|\\s)${escaped}(\\s|$)`).test(normalized);
  });
}

function MyraVoiceActivation({ currentPage, onNavigate }) {
  const [permissionState, setPermissionState] = useState("checking");
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState(null);
  const [lastHeard, setLastHeard] = useState("");
  const [showSimulate, setShowSimulate] = useState(false);
  const [simulateText, setSimulateText] = useState("Hey Myra schedule a meeting");
  const recognitionRef = useRef(null);
  const restartTimerRef = useRef(null);
  const speechResultTimerRef = useRef(null);
  const transcriptSeenRef = useRef(false);
  const recordingRef = useRef(null);
  const commandChunksRef = useRef([]);
  const silenceTimerRef = useRef(null);
  const maxTimerRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const streamRef = useRef(null);
  const handlingWakeRef = useRef(false);
  const permissionStateRef = useRef(permissionState);
  const restartListeningRef = useRef(null);
  const { startNewChat, sendVoiceMessage, conversationId } = useChatStore();

  useEffect(() => {
    permissionStateRef.current = permissionState;
  }, [permissionState]);

  const stopRecognition = useCallback(() => {
    window.clearTimeout(restartTimerRef.current);
    window.clearTimeout(speechResultTimerRef.current);
    try {
      recognitionRef.current?.stop();
    } catch {
      // Already stopped.
    }
  }, []);

  const cleanupRecording = useCallback(() => {
    window.clearInterval(silenceTimerRef.current);
    window.clearTimeout(maxTimerRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    if (audioContextRef.current?.state !== "closed") {
      audioContextRef.current?.close();
    }
    streamRef.current = null;
    audioContextRef.current = null;
    analyserRef.current = null;
    recordingRef.current = null;
  }, []);

  const restartListening = useCallback(() => {
    if (permissionStateRef.current !== "granted" || !SpeechRecognition || handlingWakeRef.current) return;
    window.clearTimeout(restartTimerRef.current);
    restartTimerRef.current = window.setTimeout(() => {
      try {
        recognitionRef.current?.start();
        setStatus("listening");
      } catch {
        // Chrome throws if recognition is already running.
      }
    }, 300);
  }, []);

  useEffect(() => {
    restartListeningRef.current = restartListening;
  }, [restartListening]);

  const getMicVolume = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return 0;
    const data = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (const value of data) {
      const normalized = (value - 128) / 128;
      sum += normalized * normalized;
    }
    return Math.sqrt(sum / data.length);
  }, []);

  const startCommandRecording = useCallback(async () => {
    if (handlingWakeRef.current) return;
    handlingWakeRef.current = true;
    stopRecognition();
    setError(null);
    setStatus("recording");

    if (currentPage !== "chat") {
      startNewChat();
      onNavigate?.("chat");
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = getSupportedMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      const startedAt = Date.now();
      let lastVoiceAt = Date.now();
      let finished = false;

      streamRef.current = stream;
      recordingRef.current = recorder;
      commandChunksRef.current = [];

      if (AudioContextCtor) {
        const audioContext = new AudioContextCtor();
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 1024;
        audioContext.createMediaStreamSource(stream).connect(analyser);
        audioContextRef.current = audioContext;
        analyserRef.current = analyser;
      }

      const finishRecording = () => {
        if (finished) return;
        finished = true;
        if (recorder.state !== "inactive") recorder.stop();
      };

      recorder.ondataavailable = (event) => {
        if (event.data?.size > 0) commandChunksRef.current.push(event.data);
      };

      recorder.onerror = (event) => {
        setError(event.error?.message || "Recording failed.");
        setStatus("error");
        handlingWakeRef.current = false;
        cleanupRecording();
        restartListeningRef.current?.();
      };

      recorder.onstop = async () => {
        window.clearInterval(silenceTimerRef.current);
        window.clearTimeout(maxTimerRef.current);
        const durationMs = Date.now() - startedAt;
        const blob = new Blob(commandChunksRef.current, {
          type: recorder.mimeType || mimeType || "audio/webm",
        });
        const audioUrl = blob.size ? URL.createObjectURL(blob) : null;
        cleanupRecording();

        try {
          if (!blob.size) throw new Error("No voice audio was captured.");
          setStatus("sending");
          await sendVoiceMessage({
            blob,
            audioUrl,
            durationMs,
            mimeType: blob.type,
            wakeWord: "hey myra",
          });
          setStatus("listening");
        } catch (err) {
          setError(err.message || "Could not send voice command.");
          setStatus("error");
        } finally {
          handlingWakeRef.current = false;
          restartListeningRef.current?.();
        }
      };

      recorder.start(250);

      silenceTimerRef.current = window.setInterval(() => {
        const now = Date.now();
        if (getMicVolume() >= VOLUME_THRESHOLD) lastVoiceAt = now;
        if (now - startedAt >= MIN_COMMAND_MS && now - lastVoiceAt >= SILENCE_STOP_MS) {
          finishRecording();
        }
      }, 160);

      maxTimerRef.current = window.setTimeout(finishRecording, MAX_COMMAND_MS);
    } catch (err) {
      setError(err.message || "Could not start recording.");
      setStatus("error");
      handlingWakeRef.current = false;
      cleanupRecording();
      restartListeningRef.current?.();
    }
  }, [cleanupRecording, currentPage, getMicVolume, onNavigate, sendVoiceMessage, startNewChat, stopRecognition]);

  const requestMicrophonePermission = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setPermissionState("granted");
      setStatus("starting");
    } catch {
      setPermissionState("denied");
      setStatus("error");
      setError("Microphone permission is required for Hey Myra.");
    }
  }, []);

  const handleSimulate = useCallback(async () => {
    if (handlingWakeRef.current) return;
    const text = simulateText.trim();
    if (!text) return;

    const stripped = normalizeSpeech(text);
    const wakeVariants = WAKE_PHRASES
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);
    let command = stripped;
    for (const phrase of wakeVariants) {
      if (command.startsWith(phrase)) {
        command = command.slice(phrase.length).trim();
        break;
      }
    }

    if (!command) {
      setError("Add a command after the wake phrase, e.g. 'Hey Myra schedule a meeting'.");
      return;
    }

    setError(null);
    setStatus("sending");

    if (currentPage !== "chat") {
      startNewChat();
      onNavigate?.("chat");
    }

    try {
      const { sendMessage } = useChatStore.getState();
      await sendMessage(command);
      setStatus("listening");
    } catch (err) {
      setError(err.message || "Test command failed.");
      setStatus("error");
    }
  }, [currentPage, onNavigate, simulateText, startNewChat]);

  useEffect(() => {
    if (!SpeechRecognition || typeof MediaRecorder === "undefined") {
      setPermissionState("unsupported");
      setError("Hey Myra is not supported in this browser. Use Chrome or Edge.");
      return undefined;
    }

    let permissionStatus;
    let cancelled = false;
    const syncPermission = (state) => {
      if (cancelled) return;
      setPermissionState(state);
      setStatus(state === "granted" ? "starting" : "permission");
    };

    navigator.permissions?.query?.({ name: "microphone" })
      .then((statusResult) => {
        permissionStatus = statusResult;
        syncPermission(statusResult.state);
        statusResult.onchange = () => syncPermission(statusResult.state);
      })
      .catch(() => syncPermission("prompt"));

    return () => {
      cancelled = true;
      if (permissionStatus) permissionStatus.onchange = null;
    };
  }, []);

  useEffect(() => {
    if (permissionState !== "granted") {
      stopRecognition();
      return undefined;
    }

    let cancelled = false;
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onstart = () => {
      if (!handlingWakeRef.current) setStatus("listening");
    };

    recognition.onaudiostart = () => {
      if (!handlingWakeRef.current) setStatus("listening");
    };

    recognition.onsoundstart = () => {
      if (!handlingWakeRef.current) setStatus("sound");
    };

    recognition.onspeechstart = () => {
      if (handlingWakeRef.current) return;
      transcriptSeenRef.current = false;
      setStatus("speech");
      window.clearTimeout(speechResultTimerRef.current);
      speechResultTimerRef.current = window.setTimeout(() => {
        if (!transcriptSeenRef.current && !handlingWakeRef.current) {
          setStatus("no-transcript");
        }
      }, 2600);
    };

    recognition.onspeechend = () => {
      if (handlingWakeRef.current) return;
      window.setTimeout(() => {
        try {
          recognition.stop();
        } catch {
          // Already stopped.
        }
      }, 300);
    };

    recognition.onresult = (event) => {
      window.clearTimeout(speechResultTimerRef.current);
      const transcript = Array.from(event.results || [])
        .slice(-6)
        .map((result) => result?.[0]?.transcript || "")
        .join(" ")
        .trim();

      if (transcript) {
        transcriptSeenRef.current = true;
        setLastHeard(transcript);
        setStatus("heard");
      }

      if (isWakePhrase(transcript)) {
        startCommandRecording();
      }
    };

    recognition.onerror = (event) => {
      if (event.error === "no-speech" || event.error === "aborted") return;
      setError(event.error === "not-allowed" ? "Microphone permission is blocked." : `Wake listener error: ${event.error}`);
      setStatus("error");
    };

    recognition.onend = () => {
      if (!cancelled && !handlingWakeRef.current) {
        restartListeningRef.current?.();
      }
    };

    recognitionRef.current = recognition;
    restartListeningRef.current?.();

    return () => {
      cancelled = true;
      stopRecognition();
      recognition.onstart = null;
      recognition.onaudiostart = null;
      recognition.onsoundstart = null;
      recognition.onspeechstart = null;
      recognition.onspeechend = null;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognitionRef.current = null;
    };
  }, [permissionState, startCommandRecording, stopRecognition]);

  useEffect(() => {
    return () => {
      cleanupRecording();
      stopRecognition();
    };
  }, [cleanupRecording, stopRecognition]);

  if (permissionState === "unsupported") {
    return (
      <div className="myra-voice-activation">
        <span className="myra-voice-activation-error">{error}</span>
      </div>
    );
  }

  if (permissionState !== "granted") {
    return (
      <div className="myra-voice-activation" data-active="false">
        <button
          className="myra-voice-activation-main"
          onClick={requestMicrophonePermission}
          title="Allow microphone for Hey Myra"
        >
          <MicIcon />
          <span>Allow Hey Myra</span>
        </button>
        {error && <span className="myra-voice-activation-error">{error}</span>}
      </div>
    );
  }

  return (
    <div className="myra-voice-activation" data-active="true">
      <span className={"myra-voice-activation-listening" + (status === "recording" ? " recording" : "")}>
        <MicIcon />
        <span>
          {status === "recording"
            ? "Recording command..."
            : status === "sending"
            ? "Sending voice"
            : status === "heard"
            ? "Heard speech"
            : status === "speech"
            ? "Speech detected"
            : status === "no-transcript"
            ? "No transcript from Chrome"
            : status === "sound"
            ? "Mic heard sound"
            : "Hey Myra listening"}
        </span>
      </span>
      {status === "recording" && (
        <span className="myra-voice-activation-state">Stops after silence</span>
      )}
      {lastHeard && status !== "recording" && status !== "sending" && (
        <span className="myra-voice-activation-state">Heard: {lastHeard.slice(-52)}</span>
      )}
      {conversationId && currentPage === "chat" && (
        <span className="myra-voice-activation-state">Current chat</span>
      )}
      {error && <span className="myra-voice-activation-error">{error}</span>}
      <button
        className="myra-voice-simulate-toggle"
        onClick={() => setShowSimulate((value) => !value)}
        title="Test Hey Myra without voice"
        aria-label="Toggle test command panel"
      >
        <BeakerIcon />
      </button>
      {showSimulate && (
        <div className="myra-voice-simulate-panel">
          <span className="myra-voice-simulate-label">Test without voice</span>
          <input
            className="myra-voice-simulate-input"
            value={simulateText}
            onChange={(event) => setSimulateText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") handleSimulate();
            }}
            placeholder="Hey Myra schedule a meeting"
          />
          <button
            className="myra-voice-simulate-btn"
            onClick={handleSimulate}
            disabled={status === "sending" || status === "recording"}
          >
            <PlayIcon /> Send
          </button>
        </div>
      )}
    </div>
  );
}

function MicIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M19 10a7 7 0 0 1-14 0M12 19v3" />
    </svg>
  );
}

function BeakerIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 3h6M9 3v8l-4 9h14l-4-9V3" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <polygon points="5,3 19,12 5,21" />
    </svg>
  );
}

export default MyraVoiceActivation;
