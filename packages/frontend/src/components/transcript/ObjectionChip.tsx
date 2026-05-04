"use client";

import { useEffect, useRef, useState } from "react";
import type { ObjectionMatch } from "@/lib/detectObjection";

type Props = {
  match: ObjectionMatch;
  onSend: () => void;
  onDismiss: () => void;
};

export function ObjectionChip({ match, onSend, onDismiss }: Props) {
  const [mounted, setMounted] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const id = window.setTimeout(() => onDismiss(), 6000);
    timeoutRef.current = id;
    const raf = window.requestAnimationFrame(() => setMounted(true));
    return () => {
      window.cancelAnimationFrame(raf);
      if (timeoutRef.current != null) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, [onDismiss]);

  return (
    <div
      className={[
        "relative overflow-hidden rounded-xl border border-white/10 border-l-4 border-emerald-500 bg-black/70 px-4 py-3 shadow-sm",
        "transition-all duration-300 ease-out",
        mounted ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
      ].join(" ")}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-gray-200">
          <span className="font-semibold text-white">
            {match.emoji} Objection detected: {match.label}
          </span>{" "}
          <span className="text-gray-400">— Send to coach?</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-md border border-white/15 bg-transparent px-2.5 py-1 text-xs font-medium text-gray-300 transition hover:bg-white/5 hover:text-white"
          >
            Dismiss
          </button>
          <button
            type="button"
            onClick={onSend}
            className="animate-pulse rounded-md bg-emerald-500 px-6 py-2 text-xs font-bold text-black transition hover:bg-emerald-400"
          >
            Send
          </button>
        </div>
      </div>

      <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-white/5">
        <div className="h-full bg-emerald-500/70 objection-progress" />
      </div>

      <style jsx>{`
        .objection-progress {
          width: 100%;
          transform-origin: left;
          animation: objectionProgress 6s linear forwards;
        }
        @keyframes objectionProgress {
          from {
            transform: scaleX(1);
          }
          to {
            transform: scaleX(0);
          }
        }
      `}</style>
    </div>
  );
}

