"use client";

import { useEffect, useState, useCallback } from "react";
import { API_URL } from "@/lib/env";
import { waitForSessionAccessToken } from "@/app/dashboard/[conversationId]/conversationSession";

interface LeaderboardEntry {
  userId: string;
  displayName: string;
  email: string;
  role: string;
  isCurrentUser: boolean;
  isOwner: boolean;
  rank: number;
  totalConversations: number;
  won: number;
  lost: number;
  inProgress: number;
  closeRate: number;
  totalDealValue: number;
}

interface LeaderboardData {
  ok: boolean;
  period: "week" | "month" | "all";
  isOwner: boolean;
  totalReps: number;
  leaderboard: LeaderboardEntry[];
  myRank: number | null;
  gapToTop3: number | null;
}

interface WorkspaceInfo {
  id: string;
  name: string;
}

const MEDAL: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

function formatCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toLocaleString()}`;
}

export default function LeaderboardWidget({
  demoMode = false,
}: {
  demoMode?: boolean;
}) {
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [period, setPeriod] = useState<"week" | "month" | "all">("week");
  const [loading, setLoading] = useState(true);
  const [noWorkspace, setNoWorkspace] = useState(false);

  const DEMO_DATA: LeaderboardData = {
    ok: true,
    period: "week",
    isOwner: true,
    totalReps: 5,
    myRank: 2,
    gapToTop3: null,
    leaderboard: [
      {
        userId: "u1", displayName: "marcus", email: "marcus@shop.com",
        role: "member", isCurrentUser: false, isOwner: false,
        rank: 1, totalConversations: 14, won: 8, lost: 3,
        inProgress: 3, closeRate: 72.7, totalDealValue: 480000,
      },
      {
        userId: "u2", displayName: "you", email: "you@shop.com",
        role: "owner", isCurrentUser: true, isOwner: true,
        rank: 2, totalConversations: 12, won: 6, lost: 3,
        inProgress: 3, closeRate: 66.7, totalDealValue: 310000,
      },
      {
        userId: "u3", displayName: "destiny", email: "destiny@shop.com",
        role: "member", isCurrentUser: false, isOwner: false,
        rank: 3, totalConversations: 10, won: 5, lost: 4,
        inProgress: 1, closeRate: 55.6, totalDealValue: 220000,
      },
      {
        userId: "u4", displayName: "james", email: "james@shop.com",
        role: "member", isCurrentUser: false, isOwner: false,
        rank: 4, totalConversations: 9, won: 3, lost: 5,
        inProgress: 1, closeRate: 37.5, totalDealValue: 95000,
      },
      {
        userId: "u5", displayName: "priya", email: "priya@shop.com",
        role: "member", isCurrentUser: false, isOwner: false,
        rank: 5, totalConversations: 7, won: 2, lost: 4,
        inProgress: 1, closeRate: 33.3, totalDealValue: 60000,
      },
    ],
  };

  const fetchWorkspace = useCallback(async (): Promise<string | null> => {
    if (demoMode) return "demo-workspace";
    try {
      const token = await waitForSessionAccessToken();
      if (!token) return null;
      const res = await fetch(`${API_URL}/api/workspaces/mine`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      const json = (await res.json()) as { ok: boolean; item: WorkspaceInfo | null };
      if (!json.item) return null;
      setWorkspace(json.item);
      return json.item.id;
    } catch {
      return null;
    }
  }, [demoMode]);

  const fetchLeaderboard = useCallback(
    async (wsId: string, p: "week" | "month" | "all") => {
      setLoading(true);
      try {
        if (demoMode) {
          setData({ ...DEMO_DATA, period: p });
          return;
        }
        const token = await waitForSessionAccessToken();
        if (!token) return;
        const res = await fetch(
          `${API_URL}/api/workspaces/${wsId}/leaderboard?period=${p}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!res.ok) return;
        const json = (await res.json()) as LeaderboardData;
        setData(json);
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [demoMode]
  );

  useEffect(() => {
    void (async () => {
      const wsId = await fetchWorkspace();
      if (!wsId) {
        setNoWorkspace(true);
        setLoading(false);
        return;
      }
      await fetchLeaderboard(wsId, period);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!workspace && !demoMode) return;
    const wsId = demoMode ? "demo-workspace" : workspace?.id;
    if (!wsId) return;
    void fetchLeaderboard(wsId, period);
  }, [period, workspace, demoMode, fetchLeaderboard]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.04] to-black/30 p-5 animate-pulse">
        <div className="h-4 w-40 rounded bg-white/10 mb-3" />
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-10 rounded-xl bg-white/10" />
          ))}
        </div>
      </div>
    );
  }

  if (noWorkspace || !data) {
    return (
      <div className="rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.04] to-black/30 p-5">
        <h2 className="text-sm font-semibold text-white/80 mb-2">
          🏆 Team Leaderboard
        </h2>
        <p className="text-xs text-white/30 leading-relaxed">
          Create or join a team workspace to see how your close rate
          ranks against your shop.
          <br />
          <span className="text-white/20">
            Managers see all reps. Reps see their rank.
          </span>
        </p>
      </div>
    );
  }

  const { leaderboard, isOwner, myRank, gapToTop3, totalReps } = data;
  const hasActivity = leaderboard.some((e) => e.totalConversations > 0);

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.04] to-black/30 p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-white/80">
          🏆 {workspace?.name ?? "Team"} Leaderboard
        </h2>
        <div className="flex gap-1">
          {(["week", "month", "all"] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-all ${
                period === p
                  ? "bg-emerald-600 text-white"
                  : "text-white/40 hover:text-white/70"
              }`}
            >
              {p === "week" ? "7d" : p === "month" ? "30d" : "All"}
            </button>
          ))}
        </div>
      </div>

      {/* My rank banner (rep view) */}
      {!isOwner && myRank !== null && (
        <div className="mb-3 rounded-xl bg-white/[0.04] border border-white/[0.06] px-3 py-2">
          <p className="text-xs text-white/70">
            You are{" "}
            <span className="font-bold text-white">
              #{myRank} of {totalReps}
            </span>{" "}
            reps this {period === "all" ? "time" : period}.
            {gapToTop3 !== null && gapToTop3 > 0 && (
              <span className="text-yellow-400 ml-1">
                {gapToTop3} more win{gapToTop3 !== 1 ? "s" : ""} to reach top 3.
              </span>
            )}
          </p>
        </div>
      )}

      {!hasActivity ? (
        <p className="text-xs text-white/30">
          No deals tracked yet this period. Mark your first deal as Won to
          appear on the board.
        </p>
      ) : (
        <div className="space-y-1.5">
          {leaderboard.map((entry) => {
            const isMe = entry.isCurrentUser;
            // Managers see real names; reps see themselves named + others as "Rep #N"
            const label = isOwner
              ? entry.displayName
              : isMe
              ? "You"
              : `Rep #${entry.rank}`;

            return (
              <div
                key={entry.userId}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 transition-all ${
                  isMe
                    ? "bg-emerald-500/10 border border-emerald-500/20"
                    : "bg-white/[0.03] border border-transparent"
                }`}
              >
                {/* Rank */}
                <span className="w-6 text-center text-sm">
                  {MEDAL[entry.rank] ?? (
                    <span className="text-xs text-white/30">
                      #{entry.rank}
                    </span>
                  )}
                </span>

                {/* Name + stats */}
                <div className="flex-1 min-w-0">
                  <p
                    className={`text-sm font-medium truncate ${
                      isMe ? "text-emerald-300" : "text-white/80"
                    }`}
                  >
                    {label}
                  </p>
                  <p className="text-[10px] text-white/30 mt-0.5">
                    {entry.won}W · {entry.lost}L ·{" "}
                    {entry.totalConversations} convos
                  </p>
                </div>

                {/* Close rate */}
                <div className="text-right shrink-0">
                  <p
                    className={`text-sm font-bold ${
                      entry.closeRate >= 60
                        ? "text-emerald-400"
                        : entry.closeRate >= 40
                        ? "text-yellow-400"
                        : entry.closeRate > 0
                        ? "text-red-400"
                        : "text-white/20"
                    }`}
                  >
                    {entry.closeRate > 0 ? `${entry.closeRate}%` : "—"}
                  </p>
                  {isOwner && entry.totalDealValue > 0 && (
                    <p className="text-[10px] text-white/30">
                      {formatCurrency(entry.totalDealValue)}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Closer of the Month badge — owner view only, month period */}
      {isOwner && period === "month" && leaderboard[0] && leaderboard[0].won > 0 && (
        <div className="mt-4 rounded-xl border border-yellow-500/20 bg-yellow-500/5 px-3 py-2">
          <p className="text-xs text-yellow-300/90 font-medium">
            🎖️ Closer of the Month:{" "}
            <span className="font-bold">{leaderboard[0].displayName}</span>
            {" "}— {leaderboard[0].won} wins · {leaderboard[0].closeRate}% close rate
          </p>
        </div>
      )}
    </div>
  );
}
