"use client";

import { useEffect, useState } from "react";
import { API_URL } from "@/lib/env";
import { waitForSessionAccessToken } from "@/app/dashboard/[conversationId]/conversationSession";

interface AutopsyData {
  ok: boolean;
  lostReason: string;
  primaryObjType: string | null;
  globalLossCount: number;
  winningRebuttals: string[];
  coaching: string | null;
}

interface DealAutopsyPanelProps {
  conversationId: string;
  lostReason: string;
  onPracticeNow: () => void;
}

export default function DealAutopsyPanel({
  conversationId,
  lostReason,
  onPracticeNow,
}: DealAutopsyPanelProps) {
  const [data, setData] = useState<AutopsyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const token = await waitForSessionAccessToken();
        if (!token) return;
        const res = await fetch(
          `${API_URL}/api/conversations/${conversationId}/autopsy`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
          }
        );
        if (!res.ok) return;
        const json = (await res.json()) as AutopsyData;
        setData(json);
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    })();
  }, [conversationId]);

  if (loading) {
    return (
      <div className="mx-3 mb-2 rounded-xl border border-red-500/20 bg-red-500/5 p-4 animate-pulse">
        <div className="h-3 w-48 rounded bg-white/10 mb-2" />
        <div className="h-3 w-64 rounded bg-white/10 mb-2" />
        <div className="h-3 w-40 rounded bg-white/10" />
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="mx-3 mb-2 rounded-xl border border-red-500/20 bg-red-500/5 overflow-hidden">
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-red-500/5 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm">🔬</span>
          <span className="text-xs font-semibold text-red-300">
            Deal Autopsy
          </span>
          {data.globalLossCount > 1 && (
            <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] text-red-300">
              {data.globalLossCount} reps lost to this
            </span>
          )}
        </div>
        <span className="text-white/30 text-[10px]">
          {expanded ? "▲" : "▼"}
        </span>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          {/* Lost reason */}
          <div>
            <p className="text-[10px] text-white/40 uppercase tracking-wide mb-1">
              Final Objection
            </p>
            <p className="text-xs text-white/70 font-medium capitalize">
              "{lostReason}"
            </p>
            {data.primaryObjType && (
              <p className="text-[10px] text-white/30 mt-0.5">
                Category: {data.primaryObjType.replace(/_/g, " ")}
              </p>
            )}
          </div>

          {/* Winning rebuttals */}
          {data.winningRebuttals.length > 0 && (
            <div>
              <p className="text-[10px] text-white/40 uppercase tracking-wide mb-2">
                Rebuttals That Won Against This
              </p>
              <div className="space-y-2">
                {data.winningRebuttals.map((r, i) => (
                  <div
                    key={i}
                    className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-2"
                  >
                    <p className="text-xs text-emerald-200/80 leading-relaxed italic">
                      "{r}"
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* AI coaching */}
          {data.coaching && (
            <div>
              <p className="text-[10px] text-white/40 uppercase tracking-wide mb-1">
                Coaching
              </p>
              <p className="text-xs text-white/60 leading-relaxed whitespace-pre-wrap">
                {data.coaching}
              </p>
            </div>
          )}

          {/* Practice CTA */}
          <button
            type="button"
            onClick={onPracticeNow}
            className="w-full rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold py-2.5 transition-all mt-1"
          >
            🎭 Practice This Objection Now
          </button>
        </div>
      )}
    </div>
  );
}
