"use client";

import { useEffect, useState } from "react";
import { API_URL } from "@/lib/env";
import { waitForSessionAccessToken } from "@/app/dashboard/[conversationId]/conversationSession";

interface MorningBriefData {
  generatedAt: string;
  closeRate: {
    thisWeek: number;
    lastWeek: number;
    delta: number;
    thisWeekWon: number;
    thisWeekTotal: number;
  };
  winStreak: number;
  trendingObjection: string | null;
  weakestObjection: string | null;
  practiceRebuttal: string | null;
}

const DEMO: MorningBriefData = {
  generatedAt: new Date().toISOString(),
  closeRate: {
    thisWeek: 66.7,
    lastWeek: 50.0,
    delta: 16.7,
    thisWeekWon: 4,
    thisWeekTotal: 9,
  },
  winStreak: 3,
  trendingObjection: "rate too high",
  weakestObjection: "already working with someone",
  practiceRebuttal:
    "I completely understand — most of our clients said the same thing before switching. The difference is we structure deals around your cash flow, not a fixed rate.",
};

function DeltaBadge({ delta }: { delta: number }) {
  if (delta === 0)
    return <span className="text-xs text-white/30">same as last week</span>;
  const up = delta > 0;
  return (
    <span
      className={`text-xs font-medium ${up ? "text-emerald-400" : "text-red-400"}`}
    >
      {up ? "▲" : "▼"} {Math.abs(delta)}% vs last week
    </span>
  );
}

export default function MorningBriefWidget({
  demoMode = false,
}: {
  demoMode?: boolean;
}) {
  const [data, setData] = useState<MorningBriefData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        if (demoMode) {
          setData(DEMO);
          return;
        }
        const token = await waitForSessionAccessToken();
        if (!token) return;
        const res = await fetch(
          `${API_URL}/api/conversations/analytics/morning-brief`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!res.ok) return;
        const json = (await res.json()) as MorningBriefData;
        setData(json);
      } catch {
        // silent — widget is non-critical
      } finally {
        setLoading(false);
      }
    })();
  }, [demoMode]);

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  };

  if (loading) {
    return (
      <div className="rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.04] to-black/30 p-5 animate-pulse">
        <div className="h-4 w-48 rounded bg-white/10 mb-3" />
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-8 rounded-xl bg-white/10" />
          ))}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const hasAnyData =
    data.closeRate.thisWeekTotal > 0 ||
    data.winStreak > 0 ||
    data.trendingObjection !== null;

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.04] to-black/30 overflow-hidden">
      {/* Header — always visible */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-base">☀️</span>
          <span className="text-sm font-semibold text-white/80">
            {greeting()} — Your 60-Second Brief
          </span>
        </div>
        <span className="text-white/30 text-xs">{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && (
        <div className="px-5 pb-5 space-y-3">
          {!hasAnyData ? (
            <p className="text-xs text-white/30 leading-relaxed">
              Start tracking deals and using live coaching to unlock your
              personalized daily brief.
            </p>
          ) : (
            <>
              {/* Close rate */}
              <div className="rounded-xl bg-white/[0.04] border border-white/[0.06] px-4 py-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-white/50 font-medium uppercase tracking-wide">
                    Close Rate This Week
                  </p>
                  <DeltaBadge delta={data.closeRate.delta} />
                </div>
                <p className="mt-1">
                  <span
                    className={`text-2xl font-bold ${
                      data.closeRate.thisWeek >= 60
                        ? "text-emerald-400"
                        : data.closeRate.thisWeek >= 40
                        ? "text-yellow-400"
                        : data.closeRate.thisWeek > 0
                        ? "text-red-400"
                        : "text-white/30"
                    }`}
                  >
                    {data.closeRate.thisWeek > 0
                      ? `${data.closeRate.thisWeek}%`
                      : "—"}
                  </span>
                  {data.closeRate.thisWeekTotal > 0 && (
                    <span className="ml-2 text-xs text-white/30">
                      {data.closeRate.thisWeekWon}W /{" "}
                      {data.closeRate.thisWeekTotal} tracked
                    </span>
                  )}
                </p>
              </div>

              {/* Win streak */}
              {data.winStreak > 0 && (
                <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-4 py-3">
                  <p className="text-xs text-emerald-300/70 font-medium uppercase tracking-wide">
                    Win Streak
                  </p>
                  <p className="mt-1 text-xl font-bold text-emerald-300">
                    🔥 {data.winStreak} in a row
                  </p>
                </div>
              )}

              {/* Trending objection */}
              {data.trendingObjection && (
                <div className="rounded-xl bg-white/[0.04] border border-white/[0.06] px-4 py-3">
                  <p className="text-xs text-white/50 font-medium uppercase tracking-wide">
                    #1 Objection Trending This Week
                  </p>
                  <p className="mt-1 text-sm font-semibold text-white/80 capitalize">
                    "{data.trendingObjection}"
                  </p>
                  <p className="text-[10px] text-white/30 mt-0.5">
                    Across all RoboRebut users
                  </p>
                </div>
              )}

              {/* Practice rebuttal */}
              {data.weakestObjection && (
                <div className="rounded-xl bg-yellow-500/5 border border-yellow-500/20 px-4 py-3">
                  <p className="text-xs text-yellow-300/70 font-medium uppercase tracking-wide">
                    Practice This Today
                  </p>
                  <p className="mt-1 text-xs text-white/70 font-medium">
                    Your weak spot:{" "}
                    <span className="text-yellow-300 capitalize">
                      "{data.weakestObjection}"
                    </span>
                  </p>
                  {data.practiceRebuttal && (
                    <p className="mt-2 text-xs text-white/50 leading-relaxed italic border-l-2 border-yellow-500/30 pl-3">
                      {data.practiceRebuttal}
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
