"use client";

import { useEffect, useState } from "react";
import { API_URL } from "@/lib/env";
import { waitForSessionAccessToken } from "@/app/dashboard/[conversationId]/conversationSession";

interface StreakData {
  winStreak: number;
  closeRate: {
    thisWeek: number;
    lastWeek: number;
    delta: number;
    thisWeekWon: number;
    thisWeekTotal: number;
  };
}

const DEMO: StreakData = {
  winStreak: 4,
  closeRate: {
    thisWeek: 66.7,
    lastWeek: 50.0,
    delta: 16.7,
    thisWeekWon: 4,
    thisWeekTotal: 9,
  },
};

function getStreakLabel(streak: number): string {
  if (streak === 0) return "No active streak";
  if (streak === 1) return "1 win streak — keep going";
  if (streak <= 3) return `${streak} in a row — building momentum`;
  if (streak <= 6) return `${streak} in a row — you're on fire`;
  if (streak <= 10) return `${streak} in a row — unstoppable`;
  return `${streak} in a row — LEGENDARY`;
}

function getFlameCount(streak: number): number {
  if (streak === 0) return 0;
  if (streak <= 2) return 1;
  if (streak <= 5) return 2;
  if (streak <= 9) return 3;
  return 4;
}

function StreakFlames({ count }: { count: number }) {
  return (
    <span className="text-2xl leading-none">
      {"🔥".repeat(count)}
    </span>
  );
}

export default function WinStreakWidget({
  demoMode = false,
  refreshTrigger = 0,
}: {
  demoMode?: boolean;
  refreshTrigger?: number;
}) {
  const [data, setData] = useState<StreakData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      setLoading(true);
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
        const json = (await res.json()) as StreakData;
        setData(json);
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    })();
  }, [demoMode, refreshTrigger]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.04] to-black/30 p-5 animate-pulse">
        <div className="h-4 w-32 rounded bg-white/10 mb-2" />
        <div className="h-8 w-24 rounded bg-white/10" />
      </div>
    );
  }

  if (!data) return null;

  const streak = data.winStreak ?? 0;
  const flameCount = getFlameCount(streak);
  const label = getStreakLabel(streak);
  const hasStreak = streak > 0;
  const { thisWeek, delta, thisWeekWon, thisWeekTotal } = data.closeRate;

  return (
    <div
      className={`rounded-2xl border p-5 transition-all ${
        hasStreak
          ? "border-orange-500/30 bg-gradient-to-b from-orange-500/[0.06] to-black/30"
          : "border-white/[0.08] bg-gradient-to-b from-white/[0.04] to-black/30"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-white/50 uppercase tracking-wide mb-1">
            Win Streak
          </p>

          {hasStreak ? (
            <>
              <div className="flex items-center gap-2 mb-1">
                <span
                  className={`text-4xl font-black leading-none ${
                    streak >= 10
                      ? "text-yellow-300"
                      : streak >= 5
                      ? "text-orange-400"
                      : "text-orange-300"
                  }`}
                >
                  {streak}
                </span>
                <StreakFlames count={flameCount} />
              </div>
              <p className="text-xs text-white/50">{label}</p>
            </>
          ) : (
            <>
              <p className="text-2xl font-bold text-white/20 mb-1">—</p>
              <p className="text-xs text-white/30 leading-relaxed">
                Mark your next deal as Won to start your streak.
              </p>
            </>
          )}
        </div>

        {/* Close rate this week */}
        <div className="shrink-0 text-right">
          <p className="text-[10px] text-white/30 mb-0.5">This week</p>
          <p
            className={`text-xl font-bold ${
              thisWeek >= 60
                ? "text-emerald-400"
                : thisWeek >= 40
                ? "text-yellow-400"
                : thisWeek > 0
                ? "text-red-400"
                : "text-white/20"
            }`}
          >
            {thisWeek > 0 ? `${thisWeek}%` : "—"}
          </p>
          {thisWeekTotal > 0 && (
            <p className="text-[10px] text-white/30">
              {thisWeekWon}W / {thisWeekTotal}
            </p>
          )}
          {delta !== 0 && (
            <p
              className={`text-[10px] font-medium mt-0.5 ${
                delta > 0 ? "text-emerald-400" : "text-red-400"
              }`}
            >
              {delta > 0 ? "▲" : "▼"} {Math.abs(delta)}%
            </p>
          )}
        </div>
      </div>

      {/* Streak danger message — if streak exists, motivate to protect it */}
      {streak >= 3 && (
        <div className="mt-3 rounded-xl bg-orange-500/10 border border-orange-500/20 px-3 py-2">
          <p className="text-xs text-orange-200/80 font-medium">
            🛡️ Protect your streak — mark your next deal before end of day.
          </p>
        </div>
      )}

      {/* Milestone celebrations */}
      {streak === 5 && (
        <div className="mt-3 rounded-xl bg-yellow-500/10 border border-yellow-500/20 px-3 py-2">
          <p className="text-xs text-yellow-200/80 font-medium">
            🎯 5-deal streak! You're closing at an elite level.
          </p>
        </div>
      )}
      {streak === 10 && (
        <div className="mt-3 rounded-xl bg-yellow-500/10 border border-yellow-500/20 px-3 py-2">
          <p className="text-xs text-yellow-200/80 font-bold">
            👑 10-deal streak. Absolute closer.
          </p>
        </div>
      )}
    </div>
  );
}
