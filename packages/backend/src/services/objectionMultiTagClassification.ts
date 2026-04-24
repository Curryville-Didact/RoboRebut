/**
 * Pre–Phase 4.4: deterministic multi-tag objection classification for analytics / structured_reply.
 * Does not replace `normalizeObjectionCategory` used by pattern ranking (unchanged).
 */

import type {
  AssistantStructuredReply,
  ObjectionTagWithScore,
} from "../types/assistantStructuredReply.js";
import type { DealContext } from "../types/dealContext.js";
import { isLineOfCreditContext, isMcaContext } from "../types/dealContext.js";
import { normalizeObjectionCategory } from "./objectionResponsePattern.js";

/** Canonical analytics-friendly slugs (fixed set). */
export const CANONICAL_OBJECTION_TAGS = [
  "price_cost_framing",
  "payment_affordability",
  "cash_flow_pressure",
  "margin_profitability",
  "timing_delay",
  "trust_risk",
  "confusion_clarity",
  "comparison_shopping",
  "urgency_absent",
  "decision_avoidance",
  "past_bad_experience",
  "not_a_fit",
  "authority_constraint",
  "receivables_lag",
  "structure_mismatch",
  "documentation_verification",
] as const;

export type CanonicalObjectionTag = (typeof CANONICAL_OBJECTION_TAGS)[number];

const TAG_SET = new Set<string>(CANONICAL_OBJECTION_TAGS);

/** When two tags tie on score, lower index wins as primary. */
export const PRIMARY_TIE_BREAK_ORDER: readonly CanonicalObjectionTag[] = [
  "not_a_fit",
  "structure_mismatch",
  "receivables_lag",
  "margin_profitability",
  "cash_flow_pressure",
  "payment_affordability",
  "price_cost_framing",
  "past_bad_experience",
  "trust_risk",
  "confusion_clarity",
  "authority_constraint",
  "timing_delay",
  "decision_avoidance",
  "urgency_absent",
  "comparison_shopping",
  "documentation_verification",
];

export function isKnownObjectionTag(s: string | null | undefined): s is CanonicalObjectionTag {
  if (s == null || s === "") return false;
  return TAG_SET.has(s.trim());
}

/** Map legacy matrix categories to canonical tag(s) for overlap / hints. */
export function mapLegacyCategoryToCanonical(
  legacy: string
): CanonicalObjectionTag | null {
  const n = normalizeObjectionCategory(legacy);
  switch (n) {
    case "price_cost_framing":
      return "price_cost_framing";
    case "timing_delay":
      return "timing_delay";
    case "trust_skepticism":
      return "trust_risk";
    case "need_indifference":
      return "not_a_fit";
    case "payment_fatigue":
      return "payment_affordability";
    default:
      return null;
  }
}

function tieBreakIndex(tag: string): number {
  const i = PRIMARY_TIE_BREAK_ORDER.indexOf(tag as CanonicalObjectionTag);
  return i === -1 ? 999 : i;
}

/**
 * Dedupe, strip unknown, stable canonical order, ensure primary appears in list.
 */
export function normalizeObjectionTags(
  primaryObjectionType: string | null,
  tags: readonly string[]
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (t: string) => {
    const k = t.trim();
    if (!isKnownObjectionTag(k) || seen.has(k)) return;
    seen.add(k);
    out.push(k);
  };
  if (primaryObjectionType && isKnownObjectionTag(primaryObjectionType)) {
    add(primaryObjectionType);
  }
  for (const t of tags) add(t);
  const ordered: string[] = [];
  for (const c of CANONICAL_OBJECTION_TAGS) {
    if (seen.has(c)) ordered.push(c);
  }
  return ordered;
}

/** Higher score first; on tie, lower `tieBreakIndex` wins (same as primary selection). */
export function sortObjectionTagsByScore(
  rows: readonly ObjectionTagWithScore[]
): ObjectionTagWithScore[] {
  return [...rows].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return tieBreakIndex(a.tag) - tieBreakIndex(b.tag);
  });
}

