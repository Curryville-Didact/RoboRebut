"use client";

import { useEffect, useState, useCallback } from "react";
import { API_URL } from "@/lib/env";
import { waitForSessionAccessToken } from "@/app/dashboard/[conversationId]/conversationSession";

interface TeamStats {
  totalReps: number;
  totalAttempted: number;
  totalWon: number;
  totalLost: number;
  totalInProgress: number;
  teamCloseRate: number;
  avgDealSize: number;
  estimatedRevenueLost: number;
}

interface RepStat {
  userId: string;
  displayName: string;
  role: string;
  totalConversations: number;
  won: number;
  lost: number;
  closeRate: number;
  prevCloseRate: number;
  improvement: number;
}

interface ShopReport {
  ok: boolean;
  period: "week" | "month";
  workspaceName: string;
  generatedAt: string;
  team: TeamStats;
  topObjections: { reason: string; count: number }[];
  repStats: RepStat[];
  mostImproved: {
    displayName: string;
    improvement: number;
    closeRate: number;
  } | null;
  strugglingRep: {
    displayName: string;
    closeRate: number;
    lost: number;
  } | null;
  trainingFocus: string | null;
  recommendedAction: string | null;
}

interface WorkspaceInfo {
  id: string;
  name: string;
  owner_id: string;
}

const DEMO_REPORT: ShopReport = {
  ok: true,
  period: "week",
  workspaceName: "Curry's ISO Shop",
  generatedAt: new Date().toISOString(),
  team: {
    totalReps: 5,
    totalAttempted: 52,
    totalWon: 18,
    totalLost: 21,
    totalInProgress: 13,
    teamCloseRate: 46.2,
    avgDealSize: 42000,
    estimatedRevenueLost: 882000,
  },
  topObjections: [
    { reason: "rate too high", count: 9 },
    { reason: "already working with someone", count: 6 },
    { reason: "need to think about it", count: 4 },
  ],
  repStats: [
    {
      userId: "u1", displayName: "marcus", role: "member",
      totalConversations: 14, won: 8, lost: 3,
      closeRate: 72.7, prevCloseRate: 55.0, improvement: 17.7,
    },
    {
      userId: "u2", displayName: "you", role: "owner",
      totalConversations: 12, won: 5, lost: 5,
      closeRate: 50.0, prevCloseRate: 50.0, improvement: 0,
    },
    {
      userId: "u3", displayName: "destiny", role: "member",
      totalConversations: 10, won: 3, lost: 7,
      closeRate: 30.0, prevCloseRate: 44.0, improvement: -14.0,
    },
    {
      userId: "u4", displayName: "james", role: "member",
      totalConversations: 9, won: 1, lost: 4,
      closeRate: 20.0, prevCloseRate: 35.0, improvement: -15.0,
    },
    {
      userId: "u5", displayName: "priya", role: "member",
      totalConversations: 7, won: 1, lost: 2,
      closeRate: 33.3, prevCloseRate: 28.0, improvement: 5.3,
    },
  ],
  mostImproved: {
    displayName: "marcus",
    improvement: 17.7,
    closeRate: 72.7,
  },
  strugglingRep: {
    displayName: "james",
    closeRate: 20.0,
    lost: 4,
  },
  trainingFocus: "rate too high",
  recommendedAction:
    'Coach james on "rate too high" objections this week',
};

function formatCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

