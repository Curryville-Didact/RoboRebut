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
            daily: [],
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
            ],
            topMerchantObjections: [
              { key: "The payment feels too heavy.", count: 9 },
              { key: "I need to think about it.", count: 7 },
            ],
          },
          breakdown: {
            families: [
              { family: "cash_flow", count: 34, avgRating: 4.1, weakPct: 0.12, repetitivePct: 0.08, missedContextPct: 0.09 },
              { family: "trust", count: 22, avgRating: 3.8, weakPct: 0.18, repetitivePct: 0.06, missedContextPct: 0.11 },
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Card label="Total captured" value={String(data.cards.totalCaptured)} />
            <Card label="Total reviewed" value={String(data.cards.totalReviewed)} />
            <Card label="Review coverage" value={`${data.cards.coveragePct}%`} />
            <Card
              label="Average rating"
              value={data.cards.avgRating == null ? "—" : String(data.cards.avgRating)}
            />
            <Card
              label="Most common family"
              value={data.cards.mostCommonFamily ?? "—"}
            />
            <Card
              label="Most common rhetorical type"
              value={data.cards.mostCommonRhetoricalType ?? "—"}
            />
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
            <div className="text-sm font-semibold">Top families (reviewed)</div>
            <div className="mt-3 space-y-2">
              {data.breakdown.families.slice(0, 12).map((f) => (
                <div key={f.family} className="grid grid-cols-[1fr_90px_90px] gap-2 text-sm">
                  <div className="truncate text-gray-200">{f.family}</div>
                  <div className="text-right text-gray-400">
                    {f.avgRating == null ? "—" : f.avgRating.toFixed(2)}
                  </div>
                  <div className="text-right text-gray-500">{f.count}</div>
                </div>
              ))}
              {data.breakdown.families.length === 0 ? (
                <div className="text-sm text-gray-500">No reviewed data yet.</div>
              ) : null}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

