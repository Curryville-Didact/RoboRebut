"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { API_URL } from "@/lib/env";
import { DashboardEmptyState, DashboardErrorPanel } from "@/components/dashboard/DashboardEmptyState";
import { MSG_PERFORMANCE_LOAD, MSG_SESSION } from "@/lib/userFacingErrors";
import { isFounderEmail } from "@/lib/founder";

type KeyCount = { key: string; count: number };

type AnalyticsResponse = {
  windowDays: number;
  cards: {
    totalCaptured: number;
    totalReviewed: number;
    coveragePct: number;
    avgRating: number | null;
    mostCommonFamily: string | null;
    mostCommonRhetoricalType: string | null;
  };
  series: {
    daily: { day: string; count: number }[];
    objectionFamily: KeyCount[];
    tone: KeyCount[];
    rhetoricalType: KeyCount[];
    outcomeTag: KeyCount[];
    topMerchantObjections: KeyCount[];
  };
  breakdown: {
    families: {
      family: string;
      /** Reviewed events in this family (API field name: `count`) */
      count: number;
      avgRating: number | null;
      weakPct: number;
      repetitivePct: number;
      missedContextPct: number;
    }[];
  };
};

async function waitForSessionAccessToken(): Promise<string | null> {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-1 text-xl font-semibold text-white">{value}</div>
    </div>
  );
}