function rowsFromScoresMap(
  scores: Map<string, number>,
  primary: CanonicalObjectionTag,
  threshold: number
): ObjectionTagWithScore[] {
  const rows: ObjectionTagWithScore[] = [];
  for (const tag of CANONICAL_OBJECTION_TAGS) {
    const s = scores.get(tag) ?? 0;
    if (s >= threshold || tag === primary) {
      rows.push({ tag, score: s });
    }
  }
  return sortObjectionTagsByScore(rows);
}

function scoresMapFromTagRows(rows: readonly ObjectionTagWithScore[]): Map<string, number> {
  const scores = new Map<string, number>();
  for (const t of CANONICAL_OBJECTION_TAGS) scores.set(t, 0);
  for (const r of rows) {
    if (isKnownObjectionTag(r.tag)) scores.set(r.tag, r.score);
  }
  return scores;
}

/** Context-only tag weight (does not re-run core `scoreMessage`). */
const CONTEXT_REINFORCE_SCORE = 1.25;
const MARGIN_BOOST_DELTA = 0.25;

export type ObjectionClassificationResult = {
  primaryObjectionType: CanonicalObjectionTag;
  objectionTags: ObjectionTagWithScore[];
  objectionTagReasons?: string[];
};

export type ObjectionClassificationInput = {
  userMessage: string;
  /** From `normalizeObjectionCategory` / pattern path (legacy matrix vocabulary). */
  legacyNormalizedCategory: string;
  /** Deal / coaching context hints (optional). */
  dealTypeLabel?: string | null;
  posture?: string | null;
  /** Optional deal JSON for context-aware tag reinforcement only (does not alter core scoring). */
  dealContext?: DealContext | null;
  /** Light prior user text for repetition / trust persistence (optional). */
  conversationHistory?: {
    priorUserMessages?: string[];
  };
};

function bump(scores: Map<string, number>, tag: string, delta: number, reason: string, reasons: string[]) {
  const cur = scores.get(tag) ?? 0;
  scores.set(tag, cur + delta);
  if (delta > 0) reasons.push(`${tag}:+${delta}:${reason}`);
}

/**
 * Uneven sales / daily pull / same fixed debit — operational payment structure (not defer-the-decision).
 */
const OPERATIONAL_CADENCE_CONCERN_RE =
  /\b(slow\s+days?|dead\s+days?|days?\s+are\s+(slow|dead)|inconsistent\s+days|not\s+consistent|every\s+single\s+day|same\s+amount\s+coming\s+out|same\s+payment\s+every\s+day|same\s+amount\s+every\s+day)\b|restaurants?\s+don'?t\s+have\s+consistent\s+days|\b(daily\s+pull|daily\s+debit|daily\s+draft)\b|\b(aggressive).{0,40}\b(every\s+single\s+day|every\s+day)\b|\b(every\s+single\s+day).{0,40}\baggressive\b|\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\b.{0,50}\b(slow|dead|quiet)\b|\bwhen\s+we'?re\s+slow\b|\bcan'?t\s+handle\s+.{0,40}\b(pull|debit|draft|payment)\b|\bcan'?t\s+have\s+the\s+same\s+amount\b|\bkind\s+of\s+pull\b|\bpull\b.{0,30}\b(slow|dead|handle)\b/i;

/** True deferral / stall language — keep decision_avoidance when this matches. */
const EXPLICIT_DEFERRAL_RE =
  /\b(call\s+me\s+tomorrow|circle\s+back|think\s+about\s+it|not\s+ready\b|next\s+week|next\s+month|later\s+today|need\s+to\s+wait|have\s+to\s+wait|wait\s+a\s+few|wait\s+until|couple\s+of\s+weeks|couple\s+weeks|few\s+weeks|get\s+back\s+to\s+you|let\s+me\s+think)\b/i;

/** Receivables / payout timing mismatch (not generic “slow days”). */
const RECEIVABLES_TIMING_MISMATCH_RE =
  /\b(brokers?\s+(take|pay)|forever\s+to\s+pay|slow\s+pay|payout\s+lag|receivables?\s+(delay|lag)|pay\s+me\s+later|get\s+paid\s+later|paid\s+later\s+than|weekly\s+debit\s+but.{0,60}(later|lag|slow\s+pay)|when\s+brokers\s+pay|brokers?\s+pay\s+me\s+later)\b/i;

