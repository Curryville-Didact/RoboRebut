/**
 * Phase 8 — Offline Intelligence Layer
 *
 * Offline-only aggregation + recommendation rules over captured rebuttal events/reviews.
 * Must not affect Live runtime behavior.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { persistVariantInventoryRegistrySnapshot } from "./variantInventoryRegistry.js";

export type IntelligenceRecommendationType =
  | "top_performer"
  | "underperforming"
  | "needs_revision"
  | "underutilized"
  | "unused"
  | "unknown";

export type IntelligenceSnapshotRow = {
  objection_type: string | null;
  strategy_tag: string | null;
  rhetorical_type: string | null;
  variant_key: string | null;
  usage_count: number;
  avg_rating: number | null;
  positive_outcome_count: number;
  negative_outcome_count: number;
  success_rate: number | null;
  under_review_flag: boolean;
  recommendation_type: IntelligenceRecommendationType;
  recommendation_reason: string;
  metadata: Record<string, unknown> | null;
};

type ReviewOutcomeTag =
  | "strong"
  | "weak"
  | "repetitive"
  | "missed_context"
  | "missed_family"
  | "not_sure";

export type OfflineEvent = {
  id: string;
  objection_type: string | null;
  strategy_tag: string | null;
  rhetorical_type: string | null;
  selected_variant_text: string | null;
  final_live_script: string | null;
};

export type OfflineReview = {
  rebuttal_event_id: string;
  rating: number;
  outcome_tag: ReviewOutcomeTag | null;
  structured_tags?: string[] | null;
};

function stableVariantKey(text: string): string {
  const s = text.trim();
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return `v_${h.toString(16)}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function successRate(pos: number, neg: number): number | null {
  const denom = pos + neg;
  if (denom <= 0) return null;
  return round2(pos / denom);
}

const DEFAULT_MIN_SAMPLE_THRESHOLD = 5;

function minSampleThreshold(): number {
  const raw = process.env.INTELLIGENCE_MIN_SAMPLE_THRESHOLD;
  const n = raw != null ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return DEFAULT_MIN_SAMPLE_THRESHOLD;
  const i = Math.floor(n);
  if (i <= 0) return DEFAULT_MIN_SAMPLE_THRESHOLD;
  return Math.min(i, 100);
}

function recommend(input: {
  usageCount: number;
  avgRating: number | null;
  successRate: number | null;
  fromRegistryOnly: boolean;
}): { type: IntelligenceRecommendationType; reason: string } {
  const { usageCount, avgRating, successRate, fromRegistryOnly } = input;
  const minN = minSampleThreshold();

  if (usageCount <= 0) {
    return { type: "unused", reason: "No captured usage in the current window." };
  }

  // Deterministic, rules-based recommendations (no scoring models).
  if (usageCount <= 3 && avgRating != null && avgRating >= 4.3) {
    return { type: "underutilized", reason: "Low usage with strong average rating." };
  }

  if (!fromRegistryOnly && usageCount < minN) {
    return {
      type: "unknown",
      reason: `Insufficient data (<${minN} samples) for a high-confidence recommendation.`,
    };
  }

  if (usageCount >= 10 && avgRating != null && avgRating <= 2.6) {
    return { type: "needs_revision", reason: "High usage with low average rating." };
  }
  if (usageCount >= 10 && successRate != null && successRate <= 0.35) {
    return { type: "underperforming", reason: "High usage with low success rate." };
  }
  if (usageCount >= 10 && avgRating != null && avgRating >= 4.3) {
    return { type: "top_performer", reason: "High usage with strong average rating." };
  }
  if (usageCount >= 10 && successRate != null && successRate >= 0.7) {
    return { type: "top_performer", reason: "High usage with strong success rate." };
  }

  return { type: "unknown", reason: "Insufficient signal for a stronger classification." };
}

export function aggregateOfflineIntelligence(input: {
  events: OfflineEvent[];
  reviews: OfflineReview[];
  registryVariants?: Array<{
    objection_type: string | null;
    strategy_tag: string | null;
    rhetorical_type: string | null;
    variant_key: string | null;
    variant_text_sample: string | null;
    source_family: string | null;
    source_module: string | null;
  }>;
}): IntelligenceSnapshotRow[] {
  const { events, reviews } = input;
  const registry = input.registryVariants ?? [];
  const reviewByEvent = new Map<string, OfflineReview>();
  for (const r of reviews) reviewByEvent.set(r.rebuttal_event_id, r);

  type Agg = {
    objection_type: string | null;
    strategy_tag: string | null;
    rhetorical_type: string | null;
    variant_key: string | null;
    usage_count: number;
    rating_sum: number;
    rating_count: number;
    low_rating_count: number;
    high_rating_count: number;
    reviewed_count: number;
    pos: number;
    neg: number;
    under_review_flag: boolean;
    under_review_reasons: string[];
    variant_text_sample: string | null;
  };

  const keyFor = (e: OfflineEvent): string => {
    const objection = e.objection_type ?? "";
    const strategy = e.strategy_tag ?? "";
    const rhetorical = e.rhetorical_type ?? "";
    const variantText = (e.selected_variant_text ?? e.final_live_script ?? "").trim();
    const vkey = variantText ? stableVariantKey(variantText) : "";
    return [objection, strategy, rhetorical, vkey].join("|");
  };

  const agg = new Map<string, Agg>();
  for (const e of events) {
    const k = keyFor(e);
    const variantText = (e.selected_variant_text ?? e.final_live_script ?? "").trim();
    const vkey = variantText ? stableVariantKey(variantText) : null;
    const cur =
      agg.get(k) ??
      ({
        objection_type: e.objection_type ?? null,
        strategy_tag: e.strategy_tag ?? null,
        rhetorical_type: e.rhetorical_type ?? null,
        variant_key: vkey,
        usage_count: 0,
        rating_sum: 0,
        rating_count: 0,
        low_rating_count: 0,
        high_rating_count: 0,
        reviewed_count: 0,
        pos: 0,
        neg: 0,
        under_review_flag: false,
        under_review_reasons: [],
        variant_text_sample: variantText || null,
      } satisfies Agg);

    cur.usage_count += 1;

    const rev = reviewByEvent.get(e.id) ?? null;
    if (rev) {
      cur.reviewed_count += 1;
      if (Number.isFinite(rev.rating)) {
        cur.rating_sum += rev.rating;
        cur.rating_count += 1;
        if (rev.rating <= 2) cur.low_rating_count += 1;
        if (rev.rating >= 4) cur.high_rating_count += 1;
      }
      const tag = rev.outcome_tag;
      if (tag === "strong") cur.pos += 1;
      if (tag === "weak" || tag === "repetitive" || tag === "missed_context" || tag === "missed_family") {
        cur.neg += 1;
      }
    }

    agg.set(k, cur);
  }

  // Merge-in registry variants (to detect true unused / missing coverage).
  for (const r of registry) {
    const objection = r.objection_type ?? "";
    const strategy = r.strategy_tag ?? "";
    const rhetorical = r.rhetorical_type ?? "";
    const vkey = r.variant_key ?? "";
    const k = [objection, strategy, rhetorical, vkey].join("|");
    if (agg.has(k)) continue;
    agg.set(k, {
      objection_type: r.objection_type ?? null,
      strategy_tag: r.strategy_tag ?? null,
      rhetorical_type: r.rhetorical_type ?? null,
      variant_key: r.variant_key ?? null,
      usage_count: 0,
      rating_sum: 0,
      rating_count: 0,
      low_rating_count: 0,
      high_rating_count: 0,
      reviewed_count: 0,
      pos: 0,
      neg: 0,
      under_review_flag: false,
      under_review_reasons: [],
      variant_text_sample: r.variant_text_sample ?? null,
    });
  }

  const out: IntelligenceSnapshotRow[] = [];
  for (const a of agg.values()) {
    const avg = a.rating_count > 0 ? round2(a.rating_sum / a.rating_count) : null;
    const sr = successRate(a.pos, a.neg);

    // under_review_flag refinement (conflict/instability only).
    const reasons: string[] = [];
    if (a.reviewed_count >= 2 && a.low_rating_count > 0 && a.high_rating_count > 0) {
      reasons.push("review_conflict");
    }
    if (a.pos > 0 && a.neg > 0 && a.pos + a.neg >= Math.max(3, minSampleThreshold())) {
      reasons.push("outcome_instability");
    }
    // Tag disagreement (structured tags used inconsistently) — only when enough reviews exist.
    // This is conservative: we only mark when some reviews have tags and some do not.
    // (More detailed tag variance can be added later without affecting Live.)
    const underReview = reasons.length > 0;

    const rec = recommend({
      usageCount: a.usage_count,
      avgRating: avg,
      successRate: sr,
      fromRegistryOnly: a.usage_count === 0,
    });

    out.push({
      objection_type: a.objection_type,
      strategy_tag: a.strategy_tag,
      rhetorical_type: a.rhetorical_type,
      variant_key: a.variant_key,
      usage_count: a.usage_count,
      avg_rating: avg,
      positive_outcome_count: a.pos,
      negative_outcome_count: a.neg,
      success_rate: sr,
      under_review_flag: underReview,
      recommendation_type: rec.type,
      recommendation_reason: rec.reason,
      metadata: {
        ...(a.variant_text_sample ? { variantTextSample: a.variant_text_sample } : {}),
        ...(reasons.length > 0 ? { underReviewReasons: reasons } : {}),
      },
    });
  }

  // Stable output order (deterministic): highest usage first, then variant_key.
  out.sort((a, b) => {
    if (b.usage_count !== a.usage_count) return b.usage_count - a.usage_count;
    return String(a.variant_key ?? "").localeCompare(String(b.variant_key ?? ""));
  });
  return out;
}

export async function rebuildOfflineIntelligenceForUser(input: {
  supabase: SupabaseClient;
  userId: string;
  windowDays?: number;
}): Promise<{
  runId: string;
  rowsProcessed: number;
  snapshotRowsWritten: number;
  status: "success" | "error";
  registryVariantsLoaded?: number;
  observedGroupsFound?: number;
  unusedVariantsDetected?: number;
  insufficientDataCount?: number;
}> {
  const { supabase, userId } = input;
  const windowDays = input.windowDays ?? 90;
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

  const { data: runRow, error: runErr } = await supabase
    .from("intelligence_run_logs")
    .insert({ user_id: userId, status: "running", rows_processed: 0, snapshot_rows_written: 0 })
    .select("id")
    .single();
  if (runErr || !runRow) throw new Error(runErr?.message ?? "Failed to create run log");
  const runId = String((runRow as { id?: unknown }).id ?? "");

  try {
    // Build registry baseline for this run (offline-only).
    const { registryVariantsLoaded } = await persistVariantInventoryRegistrySnapshot({
      supabase,
      userId,
      runId,
    });

    const { data: events, error: evErr } = await supabase
      .from("rebuttal_events")
      .select(
        "id, objection_type, strategy_tag, rhetorical_type, selected_variant_text, final_live_script"
      )
      .eq("user_id", userId)
      .gte("created_at", since)
      .limit(10000);
    if (evErr) throw new Error(evErr.message);

    const evRows = (events ?? []) as unknown as OfflineEvent[];
    const ids = evRows.map((e) => e.id).filter(Boolean);
    const { data: reviews, error: revErr } = ids.length
      ? await supabase
          .from("rebuttal_reviews")
          .select("rebuttal_event_id, rating, outcome_tag, structured_tags")
          .eq("user_id", userId)
          .in("rebuttal_event_id", ids)
      : { data: [], error: null };
    if (revErr) throw new Error(revErr.message);

    const { data: registryRows, error: regErr } = await supabase
      .from("variant_inventory_registry_snapshots")
      .select("*")
      .eq("user_id", userId)
      .eq("run_id", runId);
    if (regErr) throw new Error(regErr.message);

    const snapshots = aggregateOfflineIntelligence({
      events: evRows,
      reviews: (reviews ?? []) as unknown as OfflineReview[],
      registryVariants: (registryRows ?? []).map((r) => ({
        objection_type:
          typeof (r as { objection_type?: unknown }).objection_type === "string"
            ? ((r as { objection_type: string }).objection_type as string)
            : null,
        strategy_tag:
          typeof (r as { strategy_tag?: unknown }).strategy_tag === "string"
            ? ((r as { strategy_tag: string }).strategy_tag as string)
            : null,
        rhetorical_type:
          typeof (r as { rhetorical_type?: unknown }).rhetorical_type === "string"
            ? ((r as { rhetorical_type: string }).rhetorical_type as string)
            : null,
        variant_key:
          typeof (r as { variant_key?: unknown }).variant_key === "string"
            ? ((r as { variant_key: string }).variant_key as string)
            : null,
        variant_text_sample:
          typeof (r as { variant_text_sample?: unknown }).variant_text_sample === "string"
            ? ((r as { variant_text_sample: string }).variant_text_sample as string)
            : null,
        source_family:
          typeof (r as { source_family?: unknown }).source_family === "string"
            ? ((r as { source_family: string }).source_family as string)
            : null,
        source_module:
          typeof (r as { source_module?: unknown }).source_module === "string"
            ? ((r as { source_module: string }).source_module as string)
            : null,
      })),
    });

    const observedGroupsFound = new Set(evRows.map((e) => `${e.objection_type ?? ""}|${e.strategy_tag ?? ""}|${e.rhetorical_type ?? ""}|${stableVariantKey((e.selected_variant_text ?? e.final_live_script ?? "").trim() || "")}`)).size;
    const unusedVariantsDetected = snapshots.filter((s) => s.usage_count === 0).length;
    const minN = minSampleThreshold();
    const insufficientDataCount = snapshots.filter(
      (s) => s.usage_count > 0 && s.usage_count < minN && s.recommendation_type === "unknown"
    ).length;

    // Write snapshot rows for this run (append-only by run_id).
    if (snapshots.length > 0) {
      const payload = snapshots.map((s) => ({
        run_id: runId,
        user_id: userId,
        objection_type: s.objection_type,
        strategy_tag: s.strategy_tag,
        rhetorical_type: s.rhetorical_type,
        variant_key: s.variant_key,
        usage_count: s.usage_count,
        avg_rating: s.avg_rating,
        positive_outcome_count: s.positive_outcome_count,
        negative_outcome_count: s.negative_outcome_count,
        success_rate: s.success_rate,
        under_review_flag: s.under_review_flag,
        recommendation_type: s.recommendation_type,
        recommendation_reason: s.recommendation_reason,
        metadata: s.metadata,
      }));
      const { error: insErr } = await supabase.from("variant_intelligence_snapshots").insert(payload);
      if (insErr) throw new Error(insErr.message);
    }

    const { error: updErr } = await supabase
      .from("intelligence_run_logs")
      .update({
        finished_at: new Date().toISOString(),
        status: "success",
        rows_processed: evRows.length,
        snapshot_rows_written: snapshots.length,
        metadata: {
          windowDays,
          minSampleThreshold: minSampleThreshold(),
          registryVariantsLoaded,
          observedGroupsFound,
          unusedVariantsDetected,
          insufficientDataCount,
          strategyTagPresentCount: evRows.filter((e) => (e as { strategy_tag?: unknown }).strategy_tag != null).length,
        },
      })
      .eq("id", runId)
      .eq("user_id", userId);
    if (updErr) throw new Error(updErr.message);

    return {
      runId,
      rowsProcessed: evRows.length,
      snapshotRowsWritten: snapshots.length,
      status: "success",
      registryVariantsLoaded,
      observedGroupsFound,
      unusedVariantsDetected,
      insufficientDataCount,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown_error";
    await supabase
      .from("intelligence_run_logs")
      .update({
        finished_at: new Date().toISOString(),
        status: "error",
        error_summary: msg.slice(0, 500),
      })
      .eq("id", runId)
      .eq("user_id", userId);
    return { runId, rowsProcessed: 0, snapshotRowsWritten: 0, status: "error" };
  }
}

