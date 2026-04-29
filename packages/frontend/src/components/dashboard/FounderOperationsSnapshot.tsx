"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type SnapshotResponse = {
  totalUsers: number | null;
  totalConversations: number | null;
  totalMessages: number | null;
  savedResponses: number | null;
  activeUsers7d: number | null;
  planDistribution: {
    free: number | null;
    starter: number | null;
    pro: number | null;
    team: number | null;
  };
  recentUsers?: Array<{
    userId: string;
    email: string | null;
    planType: string | null;
    usageCount: number | null;
    createdAt: string | null;
  }>;
  recentConversations?: Array<{
    id: string;
    userId: string;
    title: string | null;
    updatedAt: string | null;
    createdAt: string | null;
  }>;
  highUsageAccounts?: Array<{
    userId: string;
    email: string | null;
    planType: string | null;
    usageCount: number;
    updatedAt: string | null;
  }>;
};

function displayCount(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString()
    : "\u2014";
}

export function FounderOperationsSnapshot({ apiBase }: { apiBase: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SnapshotResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        setLoading(true);
        setError(null);
        const token =
          (await createClient().auth.getSession()).data.session?.access_token ??
          null;
        if (!token) {
          if (!cancelled) setError("Session unavailable.");
          return;
        }

        const res = await fetch(`${apiBase}/api/founder/operations-snapshot`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const json = (await res.json()) as SnapshotResponse;
        if (!res.ok) {
          if (!cancelled) setError("Operations snapshot unavailable.");
          return;
        }
        if (!cancelled) setData(json);
      } catch {
        if (!cancelled) setError("Operations snapshot unavailable.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium uppercase tracking-wide text-gray-500">
            Founder Operations Snapshot
          </h2>
        </div>
        {error ? (
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-gray-400">
            {error}
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ["Total users", data?.totalUsers],
            ["Total conversations", data?.totalConversations],
            ["Total messages/rebuttals", data?.totalMessages],
            ["Saved responses", data?.savedResponses],
            ["Active users (7d)", data?.activeUsers7d],
            ["Plan: free", data?.planDistribution?.free],
            ["Plan: starter", data?.planDistribution?.starter],
            ["Plan: pro", data?.planDistribution?.pro],
            ["Plan: team", data?.planDistribution?.team],
          ].map(([label, value]) => (
            <div
              key={label}
              className="rounded-xl border border-white/10 bg-white/[0.03] p-4"
            >
              <p className="text-xs text-gray-500">{label}</p>
              <p className="mt-2 text-2xl font-semibold text-white">
                {loading ? "\u2014" : displayCount(value as number | null | undefined)}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-gray-500">
          Operational Visibility
        </h2>
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <h3 className="text-sm font-semibold text-white">Recent users</h3>
            <div className="mt-3 space-y-2 text-sm">
              {(data?.recentUsers ?? []).length === 0 ? (
                <p className="text-gray-500">No recent users available.</p>
              ) : (
                (data?.recentUsers ?? []).map((u) => (
                  <div key={u.userId} className="rounded-lg border border-white/10 p-2">
                    <p className="truncate text-gray-200">{u.email ?? u.userId}</p>
                    <p className="text-xs text-gray-500">
                      {u.planType ?? "unknown"} • usage {displayCount(u.usageCount)}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <h3 className="text-sm font-semibold text-white">Recent conversations</h3>
            <div className="mt-3 space-y-2 text-sm">
              {(data?.recentConversations ?? []).length === 0 ? (
                <p className="text-gray-500">No recent conversations available.</p>
              ) : (
                (data?.recentConversations ?? []).map((c) => (
                  <div key={c.id} className="rounded-lg border border-white/10 p-2">
                    <p className="truncate text-gray-200">{c.title ?? "Untitled conversation"}</p>
                    <p className="text-xs text-gray-500 truncate">{c.userId}</p>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <h3 className="text-sm font-semibold text-white">Recent high-usage accounts</h3>
            <div className="mt-3 space-y-2 text-sm">
              {(data?.highUsageAccounts ?? []).length === 0 ? (
                <p className="text-gray-500">No high-usage accounts available.</p>
              ) : (
                (data?.highUsageAccounts ?? []).map((u) => (
                  <div key={u.userId} className="rounded-lg border border-white/10 p-2">
                    <p className="truncate text-gray-200">{u.email ?? u.userId}</p>
                    <p className="text-xs text-gray-500">
                      {u.planType ?? "unknown"} • usage {displayCount(u.usageCount)}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

