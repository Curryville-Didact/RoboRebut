"use client";

import { useEffect, useState, useCallback } from "react";
import { API_URL } from "@/lib/env";
import { waitForSessionAccessToken } from "@/app/dashboard/[conversationId]/conversationSession";

interface CloseRateData {
  period: "week" | "month" | "all";
  totalConversations: number;
  won: number;
  lost: number;
  inProgress: number;
  closeRate: number;
  totalDealValue: number;
  avgDealSize: number;
  prevCloseRate: number;
  closeRateDelta: number;
}

const COMMISSION_STORAGE_KEY = "roborebut_commission_rate";
const DEFAULT_COMMISSION_RATE = 10;

function formatCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toLocaleString()}`;
}

export default function CommissionWidget({
  demoMode = false,
}: {
  demoMode?: boolean;
}) {
  const [period, setPeriod] = useState<"week" | "month" | "all">("month");
  const [data, setData] = useState<CloseRateData | null>(null);
  const [loading, setLoading] = useState(true);
  const [commissionRate, setCommissionRate] = useState<number>(() => {
    if (typeof window === "undefined") return DEFAULT_COMMISSION_RATE;
    const stored = localStorage.getItem(COMMISSION_STORAGE_KEY);
    const parsed = stored ? parseFloat(stored) : NaN;
    return Number.isNaN(parsed) ? DEFAULT_COMMISSION_RATE : parsed;
  });
  const [editingRate, setEditingRate] = useState(false);
  const [rateInput, setRateInput] = useState<string>(
    String(commissionRate)
  );

  const fetchData = useCallback(
    async (p: "week" | "month" | "all") => {
      setLoading(true);
      try {
        if (demoMode) {
          // Demo fixture — realistic MCA numbers
          const fixture: CloseRateData = {
            period: p,
            totalConversations: 18,
            won: 7,
            lost: 6,
            inProgress: 5,
            closeRate: 53.8,
            totalDealValue: 412000,
            avgDealSize: 58857,
            prevCloseRate: 44.4,
            closeRateDelta: 9.4,
          };
          setData(fixture);
          return;
        }
        const token = await waitForSessionAccessToken();
        if (!token) return;
        const res = await fetch(
          `${API_URL}/api/conversations/analytics/close-rate?period=${p}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!res.ok) return;
        const json = (await res.json()) as CloseRateData;
        setData(json);
      } catch {
        // silent — widget is non-critical
      } finally {
        setLoading(false);
      }
    },
    [demoMode]
  );

  useEffect(() => {
    void fetchData(period);
  }, [period, fetchData]);

  const handleRateSave = () => {
    const parsed = parseFloat(rateInput);
    if (Number.isNaN(parsed) || parsed <= 0 || parsed > 100) {
      setRateInput(String(commissionRate));
      setEditingRate(false);
      return;
    }
    const rounded = Math.round(parsed * 10) / 10;
    setCommissionRate(rounded);
    localStorage.setItem(COMMISSION_STORAGE_KEY, String(rounded));
    setEditingRate(false);
  };

  const estimatedCommission = data
    ? Math.round(data.totalDealValue * (commissionRate / 100))
    : 0;

  const deltaColor =
    !data || data.closeRateDelta === 0
      ? "text-white/40"
      : data.closeRateDelta > 0
      ? "text-emerald-400"
      : "text-red-400";

  const deltaPrefix =
    data && data.closeRateDelta > 0
      ? "+"
      : "";

  if (loading) {
    return (
      <div className="rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.04] to-black/30 p-5 animate-pulse">
        <div className="h-4 w-32 rounded bg-white/10 mb-3" />
        <div className="h-8 w-24 rounded bg-white/10 mb-2" />
        <div className="h-3 w-48 rounded bg-white/10" />
      </div>
    );
  }

  const hasData = data && (data.won > 0 || data.lost > 0);

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.04] to-black/30 p-5">
      {/* Header row */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-white/80">
          💰 Commission Tracker
        </h2>
        {/* Period tabs */}
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

      {!hasData ? (
        <p className="text-xs text-white/30 leading-relaxed">
          Mark deals as Won to start tracking your commission here.
          <br />
          Your earnings only go up. Leaving means losing the counter.
        </p>
      ) : (
        <>
          {/* Big commission number */}
          <div className="mb-4">
            <p className="text-[11px] text-white/40 mb-0.5">
              Estimated commission earned with RoboRebut
            </p>
            <div className="flex items-end gap-2">
              <span className="text-3xl font-bold text-emerald-400">
                {formatCurrency(estimatedCommission)}
              </span>
              <span className="text-xs text-white/30 mb-1">
                @ {commissionRate}%
              </span>
              <button
                type="button"
                onClick={() => {
                  setRateInput(String(commissionRate));
                  setEditingRate(true);
                }}
                className="mb-1 text-[10px] text-white/30 underline hover:text-white/60"
              >
                edit rate
              </button>
            </div>

            {/* Inline rate editor */}
            {editingRate && (
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="number"
                  min="0.1"
                  max="100"
                  step="0.5"
                  value={rateInput}
                  onChange={(e) => setRateInput(e.target.value)}
                  className="w-20 rounded-lg bg-white/10 px-2 py-1 text-sm text-white outline-none focus:ring-2 focus:ring-emerald-500"
                  autoFocus
                />
                <span className="text-xs text-white/40">%</span>
                <button
                  type="button"
                  onClick={handleRateSave}
                  className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-500"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setEditingRate(false)}
                  className="text-xs text-white/30 hover:text-white/60"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="rounded-xl bg-white/[0.04] p-3 text-center">
              <p className="text-lg font-bold text-emerald-400">{data.won}</p>
              <p className="text-[10px] text-white/40 mt-0.5">Won</p>
            </div>
            <div className="rounded-xl bg-white/[0.04] p-3 text-center">
              <p className="text-lg font-bold text-red-400">{data.lost}</p>
              <p className="text-[10px] text-white/40 mt-0.5">Lost</p>
            </div>
            <div className="rounded-xl bg-white/[0.04] p-3 text-center">
              <p className="text-lg font-bold text-white">{data.closeRate}%</p>
              <p className="text-[10px] text-white/40 mt-0.5">Close Rate</p>
            </div>
          </div>

          {/* Close rate delta */}
          {period !== "all" && (
            <p className={`text-xs mb-3 ${deltaColor}`}>
              {data.closeRateDelta === 0
                ? "Same close rate as previous period"
                : `${deltaPrefix}${data.closeRateDelta}% vs previous ${period === "week" ? "7 days" : "30 days"}`}
            </p>
          )}

          {/* Deal value */}
          <div className="flex items-center justify-between text-xs text-white/40">
            <span>Total deal value</span>
            <span className="font-medium text-white/70">
              {formatCurrency(data.totalDealValue)}
            </span>
          </div>
          {data.avgDealSize > 0 && (
            <div className="flex items-center justify-between text-xs text-white/40 mt-1">
              <span>Avg deal size</span>
              <span className="font-medium text-white/70">
                {formatCurrency(data.avgDealSize)}
              </span>
            </div>
          )}

          {/* Annual projection teaser */}
          {period === "month" && estimatedCommission > 0 && (
            <div className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
              <p className="text-xs text-emerald-300/80 font-medium">
                📈 On this pace, RoboRebut will help you earn{" "}
                <span className="font-bold text-emerald-300">
                  {formatCurrency(estimatedCommission * 12)}
                </span>{" "}
                in commission this year.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
