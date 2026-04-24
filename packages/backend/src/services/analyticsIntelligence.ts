/**
 * Phase 4.9 — Internal analytics intelligence (read-only).
 *
 * Aggregates existing deterministic telemetry into a stable summary.
 * Bounded queries only; no mutations; null-safe math.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type AnalyticsIntelligenceSummary = {
  window: {
    limit: number;
    conversationId: string | null;
    intelRows: number;
    messageRows: number | null;
    savedResponses: number | null;
    fromCreatedAt: string | null;
    toCreatedAt: string | null;
  };
  selection: {
    topPatternKeys: Array<{ patternKey: string; count: number }>;
    topStrategyTags: Array<{ strategyTag: string; count: number }>;
    singleCandidateRate: number | null;
    multiCandidateRate: number | null;
    avgCandidateCount: number | null;
    avgUniquePatternKeyCount: number | null;
    avgScoreGap: number | null;
  };
  antiRepeat: {
    appliedCount: number | null;
    appliedRate: number | null;
    byReason: Record<string, number>;
    winnerShiftPossibleCount: number | null;
    winnerShiftBlockedBySingleCandidateCount: number | null;
  };
  dvl: {
    appliedCount: number | null;
    appliedRate: number | null;
    variantUsage: Record<string, number>;
  };
  confidence: {
    avg: number | null;
    negativeRate: number | null;
    zeroRate: number | null;
    positiveRate: number | null;
    min: number | null;
    max: number | null;
  };
  saves: {
    savedCount: number;
    saveRate: number | null;
    topSavedPatternKeys: Array<{ patternKey: string; count: number }>;
    topSavedStrategyTags: Array<{ strategyTag: string; count: number }>;
  };
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

type IntelRow = {
  created_at: string;
  conversation_id: string;
  pattern_key: string | null;
  strategy_tag: string | null;
  objection_type: string | null;
  was_saved: boolean;
  confidence_support: number | null;
  candidate_count: number | null;
  unique_pattern_key_count: number | null;
  score_gap: number | null;
  runner_up_pattern_key: string | null;
  anti_repeat_applied: boolean | null;
  anti_repeat_reason: string | null;
  dvl_applied: boolean | null;
  variant_index: number | null;
};

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function safeRate(n: number, d: number): number | null {
  if (!Number.isFinite(n) || !Number.isFinite(d) || d <= 0) return null;
  return n / d;
}

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sum = nums.reduce((a, b) => a + b, 0);
  return sum / nums.length;
}

function countTop(
  values: Array<string | null | undefined>,
  max: number
): Array<{ key: string; count: number }> {
  const m = new Map<string, number>();
  for (const v of values) {
    const k = typeof v === "string" ? v.trim() : "";
    if (!k) continue;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  const rows = [...m.entries()].map(([key, count]) => ({ key, count }));
  rows.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  return rows.slice(0, max);
}

export async function buildAnalyticsIntelligenceSummary(
  supabase: SupabaseClient,
  input: { limit?: number; conversationId?: string | null }
): Promise<AnalyticsIntelligenceSummary> {
  const limit = clampInt(input.limit ?? 250, 1, 500);
  const conversationId = (input.conversationId ?? "").trim() || null;

  const baseSelect =
    "created_at,conversation_id,pattern_key,strategy_tag,objection_type,was_saved,confidence_support";
  const extendedSelect =
    `${baseSelect},candidate_count,unique_pattern_key_count,score_gap,runner_up_pattern_key,anti_repeat_applied,anti_repeat_reason,dvl_applied,variant_index`;

  const run = async (sel: string) => {
    let q = supabase
      .from("pattern_intelligence_events")
      .select(sel)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (conversationId) q = q.eq("conversation_id", conversationId);
    return q;
  };

  let data: unknown = null;
  let error: any = null;
  {
    const res = await run(extendedSelect);
    data = res.data;
    error = res.error;
  }
  // Rollout safety: if additive columns aren't present yet, fall back to base select.
  if (error) {
    const res2 = await run(baseSelect);
    data = res2.data;
    error = res2.error;
  }
  const rows = (!error && Array.isArray(data) ? (data as IntelRow[]) : []) ?? [];

  const intelRows = rows.length;
  const createdAts = rows.map((r) => r.created_at).filter(Boolean);
  const toCreatedAt = createdAts[0] ?? null;
  const fromCreatedAt = createdAts.length ? createdAts[createdAts.length - 1]! : null;

  const patternKeys = rows.map((r) => r.pattern_key);
  const strategyTags = rows.map((r) => r.strategy_tag);

  const topPatternKeys = countTop(patternKeys, 12).map((r) => ({
    patternKey: r.key,
    count: r.count,
  }));
  const topStrategyTags = countTop(strategyTags, 12).map((r) => ({
    strategyTag: r.key,
    count: r.count,
  }));

  const saved = rows.filter((r) => r.was_saved === true);
  const savedCount = saved.length;
  const saveRate = safeRate(savedCount, intelRows);
  const topSavedPatternKeys = countTop(
    saved.map((r) => r.pattern_key),
    10
  ).map((r) => ({ patternKey: r.key, count: r.count }));
  const topSavedStrategyTags = countTop(
    saved.map((r) => r.strategy_tag),
    10
  ).map((r) => ({ strategyTag: r.key, count: r.count }));

  const confVals = rows
    .map((r) => r.confidence_support)
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n));

  const confNeg = confVals.filter((n) => n < 0).length;
  const confZero = confVals.filter((n) => n === 0).length;
  const confPos = confVals.filter((n) => n > 0).length;

  const unknownObjectionTypeCount = rows.filter((r) => {
    const t = typeof r.objection_type === "string" ? r.objection_type.trim() : "";
    return !t || t === "unknown";
  }).length;

  const missingPatternKeyCount = rows.filter((r) => {
    const k = typeof r.pattern_key === "string" ? r.pattern_key.trim() : "";
    return !k;
  }).length;

  // Decision meta and DVL usage are not persisted in `pattern_intelligence_events` yet.
  const decisionMetaPresent = rows.filter(
    (r) =>
      typeof r.candidate_count === "number" ||
      typeof r.unique_pattern_key_count === "number" ||
      typeof r.score_gap === "number" ||
      typeof r.anti_repeat_applied === "boolean" ||
      typeof r.dvl_applied === "boolean"
  ).length;
  const missingDecisionMetaRate = 1 - (safeRate(decisionMetaPresent, intelRows) ?? 0);

  const candidateCounts = rows
    .map((r) => r.candidate_count)
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0);
  const uniqueKeyCounts = rows
    .map((r) => r.unique_pattern_key_count)
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0);
  const scoreGaps = rows
    .map((r) => r.score_gap)
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n));

  const denomUniqueKeys = rows.filter(
    (r) => typeof r.unique_pattern_key_count === "number" && Number.isFinite(r.unique_pattern_key_count)
  ).length;
  const singleCandidate = rows.filter((r) => r.unique_pattern_key_count === 1).length;
  const multiCandidate = rows.filter((r) => {
    const u = r.unique_pattern_key_count;
    return typeof u === "number" && Number.isFinite(u) && u >= 2;
  }).length;

  const denomAntiRepeat = rows.filter((r) => typeof r.anti_repeat_applied === "boolean").length;
  const antiRepeatAppliedCount = rows.filter((r) => r.anti_repeat_applied === true).length;
  const antiRepeatReasonCounts = new Map<string, number>();
  for (const r of rows) {
    const reason = typeof r.anti_repeat_reason === "string" ? r.anti_repeat_reason.trim() : "";
    if (!reason) continue;
    antiRepeatReasonCounts.set(reason, (antiRepeatReasonCounts.get(reason) ?? 0) + 1);
  }
  const byReason = [...antiRepeatReasonCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .reduce<Record<string, number>>((acc, [k, v]) => {
      acc[k] = v;
      return acc;
    }, {});

  const winnerShiftPossibleCount = rows.filter((r) => {
    const u = r.unique_pattern_key_count;
    const gap = r.score_gap;
    return typeof u === "number" && Number.isFinite(u) && u >= 2 && typeof gap === "number" && Number.isFinite(gap);
  }).length;
  const winnerShiftBlockedBySingleCandidateCount = rows.filter((r) => r.unique_pattern_key_count === 1).length;

  const denomDvl = rows.filter((r) => typeof r.dvl_applied === "boolean").length;
  const dvlAppliedCount = rows.filter((r) => r.dvl_applied === true).length;
  const variantUsageCounts = new Map<string, number>();
  for (const r of rows) {
    const idx = r.variant_index;
    if (typeof idx !== "number" || !Number.isFinite(idx)) continue;
    const k = String(idx);
    variantUsageCounts.set(k, (variantUsageCounts.get(k) ?? 0) + 1);
  }
  const variantUsage = [...variantUsageCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .reduce<Record<string, number>>((acc, [k, v]) => {
      acc[k] = v;
      return acc;
    }, {});

  const byBranch = new Map<string, { total: number; saved: number }>();
  for (const r of rows) {
    const key =
      (typeof r.objection_type === "string" && r.objection_type.trim()) ||
      "unknown";
    const rec = byBranch.get(key) ?? { total: 0, saved: 0 };
    rec.total += 1;
    if (r.was_saved === true) rec.saved += 1;
    byBranch.set(key, rec);
  }
  const branches = [...byBranch.entries()]
    .map(([objectionType, v]) => ({
      objectionType,
      total: v.total,
      avgUniquePatternKeyCount: avg(
        rows
          .filter((r) => (r.objection_type ?? "unknown") === objectionType)
          .map((r) => r.unique_pattern_key_count)
          .filter(
            (n): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0
          )
      ),
      singleCandidateRate: safeRate(
        rows.filter(
          (r) =>
            (r.objection_type ?? "unknown") === objectionType &&
            r.unique_pattern_key_count === 1
        ).length,
        rows.filter(
          (r) =>
            (r.objection_type ?? "unknown") === objectionType &&
            typeof r.unique_pattern_key_count === "number" &&
            Number.isFinite(r.unique_pattern_key_count)
        ).length
      ),
      avgScoreGap: avg(
        rows
          .filter((r) => (r.objection_type ?? "unknown") === objectionType)
          .map((r) => r.score_gap)
          .filter((n): n is number => typeof n === "number" && Number.isFinite(n))
      ),
      saveRate: safeRate(v.saved, v.total),
    }))
    .sort((a, b) => b.total - a.total || a.objectionType.localeCompare(b.objectionType));

  return {
    window: {
      limit,
      conversationId,
      intelRows,
      messageRows: null,
      savedResponses: null,
      fromCreatedAt,
      toCreatedAt,
    },
    selection: {
      topPatternKeys,
      topStrategyTags,
      singleCandidateRate: safeRate(singleCandidate, denomUniqueKeys),
      multiCandidateRate: safeRate(multiCandidate, denomUniqueKeys),
      avgCandidateCount: avg(candidateCounts),
      avgUniquePatternKeyCount: avg(uniqueKeyCounts),
      avgScoreGap: avg(scoreGaps),
    },
    antiRepeat: {
      appliedCount: antiRepeatAppliedCount,
      appliedRate: safeRate(antiRepeatAppliedCount, denomAntiRepeat),
      byReason,
      winnerShiftPossibleCount,
      winnerShiftBlockedBySingleCandidateCount,
    },
    dvl: {
      appliedCount: dvlAppliedCount,
      appliedRate: safeRate(dvlAppliedCount, denomDvl),
      variantUsage,
    },
    confidence: {
      avg: avg(confVals),
      negativeRate: safeRate(confNeg, confVals.length),
      zeroRate: safeRate(confZero, confVals.length),
      positiveRate: safeRate(confPos, confVals.length),
      min: confVals.length ? Math.min(...confVals) : null,
      max: confVals.length ? Math.max(...confVals) : null,
    },
    saves: {
      savedCount,
      saveRate,
      topSavedPatternKeys,
      topSavedStrategyTags,
    },
    health: {
      missingDecisionMetaRate,
      missingPatternKeyRate: safeRate(missingPatternKeyCount, intelRows) ?? 0,
      fallbackMessageCount: null,
      unknownObjectionTypeCount,
      nullConfidenceCount: intelRows - confVals.length,
    },
    branches,
  };
}

