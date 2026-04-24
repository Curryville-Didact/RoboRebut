/**
 * Phase 4.4 — Deterministic additive bias from objection classification onto pattern candidate scores.
 * Nudges `selectPatternPreference` before final sort; does not replace base source priority or analytics.
 */

import type { ScoredPatternCandidate } from "./patternPreference.js";

const DIMINISHING_FACTOR = 0.65;
const STYLE_CAP = 6;
const MAX_BIAS_PER_CANDIDATE = 14;
const SUPPRESSION_PENALTY = 2;
const TRUST_QUAL_MAX_OF_CLARITY = 0.35;
const COD_FLOOR_COMMERCIAL = 2.5;

const KEY_QUAL = "rebuttal:qualification_pressure";
const KEY_COD = "rebuttal:cost_of_delay_redirect";

/** Soft down-weight for aggressive / pushy styles when trust / clarity tags dominate. */
export const SUPPRESSION_RULES: Record<string, readonly string[]> = {
  trust_risk: ["qualification_pressure"],
  past_bad_experience: ["qualification_pressure"],
  confusion_clarity: ["urgency_without_panic"],
};

export type ObjectionTagScore = {
  tag: string;
  score: number;
};

export type ObjectionTagBiasInput = {
  objectionTags: ObjectionTagScore[];
  primaryObjectionType: string | null;
};

export type ObjectionBiasBucketResult = {
  /** Final per-style bucket values after cap, suppression, trust clamp, and COD floor — sole input to candidate bonus sum. */
  buckets: Record<string, number>;
  /** Sum of bucket values after `MAX_BIAS_PER_CANDIDATE` global clamp. */
  bonus: number;
  reasons: string[];
};

type StyleRule = {
  rebuttalStyle?: string;
  coachNoteStyle?: string;
  followUpStyle?: string;
  weight: number;
};

/**
 * Canonical objection tag → pattern style dimensions (rebuttal / coach note / follow-up).
 */
export const TAG_BIAS_RULES: Record<string, StyleRule[]> = {
  margin_profitability: [
    { rebuttalStyle: "operational_use_case", weight: 3 },
    { rebuttalStyle: "qualification_pressure", weight: 3 },
    { rebuttalStyle: "cost_of_delay_redirect", weight: 2 },
  ],
  cash_flow_pressure: [
    { rebuttalStyle: "operational_use_case", weight: 3 },
    { rebuttalStyle: "qualification_pressure", weight: 2 },
    { rebuttalStyle: "cost_of_delay_redirect", weight: 3 },
    { rebuttalStyle: "daily_burden_reframe", weight: 2 },
  ],
  payment_affordability: [
    { rebuttalStyle: "structure_clarity", weight: 3 },
    { rebuttalStyle: "daily_burden_reframe", weight: 3 },
  ],
  structure_mismatch: [
    { rebuttalStyle: "structure_clarity", weight: 3 },
    { rebuttalStyle: "daily_burden_reframe", weight: 2 },
  ],
  trust_risk: [
    { rebuttalStyle: "structure_clarity", weight: 3 },
    { rebuttalStyle: "risk_reduction", weight: 3 },
  ],
  past_bad_experience: [
    { rebuttalStyle: "structure_clarity", weight: 3 },
    { rebuttalStyle: "risk_reduction", weight: 4 },
  ],
  confusion_clarity: [
    { rebuttalStyle: "structure_clarity", weight: 4 },
    { rebuttalStyle: "qualification_pressure", weight: 2 },
  ],
  timing_delay: [
    { rebuttalStyle: "urgency_without_panic", weight: 3 },
    { rebuttalStyle: "cost_of_delay_redirect", weight: 2 },
  ],
  decision_avoidance: [
    { rebuttalStyle: "urgency_without_panic", weight: 3 },
    { followUpStyle: "commitment_question", weight: 3 },
  ],
};

function normalizeTag(s: string): string {
  return s.trim().toLowerCase();
}

function ruleStyleKey(rule: StyleRule): string | null {
  if (rule.rebuttalStyle) return `rebuttal:${rule.rebuttalStyle}`;
  if (rule.followUpStyle) return `followUp:${rule.followUpStyle}`;
  if (rule.coachNoteStyle) return `coachNote:${rule.coachNoteStyle}`;
  return null;
}

function candidateMatchesRule(
  sc: ScoredPatternCandidate,
  rule: StyleRule
): boolean {
  if (rule.rebuttalStyle && sc.rebuttalStyle === rule.rebuttalStyle) return true;
  if (rule.coachNoteStyle && sc.coachNoteStyle === rule.coachNoteStyle) return true;
  if (rule.followUpStyle && sc.followUpStyle === rule.followUpStyle) return true;
  return false;
}

/**
 * Merge rows, dedupe by tag (max score), sort by score DESC for diminishing returns order.
 */
