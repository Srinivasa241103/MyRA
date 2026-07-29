import { useCallback, useEffect, useRef, useState } from "react";

const MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/wav",
];

function getSupportedMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  return MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

export function useVoiceRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [durationMs, setDurationMs] = useState(0);
  const [error, setError] = useState(null);
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const timeoutRef = useRef(null);
  const startedAtRef = useRef(0);
  const pendingRef = useRef(null);

  const cleanup = useCallback(() => {
    window.clearInterval(timerRef.current);
    window.clearTimeout(timeoutRef.current);
    timerRef.current = null;
    timeoutRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    setIsRecording(false);
  }, []);

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
    return pendingRef.current?.promise ?? Promise.resolve(null);
  }, []);

  const cancelRecording = useCallback(() => {
    pendingRef.current?.resolve?.(null);
    pendingRef.current = null;
    chunksRef.current = [];
    stopRecording();
  }, [stopRecording]);

  const startRecording = useCallback(async ({ maxDurationMs = 15000 } = {}) => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      const message = "Voice recording is not supported in this browser.";
      setError(message);
      throw new Error(message);
    }

    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      return pendingRef.current.promise;
    }

    setError(null);
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = getSupportedMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const startedAt = Date.now();

    streamRef.current = stream;
    recorderRef.current = recorder;
    startedAtRef.current = startedAt;
    chunksRef.current = [];
    setDurationMs(0);

    let resolveRecording;
    let rejectRecording;
    const promise = new Promise((resolve, reject) => {
      resolveRecording = resolve;
      rejectRecording = reject;
    });
    pendingRef.current = { promise, resolve: resolveRecording, reject: rejectRecording };

    recorder.ondataavailable = (event) => {
      if (event.data?.size > 0) chunksRef.current.push(event.data);
    };

    recorder.onerror = (event) => {
      const message = event.error?.message || "Recording failed.";
      setError(message);
      pendingRef.current?.reject?.(new Error(message));
      pendingRef.current = null;
      cleanup();
    };

    recorder.onstop = () => {
      const duration = Date.now() - startedAtRef.current;
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType || "audio/webm" });
      chunksRef.current = [];
      const result = blob.size > 0
        ? {
            blob,
            durationMs: duration,
            mimeType: blob.type,
            audioUrl: URL.createObjectURL(blob),
          }
        : null;
      pendingRef.current?.resolve?.(result);
      pendingRef.current = null;
      cleanup();
    };

    recorder.start();
    setIsRecording(true);

    timerRef.current = window.setInterval(() => {
      setDurationMs(Date.now() - startedAtRef.current);
    }, 250);

    if (maxDurationMs > 0) {
      timeoutRef.current = window.setTimeout(() => {
        stopRecording();
      }, maxDurationMs);
    }

    return promise;
  }, [cleanup, stopRecording]);

  useEffect(() => {
    return () => {
      window.clearInterval(timerRef.current);
      window.clearTimeout(timeoutRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
    };
  }, []);

  return {
    isSupported: Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== "undefined",
    isRecording,
    durationMs,
    error,
    startRecording,
    stopRecording,
    cancelRecording,
  };
}
