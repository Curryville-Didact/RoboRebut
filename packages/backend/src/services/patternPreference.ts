/**
 * Phase 4.9 — Adaptive preference among rule-generated objection patterns (telemetry-driven, deterministic).
 */

import {
  applyObjectionTagBias,
  hasObjectionRankingSignal,
  type ObjectionTagBiasInput,
} from "./objectionTagPatternBias.js";

export {
  applyObjectionTagBias,
  computeObjectionBiasStyleBuckets,
  hasObjectionRankingSignal,
  prepareObjectionBiasContext,
  trustBundleRefStructAndRisk,
  SUPPRESSION_RULES,
  TAG_BIAS_RULES,
  type ObjectionBiasBucketResult,
  type ObjectionTagBiasInput,
  type ObjectionTagScore,
} from "./objectionTagPatternBias.js";
import { additionalPatternRankingBoost } from "./patternRankingWeight.js";

export interface PatternPerformanceStats {
  patternKey: string;
  generatedCount: number;
  savedCount: number;
  saveRate: number;
}

export interface PatternCandidate {
  patternKey: string;
  source: "deal_specialized" | "explicit" | "default_posture";
  objectionCategory?: string;
  posture?: string;
  dealType?: string | null;
  rebuttalStyle?: string;
  coachNoteStyle?: string;
  followUpStyle?: string;
  confidenceStyle?: string;
}

export interface ScoredPatternCandidate extends PatternCandidate {
  score: number;
  reasons: string[];
}

export interface PatternSelectionResult {
  selected: PatternCandidate;
  scoredCandidates: ScoredPatternCandidate[];
}

/** Minimal core shape passed through selection (matches ObjectionResponsePatternCore). */
export interface PatternCorePayload {
  rebuttalStyle: string;
  coachNoteStyle: string;
  followUpStyle: string;
  primaryMove: string;
  secondaryMove?: string;
}

export interface PatternStatsProvider {
  getStats(patternKeys: string[]): Promise<Record<string, PatternPerformanceStats>>;
}

/** Default: no persisted stats yet — adaptive layer defers to base source priorities. */
export const defaultPatternStatsProvider: PatternStatsProvider = {
  async getStats() {
    return {};
  },
};

/**
 * Phase 5.2 — Deterministic confidence for insight copy only (does not affect selection/scoring).
 */
export function getPatternConfidence(
  stats: PatternPerformanceStats | undefined | null
): "high" | "medium" | "low" {
  if (stats == null) return "low";
  if (stats.generatedCount >= 5 && stats.saveRate >= 0.6) return "high";
  if (stats.generatedCount >= 3) return "medium";
  return "low";
}

const BASE_SOURCE_SCORE: Record<PatternCandidate["source"], number> = {
  deal_specialized: 30,
  explicit: 20,
  default_posture: 10,
};

function sourceRank(source: PatternCandidate["source"]): number {
  switch (source) {
    case "deal_specialized":
      return 3;
    case "explicit":
      return 2;
    case "default_posture":
      return 1;
    default: {
      const _e: never = source;
      return _e;
    }
  }
}

function scoreOne(
  candidate: PatternCandidate,
  stats: Record<string, PatternPerformanceStats>,
  repetitionPenalty?: Record<string, number> | null
): ScoredPatternCandidate {
  const reasons: string[] = [];
  const base = BASE_SOURCE_SCORE[candidate.source];
  reasons.push(`base priority: ${candidate.source}`);
  let score = base;

  const st = stats[candidate.patternKey];
  if (!st || st.generatedCount < 3) {
    reasons.push("no analytics bonus: insufficient sample size");
  } else {
    const bonus = st.saveRate * 20 + Math.min(st.savedCount, 5);
    score += bonus;
    reasons.push(`analytics bonus applied from saveRate ${st.saveRate.toFixed(2)}`);
    reasons.push(`savedCount contribution (capped at 5): ${Math.min(st.savedCount, 5)}`);
  }

  // Phase 4.4:
  // Adds performance-based boost using saved-response telemetry.
  // Only applies when sufficient data exists (generatedCount >= 5, saveRate >= 0.5).
  // Safe fallback: returns 0 when stats unavailable.
  // Per-candidate row from getStats(patternKeys)[candidate.patternKey]; st may be undefined.
  const boost = additionalPatternRankingBoost(st);
  score += boost;

  const penalty = repetitionPenalty?.[candidate.patternKey];
  if (typeof penalty === "number" && Number.isFinite(penalty) && penalty > 0) {
    score -= penalty;
    reasons.push(`repeat penalty applied: -${penalty.toFixed(1)}`);
  }

  return { ...candidate, score, reasons };
}

function compareScored(
  a: ScoredPatternCandidate,
  b: ScoredPatternCandidate,
  stats: Record<string, PatternPerformanceStats>
): number {
  if (a.score !== b.score) return b.score - a.score;
  const sr = sourceRank(b.source) - sourceRank(a.source);
  if (sr !== 0) return sr;
  const sa = stats[a.patternKey]?.savedCount ?? 0;
  const sb = stats[b.patternKey]?.savedCount ?? 0;
  if (sa !== sb) return sb - sa;
  const k = a.patternKey.localeCompare(b.patternKey);
  if (k !== 0) return k;
  return a.source.localeCompare(b.source);
}

export type PatternCandidateEntry = {
  candidate: PatternCandidate;
  core: PatternCorePayload;
};

/**
 * Deterministic selection among already-valid rule candidates.
 * When stats is empty, ordering matches legacy priority: deal_specialized > explicit > default_posture.
 * Phase 4.4 — Optional objection tag bias nudges scores additively before sort
 * (no effect when signal is empty; weak/unknown tags yield zero bonus per rule).
 */
export function selectPatternPreference(
  entries: PatternCandidateEntry[],
  stats: Record<string, PatternPerformanceStats>,
  tagBias?: ObjectionTagBiasInput | null,
  repetitionPenalty?: Record<string, number> | null
): PatternSelectionResult & { selectedCore: PatternCorePayload } {
  const scored = entries.map((e) => scoreOne(e.candidate, stats, repetitionPenalty));
  const hasTags =
    tagBias != null &&
    hasObjectionRankingSignal({
      objectionTags: tagBias.objectionTags ?? [],
      primaryObjectionType: tagBias.primaryObjectionType ?? null,
    });
  const biased = hasTags
    ? applyObjectionTagBias({
        scoredCandidates: scored,
        primaryObjectionType: tagBias!.primaryObjectionType,
        objectionTags: tagBias!.objectionTags,
      })
    : scored;
  const sorted = [...biased].sort((x, y) => compareScored(x, y, stats));
  const bestScored = sorted[0]!;
  const entry = entries.find(
    (e) =>
      e.candidate.patternKey === bestScored.patternKey &&
      e.candidate.source === bestScored.source
  );
  if (!entry) {
    throw new Error("pattern preference: internal selection mismatch");
  }
  return {
    selected: entry.candidate,
    scoredCandidates: sorted,
    selectedCore: entry.core,
  };
}