export default function ShopIntelligenceReport({
  demoMode = false,
}: {
  demoMode?: boolean;
}) {
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [report, setReport] = useState<ShopReport | null>(null);
  const [period, setPeriod] = useState<"week" | "month">("week");
  const [loading, setLoading] = useState(true);
  const [notOwner, setNotOwner] = useState(false);
  const [noWorkspace, setNoWorkspace] = useState(false);

  const fetchReport = useCallback(
    async (wsId: string, p: "week" | "month") => {
      setLoading(true);
      try {
        if (demoMode) {
          setReport({ ...DEMO_REPORT, period: p });
          return;
        }
        const token = await waitForSessionAccessToken();
        if (!token) return;
        const res = await fetch(
          `${API_URL}/api/workspaces/${wsId}/shop-report?period=${p}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (res.status === 403) {
          setNotOwner(true);
          return;
        }
        if (!res.ok) return;
        const json = (await res.json()) as ShopReport;
        setReport(json);
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    },
    [demoMode]
  );

  useEffect(() => {
    void (async () => {
      if (demoMode) {
        await fetchReport("demo", period);
        return;
      }
      try {
        const token = await waitForSessionAccessToken();
        if (!token) { setLoading(false); return; }
        const res = await fetch(`${API_URL}/api/workspaces/mine`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) { setLoading(false); return; }
        const json = (await res.json()) as {
          ok: boolean;
          item: WorkspaceInfo | null;
        };
        if (!json.item) {
          setNoWorkspace(true);
          setLoading(false);
          return;
        }
        setWorkspace(json.item);
        await fetchReport(json.item.id, period);
      } catch {
        setLoading(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!workspace && !demoMode) return;
    const wsId = demoMode ? "demo" : workspace?.id;
    if (!wsId) return;
    void fetchReport(wsId, period);
  }, [period, workspace, demoMode, fetchReport]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.04] to-black/30 p-5 animate-pulse">
        <div className="h-4 w-56 rounded bg-white/10 mb-4" />
        <div className="grid grid-cols-3 gap-3 mb-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 rounded-xl bg-white/10" />
          ))}
        </div>
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-10 rounded-xl bg-white/10" />
          ))}
        </div>
      </div>
    );
  }

  if (noWorkspace) {
    return (
      <div className="rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.04] to-black/30 p-5">
        <h2 className="text-sm font-semibold text-white/80 mb-2">
          📊 Shop Intelligence Report
        </h2>
        <p className="text-xs text-white/30 leading-relaxed">
          Create a team workspace to unlock the shop report.
          <br />
          <span className="text-white/20">
            Managers see total deals, top objections, rep performance,
            and weekly training recommendations.
          </span>
        </p>
      </div>
    );
  }

  if (notOwner) return null;
  if (!report) return null;

  const { team, topObjections, repStats, mostImproved,
    strugglingRep, recommendedAction } = report;

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.04] to-black/30 p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold text-white/80">
            📊 {report.workspaceName} — Weekly Report
          </h2>
          <p className="text-[10px] text-white/30 mt-0.5">
            {period === "week" ? "Last 7 days" : "Last 30 days"} ·
            Generated {new Date(report.generatedAt).toLocaleDateString()}
          </p>
        </div>
        <div className="flex gap-1">
          {(["week", "month"] as const).map((p) => (
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
              {p === "week" ? "7d" : "30d"}
            </button>
          ))}
        </div>
      </div>

      {/* Team scoreboard */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="rounded-xl bg-white/[0.04] p-3 text-center">
          <p className="text-lg font-bold text-white">{team.totalAttempted}</p>
          <p className="text-[10px] text-white/40 mt-0.5">Deals Worked</p>
        </div>
        <div className="rounded-xl bg-white/[0.04] p-3 text-center">
          <p className={`text-lg font-bold ${
            team.teamCloseRate >= 50 ? "text-emerald-400"
            : team.teamCloseRate >= 30 ? "text-yellow-400"
            : "text-red-400"
          }`}>
            {team.teamCloseRate > 0 ? `${team.teamCloseRate}%` : "—"}
          </p>
          <p className="text-[10px] text-white/40 mt-0.5">Team Close Rate</p>
        </div>
        <div className="rounded-xl bg-white/[0.04] p-3 text-center">
          <p className="text-lg font-bold text-emerald-400">
            {team.totalWon}
          </p>
          <p className="text-[10px] text-white/40 mt-0.5">Deals Won</p>
        </div>
      </div>

      {/* Revenue lost */}
      {team.estimatedRevenueLost > 0 && (
        <div className="rounded-xl bg-red-500/5 border border-red-500/20 px-4 py-3 mb-4">
          <p className="text-xs text-red-300/80 font-medium">
            💸 Your team lost an estimated{" "}
            <span className="font-bold text-red-300">
              {formatCurrency(team.estimatedRevenueLost)}
            </span>{" "}
            in deals this {period}.
            {team.avgDealSize > 0 && (
              <span className="text-red-300/60">
                {" "}(avg deal size {formatCurrency(team.avgDealSize)})
              </span>
            )}
          </p>
        </div>
      )}

      {/* Top objections that beat your team */}
      {topObjections.length > 0 && (
        <div className="mb-4">
          <p className="text-[10px] text-white/40 uppercase tracking-wide mb-2">
            Top Objections That Beat Your Team
          </p>
          <div className="space-y-1.5">
            {topObjections.map((obj, i) => (
              <div
                key={obj.reason}
                className="flex items-center justify-between rounded-xl bg-white/[0.03] border border-white/[0.05] px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs text-white/30">
                    #{i + 1}
                  </span>
                  <p className="text-xs text-white/70 capitalize">
                    "{obj.reason}"
                  </p>
                </div>
                <span className="text-xs font-medium text-red-400">
                  {obj.count} loss{obj.count !== 1 ? "es" : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Rep performance table */}
      <div className="mb-4">
        <p className="text-[10px] text-white/40 uppercase tracking-wide mb-2">
          Rep Performance
        </p>
        <div className="space-y-1.5">
          {repStats
            .sort((a, b) => b.closeRate - a.closeRate)
            .map((rep) => (
              <div
                key={rep.userId}
                className="flex items-center gap-3 rounded-xl bg-white/[0.03] border border-white/[0.05] px-3 py-2.5"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-white/80 truncate">
                    {rep.displayName}
                  </p>
                  <p className="text-[10px] text-white/30 mt-0.5">
                    {rep.won}W · {rep.lost}L ·{" "}
                    {rep.totalConversations} convos
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className={`text-sm font-bold ${
                    rep.closeRate >= 60 ? "text-emerald-400"
                    : rep.closeRate >= 40 ? "text-yellow-400"
                    : rep.closeRate > 0 ? "text-red-400"
                    : "text-white/20"
                  }`}>
                    {rep.closeRate > 0 ? `${rep.closeRate}%` : "—"}
                  </p>
                  {rep.improvement !== 0 && (
                    <p className={`text-[10px] font-medium ${
                      rep.improvement > 0
                        ? "text-emerald-400"
                        : "text-red-400"
                    }`}>
                      {rep.improvement > 0 ? "▲" : "▼"}{" "}
                      {Math.abs(rep.improvement)}%
                    </p>
                  )}
                </div>
              </div>
            ))}
        </div>
      </div>

      {/* Intelligence callouts */}
      <div className="space-y-2">
        {mostImproved && mostImproved.improvement > 0 && (
          <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/20 px-4 py-3">
            <p className="text-xs text-emerald-300/80 font-medium">
              📈 Most Improved:{" "}
              <span className="font-bold text-emerald-300">
                {mostImproved.displayName}
              </span>{" "}
              +{mostImproved.improvement}% close rate vs last period
            </p>
          </div>
        )}

        {strugglingRep && (
          <div className="rounded-xl bg-yellow-500/5 border border-yellow-500/20 px-4 py-3">
            <p className="text-xs text-yellow-300/80 font-medium">
              ⚠️ Needs Coaching:{" "}
              <span className="font-bold text-yellow-300">
                {strugglingRep.displayName}
              </span>{" "}
              — {strugglingRep.closeRate}% close rate,{" "}
              {strugglingRep.lost} losses this period
            </p>
          </div>
        )}

        {recommendedAction && (
          <div className="rounded-xl bg-white/[0.04] border border-white/[0.08] px-4 py-3">
            <p className="text-[10px] text-white/40 uppercase tracking-wide mb-1">
              Recommended Action This Week
            </p>
            <p className="text-xs text-white/70 font-medium">
              🎯 {recommendedAction}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
