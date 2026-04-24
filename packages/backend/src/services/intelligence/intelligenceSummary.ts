/**
 * Phase 10 — Actionable Intelligence Surfaces (read-only).
 *
 * Builds decision-grade summaries from:
 * - variant_intelligence_snapshots
 * - variant_inventory_registry_snapshots
 * - rebuttal_reviews (Phase 9 disposition + structured_tags)
 * - intelligence_run_logs metadata
 *
 * Must NOT change Phase 8 recommendation logic.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type IntelligenceInsightsResponse = {
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
    tagCounts: Record<string, number>;
    topFailures: Array<{ tag: string; count: number }>;
  };
  operatorInsights: {
    weakestArea: string;
    strongestStrategy: string;
    topFailurePattern: string;
  };
  metadata: {
    run_id: string;
    window_days: number | null;
    min_sample_threshold: number | null;
  };
};

type SnapshotRow = {
  objection_type: string | null;
  strategy_tag: string | null;
  rhetorical_type: string | null;
  variant_key: string | null;
  usage_count: number;
  avg_rating: number | null;
  success_rate: number | null;
};

type RegistryRow = {
  objection_type: string | null;
  rhetorical_type: string | null;
  variant_key: string | null;
};

type ReviewRow = {
  disposition: string | null;
  structured_tags: string[] | null;
};

function toNum(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function toNullableNum(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function toStr(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

function topN<T>(items: T[], n: number): T[] {
  return items.slice(0, n);
}

export function buildInsightsFromRows(input: {
  runId: string;
  runMeta: { windowDays: number | null; minSampleThreshold: number | null };
  snapshots: SnapshotRow[];
  registry: RegistryRow[];
  reviews: ReviewRow[];
}): IntelligenceInsightsResponse {
  const { runId, runMeta, snapshots, registry, reviews } = input;

  const topPerformers = snapshots
    .filter((s) => s.usage_count > 0)
    .slice()
    .sort((a, b) => {
      const as = a.success_rate ?? -1;
      const bs = b.success_rate ?? -1;
      if (bs !== as) return bs - as;
      const ar = a.avg_rating ?? -1;
      const br = b.avg_rating ?? -1;
      if (br !== ar) return br - ar;
      return b.usage_count - a.usage_count;
    })
    .map((s) => ({
      objection_type: s.objection_type,
      strategy_tag: s.strategy_tag,
      rhetorical_type: s.rhetorical_type,
      usage_count: s.usage_count,
      success_rate: s.success_rate,
      avg_rating: s.avg_rating,
    }));

  const weakZones = snapshots
    .filter((s) => s.usage_count >= 5) // avoid noise; not changing Phase 8 logic, just surfacing
    .slice()
    .sort((a, b) => {
      const as = a.success_rate ?? 1;
      const bs = b.success_rate ?? 1;
      if (as !== bs) return as - bs;
      if (b.usage_count !== a.usage_count) return b.usage_count - a.usage_count;
      const ar = a.avg_rating ?? 10;
      const br = b.avg_rating ?? 10;
      return ar - br;
    })
    .map((s) => ({
      objection_type: s.objection_type,
      rhetorical_type: s.rhetorical_type,
      strategy_tag: s.strategy_tag,
      usage_count: s.usage_count,
      success_rate: s.success_rate,
      avg_rating: s.avg_rating,
    }));

  const underutilized = snapshots
    .filter((s) => s.usage_count > 0 && s.usage_count <= 3 && (s.avg_rating ?? 0) >= 4.3)
    .slice()
    .sort((a, b) => (b.avg_rating ?? -1) - (a.avg_rating ?? -1))
    .map((s) => ({
      objection_type: s.objection_type,
      rhetorical_type: s.rhetorical_type,
      variant_key: s.variant_key,
      usage_count: s.usage_count,
      avg_rating: s.avg_rating,
    }));

  // Missing coverage: registry variants with zero observed usage (group by objection_type + rhetorical_type).
  const observedKeys = new Set(
    snapshots.filter((s) => s.usage_count > 0).map((s) => String(s.variant_key ?? ""))
  );
  const missAgg = new Map<string, { objection_type: string | null; rhetorical_type: string | null; count: number }>();
  for (const r of registry) {
    const vk = String(r.variant_key ?? "");
    if (!vk) continue;
    if (observedKeys.has(vk)) continue;
    const k = `${r.objection_type ?? ""}|${r.rhetorical_type ?? ""}`;
    const cur = missAgg.get(k) ?? {
      objection_type: r.objection_type,
      rhetorical_type: r.rhetorical_type,
      count: 0,
    };
    cur.count += 1;
    missAgg.set(k, cur);
  }
  const missingCoverage = [...missAgg.values()]
    .sort((a, b) => b.count - a.count)
    .map((m) => ({
      objection_type: m.objection_type,
      rhetorical_type: m.rhetorical_type,
      missing_count: m.count,
    }));

  // Review breakdown: disposition + structured tags.
  const dispositionCounts = new Map<string, number>();
  const tagCounts = new Map<string, number>();
  for (const r of reviews) {
    const disp = r.disposition?.trim() || "unknown";
    dispositionCounts.set(disp, (dispositionCounts.get(disp) ?? 0) + 1);
    for (const tag of r.structured_tags ?? []) {
      const t = tag.trim();
      if (!t) continue;
      tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
    }
  }
  const topFailures = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tag, count]) => ({ tag, count }));

  // Operator insights (deterministic templates).
  const weakestArea =
    weakZones.length > 0
      ? `You struggle most with: ${weakZones[0]!.objection_type ?? "unknown"}`
      : "You struggle most with: unknown";
  const strongestStrategy =
    topPerformers.find((t) => t.strategy_tag)?.strategy_tag != null
      ? `Your strongest strategy: ${topPerformers.find((t) => t.strategy_tag)!.strategy_tag}`
      : "Your strongest strategy: unknown";
  const topFailurePattern =
    topFailures.length > 0
      ? `Most common failure: ${topFailures[0]!.tag}`
      : "Most common failure: unknown";

  return {
    topPerformers: topN(topPerformers, 5),
    weakZones: topN(weakZones, 5),
    underutilized: topN(underutilized, 10),
    missingCoverage: topN(missingCoverage, 10),
    reviewBreakdown: {
      dispositionCounts: Object.fromEntries(dispositionCounts.entries()),
      tagCounts: Object.fromEntries(tagCounts.entries()),
      topFailures,
    },
    operatorInsights: {
      weakestArea,
      strongestStrategy,
      topFailurePattern,
    },
    metadata: {
      run_id: runId,
      window_days: runMeta.windowDays,
      min_sample_threshold: runMeta.minSampleThreshold,
    },
  };
}

export async function buildLatestInsightsForUser(input: {
  supabase: SupabaseClient;
  userId: string;
}): Promise<IntelligenceInsightsResponse | null> {
  const { supabase, userId } = input;
  const { data: run, error: runErr } = await supabase
    .from("intelligence_run_logs")
    .select("*")
    .eq("user_id", userId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (runErr) throw new Error(runErr.message);
  if (!run) return null;

  const runId = String((run as { id?: unknown }).id ?? "");
  const meta = (run as { metadata?: unknown }).metadata;
  const runMeta = {
    windowDays:
      meta && typeof meta === "object"
        ? toNullableNum((meta as { windowDays?: unknown }).windowDays)
        : null,
    minSampleThreshold:
      meta && typeof meta === "object"
        ? toNullableNum((meta as { minSampleThreshold?: unknown }).minSampleThreshold)
        : null,
  };

  const { data: snaps, error: snErr } = await supabase
    .from("variant_intelligence_snapshots")
    .select("objection_type,strategy_tag,rhetorical_type,variant_key,usage_count,avg_rating,success_rate")
    .eq("user_id", userId)
    .eq("run_id", runId)
    .limit(5000);
  if (snErr) throw new Error(snErr.message);

  const snapshots: SnapshotRow[] = (snaps ?? []).map((r) => ({
    objection_type: toStr((r as any).objection_type),
    strategy_tag: toStr((r as any).strategy_tag),
    rhetorical_type: toStr((r as any).rhetorical_type),
    variant_key: toStr((r as any).variant_key),
    usage_count: toNum((r as any).usage_count, 0),
    avg_rating: toNullableNum((r as any).avg_rating),
    success_rate: toNullableNum((r as any).success_rate),
  }));

  const { data: reg, error: regErr } = await supabase
    .from("variant_inventory_registry_snapshots")
    .select("objection_type,rhetorical_type,variant_key")
    .eq("user_id", userId)
    .eq("run_id", runId)
    .limit(5000);
  if (regErr) throw new Error(regErr.message);

  const registry: RegistryRow[] = (reg ?? []).map((r) => ({
    objection_type: toStr((r as any).objection_type),
    rhetorical_type: toStr((r as any).rhetorical_type),
    variant_key: toStr((r as any).variant_key),
  }));

  // Reviews in the same time window (if present), otherwise all reviews.
  let reviewQuery = supabase
    .from("rebuttal_reviews")
    .select("disposition,structured_tags")
    .eq("user_id", userId)
    .limit(10000);
  if (runMeta.windowDays != null) {
    const since = new Date(Date.now() - runMeta.windowDays * 24 * 60 * 60 * 1000).toISOString();
    // Join-less approximation: filter by reviewed_at when present.
    reviewQuery = reviewQuery.gte("reviewed_at", since);
  }
  const { data: revs, error: revErr } = await reviewQuery;
  if (revErr) throw new Error(revErr.message);

  const reviews: ReviewRow[] = (revs ?? []).map((r) => ({
    disposition: toStr((r as any).disposition),
    structured_tags: Array.isArray((r as any).structured_tags)
      ? ((r as any).structured_tags as unknown[]).filter((t) => typeof t === "string") as string[]
      : null,
  }));

  return buildInsightsFromRows({ runId, runMeta, snapshots, registry, reviews });
}