function sortedUniqueTags(input: ObjectionTagBiasInput): ObjectionTagScore[] {
  const byTag = new Map<string, number>();
  for (const row of input.objectionTags ?? []) {
    const k = normalizeTag(row.tag);
    if (!k) continue;
    const s =
      Number.isFinite(row.score) && row.score > 0 ? row.score : 1;
    byTag.set(k, Math.max(byTag.get(k) ?? 0, s));
  }
  if (input.primaryObjectionType?.trim()) {
    const pk = normalizeTag(input.primaryObjectionType);
    if (!byTag.has(pk)) {
      byTag.set(pk, 1);
    }
  }
  const arr: ObjectionTagScore[] = [...byTag.entries()].map(([tag, score]) => ({
    tag,
    score,
  }));
  arr.sort((a, b) => b.score - a.score);
  return arr;
}

function presentTagKeys(input: ObjectionTagBiasInput): Set<string> {
  const s = new Set<string>();
  for (const row of input.objectionTags ?? []) {
    const k = normalizeTag(row.tag);
    if (k) s.add(k);
  }
  if (input.primaryObjectionType?.trim()) {
    s.add(normalizeTag(input.primaryObjectionType));
  }
  return s;
}

function topTwoIncludesTrustSensitive(
  sortedTags: ObjectionTagScore[]
): boolean {
  const top2 = sortedTags.slice(0, 2);
  return top2.some(
    (t) => t.tag === "trust_risk" || t.tag === "past_bad_experience"
  );
}

function topTwoIncludesCommercialPressure(
  sortedTags: ObjectionTagScore[]
): boolean {
  const want = new Set([
    "margin_profitability",
    "cash_flow_pressure",
    "timing_delay",
  ]);
  return sortedTags.slice(0, 2).some((t) => want.has(t.tag));
}

/**
 * Tag-bundle reference totals for structure_clarity vs risk_reduction (candidate-agnostic).
 * Exported for verification scripts.
 */
export function trustBundleRefStructAndRisk(
  sortedTags: ObjectionTagScore[],
  primaryNorm: string | null
): { refStruct: number; refRisk: number } {
  let refStruct = 0;
  let refRisk = 0;
  for (let tagIndex = 0; tagIndex < sortedTags.length; tagIndex++) {
    const { tag, score: tagScore } = sortedTags[tagIndex]!;
    const effectiveMultiplier = Math.pow(DIMINISHING_FACTOR, tagIndex);
    const top2Factor = tagIndex >= 2 ? 0.5 : 1;
    const rules = TAG_BIAS_RULES[tag] ?? [];
    for (const rule of rules) {
      if (!rule.rebuttalStyle) continue;
      let w =
        rule.weight * tagScore * effectiveMultiplier * top2Factor;
      if (primaryNorm && normalizeTag(tag) === primaryNorm) {
        w += 2 * tagScore;
      }
      if (rule.rebuttalStyle === "structure_clarity") {
        refStruct += w;
      } else if (rule.rebuttalStyle === "risk_reduction") {
        refRisk += w;
      }
    }
  }
  return {
    refStruct: Math.min(refStruct, STYLE_CAP),
    refRisk: Math.min(refRisk, STYLE_CAP),
  };
}

function trustSensitiveQualificationCap(
  sortedTags: ObjectionTagScore[],
  primaryNorm: string | null
): number | null {
  if (!topTwoIncludesTrustSensitive(sortedTags)) return null;
  const { refStruct, refRisk } = trustBundleRefStructAndRisk(
    sortedTags,
    primaryNorm
  );
  let maxQual: number | null = null;
  if (refStruct > 0) {
    maxQual = TRUST_QUAL_MAX_OF_CLARITY * refStruct;
  }
  if (refRisk > 0) {
    const capR = TRUST_QUAL_MAX_OF_CLARITY * refRisk;
    maxQual = maxQual == null ? capR : Math.min(maxQual, capR);
  }
  return maxQual;
}

/** Exposed for verification / introspection — same inputs as `applyObjectionTagBias`. */
export function prepareObjectionBiasContext(input: ObjectionTagBiasInput): {
  sortedTags: ObjectionTagScore[];
  presentTags: Set<string>;
  primaryNorm: string | null;
} {
  return {
    sortedTags: sortedUniqueTags(input),
    presentTags: presentTagKeys(input),
    primaryNorm: input.primaryObjectionType?.trim()
      ? normalizeTag(input.primaryObjectionType)
      : null,
  };
}

/**
 * True when tag bias should run (non-empty classification signal).
 */
export function hasObjectionRankingSignal(input: ObjectionTagBiasInput): boolean {
  if (input.primaryObjectionType?.trim()) return true;
  return (input.objectionTags ?? []).some((t) => t?.tag?.trim());
}

/**
 * Single source of truth: raw additive → per-style cap → suppression → trust clamp → COD floor → global cap.
 * Candidate `score` must be `baseScore + result.bonus` only — no parallel raw-style path.
 */
