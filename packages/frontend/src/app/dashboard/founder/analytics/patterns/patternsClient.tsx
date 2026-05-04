"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Summary = {
  window: {
    limit: number;
    conversationId: string | null;
    intelRows: number;
  };
  selection: {
    topPatternKeys: Array<{ patternKey: string; count: number }>;
    topStrategyTags: Array<{ strategyTag: string; count: number }>;
    singleCandidateRate: number | null;
  };
  antiRepeat: { appliedRate: number | null; byReason: Record<string, number> };
  dvl: { appliedRate: number | null; variantUsage: Record<string, number> };
  confidence: { avg: number | null };
  saves: { saveRate: number | null; savedCount: number };
  health: {
    missingDecisionMetaRate: number;
    missingPatternKeyRate: number;
    fallbackMessageCount: number | null;
    unknownObjectionTypeCount: number;
    nullConfidenceCount: number;
  };
  branches: Array<{
    objectionType: string;
    total: number;
    avgUniquePatternKeyCount: number | null;
    singleCandidateRate: number | null;
    avgScoreGap: number | null;
    saveRate: number | null;
  }>;
};

function Card({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">
        {label}
      </div>
      <div className="mt-2 text-2xl font-bold text-white">{value}</div>
    </div>
  );
}

function Table({
  title,
  headers,
  rows,
}: {
  title: string;
  headers: string[];
  rows: Array<Array<React.ReactNode>>;
}) {
  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <h2 className="text-sm font-semibold text-white">{title}</h2>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-xs text-gray-300">
          <thead className="text-[11px] uppercase tracking-wider text-gray-500">
            <tr>
              {headers.map((h) => (
                <th key={h} className="px-2 py-2">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-white/5">
                {r.map((c, j) => (
                  <td key={j} className="px-2 py-2 align-top">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function fmtPct(v: number | null | undefined): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function fmtNum(v: number | null | undefined): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return v.toFixed(2);
}

export function FounderPatternAnalyticsClient({ apiBase }: { apiBase: string }) {
  const [limit, setLimit] = useState(250);
  const [conversationId, setConversationId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Summary | null>(null);
  const [phrases, setPhrases] = useState<
    Array<{
      phrase: string;
      deal_type: string | null;
      vertical: string | null;
      occurrences: number;
      conversation_count: number;
    }>
  >([]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const token =
        (await createClient().auth.getSession()).data.session?.access_token ??
        null;
      if (!token) {
        setError("No session token available.");
        return;
      }
      const params = new URLSearchParams();
      params.set("limit", String(limit));
      if (conversationId.trim()) params.set("conversationId", conversationId.trim());
      const url = `${apiBase}/api/founder/analytics/pattern-intelligence?${params.toString()}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const json = (await res.json()) as Summary;
      if (!res.ok) {
        setError(`Request failed (${res.status}).`);
        setData(json);
        return;
      }
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const overview = useMemo(() => {
    const turns = data?.window.intelRows ?? 0;
    return {
      turns,
      antiRepeat: fmtPct(data?.antiRepeat.appliedRate ?? null),
      dvl: fmtPct(data?.dvl.appliedRate ?? null),
      saveRate: fmtPct(data?.saves.saveRate ?? null),
      fallback: data?.health.fallbackMessageCount ?? null,
      singleCandidate: fmtPct(data?.selection.singleCandidateRate ?? null),
    };
  }, [data]);

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-400">Limit</label>
            <input
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="mt-1 w-28 rounded-lg border border-white/15 bg-transparent px-3 py-2 text-sm text-white outline-none focus:border-white/40"
              inputMode="numeric"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400">
              Conversation ID (optional)
            </label>
            <input
              value={conversationId}
              onChange={(e) => setConversationId(e.target.value)}
              placeholder="uuid"
              className="mt-1 w-[360px] max-w-full rounded-lg border border-white/15 bg-transparent px-3 py-2 text-sm text-white outline-none focus:border-white/40"
            />
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex rounded-lg border border-emerald-500/40 bg-emerald-600/15 px-4 py-2 text-sm font-semibold text-emerald-50 transition hover:bg-emerald-600/25 disabled:opacity-40"
            disabled={loading}
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
          {error ? <span className="text-sm text-red-300">{error}</span> : null}
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <Card label="Turns analyzed" value={overview.turns} />
        <Card label="Anti-repeat rate" value={overview.antiRepeat} />
        <Card label="DVL rate" value={overview.dvl} />
        <Card label="Save rate" value={overview.saveRate} />
        <Card
          label="Fallback count"
          value={overview.fallback == null ? "—" : overview.fallback}
        />
        <Card label="Single-candidate rate" value={overview.singleCandidate} />
      </div>

      <Table
        title="Top pattern keys"
        headers={["patternKey", "count"]}
        rows={(data?.selection.topPatternKeys ?? []).map((r) => [
          <span key={r.patternKey} className="font-mono text-[11px] text-gray-200">
            {r.patternKey}
          </span>,
          r.count,
        ])}
      />

      <Table
        title="Top strategy tags"
        headers={["strategyTag", "count"]}
        rows={(data?.selection.topStrategyTags ?? []).map((r) => [
          <span key={r.strategyTag} className="font-mono text-[11px] text-gray-200">
            {r.strategyTag}
          </span>,
          r.count,
        ])}
      />

      <Table
        title="Branch quality (by objection type)"
        headers={["objectionType", "turns", "avg unique keys", "single-candidate %", "avg score gap", "save %"]}
        rows={(data?.branches ?? []).map((b) => [
          <span key={b.objectionType} className="font-mono text-[11px] text-gray-200">
            {b.objectionType}
          </span>,
          b.total,
          fmtNum(b.avgUniquePatternKeyCount),
          fmtPct(b.singleCandidateRate),
          fmtNum(b.avgScoreGap),
          fmtPct(b.saveRate),
        ])}
      />

      <Table
        title="Anti-repeat reasons"
        headers={["reason", "count"]}
        rows={Object.entries(data?.antiRepeat.byReason ?? {}).map(([k, v]) => [
          <span key={k} className="font-mono text-[11px] text-gray-200">
            {k}
          </span>,
          v,
        ])}
      />

      <Table
        title="DVL usage"
        headers={["variant", "count"]}
        rows={Object.entries(data?.dvl.variantUsage ?? {}).map(([k, v]) => [
          <span key={k} className="font-mono text-[11px] text-gray-200">
            {k}
          </span>,
          v,
        ])}
      />

      <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
        <h2 className="text-sm font-semibold text-white">Telemetry health</h2>
        <pre className="mt-3 overflow-x-auto rounded-lg border border-white/10 bg-black/40 p-3 text-xs text-gray-200">
          {JSON.stringify(data?.health ?? {}, null, 2)}
        </pre>
      </section>

      <Table
        title="Phrase patterns (call transcripts)"
        headers={["phrase", "deal_type", "vertical", "occurrences", "conversation_count"]}
        rows={phrases.map((p, idx) => [
          <span key={`${p.phrase}-${idx}`} className="max-w-md whitespace-pre-wrap text-gray-200">
            {p.phrase}
          </span>,
          <span key={`dt-${idx}`} className="font-mono text-[11px] text-gray-300">
            {p.deal_type ?? "—"}
          </span>,
          <span key={`v-${idx}`} className="font-mono text-[11px] text-gray-300">
            {p.vertical ?? "—"}
          </span>,
          p.occurrences,
          p.conversation_count,
        ])}
      />
    </div>
  );
}