/**
 * Rule-based scores from merchant text + legacy category hint.
 */
function scoreMessage(
  text: string,
  legacyCanonical: CanonicalObjectionTag | null,
  reasons: string[]
): Map<string, number> {
  const scores = new Map<string, number>();
  for (const t of CANONICAL_OBJECTION_TAGS) scores.set(t, 0);
  const t = text.toLowerCase();

  if (/\b(too\s*high|too\s*much|expensive|overpriced|rate\s*(is|'s|is)|fee|fees|cost\b|budget|money's?\s*too)\b/i.test(t)) {
    bump(scores, "price_cost_framing", 3, "price/cost language", reasons);
  }
  if (/\b(payment|weekly|daily|draft|debit|ach|pull|withdrawal|afford|can't\s*afford|cannot\s*afford)\b/i.test(t)) {
    bump(scores, "payment_affordability", 2, "payment/afford", reasons);
  }
  if (/\b(cash\s*flow|runway|liquidity|float\b|working\s*capital)\b/i.test(t)) {
    bump(scores, "cash_flow_pressure", 2, "cash flow", reasons);
  }
  if (/\b(margin|profit|thin|bottom\s*line|comes?\s*out\s*of\s*profit|p&l)\b/i.test(t)) {
    bump(scores, "margin_profitability", 3, "margin/profit", reasons);
  }
  if (/\b(weekly\s+payment|comes?\s*out\s*of\s*profit)\b/i.test(t)) {
    bump(scores, "cash_flow_pressure", 2, "cadence vs profit", reasons);
  }
  if (
    /\b(next\s*month|delay|timing|call\s*you\s*back)\b/i.test(t) ||
    (/\blater\b/i.test(t) &&
      !/\b(pay\s+me\s+later|get\s+paid\s+later|paid\s+later\s+than|brokers?\s+pay\s+me\s+later)\b/i.test(t))
  ) {
    bump(scores, "timing_delay", 2, "delay/timing", reasons);
  }
  if (/\b(not\s*ready)\b/i.test(t)) {
    bump(scores, "timing_delay", 2, "not ready", reasons);
  }
  if (/\b(need\s+to\s+wait|have\s+to\s+wait|wait\s+a\s+few|wait\s+until|couple\s+of\s+weeks|couple\s+weeks|few\s+weeks)\b/i.test(t)) {
    bump(scores, "timing_delay", 3, "wait window", reasons);
    bump(scores, "decision_avoidance", 2, "defer/wait", reasons);
  }
  if (/\b(trust|scam|ripoff|sketchy|don't\s*trust|numbers|burned|got\s*burned|bad\s*experience|before\s*with|last\s*time)\b/i.test(t)) {
    bump(scores, "trust_risk", 2, "trust", reasons);
    if (/\b(burned|bad\s*experience|before|last\s*time|got\s*burned)\b/i.test(t)) {
      bump(scores, "past_bad_experience", 3, "past harm", reasons);
    }
  }
  if (/\b(confus|don't\s*understand|unclear|clarity|explain)\b/i.test(t)) {
    bump(scores, "confusion_clarity", 1, "clarity", reasons);
  }
  if (/\b(shop|compar|competitor|other\s*offer|elsewhere)\b/i.test(t)) {
    bump(scores, "comparison_shopping", 1, "shopping", reasons);
  }
  if (/\b(no\s*rush|not\s*urgent|no\s*hurry)\b/i.test(t)) {
    bump(scores, "urgency_absent", 1, "urgency", reasons);
  }
  if (
    /\b(think\s+about\s+it|need\s+to\s+think(\s+about\s+it)?|circle\s+back|not\s+sure\s+yet|get\s+back\s+to\s+you)\b/i.test(
      t
    )
  ) {
    bump(scores, "decision_avoidance", 2, "defer decision explicit", reasons);
  }
  if (/\b(not\s*a\s*fit|doesn't\s*fit|wrong\s*product|not\s*for\s*us)\b/i.test(t)) {
    bump(scores, "not_a_fit", 3, "fit", reasons);
  }
  if (/\b(partner|spouse|wife|husband|boss|board|approve|run\s*it\s*by|sign\s*off)\b/i.test(t)) {
    bump(scores, "authority_constraint", 2, "authority", reasons);
  }
  if (RECEIVABLES_TIMING_MISMATCH_RE.test(t)) {
    bump(scores, "receivables_lag", 5, "receivables_timing_mismatch", reasons);
  }
  if (/\b(structure|doesn't\s*line\s*up|dont\s*line\s*up|don't\s*line\s*up|line\s*up|misaligned)\b/i.test(t)) {
    bump(scores, "structure_mismatch", 2, "structure", reasons);
  }
  if (/\b(weekly\s*debit|daily\s*pull)\b/i.test(t)) {
    bump(scores, "payment_affordability", 2, "weekly debit", reasons);
    bump(scores, "cash_flow_pressure", 1, "cadence", reasons);
  }
  if (OPERATIONAL_CADENCE_CONCERN_RE.test(t)) {
    bump(scores, "payment_affordability", 3, "operational_cadence", reasons);
    bump(scores, "cash_flow_pressure", 3, "operational_cadence", reasons);
    bump(scores, "structure_mismatch", 3, "operational_cadence", reasons);
  }
  if (/\b(paperwork|documents?|statements?|verify|proof|bank\s*statements?)\b/i.test(t)) {
    bump(scores, "documentation_verification", 2, "docs", reasons);
  }

  if (legacyCanonical) {
    bump(scores, legacyCanonical, 2, "legacy_category", reasons);
  }

  if (OPERATIONAL_CADENCE_CONCERN_RE.test(t) && !EXPLICIT_DEFERRAL_RE.test(t)) {
    const da = scores.get("decision_avoidance") ?? 0;
    if (da > 0 && da <= 2) {
      scores.set("decision_avoidance", 0);
      reasons.push("decision_avoidance:suppressed:operational_cadence");
    }
  }

  return scores;
}

function pickPrimary(
  scores: Map<string, number>
): CanonicalObjectionTag {
  let bestTag: CanonicalObjectionTag = "price_cost_framing";
  let bestScore = -1;
  for (const tag of CANONICAL_OBJECTION_TAGS) {
    const s = scores.get(tag) ?? 0;
    if (s > bestScore) {
      bestScore = s;
      bestTag = tag;
      continue;
    }
    if (s === bestScore && s > 0) {
      if (tieBreakIndex(tag) < tieBreakIndex(bestTag)) {
        bestTag = tag;
      }
    }
  }
  if (bestScore <= 0) {
    return "price_cost_framing";
  }
  return bestTag;
}


/** Same phrasing as `scoreMessage` trust branch — used only for prior-turn scans. */
const PRIOR_TRUST_LANGUAGE_RE =
  /\b(trust|scam|ripoff|sketchy|don't\s*trust|numbers|burned|got\s*burned|bad\s*experience|before\s*with|last\s*time)\b/i;

function normalizeObjectionTextForMatch(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function extractMonthlyRevenueFromDeal(dc: DealContext | null | undefined): number | undefined {
  if (dc == null) return undefined;
  if (isMcaContext(dc) && dc.monthlyRevenue != null) return dc.monthlyRevenue;
  if (isLineOfCreditContext(dc) && dc.monthlyRevenue != null) return dc.monthlyRevenue;
  return undefined;
}

/** Optional numeric margin on stored deal JSON (fraction 0–1 or percent 1–100). */
function readOptionalMarginPercent(dc: DealContext | null | undefined): number | undefined {
  if (dc == null || typeof dc !== "object") return undefined;
  const r = dc as Record<string, unknown>;
  const m = r.margin ?? r.marginPercent ?? r.grossMarginPercent;
  if (typeof m !== "number" || !Number.isFinite(m)) return undefined;
  return m;
}

function isLowMarginSignal(dc: DealContext | null | undefined): boolean {
  const m = readOptionalMarginPercent(dc);
  if (m == null) return false;
  if (m > 0 && m <= 1) return m < 0.18;
  if (m > 1 && m <= 100) return m < 18;
  return false;
}

function countPriorSameNormalizedObjection(
  current: string,
  priorUserMessages: readonly string[] | undefined
): number {
  if (!priorUserMessages?.length) return 0;
  const cur = normalizeObjectionTextForMatch(current);
  if (cur.length < 12) return 0;
  let n = 0;
  for (const p of priorUserMessages) {
    if (normalizeObjectionTextForMatch(p) === cur) n += 1;
  }
  return n;
}

function priorUserMessagesHadTrustLanguage(priorUserMessages: readonly string[] | undefined): boolean {
  if (!priorUserMessages?.length) return false;
  return priorUserMessages.some((p) => PRIOR_TRUST_LANGUAGE_RE.test(p));
}

type DealPaymentCadence = "daily" | "weekly" | "monthly";

function dealPaymentCadence(dc: DealContext | null | undefined): DealPaymentCadence | undefined {
  if (dc == null) return undefined;
  if (isMcaContext(dc) && dc.paymentFrequency) return dc.paymentFrequency;
  if (isLineOfCreditContext(dc) && dc.paymentFrequency) return dc.paymentFrequency;
  return undefined;
}

/**
 * Clear mismatch: merchant describes receivables/timing tension and names a payment cadence
 * that conflicts with the deal's `paymentFrequency`.
 */
function receivablesTimingVsPaymentFrequencyMismatch(
  userMessage: string,
  dc: DealContext | null | undefined
): boolean {
  const cadence = dealPaymentCadence(dc);
  if (!cadence) return false;
  const t = userMessage.toLowerCase();
  const hasReceivableTiming =
    /\b(brokers?\s+take|forever\s+to\s+pay|slow\s+pay|receivables?|a\/r\b|when\s+customers?\s+pay|pay\s+me\s+when)/i.test(
      t
    );
  if (!hasReceivableTiming) return false;
  const mentionsDaily = /\bdaily\b/i.test(t);
  const mentionsWeekly = /\bweekly\b/i.test(t);
  const mentionsMonthly = /\bmonthly\b/i.test(t);
  const cadenceNamed = mentionsDaily || mentionsWeekly || mentionsMonthly;
  if (!cadenceNamed) return false;
  if (cadence === "daily" && mentionsWeekly) return true;
  if (cadence === "weekly" && mentionsDaily) return true;
  if (cadence === "monthly" && (mentionsDaily || mentionsWeekly)) return true;
  if ((cadence === "daily" || cadence === "weekly") && mentionsMonthly) return true;
  return false;
}

/**
 * Post-step: merge context tags into the core classifier output. Does not re-run or alter `scoreMessage` / thresholds.
 */
function applyContextAwareReinforcement(
  core: ObjectionClassificationResult,
  input: ObjectionClassificationInput
): ObjectionClassificationResult {
  const extraReasons: string[] = [];
  const scores = scoresMapFromTagRows(core.objectionTags);
  const dc = input.dealContext ?? null;
  const priors = input.conversationHistory?.priorUserMessages;

  const rev = extractMonthlyRevenueFromDeal(dc);
  if (
    rev != null &&
    rev > 0 &&
    /\bpayment\b/i.test(input.userMessage) &&
    (scores.get("cash_flow_pressure") ?? 0) === 0
  ) {
    scores.set("cash_flow_pressure", CONTEXT_REINFORCE_SCORE);
    extraReasons.push("context:monthlyRevenue+payment→cash_flow_pressure");
  }

  if (isLowMarginSignal(dc)) {
    const cur = scores.get("margin_profitability") ?? 0;
    if (cur === 0) {
      scores.set("margin_profitability", CONTEXT_REINFORCE_SCORE);
      extraReasons.push("context:low_margin→margin_profitability");
    } else {
      scores.set("margin_profitability", cur + MARGIN_BOOST_DELTA);
      extraReasons.push("context:low_margin→boost_margin_profitability");
    }
  }

  const repeats = countPriorSameNormalizedObjection(input.userMessage.trim(), priors);
  if (repeats >= 2 && (scores.get("decision_avoidance") ?? 0) === 0) {
    scores.set("decision_avoidance", CONTEXT_REINFORCE_SCORE);
    extraReasons.push("context:repeated_objection≥2→decision_avoidance");
  }

  if (priorUserMessagesHadTrustLanguage(priors) && (scores.get("trust_risk") ?? 0) === 0) {
    scores.set("trust_risk", CONTEXT_REINFORCE_SCORE);
    extraReasons.push("context:prior_trust_language→trust_risk");
  }

  if (receivablesTimingVsPaymentFrequencyMismatch(input.userMessage.trim(), dc)) {
    if ((scores.get("receivables_lag") ?? 0) === 0) {
      scores.set("receivables_lag", CONTEXT_REINFORCE_SCORE);
      extraReasons.push("context:receivables_vs_deal_cadence→receivables_lag");
    }
    if ((scores.get("structure_mismatch") ?? 0) === 0) {
      scores.set("structure_mismatch", CONTEXT_REINFORCE_SCORE);
      extraReasons.push("context:receivables_vs_deal_cadence→structure_mismatch");
    }
  }

  if (extraReasons.length === 0) return core;

  const primary = pickPrimary(scores);
  const objectionTags = rowsFromScoresMap(scores, primary, 1);
  const allReasons = [...(core.objectionTagReasons ?? []), ...extraReasons];
  return {
    primaryObjectionType: primary,
    objectionTags: objectionTags.length > 0 ? objectionTags : [{ tag: primary, score: scores.get(primary) ?? 0 }],
    objectionTagReasons: allReasons.length > 0 ? allReasons : undefined,
  };
}

function resolveCorePrimaryAndSecondaryObjections(
  input: ObjectionClassificationInput
): ObjectionClassificationResult {
  const reasons: string[] = [];
  const legacyCanon = mapLegacyCategoryToCanonical(input.legacyNormalizedCategory);
  const scores = scoreMessage(input.userMessage.trim(), legacyCanon, reasons);
  const primary = pickPrimary(scores);
  const objectionTags = rowsFromScoresMap(scores, primary, 1);
  return {
    primaryObjectionType: primary,
    objectionTags:
      objectionTags.length > 0 ? objectionTags : [{ tag: primary, score: scores.get(primary) ?? 0 }],
    objectionTagReasons: reasons.length > 0 ? reasons : undefined,
  };
}

/**
 * Deterministic primary + secondary tags from user text and legacy normalized category,
 * plus optional deal/thread reinforcement (additive; core scoring path unchanged).
 */
export function resolvePrimaryAndSecondaryObjections(
  input: ObjectionClassificationInput
): ObjectionClassificationResult {
  const core = resolveCorePrimaryAndSecondaryObjections(input);
  const hasContext =
    input.dealContext != null ||
    (input.conversationHistory?.priorUserMessages?.length ?? 0) > 0;
  if (!hasContext) return core;
  return applyContextAwareReinforcement(core, input);
}

/** Normalize a raw slug (marker / UI) onto a canonical tag when possible. */
export function coerceToCanonicalObjectionTag(raw: string | null | undefined): CanonicalObjectionTag | null {
  if (raw == null || raw.trim() === "") return null;
  const s = raw.trim().toLowerCase().replace(/\s+/g, "_");
  if (isKnownObjectionTag(s)) return s;
  const mapped = mapLegacyCategoryToCanonical(s);
  return mapped;
}

/**
 * Attach multi-tag fields; keeps `objectionType` aligned with `primaryObjectionType` for UI + API.
 */
const TOP_OBJECTION_TAGS_UI = 5;

export function enrichAssistantStructuredReplyWithObjectionTags(
  sr: AssistantStructuredReply,
  classification: ObjectionClassificationResult
): AssistantStructuredReply {
  const sorted = sortObjectionTagsByScore(classification.objectionTags);
  const topObjectionTags = sorted.slice(0, TOP_OBJECTION_TAGS_UI);
  const primary: CanonicalObjectionTag =
    (sorted[0]?.tag as CanonicalObjectionTag) ?? classification.primaryObjectionType;
  return {
    ...sr,
    objectionType: primary,
    primaryObjectionType: primary,
    objectionTags: sorted,
    topObjectionTags,
    ...(classification.objectionTagReasons != null &&
    classification.objectionTagReasons.length > 0
      ? { objectionTagReasons: classification.objectionTagReasons }
      : {}),
  };
}
