"use client";

import { useEffect } from "react";

export type TranscriptReplayLine = {
  text: string;
  timestamp: string;
  session_id: string | null;
};

function formatTranscriptClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

export function TranscriptReplayModal({
  open,
  onClose,
  lines,
  isLoading,
  errorMessage,
}: {
  open: boolean;
  onClose: () => void;
  lines: TranscriptReplayLine[];
  isLoading: boolean;
  errorMessage: string | null;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center p-4 sm:items-center">
      <button
        type="button"
        className="absolute inset-0 bg-black/75 backdrop-blur-[2px]"
        aria-label="Close transcript"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="transcript-replay-title"
        className="relative flex max-h-[min(85vh,720px)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-emerald-500/25 bg-zinc-900 shadow-[0_0_40px_rgba(16,185,129,0.12)]"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 bg-zinc-950/80 px-4 py-3">
          <h2 id="transcript-replay-title" className="text-lg font-semibold text-white">
            Call transcript
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-gray-300 transition hover:border-emerald-500/40 hover:bg-emerald-500/10 hover:text-white"
          >
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16">
              <div
                className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-500/30 border-t-emerald-400"
                aria-hidden
              />
              <p className="text-sm text-gray-400">Loading transcript…</p>
            </div>
          ) : errorMessage ? (
            <p className="rounded-lg border border-red-500/25 bg-red-950/30 px-4 py-3 text-sm text-red-200">
              {errorMessage}
            </p>
          ) : lines.length === 0 ? (
            <p className="py-12 text-center text-sm text-gray-500">
              No transcript lines for this conversation.
            </p>
          ) : (
            <div className="space-y-4">
              {lines.map((line, i) => (
                <div
                  key={`${line.timestamp}-${i}-${line.session_id ?? ""}`}
                  className="border-l-2 border-emerald-500/50 pl-4"
                >
                  <p className="mb-1 text-xs font-medium tabular-nums text-emerald-400/90">
                    {formatTranscriptClock(line.timestamp)}
                  </p>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-white">
                    {line.text}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