export function computeObjectionBiasStyleBuckets(
  sc: ScoredPatternCandidate,
  sortedTags: ObjectionTagScore[],
  primaryNorm: string | null,
  presentTags: Set<string>
): ObjectionBiasBucketResult {
  const styleAccum: Record<string, number> = {};
  const reasons: string[] = [];

  for (let tagIndex = 0; tagIndex < sortedTags.length; tagIndex++) {
    const { tag, score: tagScore } = sortedTags[tagIndex]!;
    const effectiveMultiplier = Math.pow(DIMINISHING_FACTOR, tagIndex);
    const top2Factor = tagIndex >= 2 ? 0.5 : 1;
    const rules = TAG_BIAS_RULES[tag];
    if (!rules) continue;

    for (const rule of rules) {
      if (!candidateMatchesRule(sc, rule)) continue;
      const sk = ruleStyleKey(rule);
      if (!sk) continue;

      let w = rule.weight * tagScore * effectiveMultiplier * top2Factor;
      if (primaryNorm && normalizeTag(tag) === primaryNorm) {
        w += 2 * tagScore;
      }

      styleAccum[sk] = (styleAccum[sk] ?? 0) + w;
      reasons.push(`tag_bias:${tag}:w=${w.toFixed(2)}:${sk}:dim${tagIndex}`);
    }
  }

  for (const k of Object.keys(styleAccum)) {
    styleAccum[k] = Math.min(styleAccum[k]!, STYLE_CAP);
  }

  const suppressedRebuttalStyles = new Set<string>();
  for (const tag of presentTags) {
    const list = SUPPRESSION_RULES[tag];
    if (list) {
      for (const st of list) suppressedRebuttalStyles.add(st);
    }
  }

  for (const st of suppressedRebuttalStyles) {
    const rk = `rebuttal:${st}`;
    if (styleAccum[rk] != null) {
      const before = styleAccum[rk]!;
      styleAccum[rk] = Math.max(0, before - SUPPRESSION_PENALTY);
      if (before !== styleAccum[rk]) {
        reasons.push(`suppression:${st}:-${SUPPRESSION_PENALTY}`);
      }
    }
  }

  const trustQualCap = trustSensitiveQualificationCap(
    sortedTags,
    primaryNorm
  );
  if (trustQualCap != null && (styleAccum[KEY_QUAL] ?? 0) > trustQualCap) {
    styleAccum[KEY_QUAL] = trustQualCap;
    const { refStruct, refRisk } = trustBundleRefStructAndRisk(
      sortedTags,
      primaryNorm
    );
    reasons.push(
      `trust_clamp:qual→${trustQualCap.toFixed(2)}(35%·min(refStruct=${refStruct.toFixed(2)},refRisk=${refRisk.toFixed(2)}))`
    );
  }

  if (
    topTwoIncludesCommercialPressure(sortedTags) &&
    sc.rebuttalStyle === "cost_of_delay_redirect"
  ) {
    const cur = styleAccum[KEY_COD] ?? 0;
    const floored = Math.min(STYLE_CAP, Math.max(cur, COD_FLOOR_COMMERCIAL));
    if (floored !== cur) {
      reasons.push(`cod_floor:${cur.toFixed(2)}→${floored.toFixed(2)}`);
    }
    styleAccum[KEY_COD] = floored;
  }

  let bonus = Object.values(styleAccum).reduce((a, b) => a + b, 0);
  const beforeGlobal = bonus;
  bonus = Math.min(bonus, MAX_BIAS_PER_CANDIDATE);
  if (beforeGlobal > bonus) {
    reasons.push(`global_cap:${beforeGlobal.toFixed(2)}→${bonus.toFixed(2)}`);
  }

  return { buckets: { ...styleAccum }, bonus, reasons };
}

/**
 * Additive score nudge before final sort. Deterministic; weak signal → no-op.
 */
export function applyObjectionTagBias(input: {
  scoredCandidates: ScoredPatternCandidate[];
  primaryObjectionType: string | null;
  objectionTags: ObjectionTagScore[];
}): ScoredPatternCandidate[] {
  if (!hasObjectionRankingSignal(input)) {
    return input.scoredCandidates.map((s) => ({ ...s, reasons: [...s.reasons] }));
  }

  const sortedTags = sortedUniqueTags(input);
  if (sortedTags.length === 0) {
    return input.scoredCandidates.map((s) => ({ ...s, reasons: [...s.reasons] }));
  }

  const primaryNorm = input.primaryObjectionType?.trim()
    ? normalizeTag(input.primaryObjectionType)
    : null;

  const presentTags = presentTagKeys(input);

  return input.scoredCandidates.map((sc) => {
    const { bonus, reasons } = computeObjectionBiasStyleBuckets(
      sc,
      sortedTags,
      primaryNorm,
      presentTags
    );

    if (bonus === 0) {
      return { ...sc, reasons: [...sc.reasons] };
    }
    return {
      ...sc,
      score: sc.score + bonus,
      reasons: [
        ...sc.reasons,
        `objection_tag_bias:total+${bonus.toFixed(2)}`,
        ...reasons,
      ],
    };
  });
}
