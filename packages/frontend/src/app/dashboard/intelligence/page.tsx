"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { API_URL } from "@/lib/env";
import { DashboardEmptyState, DashboardErrorPanel } from "@/components/dashboard/DashboardEmptyState";
import { MSG_INSIGHTS_LOAD, MSG_SESSION } from "@/lib/userFacingErrors";

type InsightsResponse = {
  ok: true;
  insights?: null;
  run_id?: string;
  window_days?: number | null;
  min_sample_threshold?: number | null;
  topPerformers: Array<{
    objection_type: string | null;
    strategy_tag: string | null;
    rhetorical_type: string | null;
    usage_count: number;
    success_rate: number | null;
    avg_rating: number | null;
  }>;
  weakZones: Array<{
    objection_type: string | null;
    rhetorical_type: string | null;
    strategy_tag: string | null;
    usage_count: number;
    success_rate: number | null;
    avg_rating: number | null;
  }>;
  underutilized: Array<{
    objection_type: string | null;
    rhetorical_type: string | null;
    variant_key: string | null;
    usage_count: number;
    avg_rating: number | null;
  }>;
  missingCoverage: Array<{
    objection_type: string | null;
    rhetorical_type: string | null;
    missing_count: number;
  }>;
  reviewBreakdown: {
    dispositionCounts: Record<string, number>;
    topFailures: Array<{ tag: string; count: number }>;
  };
  operatorInsights: {
    weakestArea: string;
    strongestStrategy: string;
    topFailurePattern: string;
  };
};

async function waitForSessionAccessToken(): Promise<string | null> {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

function fmtPct(v: number | null): string {
  if (v == null) return "—";
  return `${Math.round(v * 100)}%`;
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-white">{value}</div>
    </div>
  );
}

function Row({
  left,
  right,
}: {
  left: React.ReactNode;
  right: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-white/10 bg-black/20 p-3">
      <div className="min-w-0 text-sm text-gray-200">{left}</div>
      <div className="shrink-0 text-xs text-gray-500">{right}</div>
    </div>
  );
}

