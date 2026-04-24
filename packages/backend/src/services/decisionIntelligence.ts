/**
 * Phase 4.7 — Decision Intelligence Layer (observational only).
 *
 * Captures selection outcomes and compact reason tokens without affecting scoring, ordering, or routing.
 */
import type { PatternSelectionResult, ScoredPatternCandidate } from "./patternPreference.js";

export type DecisionReasonToken =
  | "base_priority_deal_specialized"
  | "base_priority_explicit"
  | "base_priority_default_posture"
  | "anti_repeat_penalty"
  | "single_candidate_pool"
  | "multi_candidate_competition"
  | "dvl_variant_swap"
  | "confidence_support_positive"
  | "confidence_support_negative";

export type DecisionIntelligenceMeta = {
  selectedPatternKey: string | null;
  selectedSource: string | null;
  selectedScore: number | null;
  runnerUpPatternKey: string | null;
  runnerUpSource: string | null;
  runnerUpScore: number | null;
  scoreGap: number | null;
  candidateCount: number;
  uniquePatternKeyCount: number;
  decisionReasons: DecisionReasonToken[];
  antiRepeatApplied: boolean;
  antiRepeatReason: string | null;
  confidenceSupport: number | null;
  dvlApplied: boolean;
  variantIndex: number | null;
};

function addReason(set: Set<DecisionReasonToken>, tok: DecisionReasonToken): void {
  set.add(tok);
}

export function normalizeDecisionReasonTokens(input: {
  scoredCandidates: ReadonlyArray<ScoredPatternCandidate>;
  antiRepeatApplied: boolean;
  confidenceSupport: number | null | undefined;
  dvlApplied: boolean;
  candidateCount: number;
  uniquePatternKeyCount: number;
}): DecisionReasonToken[] {
  const out = new Set<DecisionReasonToken>();

  for (const c of input.scoredCandidates) {
    const base = (c.reasons ?? []).join(" | ").toLowerCase();
    if (base.includes("base priority: deal_specialized")) {
      addReason(out, "base_priority_deal_specialized");
    }
    if (base.includes("base priority: explicit")) {
      addReason(out, "base_priority_explicit");
    }
    if (base.includes("base priority: default_posture")) {
      addReason(out, "base_priority_default_posture");
    }
    if (base.includes("repeat penalty applied")) {
      addReason(out, "anti_repeat_penalty");
    }
  }

  if (input.candidateCount <= 1 || input.uniquePatternKeyCount <= 1) {
    addReason(out, "single_candidate_pool");
  } else {
    addReason(out, "multi_candidate_competition");
  }

  if (input.dvlApplied) addReason(out, "dvl_variant_swap");
  if (input.antiRepeatApplied) addReason(out, "anti_repeat_penalty");

  const cs = input.confidenceSupport ?? null;
  if (typeof cs === "number" && Number.isFinite(cs)) {
    if (cs > 0) addReason(out, "confidence_support_positive");
    if (cs < 0) addReason(out, "confidence_support_negative");
  }

  const ordered: DecisionReasonToken[] = [
    "base_priority_deal_specialized",
    "base_priority_explicit",
    "base_priority_default_posture",
    "anti_repeat_penalty",
    "single_candidate_pool",
    "multi_candidate_competition",
    "confidence_support_positive",
    "confidence_support_negative",
    "dvl_variant_swap",
  ];
  return ordered.filter((t) => out.has(t));
}

function findSelectedScore(
  scored: ReadonlyArray<ScoredPatternCandidate>,
  selected: { patternKey: string; source: string }
): number | null {
  const hit = scored.find(
    (c) => c.patternKey === selected.patternKey && c.source === selected.source
  );
  return typeof hit?.score === "number" && Number.isFinite(hit.score) ? hit.score : null;
}

export function buildDecisionIntelligenceMeta(input: {
  selection: PatternSelectionResult;
  antiRepeatApplied: boolean;
  antiRepeatReason: string | null;
  confidenceSupport: number | null;
  dvlApplied: boolean;
  variantIndex: number | null;
}): DecisionIntelligenceMeta {
  const scored = input.selection.scoredCandidates ?? [];
  const candidateCount = scored.length;
  const uniquePatternKeyCount = new Set(scored.map((c) => c.patternKey)).size;

  const selectedKey = input.selection.selected?.patternKey ?? null;
  const selectedSource = (input.selection.selected as { source?: string } | null | undefined)?.source ?? null;
  const selectedScore =
    selectedKey && selectedSource
      ? findSelectedScore(scored, { patternKey: selectedKey, source: selectedSource })
      : null;

  const runner = candidateCount >= 2 ? scored[1] : null;
  const runnerUpScore =
    typeof runner?.score === "number" && Number.isFinite(runner.score) ? runner.score : null;
  const runnerUpKey = runner?.patternKey ?? null;
  const runnerUpSource = (runner as { source?: string } | null)?.source ?? null;

  const scoreGap =
    selectedScore != null && runnerUpScore != null ? selectedScore - runnerUpScore : null;

  const decisionReasons = normalizeDecisionReasonTokens({
    scoredCandidates: scored,
    antiRepeatApplied: input.antiRepeatApplied,
    confidenceSupport: input.confidenceSupport,
    dvlApplied: input.dvlApplied,
    candidateCount,
    uniquePatternKeyCount,
  });

  return {
    selectedPatternKey: selectedKey,
    selectedSource,
    selectedScore,
    runnerUpPatternKey: runnerUpKey,
    runnerUpSource,
    runnerUpScore,
    scoreGap,
    candidateCount,
    uniquePatternKeyCount,
    decisionReasons,
    antiRepeatApplied: input.antiRepeatApplied,
    antiRepeatReason: input.antiRepeatReason,
    confidenceSupport: input.confidenceSupport,
    dvlApplied: input.dvlApplied,
    variantIndex: input.dvlApplied ? input.variantIndex : null,
  };
}

