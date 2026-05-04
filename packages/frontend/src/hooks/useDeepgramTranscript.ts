"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { API_URL } from "@/lib/env";
import { createClient } from "@/lib/supabase/client";

export type TranscriptLine = {
  text: string;
  isFinal: boolean;
  timestamp: Date;
};

type DeepgramAlt = {
  transcript?: string;
};

type DeepgramMessage = {
  type?: string;
  is_final?: boolean;
  channel?: { alternatives?: DeepgramAlt[] };
};

function extractTranscript(msg: DeepgramMessage): { text: string; isFinal: boolean } | null {
  const text =
    msg?.channel?.alternatives?.[0]?.transcript &&
    typeof msg.channel.alternatives[0].transcript === "string"
      ? msg.channel.alternatives[0].transcript
      : "";
  const trimmed = text.trim();
  if (!trimmed) return null;
  return { text: trimmed, isFinal: msg.is_final === true };
}

export function useDeepgramTranscript(conversationId: string): {
  transcript: TranscriptLine[];
  isListening: boolean;
  startListening: () => Promise<void>;
  stopListening: () => void;
  error: string | null;
} {
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const startedRef = useRef(false);
  const sessionIdRef = useRef<string | null>(null);

  const wsUrl = useMemo(() => {
    const params = new URLSearchParams({
      model: "nova-2",
      language: "en",
      interim_results: "true",
      smart_format: "true",
    });
    return `wss://api.deepgram.com/v1/listen?${params.toString()}`;
  }, []);

  const stopListening = useCallback(() => {
    startedRef.current = false;
    setIsListening(false);
    sessionIdRef.current = null;

    try {
      mediaRecorderRef.current?.stop();
    } catch {
      /* ignore */
    }
    mediaRecorderRef.current = null;

    try {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    } catch {
      /* ignore */
    }
    streamRef.current = null;

    try {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.close();
      }
    } catch {
      /* ignore */
    }
    wsRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      stopListening();
    };
  }, [stopListening]);

  const startListening = useCallback(async () => {
    if (startedRef.current) return;
    startedRef.current = true;
    setError(null);
    sessionIdRef.current = crypto.randomUUID();

    const supabase = createClient();
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token ?? null;

    const key = process.env.NEXT_PUBLIC_DEEPGRAM_API_KEY ?? "";
    if (!key.trim()) {
      startedRef.current = false;
      setError("Missing NEXT_PUBLIC_DEEPGRAM_API_KEY.");
      return;
    }

    let userStream: MediaStream;
    try {
      userStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      startedRef.current = false;
      const name = e instanceof Error ? (e as any).name : "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setError("Microphone permission denied.");
      } else {
        setError("Could not access microphone.");
      }
      return;
    }

    streamRef.current = userStream;

    const ws = new WebSocket(wsUrl, ["token", key]);
    wsRef.current = ws;

    ws.onerror = () => {
      setError("Transcript connection error.");
    };

    ws.onclose = () => {
      if (startedRef.current) {
        startedRef.current = false;
        setIsListening(false);
      }
    };

    ws.onmessage = (ev) => {
      let parsed: DeepgramMessage | null = null;
      try {
        parsed = JSON.parse(String(ev.data)) as DeepgramMessage;
      } catch {
        parsed = null;
      }
      if (!parsed) return;
      const extracted = extractTranscript(parsed);
      if (!extracted) return;

      setTranscript((prev) => {
        const line: TranscriptLine = {
          text: extracted.text,
          isFinal: extracted.isFinal,
          timestamp: new Date(),
        };

        if (extracted.isFinal) {
          // Fire-and-forget persistence of final lines.
          if (token && sessionIdRef.current) {
            void fetch(`${API_URL}/api/transcripts/line`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                conversation_id: conversationId,
                text: line.text,
                session_id: sessionIdRef.current,
              }),
            }).catch(() => {
              /* ignore */
            });
          }

          const withoutInterim =
            prev.length > 0 && prev[prev.length - 1]?.isFinal === false
              ? prev.slice(0, -1)
              : prev;
          return [...withoutInterim, line];
        }

        if (prev.length === 0) return [line];
        const last = prev[prev.length - 1]!;
        if (last.isFinal === false) {
          const next = prev.slice();
          next[next.length - 1] = line;
          return next;
        }
        return [...prev, line];
      });
    };

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(userStream, { mimeType: "audio/webm" });
    } catch {
      recorder = new MediaRecorder(userStream);
    }
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = async (e) => {
      if (!e.data || e.data.size === 0) return;
      const sock = wsRef.current;
      if (!sock || sock.readyState !== WebSocket.OPEN) return;
      try {
        const buf = await e.data.arrayBuffer();
        sock.send(buf);
      } catch {
        /* ignore */
      }
    };

    recorder.onerror = () => {
      setError("Microphone recording error.");
    };

    try {
      recorder.start(250);
    } catch {
      startedRef.current = false;
      setError("Could not start microphone recording.");
      return;
    }

    setIsListening(true);
  }, [wsUrl, conversationId]);

  return {
    transcript,
    isListening,
    startListening,
    stopListening,
    error,
  };
}