export default function IntelligenceInsightsPage() {
  const [data, setData] = useState<InsightsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const token = await waitForSessionAccessToken();
      if (!token) {
        setError(MSG_SESSION);
        return;
      }
      const res = await fetch(`${API_URL}/api/admin/intelligence/insights`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = (await res.json()) as unknown;
      if (!res.ok) {
        if (res.status === 403) {
          setData(null);
          setForbidden(true);
          return;
        }
        void body;
        setError(MSG_INSIGHTS_LOAD);
        return;
      }
      setData(body as InsightsResponse);
    } catch {
      setError(MSG_INSIGHTS_LOAD);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-2xl font-bold tracking-tight text-white">Insights</h2>
          <p className="text-sm text-gray-500">
            Read-only intelligence from your latest offline run.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => void load()}
            className="rounded-md border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-gray-200 hover:bg-white/[0.06]"
          >
            Refresh
          </button>
          <Link
            href="/dashboard/intelligence/review"
            className="text-sm text-gray-400 underline hover:text-white"
          >
            Review
          </Link>
        </div>
      </div>

      {forbidden ? (
        <DashboardEmptyState
          title="Insights not available"
          description={
            <>
              <span>This feature is reserved for advanced users.</span>
              <span className="mt-2 block text-gray-500">
                You can still use Performance and Review to improve responses.
              </span>
            </>
          }
        />
      ) : error ? (
        <DashboardErrorPanel message={error} onRetry={() => void load()} retryLabel="Refresh" />
      ) : null}

      {loading ? (
        <div className="text-sm text-gray-500">Loading…</div>
      ) : forbidden ? null : error ? null : !data ? (
        <div className="text-sm text-gray-500">No data.</div>
      ) : (data as { insights?: unknown }).insights === null ? (
        <DashboardEmptyState
          title="Insights aren’t ready yet"
          description="Once your workspace has enough captured rebuttals, intelligence summaries will appear here. Use Performance and Review in the meantime."
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Card label="Weakest area" value={data.operatorInsights.weakestArea} />
            <Card
              label="Strongest strategy"
              value={data.operatorInsights.strongestStrategy}
            />
            <Card
              label="Top failure pattern"
              value={data.operatorInsights.topFailurePattern}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
              <div className="text-sm font-semibold">Top performers</div>
              {data.topPerformers.length === 0 ? (
                <div className="text-sm text-gray-500">No performer data yet.</div>
              ) : (
                data.topPerformers.map((r, i) => (
                  <Row
                    key={`${r.objection_type ?? "x"}-${i}`}
                    left={
                      <div className="space-y-1">
                        <div className="truncate">
                          {r.objection_type ?? "unknown"}
                          {r.strategy_tag ? ` · ${r.strategy_tag}` : ""}
                        </div>
                        <div className="text-[11px] text-gray-500">
                          {r.rhetorical_type ?? "—"}
                        </div>
                      </div>
                    }
                    right={
                      <div className="space-y-1 text-right">
                        <div>{fmtPct(r.success_rate)}</div>
                        <div className="text-[11px]">
                          n={r.usage_count} · ★{r.avg_rating ?? "—"}
                        </div>
                      </div>
                    }
                  />
                ))
              )}
            </div>

            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
              <div className="text-sm font-semibold">Weak zones</div>
              {data.weakZones.length === 0 ? (
                <div className="text-sm text-gray-500">No weak-zone data yet.</div>
              ) : (
                data.weakZones.map((r, i) => (
                  <Row
                    key={`${r.objection_type ?? "x"}-${i}`}
                    left={
                      <div className="space-y-1">
                        <div className="truncate">
                          {r.objection_type ?? "unknown"}
                          {r.strategy_tag ? ` · ${r.strategy_tag}` : ""}
                        </div>
                        <div className="text-[11px] text-gray-500">
                          {r.rhetorical_type ?? "—"}
                        </div>
                      </div>
                    }
                    right={
                      <div className="space-y-1 text-right">
                        <div>{fmtPct(r.success_rate)}</div>
                        <div className="text-[11px]">
                          n={r.usage_count} · ★{r.avg_rating ?? "—"}
                        </div>
                      </div>
                    }
                  />
                ))
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
              <div className="text-sm font-semibold">Underutilized opportunities</div>
              {data.underutilized.length === 0 ? (
                <div className="text-sm text-gray-500">None detected.</div>
              ) : (
                data.underutilized.slice(0, 10).map((r, i) => (
                  <Row
                    key={`${r.variant_key ?? "x"}-${i}`}
                    left={
                      <div className="truncate">
                        {r.objection_type ?? "unknown"} · {r.rhetorical_type ?? "—"}
                      </div>
                    }
                    right={
                      <div>
                        n={r.usage_count} · ★{r.avg_rating ?? "—"}
                      </div>
                    }
                  />
                ))
              )}
            </div>

            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
              <div className="text-sm font-semibold">Missing coverage</div>
              {data.missingCoverage.length === 0 ? (
                <div className="text-sm text-gray-500">None detected.</div>
              ) : (
                data.missingCoverage.slice(0, 10).map((r, i) => (
                  <Row
                    key={`${r.objection_type ?? "x"}-${i}`}
                    left={
                      <div className="truncate">
                        {r.objection_type ?? "unknown"} · {r.rhetorical_type ?? "—"}
                      </div>
                    }
                    right={<div>missing={r.missing_count}</div>}
                  />
                ))
              )}
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
            <div className="text-sm font-semibold">Review breakdown</div>
            <div className="flex flex-wrap gap-2 text-xs text-gray-400">
              {Object.entries(data.reviewBreakdown.dispositionCounts ?? {}).map(([k, v]) => (
                <span key={k} className="rounded-full border border-white/10 bg-black/20 px-2 py-1">
                  {k}: {v}
                </span>
              ))}
            </div>
            <div className="text-sm text-gray-500">
              Top failures:{" "}
              {data.reviewBreakdown.topFailures.slice(0, 5).map((t) => `${t.tag} (${t.count})`).join(", ") ||
                "—"}
            </div>
            <div className="text-[11px] text-gray-600">
              Run: {(data.run_id as string) ?? "—"} · window_days={data.window_days ?? "—"} · min_sample_threshold=
              {data.min_sample_threshold ?? "—"}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

