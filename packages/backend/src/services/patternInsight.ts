/**
 * Phase 5.2 — Revenue-focused pattern insight layer (response metadata only; no selection/scoring changes).
 */

import type { DealCoachingPosture } from "./dealCoachingPosture.js";
import type { RebuttalStyle } from "./objectionResponsePattern.js";
import {
  getPatternConfidence,
  type PatternCandidate,
  type PatternPerformanceStats,
} from "./patternPreference.js";

export type PatternInsightsPayload = {
  selectedPatternKey: string;
  confidenceLevel: "high" | "medium" | "low";
  reason: string;
  stats?: {
    saveRate: number;
    sampleSize: number;
  };
  note?: string;
};

function hasMeaningfulSample(
  stats: PatternPerformanceStats | undefined
): boolean {
  return stats != null && stats.generatedCount >= 3;
}

export function buildPatternInsightReason(
  source: PatternCandidate["source"],
  stats: PatternPerformanceStats | undefined
): string {
  const hasSample = hasMeaningfulSample(stats);
  switch (source) {
    case "deal_specialized":
      return "Selected deal-specific pattern for this objection";
    case "explicit":
      return hasSample
        ? "Using top-performing pattern based on prior usage"
        : "Using explicit pattern for this objection";
    case "default_posture":
      return hasSample
        ? "Using default pattern aligned to your posture"
        : "Using a general response pattern while this objection builds history";
    default: {
      const _e: never = source;
      return _e;
    }
  }
}

export function buildPatternInsightNote(
  confidenceLevel: "high" | "medium" | "low"
): string {
  if (confidenceLevel === "high") return "Strong signal — pattern is performing well";
  if (confidenceLevel === "medium") return "Refining — more data will sharpen this";
  return "Learning — RoboRebut is building history for this objection pattern";
}

const CATEGORY_PHRASE: Record<string, string> = {
  price_cost_framing: "Reframes cost into manageable terms",
  timing_delay: "Addresses timing and delay without stalling momentum",
  trust_skepticism: "Acknowledges concern and builds credibility",
  need_indifference: "Surfaces need and redirects toward fit",
  payment_fatigue: "Reframes payment load into workable terms",
  unknown: "Addresses the objection with a clear, practical frame",
};

const POSTURE_PHRASE: Record<DealCoachingPosture, string> = {
  exploratory: "explores before advancing",
  balanced: "balances firmness with rapport",
  controlled_assertive: "maintains control without losing rapport",
  assertive_opportunity: "drives opportunity with confident energy",
};

const REBUTTAL_PHRASE: Record<RebuttalStyle, string> = {
  daily_burden_reframe: "using a daily burden reframe",
  cost_of_delay_redirect: "redirecting to the cost of delay",
  qualification_pressure: "closing with a control question",
  structure_clarity: "emphasizing structure and clarity",
  risk_reduction: "shifting focus to risk and structure",
  urgency_without_panic: "creating urgency without panic",
  operational_use_case: "grounding in an operational use case",
};

/**
 * One-line, deterministic explanation from category × posture × rebuttal style (no LLM).
 */
export function buildPatternExplanationLine(input: {
  objectionCategory: string;
  posture: DealCoachingPosture;
  rebuttalStyle: RebuttalStyle | string;
}): string {
  const cat =
    CATEGORY_PHRASE[input.objectionCategory] ?? CATEGORY_PHRASE.unknown;
  const pos = POSTURE_PHRASE[input.posture];
  const styleKey = input.rebuttalStyle as RebuttalStyle;
  const sty =
    REBUTTAL_PHRASE[styleKey] ?? REBUTTAL_PHRASE.operational_use_case;
  return `${cat}, ${pos}, ${sty}.`;
}

export function buildPatternInsightsPayload(input: {
  selectedPatternKey: string;
  selectedSource: PatternCandidate["source"];
  stats: PatternPerformanceStats | undefined;
  objectionCategory: string;
  posture: DealCoachingPosture;
  rebuttalStyle: RebuttalStyle | string;
}): { patternInsights: PatternInsightsPayload; explanation: string } {
  const { stats } = input;
  const confidenceLevel = getPatternConfidence(stats);
  const reason = buildPatternInsightReason(input.selectedSource, stats);
  const note = buildPatternInsightNote(confidenceLevel);

  const patternInsights: PatternInsightsPayload = {
    selectedPatternKey: input.selectedPatternKey,
    confidenceLevel,
    reason,
    note,
  };

  if (stats != null && stats.generatedCount > 0) {
    patternInsights.stats = {
      saveRate: stats.saveRate,
      sampleSize: stats.generatedCount,
    };
  }

  const explanation = buildPatternExplanationLine({
    objectionCategory: input.objectionCategory,
    posture: input.posture,
    rebuttalStyle: input.rebuttalStyle,
  });

  return { patternInsights, explanation };
}
