"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useDeepgramTranscript } from "@/hooks/useDeepgramTranscript";
import { detectObjection, type ObjectionMatch } from "@/lib/detectObjection";
import { ObjectionChip } from "@/components/transcript/ObjectionChip";

function fmtElapsed(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${String(ss).padStart(2, "0")}`;
}

export function TranscriptPanel({
  conversationId,
  onObjectionDetected,
}: {
  conversationId: string;
  onObjectionDetected: (text: string) => void;
}) {
  const { transcript, isListening, startListening, stopListening, error } =
    useDeepgramTranscript(conversationId);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const lastProcessedFinalKeyRef = useRef<string | null>(null);
  const [currentObjection, setCurrentObjection] = useState<{
    match: ObjectionMatch;
    text: string;
  } | null>(null);
  const [secondsElapsed, setSecondsElapsed] = useState(0);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [transcript.length]);

  useEffect(() => {
    if (!isListening) {
      setSecondsElapsed(0);
      return;
    }
    const id = window.setInterval(() => {
      setSecondsElapsed((s) => s + 1);
    }, 1000);
    return () => {
      window.clearInterval(id);
    };
  }, [isListening]);

  useEffect(() => {
    const last = transcript.length > 0 ? transcript[transcript.length - 1] : null;
    if (!last || !last.isFinal) return;
    const key = `${last.timestamp.toISOString()}|${last.text}`;
    if (lastProcessedFinalKeyRef.current === key) return;
    lastProcessedFinalKeyRef.current = key;

    const match = detectObjection(last.text);
    if (!match) return;
    setCurrentObjection({ match, text: last.text });
  }, [transcript]);

  const hasLines = transcript.length > 0;
  const statusLabel = useMemo(() => {
    if (error) return "Mic unavailable";
    if (isListening) return "Listening";
    return "Stopped";
  }, [error, isListening]);

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div
              className={[
                "h-2 w-2 rounded-full",
                isListening ? "bg-emerald-400 animate-pulse" : "bg-white/15",
              ].join(" ")}
              aria-hidden
            />
            <div className="text-sm font-semibold text-white">Transcript</div>
            <div className="text-xs text-gray-500">{statusLabel}</div>
          </div>
          {error ? (
            <div className="text-xs text-red-400">{error}</div>
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => void (isListening ? stopListening() : startListening())}
          className="shrink-0 rounded-md border border-white/15 bg-white/5 px-2.5 py-1 text-xs font-medium text-gray-200 transition hover:bg-white/10"
        >
          {isListening ? (
            <span className="inline-flex items-center gap-2">
              <span className="inline-flex items-center gap-1 text-red-300 animate-pulse">
                <span aria-hidden>🔴</span>
                <span>{fmtElapsed(secondsElapsed)}</span>
              </span>
              <span>Stop</span>
            </span>
          ) : (
            "Start"
          )}
        </button>
      </div>

      <div
        ref={scrollerRef}
        className="mt-3 max-h-56 overflow-y-auto rounded-lg border border-white/10 bg-black/20 p-3"
      >
        {!hasLines ? (
          <div className="text-sm text-gray-500">
            Start listening to see your call transcript here.
          </div>
        ) : (
          <div className="space-y-2">
            {currentObjection ? (
              <ObjectionChip
                match={currentObjection.match}
                onSend={() => {
                  onObjectionDetected(currentObjection.text);
                  setCurrentObjection(null);
                }}
                onDismiss={() => setCurrentObjection(null)}
              />
            ) : null}
            {transcript.map((line, idx) => (
              <div
                key={`${line.timestamp.toISOString()}_${idx}`}
                className={
                  line.isFinal
                    ? "text-sm text-white"
                    : "text-sm text-gray-500 italic"
                }
              >
                {line.text}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