function toTitleCaseFromSlug(input: string | null): string {
  const t = (input ?? "").trim();
  if (!t) return "—";
  return t
    .replace(/_/g, " ")
    .split(/\s+/g)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

function formatCoveragePct(c: number): string {
  if (!Number.isFinite(c)) return "—";
  return `${c % 1 === 0 ? c.toFixed(0) : c.toFixed(1)}%`;
}

function formatAvgRating(r: number | null | undefined): string {
  if (r == null || !Number.isFinite(r)) return "—";
  return r.toFixed(1);
}

function aggregateMissedContextPct(payload: AnalyticsResponse): number {
  const reviewed = payload.cards.totalReviewed ?? 0;
  if (reviewed <= 0) return 0;
  const tag = payload.series.outcomeTag?.find((t) => t.key === "missed_context");
  const n = tag?.count ?? 0;
  return n / reviewed;
}

function DailyActivityChart({ points }: { points: { day: string; count: number }[] }) {
  if (points.length === 0) {
    return (
      <div className="rounded-lg border border-white/10 bg-black/20 px-4 py-8 text-center text-sm text-gray-500">
        No trend data yet
      </div>
    );
  }

  const w = 800;
  const h = 220;
  const padL = 48;
  const padR = 16;
  const padT = 16;
  const padB = 36;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  const maxC = Math.max(1, ...points.map((p) => p.count));
  const n = points.length;
  const xAt = (i: number) => padL + (n <= 1 ? innerW / 2 : (i / Math.max(1, n - 1)) * innerW);
  const yAt = (c: number) => padT + innerH - (c / maxC) * innerH;
  const d = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xAt(i)} ${yAt(p.count)}`)
    .join(" ");

  const labelIdx =
    n <= 10
      ? points.map((_, i) => i)
      : Array.from(new Set([0, Math.floor(n / 2), n - 1])).sort((a, b) => a - b);

  return (
    <div className="w-full overflow-x-auto">
      <svg
        className="text-emerald-400/90"
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label="Daily rebuttal activity"
      >
        <rect width={w} height={h} fill="transparent" />
        <line
          x1={padL}
          y1={padT + innerH}
          x2={padL + innerW}
          y2={padT + innerH}
          stroke="rgba(255,255,255,0.15)"
          strokeWidth={1}
        />
        <path fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" d={d} />
        {points.map((p, i) => (
          <circle key={`${p.day}-${i}`} cx={xAt(i)} cy={yAt(p.count)} r={4} fill="currentColor" />
        ))}
        {labelIdx.map((i) => {
          const label = points[i]?.day ?? "";
          return (
            <text
              key={`lbl-${i}-${label}`}
              x={xAt(i)}
              y={h - 10}
              textAnchor="middle"
              className="fill-gray-500"
              style={{ fontSize: 11 }}
            >
              {label.length >= 10 ? label.slice(5) : label}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

function BarList({ title, items }: { title: string; items: KeyCount[] }) {
  const max = useMemo(() => Math.max(1, ...items.map((i) => i.count)), [items]);
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="text-sm font-semibold">{title}</div>
      <div className="mt-3 space-y-2">
        {items.slice(0, 12).map((it) => (
          <div key={it.key} className="space-y-1">
            <div className="flex items-center justify-between gap-3 text-xs text-gray-400">
              <div className="truncate">{it.key}</div>
              <div className="shrink-0">{it.count}</div>
            </div>
            <div className="h-2 w-full rounded bg-black/30">
              <div
                className="h-2 rounded bg-emerald-500/40"
                style={{ width: `${Math.round((it.count / max) * 100)}%` }}
              />
            </div>
          </div>
        ))}
        {items.length === 0 ? (
          <div className="text-sm text-gray-500">No data.</div>
        ) : null}
      </div>
    </div>
  );
}

export default function IntelligenceAnalyticsPage() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [demoMode, setDemoMode] = useState(false);
  const [isFounder, setIsFounder] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await waitForSessionAccessToken();
      if (!token) {
        setError(MSG_SESSION);
        return;
      }
      if (demoMode && isFounder) {
        setData({
          windowDays: days,
          cards: {
            totalCaptured: 128,
            totalReviewed: 42,
            coveragePct: 33,
            avgRating: 3.9,
            mostCommonFamily: "cash_flow",
            mostCommonRhetoricalType: "control_question",
          },
          series: {
            daily: [
              { day: "2026-05-01", count: 6 },
              { day: "2026-05-02", count: 10 },
              { day: "2026-05-03", count: 8 },
            ],
            objectionFamily: [
              { key: "cash_flow", count: 34 },
              { key: "trust", count: 22 },
              { key: "stall", count: 18 },
            ],
            tone: [
              { key: "direct", count: 40 },
              { key: "calm", count: 24 },
            ],
            rhetoricalType: [
              { key: "control_question", count: 46 },
              { key: "reframe", count: 32 },
            ],
            outcomeTag: [
              { key: "strong", count: 19 },
              { key: "weak", count: 8 },
              { key: "missed_context", count: 5 },
            ],
            topMerchantObjections: [
              { key: "The payment feels too heavy.", count: 9 },
              { key: "I need to think about it.", count: 7 },
            ],
          },
          breakdown: {
            families: [
              {
                family: "cash_flow",
                count: 34,
                avgRating: 4.1,
                weakPct: 0.12,
                repetitivePct: 0.08,
                missedContextPct: 0.09,
              },
              {
                family: "trust",
                count: 22,
                avgRating: 3.8,
                weakPct: 0.18,
                repetitivePct: 0.06,
                missedContextPct: 0.11,
              },
            ],
          },
        });
        return;
      }
      const res = await fetch(`${API_URL}/api/rebuttal-events/analytics?days=${days}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = (await res.json()) as AnalyticsResponse & { error?: string };
      if (!res.ok) {
        void body;
        setData(null);
        setError(MSG_PERFORMANCE_LOAD);
        return;
      }
      setData(body);
    } catch {
      setError(MSG_PERFORMANCE_LOAD);
    } finally {
      setLoading(false);
    }
  }, [days, demoMode, isFounder]);

  useEffect(() => {
    const supabase = createClient();
    void supabase.auth.getUser().then((res) => {
      setIsFounder(isFounderEmail(res.data.user?.email ?? ""));
    });
    if (typeof window !== "undefined") {
      const p = new URLSearchParams(window.location.search);
      setDemoMode(p.get("demo") === "1");
    }
    void load();
  }, [load]);

  const noPerformanceData =
    data != null && data.cards.totalCaptured === 0 && !loading && !error;

  const timesFacedByFamily = useMemo(() => {
    const m = new Map<string, number>();
    for (const row of data?.series.objectionFamily ?? []) {
      m.set(row.key, row.count);
    }
    return m;
  }, [data]);

  const topToneMode = useMemo(() => {
    const first = data?.series.tone?.[0];
    return first?.key ?? null;
  }, [data]);

  const missedContextAggregatePct = useMemo(() => {
    if (!data) return 0;
    return aggregateMissedContextPct(data);
  }, [data]);

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-2xl font-bold tracking-tight text-white">Performance</h2>
          <p className="text-sm text-gray-500">
            Simple aggregates over captured rebuttals (scoped to your account).
          </p>
        </div>
        <Link
          href="/dashboard"
          className="text-sm text-gray-400 underline hover:text-white"
        >
          Back to conversations
        </Link>
      </div>

      <div className="flex items-center gap-2">
        <div className="text-xs text-gray-500">Window</div>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="rounded-md border border-white/10 bg-black/30 px-2 py-1 text-xs text-gray-200"
        >
          {[7, 14, 30, 60, 90, 180, 365].map((d) => (
            <option key={d} value={d}>
              Last {d} days
            </option>
          ))}
        </select>
        <button
          onClick={() => void load()}
          className="rounded-md border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-gray-200 hover:bg-white/[0.06]"
        >
          Refresh
        </button>
      </div>

      {error ? (
        <DashboardErrorPanel message={error} onRetry={() => void load()} retryLabel="Refresh" />
      ) : null}

      {loading ? (
        <div className="text-sm text-gray-500">Loading…</div>
      ) : noPerformanceData ? (
        <DashboardEmptyState
          title="No performance data yet"
          description="Use RoboRebut during conversations to start building performance data."
        />
      ) : data ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <Card label="Rebuttals Generated" value={String(data.cards.totalCaptured ?? 0)} />
            <Card
              label="Most Common Objection"
              value={toTitleCaseFromSlug(data.cards.mostCommonFamily)}
            />
            <Card label="Top Tone Used" value={toTitleCaseFromSlug(topToneMode)} />
            <Card
              label="Review Coverage"
              value={formatCoveragePct(data.cards.coveragePct ?? 0)}
            />
            <Card label="Avg Rating" value={formatAvgRating(data.cards.avgRating)} />
            <Card
              label="Missed Context %"
              value={
                (data.cards.totalReviewed ?? 0) > 0
                  ? pct(missedContextAggregatePct)
                  : "—"
              }
            />
          </div>

          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <div className="text-sm font-semibold text-white">Daily activity</div>
            <p className="mt-1 text-xs text-gray-500">
              Rebuttals captured per day in the selected window.
            </p>
            <div className="mt-4">
              <DailyActivityChart points={data.series.daily ?? []} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <BarList title="Objection family distribution" items={data.series.objectionFamily} />
            <BarList title="Rhetorical type distribution" items={data.series.rhetoricalType} />
            <BarList title="Tone distribution" items={data.series.tone} />
            <BarList title="Outcome tag distribution" items={data.series.outcomeTag} />
          </div>

          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <div className="text-sm font-semibold">Top repeated merchant objections</div>
            <div className="mt-3 space-y-2">
              {data.series.topMerchantObjections.slice(0, 15).map((it) => (
                <div key={it.key} className="flex items-start justify-between gap-4">
                  <div className="text-sm text-gray-200">{it.key}</div>
                  <div className="shrink-0 text-xs text-gray-500">{it.count}</div>
                </div>
              ))}
              {data.series.topMerchantObjections.length === 0 ? (
                <div className="text-sm text-gray-500">No data.</div>
              ) : null}
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <div className="text-sm font-semibold text-white">OBJECTION BREAKDOWN</div>
            <div className="mt-3 overflow-x-auto overflow-hidden rounded-lg border border-white/10">
              <div className="min-w-[720px]">
                <div className="grid grid-cols-6 gap-3 bg-black/30 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <div>Objection Type</div>
                  <div className="text-right">Times Faced</div>
                  <div className="text-right">Reviewed</div>
                  <div className="text-right">Weak %</div>
                  <div className="text-right">Repetitive %</div>
                  <div className="text-right">Missed Context %</div>
                </div>
                <div className="divide-y divide-white/5">
                  {data.breakdown.families.length === 0 ? (
                    <div className="px-3 py-3 text-sm text-gray-500">No breakdown data yet.</div>
                  ) : (
                    data.breakdown.families.slice(0, 12).map((r) => {
                      const highlight = (r.weakPct ?? 0) > 0.3;
                      const timesFaced = timesFacedByFamily.get(r.family) ?? 0;
                      const timesReviewed = r.count;
                      return (
                        <div
                          key={r.family}
                          className={`grid grid-cols-6 gap-3 px-3 py-2 text-sm ${
                            highlight ? "bg-amber-500/10" : "bg-black/10"
                          }`}
                        >
                          <div className="min-w-0 truncate text-gray-200">
                            {toTitleCaseFromSlug(r.family)}
                          </div>
                          <div className="text-right text-gray-300">{timesFaced}</div>
                          <div className="text-right text-gray-300">{timesReviewed}</div>
                          <div className="text-right text-gray-300">{pct(r.weakPct ?? 0)}</div>
                          <div className="text-right text-gray-300">
                            {pct(r.repetitivePct ?? 0)}
                          </div>
                          <div className="text-right text-gray-300">
                            {pct(r.missedContextPct ?? 0)}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

