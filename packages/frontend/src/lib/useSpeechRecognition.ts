"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// --------------------------------------------------------------------------
// Minimal Web Speech API type shims
// TypeScript's dom lib declares SpeechRecognition as an interface but doesn't
// always expose it as a constructable on `window` (especially the webkit
// prefix). We declare just what we need so the hook compiles cleanly.
// --------------------------------------------------------------------------

interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly [index: number]: { readonly transcript: string };
}

interface SpeechRecognitionResultList {
  readonly length: number;
  readonly [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
}

interface ISpeechRecognition extends EventTarget {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  onstart: ((ev: Event) => void) | null;
  onresult: ((ev: SpeechRecognitionEvent) => void) | null;
  onerror: ((ev: SpeechRecognitionErrorEvent) => void) | null;
  onend: ((ev: Event) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechRecognitionCtor = new () => ISpeechRecognition;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  }
}

// --------------------------------------------------------------------------

export type SpeechState = "idle" | "listening" | "error" | "unsupported";

export interface UseSpeechRecognitionReturn {
  /** Current recognition state */
  state: SpeechState;
  /**
   * Toggle: starts listening when idle, stops when already listening.
   * No-op when `disabled` is true or browser is unsupported.
   */
  start: () => void;
  /** Stop listening manually */
  stop: () => void;
  /** Short human-readable error message, null when none */
  errorMessage: string | null;
}

/**
 * Hook wrapping the browser Web Speech API for speech-to-text.
 * Calls `onTranscript(text)` each time a final result is captured.
 * When `disabled` is true, `start()` is a no-op.
 */
export function useSpeechRecognition(
  onTranscript: (text: string) => void,
  disabled = false
): UseSpeechRecognitionReturn {
  const recognitionRef = useRef<ISpeechRecognition | null>(null);
  const sessionIdRef = useRef(0);
  const stoppingRef = useRef(false);
  const lastCommittedRef = useRef("");
  const [state, setState] = useState<SpeechState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const getConstructor = useCallback((): SpeechRecognitionCtor | null => {
    if (typeof window === "undefined") return null;
    return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
  }, []);

  // Mark unsupported on first client render
  useEffect(() => {
    if (!getConstructor()) {
      setState("unsupported");
    }
  }, [getConstructor]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      sessionIdRef.current += 1;
      stoppingRef.current = true;
      try { recognitionRef.current?.abort(); } catch { /* ignore */ }
      recognitionRef.current = null;
    };
  }, []);

  const stop = useCallback(() => {
    sessionIdRef.current += 1;
    stoppingRef.current = true;
    lastCommittedRef.current = "";
    try { recognitionRef.current?.abort(); } catch { /* ignore */ }
    recognitionRef.current = null;
    setState("idle");
  }, []);

  const start = useCallback(() => {
    if (disabled) return;

    const Constructor = getConstructor();
    if (!Constructor) {
      setState("unsupported");
      setErrorMessage("Speech recognition is not supported in this browser.");
      return;
    }

    // Toggle off if already listening
    if (state === "listening") {
      stop();
      return;
    }

    setErrorMessage(null);
    stoppingRef.current = false;
    lastCommittedRef.current = "";
    const activeSessionId = ++sessionIdRef.current;

    const rec = new Constructor();
    rec.lang = "en-US";
    rec.interimResults = false; // final-only keeps the appended text clean
    rec.maxAlternatives = 1;
    rec.continuous = false;     // single utterance per tap

    rec.onstart = () => setState("listening");

    rec.onresult = (event: SpeechRecognitionEvent) => {
      if (stoppingRef.current || activeSessionId !== sessionIdRef.current) return;

      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result?.isFinal) transcript += result[0].transcript;
      }
      transcript = transcript.trim();
      if (!transcript) return;

      // Guard against duplicate final callbacks from some engines.
      if (transcript === lastCommittedRef.current) return;
      lastCommittedRef.current = transcript;
      onTranscript(transcript);
    };

    rec.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (activeSessionId !== sessionIdRef.current) return;

      // "aborted" / "no-speech" are non-fatal — silently return to idle
      if (event.error === "aborted" || event.error === "no-speech") {
        setState("idle");
        return;
      }
      const messages: Record<string, string> = {
        "not-allowed":          "Microphone access was denied. Check your browser permissions.",
        "network":              "Speech recognition requires an internet connection.",
        "audio-capture":        "No microphone was found.",
        "service-not-allowed":  "Speech recognition service is not available.",
      };
      setState("error");
      setErrorMessage(messages[event.error] ?? "Speech recognition error. Please try again.");
    };

    rec.onend = () => {
      if (activeSessionId !== sessionIdRef.current) return;
      // Only reset to idle if we're still in "listening"; error state stays
      setState((prev) => (prev === "listening" ? "idle" : prev));
      recognitionRef.current = null;
      stoppingRef.current = false;
      lastCommittedRef.current = "";
    };

    recognitionRef.current = rec;

    try {
      rec.start();
    } catch (e) {
      setState("error");
      setErrorMessage(
        e instanceof Error ? e.message : "Could not start speech recognition."
      );
    }
  }, [disabled, getConstructor, onTranscript, state, stop]);

  return { state, start, stop, errorMessage };
}
