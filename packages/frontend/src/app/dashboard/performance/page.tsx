"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { API_URL } from "@/lib/env";
import {
  DashboardEmptyState,
  DashboardErrorPanel,
} from "@/components/dashboard/DashboardEmptyState";
import { MSG_PERFORMANCE_LOAD, MSG_SESSION } from "@/lib/userFacingErrors";

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

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, Math.max(0, maxLen - 1)).trimEnd() + "…";
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-1 text-xl font-semibold text-white">{value}</div>
    </div>
  );
}

function CountBadge({ count }: { count: number }) {
  return (
    <span className="inline-flex items-center rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-xs text-gray-300">
      {count}
    </span>
  );
}

export default function PerformancePage() {
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await waitForSessionAccessToken();
      if (!token) {
        setError(MSG_SESSION);
        setData(null);
        return;
      }
      const res = await fetch(`${API_URL}/api/rebuttal-events/analytics?days=90`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = (await res.json()) as AnalyticsResponse & { error?: string };
      if (!res.ok) {
        void body;
        setError(MSG_PERFORMANCE_LOAD);
        setData(null);
        return;
      }
      setData(body);
    } catch {
      setError(MSG_PERFORMANCE_LOAD);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const totalCaptured = data?.cards.totalCaptured ?? 0;
  const noData = !loading && !error && data != null && totalCaptured === 0;

  const topObjectionRows = useMemo(() => data?.series.objectionFamily?.slice(0, 10) ?? [], [data]);
  const topMerchantRows = useMemo(
    () => data?.series.topMerchantObjections?.slice(0, 10) ?? [],
    [data]
  );
  const familyBreakdown = useMemo(() => data?.breakdown.families ?? [], [data]);

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-2xl font-bold tracking-tight text-white">My Patterns</h2>
          <p className="text-sm text-gray-500">How your calls are going based on your last 90 days.</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-md border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-gray-200 hover:bg-white/[0.06]"
          >
            Refresh
          </button>
          <Link href="/dashboard" className="text-sm text-gray-400 underline hover:text-white">
            Back to conversations
          </Link>
        </div>
      </div>

      {error ? (
        <DashboardErrorPanel message={error} onRetry={() => void load()} retryLabel="Refresh" />
      ) : null}

      {loading ? (
        <div className="text-sm text-gray-500">Loading…</div>
      ) : noData ? (
        <DashboardEmptyState
          title="No rebuttal data yet."
          description="Start a coaching session to see your patterns."
        />
      ) : !data ? (
        <div className="text-sm text-gray-500">No data.</div>
      ) : (
        <>
          {/* SUMMARY CARDS */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Card label="Rebuttals Generated" value={String(data.cards.totalCaptured ?? 0)} />
            <Card
              label="Most Common Objection"
              value={toTitleCaseFromSlug(data.cards.mostCommonFamily)}
            />
            <Card
              label="Top Tone Used"
              value={toTitleCaseFromSlug(data.cards.mostCommonRhetoricalType)}
            />
          </div>

          {/* TOP OBJECTIONS YOU FACE */}
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <div className="text-sm font-semibold text-white">TOP OBJECTIONS YOU FACE</div>
            <div className="mt-3 space-y-2">
              {topObjectionRows.length === 0 ? (
                <div className="text-sm text-gray-500">No objection data yet.</div>
              ) : (
                topObjectionRows.map((r) => (
                  <div
                    key={r.key}
                    className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2"
                  >
                    <div className="min-w-0 truncate text-sm text-gray-200">
                      {toTitleCaseFromSlug(r.key)}
                    </div>
                    <CountBadge count={r.count} />
                  </div>
                ))
              )}
            </div>
          </div>

          {/* WHAT CLIENTS ACTUALLY SAY */}
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <div className="text-sm font-semibold text-white">WHAT CLIENTS ACTUALLY SAY</div>
            <div className="mt-3 space-y-2">
              {topMerchantRows.length === 0 ? (
                <div className="text-sm text-gray-500">No merchant-message data yet.</div>
              ) : (
                topMerchantRows.map((r) => (
                  <div
                    key={r.key}
                    className="flex items-start justify-between gap-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2"
                  >
                    <div className="min-w-0 text-sm text-gray-200">
                      {truncate(r.key, 80)}
                    </div>
                    <CountBadge count={r.count} />
                  </div>
                ))
              )}
            </div>
          </div>

          {/* OBJECTION BREAKDOWN */}
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <div className="text-sm font-semibold text-white">OBJECTION BREAKDOWN</div>
            <div className="mt-3 overflow-hidden rounded-lg border border-white/10">
              <div className="grid grid-cols-4 gap-3 bg-black/30 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                <div>Objection Type</div>
                <div className="text-right">Times Faced</div>
                <div className="text-right">Weak %</div>
                <div className="text-right">Repetitive %</div>
              </div>
              <div className="divide-y divide-white/5">
                {familyBreakdown.length === 0 ? (
                  <div className="px-3 py-3 text-sm text-gray-500">No breakdown data yet.</div>
                ) : (
                  familyBreakdown.map((r) => {
                    const highlight = (r.weakPct ?? 0) > 0.3;
                    return (
                      <div
                        key={r.family}
                        className={`grid grid-cols-4 gap-3 px-3 py-2 text-sm ${
                          highlight ? "bg-amber-500/10" : "bg-black/10"
                        }`}
                      >
                        <div className="min-w-0 truncate text-gray-200">
                          {toTitleCaseFromSlug(r.family)}
                        </div>
                        <div className="text-right text-gray-300">{r.count}</div>
                        <div className="text-right text-gray-300">{pct(r.weakPct ?? 0)}</div>
                        <div className="text-right text-gray-300">
                          {pct(r.repetitivePct ?? 0)}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

