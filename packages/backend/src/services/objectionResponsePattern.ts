/**
 * Phase 4.6–4.9 — Objection category × posture × deal type → rebuttal pattern (rule engine + adaptive preference).
 *
 * PRODUCTION: `resolveObjectionResponsePatternWithSelection` / `selectObjectionResponsePattern`
 * are called only from `coachChatReply` (live app). Pattern ranking (incl. Phase 4.4 extra boost)
 * runs in `selectPatternPreference` before the coach LLM call. The `/ws` demo does not use this module.
 */

import type { DealCoachingPosture } from "./dealCoachingPosture.js";
import { buildPatternKey } from "./patternAnalytics.js";
import {
  defaultPatternStatsProvider,
  selectPatternPreference,
  type PatternCandidate,
  type PatternCandidateEntry,
  type PatternSelectionResult,
  type PatternStatsProvider,
} from "./patternPreference.js";

export type RebuttalStyle =
  | "daily_burden_reframe"
  | "cost_of_delay_redirect"
  | "qualification_pressure"
  | "structure_clarity"
  | "risk_reduction"
  | "urgency_without_panic"
  | "operational_use_case";

export type CoachNoteStyle =
  | "closer_guidance"
  | "qualification_guidance"
  | "pressure_control"
  | "risk_control";

export type FollowUpStyle =
  | "direct_question"
  | "diagnostic_question"
  | "commitment_question"
  | "use_of_funds_question";

export type ConfidenceStyle = "high" | "moderate" | "conditional";

export type ProStrategyTag =
  | "risk_reversal"
  | "financial_reframe"
  | "urgency_close"
  | "decision_isolation";

/** Core pattern before confidenceStyle is attached (derived from posture). */
export type ObjectionResponsePatternCore = {
  rebuttalStyle: RebuttalStyle;
  coachNoteStyle: CoachNoteStyle;
  followUpStyle: FollowUpStyle;
  primaryMove: string;
  secondaryMove?: string;
  strategyTag?: ProStrategyTag;
  strategyHint?: string;
};

export interface ObjectionResponsePattern extends ObjectionResponsePatternCore {
  confidenceStyle: ConfidenceStyle;
}

export type ObjectionPatternInput = {
  objectionType: string;
  posture: DealCoachingPosture;
  dealType: string;
};

/** Canonical categories used by the matrix. */
const CANONICAL = new Set([
  "price_cost_framing",
  "timing_delay",
  "trust_skepticism",
  "need_indifference",
  "payment_fatigue",
  "current_provider_loyalty",
  "existing_relationship",
  "unknown",
]);

/**
 * Normalize UI labels or loose strings to canonical category keys.
 */
export function normalizeObjectionCategory(raw: string): string {
  const s = raw.trim().toLowerCase().replace(/\s+/g, "_");
  if (CANONICAL.has(s)) return s;

  const compact = raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
  const aliases: Record<string, string> = {
    price: "price_cost_framing",
    cost: "price_cost_framing",
    price_cost: "price_cost_framing",
    price_cost_framing: "price_cost_framing",
    timing: "timing_delay",
    delay: "timing_delay",
    trust: "trust_skepticism",
    skepticism: "trust_skepticism",
    need: "need_indifference",
    indifference: "need_indifference",
    no_need: "need_indifference",
    payment_fatigue: "payment_fatigue",
    fatigue: "payment_fatigue",
    current_provider_loyalty: "current_provider_loyalty",
    provider_loyalty: "current_provider_loyalty",
    current_provider: "current_provider_loyalty",
    existing_provider: "current_provider_loyalty",
    existing_relationship: "existing_relationship",
    relationship: "existing_relationship",
    existing_relationships: "existing_relationship",
  };
  if (aliases[compact]) return aliases[compact];
  if (aliases[s]) return aliases[s];

  if (s.includes("price") && s.includes("cost")) return "price_cost_framing";
  if (s.includes("timing") || s.includes("delay")) return "timing_delay";
  if (s.includes("trust") || s.includes("skeptic")) return "trust_skepticism";
  if (s.includes("indifference") || s.includes("need")) return "need_indifference";
  if (s.includes("payment") && s.includes("fatigue")) return "payment_fatigue";
  if (s.includes("provider") && (s.includes("current") || s.includes("existing")))
    return "current_provider_loyalty";
  if (s.includes("relationship") && (s.includes("current") || s.includes("existing")))
    return "existing_relationship";

  return "unknown";
}

const SUPPORTED_DEAL_TYPES = new Set([
  "business_line_of_credit",
  "mca",
  "merchant_services",
]);

type SupportedDealType = "business_line_of_credit" | "mca" | "merchant_services";

/**
 * Maps calculator / UI deal strings to supported deal types. Unknown or empty → null (use legacy matrix only).
 */
function normalizeDealType(raw: string): SupportedDealType | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const s = trimmed.toLowerCase().replace(/\s+/g, "_");
  if (s === "unknown") return null;
  if (SUPPORTED_DEAL_TYPES.has(s)) return s as SupportedDealType;

  const compact = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  const aliases: Record<string, SupportedDealType> = {
    business_line_of_credit: "business_line_of_credit",
    loc: "business_line_of_credit",
    line_of_credit: "business_line_of_credit",
    mca: "mca",
    merchant_cash_advance: "mca",
    merchant_services: "merchant_services",
    merchant_processing: "merchant_services",
  };
  if (aliases[s]) return aliases[s];
  if (aliases[compact]) return aliases[compact];

  return null;
}

function buildDealSpecializedKey(
  category: string,
  posture: DealCoachingPosture,
  dealType: SupportedDealType
): string {
  return `${category}::${posture}::${dealType}`;
}

/**
 * Lightweight keyword routing when the client does not send objection_category.
 */
export function inferObjectionCategoryFromMessage(text: string): string {
  const t = text.toLowerCase();
  if (
    /payment\s*fatigue|daily\s*payment|ach\s*(is|hold)|too\s*much\s*(is\s*)?(coming\s*out|held)|hold\s*(is\s*)?too/i.test(
      t
    )
  ) {
    return "payment_fatigue";
  }
  if (
    /\b(later|wait|think\s*about|call\s*(you|me)\s*back|not\s*ready|next\s*week|need\s*time|timing|delay)\b/i.test(
      t
    )
  ) {
    return "timing_delay";
  }
  if (/\b(trust|scam|legit|review|ripoff|heard\s*bad)\b/i.test(t)) {
    return "trust_skepticism";
  }
  if (
    /\b(current\s*(provider|processor|bank)|already\s*(have|using)|stay\s*with\s*(them|our\s*(bank|processor))|with\s*my\s*(bank|processor)|existing\s*(provider|processor)|switch(ing)?\s*(is)?\s*(a)?\s*hassle)\b/i.test(
      t
    )
  ) {
    return "current_provider_loyalty";
  }
  if (
    /\b(existing\s*(relationship|rep|account)|been\s*with\s*(them|our\s*(bank|processor))|my\s*(guy|rep)\s*there|loyal\s*(to|with)\s*(them|our\s*(bank|processor))|we\s*have\s*a\s*relationship)\b/i.test(
      t
    )
  ) {
    return "existing_relationship";
  }
  if (/\b(don't\s*need|not\s*interested|fine\s*without|don't\s*want|no\s*need)\b/i.test(t)) {
    return "need_indifference";
  }
  if (/\b(price|cost|expensive|fee|rate|budget|too\s*much\s*money)\b/i.test(t)) {
    return "price_cost_framing";
  }
  return "unknown";
}

export function confidenceStyleForPosture(
  posture: DealCoachingPosture
): ConfidenceStyle {
  switch (posture) {
    case "controlled_assertive":
    case "assertive_opportunity":
      return "high";
    case "balanced":
      return "moderate";
    case "exploratory":
      return "conditional";
    default: {
      const _e: never = posture;
      return _e;
    }
  }
}

function attachConfidence(
  posture: DealCoachingPosture,
  core: ObjectionResponsePatternCore
): ObjectionResponsePattern {
  return {
    ...core,
    confidenceStyle: confidenceStyleForPosture(posture),
  };
}

function getProStrategyAugmentation(
  objectionType: string
): Pick<ObjectionResponsePatternCore, "strategyTag" | "strategyHint"> | null {
  switch (normalizeObjectionCategory(objectionType)) {
    case "trust_skepticism":
      return {
        strategyTag: "risk_reversal",
        strategyHint:
          "Add risk-reversal framing: reduce perceived downside with concrete proof, validation, or a safe next step.",
      };
    case "price_cost_framing":
      return {
        strategyTag: "financial_reframe",
        strategyHint:
          "Add financial-reframe framing: anchor on ROI, cost of delay, and the economics of staying the same.",
      };
    case "timing_delay":
      return {
        strategyTag: "urgency_close",
        strategyHint:
          "Add urgency-close framing: make the next decision point concrete without sounding frantic or desperate.",
      };
    case "unknown":
      return null;
    default:
      return normalizeObjectionCategory(objectionType) === "unknown"
        ? null
        : null;
  }
}

function getAuthorityProStrategyAugmentation(
  rawObjectionType: string
): Pick<ObjectionResponsePatternCore, "strategyTag" | "strategyHint"> | null {
  const normalized = rawObjectionType.trim().toLowerCase().replace(/\s+/g, "_");
  if (normalized === "authority" || normalized.includes("authority")) {
    return {
      strategyTag: "decision_isolation",
      strategyHint:
        "Add decision-isolation framing: separate internal approval mechanics from actual fit, urgency, and buyer intent.",
    };
  }
  return null;
}

function applyProStrategyAugmentation(
  input: ObjectionPatternInput,
  core: ObjectionResponsePatternCore
): ObjectionResponsePatternCore {
  const augmentation =
    getAuthorityProStrategyAugmentation(input.objectionType) ??
    getProStrategyAugmentation(input.objectionType);
  if (!augmentation) return core;

  return {
    ...core,
    ...augmentation,
    secondaryMove:
      core.secondaryMove ??
      augmentation.strategyHint,
  };
}

function toPatternCandidate(
  cat: string,
  posture: DealCoachingPosture,
  dealTypeLabel: string,
  source: PatternCandidate["source"],
  core: ObjectionResponsePatternCore
): PatternCandidate {
  const conf = confidenceStyleForPosture(posture);
  return {
    patternKey: buildPatternKey({
      objectionCategory: cat,
      posture,
      dealType: dealTypeLabel,
      rebuttalStyle: core.rebuttalStyle,
      followUpStyle: core.followUpStyle,
      confidenceStyle: conf,
    }),
    source,
    objectionCategory: cat,
    posture,
    dealType: dealTypeLabel === "unknown" ? null : dealTypeLabel,
    rebuttalStyle: core.rebuttalStyle,
    coachNoteStyle: core.coachNoteStyle,
    followUpStyle: core.followUpStyle,
    confidenceStyle: conf,
  };
}

/**
 * Valid candidates from existing rule paths (deal-specialized → explicit → default posture), in priority order.
 * Phase 4.6 — Multiple expression slots per branch; each slot yields a distinct patternKey when styles differ.
 */
export function getObjectionResponsePatternCandidates(
  input: ObjectionPatternInput
): PatternCandidateEntry[] {
  const cat = normalizeObjectionCategory(input.objectionType);
  const deal = normalizeDealType(input.dealType);
  const posture = input.posture;
  const dealTypeLabel = input.dealType?.trim() || "unknown";

  const entries: PatternCandidateEntry[] = [];

  if (deal) {
    const sk = buildDealSpecializedKey(cat, posture, deal);
    const dealCores = DEAL_SPECIALIZED_EXPRESSIONS[sk];
    if (dealCores?.length) {
      for (const core of dealCores) {
        entries.push({
          candidate: toPatternCandidate(
            cat,
            posture,
            dealTypeLabel,
            "deal_specialized",
            core
          ),
          core,
        });
      }
    }
  }

  const legacyKey = `${cat}::${posture}`;
  const explicitCores = EXPLICIT_EXPRESSIONS[legacyKey];
  if (explicitCores?.length) {
    for (const explicitCore of explicitCores) {
      entries.push({
        candidate: toPatternCandidate(
          cat,
          posture,
          dealTypeLabel,
          "explicit",
          explicitCore
        ),
        core: explicitCore,
      });
    }
  }

  const defaultCore = defaultPatternForPosture(posture);
  entries.push({
    candidate: toPatternCandidate(
      cat,
      posture,
      dealTypeLabel,
      "default_posture",
      defaultCore
    ),
    core: defaultCore,
  });

  return entries;
}

function defaultPatternForPosture(
  posture: DealCoachingPosture
): ObjectionResponsePatternCore {
  switch (posture) {
    case "exploratory":
      return {
        rebuttalStyle: "qualification_pressure",
        coachNoteStyle: "qualification_guidance",
        followUpStyle: "diagnostic_question",
        primaryMove:
          "Have the broker ask for monthly revenue, margin, and intended use of funds before proposing any close, and script one specific diagnostic question for the merchant.",
        secondaryMove:
          "Require the broker to capture revenue, average daily balance, and use-of-funds in plain numbers before moving to rebuttal language.",
      };
    case "balanced":
      return {
        rebuttalStyle: "structure_clarity",
        coachNoteStyle: "closer_guidance",
        followUpStyle: "direct_question",
        primaryMove:
          "Have the broker state the offer in three plain steps (funding amount, total payback, payment cadence) and delete jargon from what they plan to say.",
      };
    case "controlled_assertive":
      return {
        rebuttalStyle: "daily_burden_reframe",
        coachNoteStyle: "pressure_control",
        followUpStyle: "direct_question",
        primaryMove:
          "Convert total cost into daily payment and tie it to a specific operational outcome (revenue, payroll, or inventory).",
      };
    case "assertive_opportunity":
      return {
        rebuttalStyle: "operational_use_case",
        coachNoteStyle: "closer_guidance",
        followUpStyle: "commitment_question",
        primaryMove:
          "Name one concrete business outcome the funds will fund in the next 30 days and script the line that ties the payment to that outcome.",
        secondaryMove:
          "Quantify the cost of inaction in dollars or lost revenue for the next 30 days and put that comparison in the broker’s mouth.",
      };
    default: {
      const _e: never = posture;
      return _e;
    }
  }
}

/**
 * Phase 4.6 — Explicit expression slots (legacy single patterns become slot 0).
 * Distinct rebuttalStyle × followUpStyle pairs → distinct patternKeys under the same objection × posture path.
 */
const EXPLICIT_EXPRESSIONS: Record<string, ObjectionResponsePatternCore[]> = {
  "price_cost_framing::controlled_assertive": [
    {
      rebuttalStyle: "daily_burden_reframe",
      coachNoteStyle: "pressure_control",
      followUpStyle: "direct_question",
      primaryMove:
        "Convert total cost into daily payment and tie it to a specific operational outcome (revenue, payroll, or inventory).",
      secondaryMove:
        "Explicitly compare the cost of the payment to the cost of inaction (missed revenue, slowed operations, or delayed growth).",
    },
    {
      rebuttalStyle: "qualification_pressure",
      coachNoteStyle: "pressure_control",
      followUpStyle: "diagnostic_question",
      primaryMove:
        "Pull margin, weekly cash-in, and payback tolerance into numbers before you debate the headline rate — force one diagnostic that exposes where the math actually breaks.",
      secondaryMove:
        "Ask what payment pace would still feel expensive even if the rate improved—then tie your rebuttal to fixing that constraint, not swapping adjectives.",
    },
    {
      rebuttalStyle: "cost_of_delay_redirect",
      coachNoteStyle: "pressure_control",
      followUpStyle: "commitment_question",
      primaryMove:
        "Contrast the payment to what one more month of the unsolved problem costs in cash, inventory, or payroll — make delay carry a dollar tag.",
      secondaryMove:
        "Ask what date they’d fund if the structure were acceptable today; if they won’t name one, diagnose what they’re actually refusing.",
    },
  ],
  "price_cost_framing::exploratory": [
    {
      rebuttalStyle: "qualification_pressure",
      coachNoteStyle: "qualification_guidance",
      followUpStyle: "diagnostic_question",
      primaryMove:
        "Ask the merchant for monthly revenue and margin, then ask what number would make the payment workable before you push a rebuttal.",
      secondaryMove:
        "Ask what the funds will buy and how that purchase produces cash within 30 days—script both questions verbatim.",
    },
    {
      rebuttalStyle: "structure_clarity",
      coachNoteStyle: "qualification_guidance",
      followUpStyle: "direct_question",
      primaryMove:
        "Strip the objection to three plain buckets—total funding, repayment cadence, net impact on weekly cash—and refuse to chase stories until those are spoken in numbers.",
      secondaryMove:
        "Ask what proof would change their mind today; if none exists, steer to what evidence they’d accept next call.",
    },
  ],
  "timing_delay::controlled_assertive": [
    {
      rebuttalStyle: "urgency_without_panic",
      coachNoteStyle: "closer_guidance",
      followUpStyle: "commitment_question",
      primaryMove:
        "Ask what specific commit date they would use if the math worked, and state the dollar cost of each additional week of delay.",
      secondaryMove:
        "Contrast the weekly payment with one weekly revenue figure they must confirm on the call.",
    },
    {
      rebuttalStyle: "cost_of_delay_redirect",
      coachNoteStyle: "closer_guidance",
      followUpStyle: "direct_question",
      primaryMove:
        "Force the wait to compete with one operational loss they already feel—stack rank delay against payroll risk, inventory gaps, or missed revenue they name.",
      secondaryMove:
        "Ask what has to be true next week that isn’t true today—if they can’t answer, expose the stall as unmanaged risk, not patience.",
    },
    {
      rebuttalStyle: "urgency_without_panic",
      coachNoteStyle: "closer_guidance",
      followUpStyle: "diagnostic_question",
      primaryMove:
        "Separate clock objections from math objections—diagnose whether they fear timing or they fear the commitment once timing is resolved.",
      secondaryMove:
        "Demand one concrete contingency that would justify moving now vs later; if absent, tighten to a dated follow-up or drop the pretend delay.",
    },
  ],
  "trust_skepticism::balanced": [
    {
      rebuttalStyle: "structure_clarity",
      coachNoteStyle: "risk_control",
      followUpStyle: "direct_question",
      primaryMove:
        "State funding, repayment, and fees in one sentence each, then ask one verification question they can answer from a document on the desk.",
    },
    {
      rebuttalStyle: "risk_reduction",
      coachNoteStyle: "risk_control",
      followUpStyle: "diagnostic_question",
      primaryMove:
        "Isolate what would falsify their doubt—processor statement, funding agreement, ACH schedule—and ask what proof threshold would move them to a yes/no.",
      secondaryMove:
        "If they cite past harm, separate that provider from this structure before you defend; mismatch here loses the room.",
    },
    {
      rebuttalStyle: "structure_clarity",
      coachNoteStyle: "risk_control",
      followUpStyle: "commitment_question",
      primaryMove:
        "Translate skepticism into a bounded test: one funding step they can observe, one repayment date they control, then ask if they’ll execute if both check out.",
      secondaryMove:
        "If trust is still generic, pin whether they fear speed, disclosure, or control—and answer only that slice without a monologue.",
    },
  ],
  "need_indifference::assertive_opportunity": [
    {
      rebuttalStyle: "operational_use_case",
      coachNoteStyle: "closer_guidance",
      followUpStyle: "commitment_question",
      primaryMove:
        "Name one expense or revenue leak the capital fixes in the next 45 days and script the line that connects the payment to fixing that leak.",
      secondaryMove:
        "Ask them to state that problem’s dollar cost per month and use that figure in the next sentence.",
    },
    {
      rebuttalStyle: "cost_of_delay_redirect",
      coachNoteStyle: "closer_guidance",
      followUpStyle: "direct_question",
      primaryMove:
        "Treat “don’t need it” as a positioning error—quantify what they lose weekly by funding the status quo vs fixing the named constraint.",
      secondaryMove:
        "Ask what metric moves first if capital lands—force them to contradict indifference with one operational imperative.",
    },
    {
      rebuttalStyle: "urgency_without_panic",
      coachNoteStyle: "closer_guidance",
      followUpStyle: "diagnostic_question",
      primaryMove:
        "Separate true indifference from fear disguised as apathy—diagnose whether they’re refusing the offer or refusing to reorder priorities.",
      secondaryMove:
        "Ask what would make “not interested” falsifiable on paper in the next 48 hours.",
    },
  ],
  "payment_fatigue::controlled_assertive": [
    {
      rebuttalStyle: "qualification_pressure",
      coachNoteStyle: "pressure_control",
      followUpStyle: "use_of_funds_question",
      primaryMove:
        "Separate what the capital buys from what the hold repays—have the merchant list both in one breath.",
      secondaryMove:
        "Ask what operational outcome must change for the payment to be worth it, and refuse to move on until they name one metric.",
    },
    {
      rebuttalStyle: "daily_burden_reframe",
      coachNoteStyle: "pressure_control",
      followUpStyle: "commitment_question",
      primaryMove:
        "Compare stacked payments to throughput—if gross margin can’t absorb the pace, steer to structure change, not another band-aid.",
      secondaryMove:
        "Ask whether they’re exhausted by volume of pulls or by misaligned timing—each answer routes a different repair.",
    },
  ],
  "payment_fatigue::balanced": [
    {
      rebuttalStyle: "structure_clarity",
      coachNoteStyle: "qualification_guidance",
      followUpStyle: "direct_question",
      primaryMove:
        "Clarify whether they’re reacting to frequency, total load, or unpredictability—then restate the offer in plain steps so they can point to the exact friction.",
      secondaryMove:
        "Ask which lever actually fixes fatigue: fewer pulls, smoother cadence, or a smaller fixed obligation.",
    },
    {
      rebuttalStyle: "qualification_pressure",
      coachNoteStyle: "qualification_guidance",
      followUpStyle: "diagnostic_question",
      primaryMove:
        "Use fatigue to force numbers: what’s total monthly outflow, what’s left after COGS + payroll, and what payment range stops feeling like a grind.",
      secondaryMove:
        "Ask what they’re trying to relieve—cash timing, margin squeeze, or stacked obligations—so you don’t pitch a new payment as the cure for payments.",
    },
    {
      rebuttalStyle: "risk_reduction",
      coachNoteStyle: "risk_control",
      followUpStyle: "commitment_question",
      primaryMove:
        "De-risk the decision by narrowing it: agree on one structure change that reduces fatigue, then ask for a yes/no if that change is met.",
      secondaryMove:
        "If they won’t commit even with the fatigue reduced, surface the real objection instead of negotiating cadence forever.",
    },
  ],
  "unknown::balanced": [
    {
      rebuttalStyle: "structure_clarity",
      coachNoteStyle: "closer_guidance",
      followUpStyle: "direct_question",
      primaryMove:
        "Force clarity: restate what you heard in one sentence, then reduce the next step to one decision so the call stops drifting.",
      secondaryMove:
        "Ask what part is off—structure, timing, or trust—and only answer that slice.",
    },
    {
      rebuttalStyle: "qualification_pressure",
      coachNoteStyle: "qualification_guidance",
      followUpStyle: "diagnostic_question",
      primaryMove:
        "When the objection is vague, pull it into a constraint: money, timing, authority, or trust—then ask one diagnostic that pins down which bucket it is.",
      secondaryMove:
        "If they won’t pick a bucket, treat it as a stall and re-qualify the deal before you keep pitching.",
    },
    {
      rebuttalStyle: "urgency_without_panic",
      coachNoteStyle: "closer_guidance",
      followUpStyle: "commitment_question",
      primaryMove:
        "Anchor the next step: offer one concrete path forward and ask for a commitment to a date or a decision, not a vague \"circle back\".",
      secondaryMove:
        "If they won’t commit to a step, ask what new information would change that—then set the condition explicitly.",
    },
  ],
  "current_provider_loyalty::balanced": [
    {
      rebuttalStyle: "structure_clarity",
      coachNoteStyle: "risk_control",
      followUpStyle: "direct_question",
      primaryMove:
        "Respect loyalty but separate it from fit: clarify what they get today (terms, speed, control) and what they wish was different so you’re not asking them to \"switch\" blindly.",
      secondaryMove:
        "Ask what they’d need to see to consider an alternative without burning the relationship.",
    },
    {
      rebuttalStyle: "risk_reduction",
      coachNoteStyle: "risk_control",
      followUpStyle: "diagnostic_question",
      primaryMove:
        "Expose hidden risk: ask what happens if their current provider tightens terms, delays funding, or changes cadence—then position your option as a controlled backup, not a betrayal.",
      secondaryMove:
        "Ask which failure mode they’ve already experienced: speed, transparency, or control.",
    },
    {
      rebuttalStyle: "operational_use_case",
      coachNoteStyle: "closer_guidance",
      followUpStyle: "commitment_question",
      primaryMove:
        "Reframe as optional leverage: a second option gives them negotiating power with their current provider and a faster path if a new need pops up.",
      secondaryMove:
        "Ask if they’ll run the comparison once—if the numbers beat their current option, they decide; if not, they stay put.",
    },
  ],
  "current_provider_loyalty::controlled_assertive": [
    {
      rebuttalStyle: "cost_of_delay_redirect",
      coachNoteStyle: "pressure_control",
      followUpStyle: "direct_question",
      primaryMove:
        "Loyalty doesn’t fix constraints. If the current provider can’t solve the problem on your timeline, the cost is delay—force the decision around outcome, not allegiance.",
      secondaryMove:
        "Ask what deadline exists that their current provider cannot meet.",
    },
    {
      rebuttalStyle: "structure_clarity",
      coachNoteStyle: "pressure_control",
      followUpStyle: "diagnostic_question",
      primaryMove:
        "Pin the real blocker: is it rate, cadence, speed, or control? If they can’t name it, loyalty is a shield for uncertainty—make them choose the constraint.",
      secondaryMove:
        "Ask what their current provider offered that they won’t match anywhere else.",
    },
    {
      rebuttalStyle: "urgency_without_panic",
      coachNoteStyle: "closer_guidance",
      followUpStyle: "commitment_question",
      primaryMove:
        "Offer a clean comparison lane: keep the relationship, but give yourself an alternative path so you’re not stuck if they stall or re-price.",
      secondaryMove:
        "Ask for a yes/no on reviewing one alternate structure today.",
    },
  ],
  "current_provider_loyalty::assertive_opportunity": [
    {
      rebuttalStyle: "operational_use_case",
      coachNoteStyle: "closer_guidance",
      followUpStyle: "commitment_question",
      primaryMove:
        "Make it about execution: if this capital fixes a 30‑day outcome and your provider can’t deliver the structure fast enough, you’re choosing performance, not disloyalty.",
      secondaryMove:
        "Ask what outcome they want solved in 30 days that their current provider hasn’t already solved.",
    },
    {
      rebuttalStyle: "risk_reduction",
      coachNoteStyle: "risk_control",
      followUpStyle: "direct_question",
      primaryMove:
        "Position it as a contingency: keep the provider, but lock a backup so a surprise change doesn’t trap them.",
      secondaryMove:
        "Ask what happens to their plan if the provider says \"not now\" again.",
    },
  ],
  "existing_relationship::balanced": [
    {
      rebuttalStyle: "structure_clarity",
      coachNoteStyle: "risk_control",
      followUpStyle: "direct_question",
      primaryMove:
        "A relationship is a channel, not a solution. Clarify what they’re actually waiting on—approval, terms, or timing—so you can compare options cleanly.",
      secondaryMove:
        "Ask what their rep promised and by what date.",
    },
    {
      rebuttalStyle: "risk_reduction",
      coachNoteStyle: "risk_control",
      followUpStyle: "diagnostic_question",
      primaryMove:
        "Expose the blind spot: relationships fail when exceptions disappear. Ask what happens if their rep leaves, policy changes, or the bank tightens—then frame your option as insurance.",
      secondaryMove:
        "Ask what they’ve gotten from the relationship that a standard offer wouldn’t give them.",
    },
    {
      rebuttalStyle: "cost_of_delay_redirect",
      coachNoteStyle: "closer_guidance",
      followUpStyle: "commitment_question",
      primaryMove:
        "Force a decision window: if the relationship can’t produce a clear yes/no by a specific date, you’re choosing delay—make them own that cost.",
      secondaryMove:
        "Ask if they’ll commit to a dated checkpoint, then choose the path that actually funds.",
    },
  ],
  "existing_relationship::controlled_assertive": [
    {
      rebuttalStyle: "urgency_without_panic",
      coachNoteStyle: "pressure_control",
      followUpStyle: "direct_question",
      primaryMove:
        "If the relationship is real, it can produce a decision, not a story. Ask for a commit date and a concrete term—otherwise it’s a stall.",
      secondaryMove:
        "Ask what exact term they’re waiting for that isn’t available today.",
    },
    {
      rebuttalStyle: "structure_clarity",
      coachNoteStyle: "pressure_control",
      followUpStyle: "diagnostic_question",
      primaryMove:
        "Separate emotional loyalty from business fit: rate, cadence, speed, and control. Make them choose which one the relationship actually improves.",
      secondaryMove:
        "Ask what would make them switch even with the relationship intact.",
    },
    {
      rebuttalStyle: "operational_use_case",
      coachNoteStyle: "closer_guidance",
      followUpStyle: "commitment_question",
      primaryMove:
        "Re-qualify intent: if capital solves a near-term operational outcome, they should take the path that executes, then keep the relationship for the next cycle.",
      secondaryMove:
        "Ask if they’ll take funding now if it fixes the outcome, and revisit the relationship later.",
    },
  ],
  "existing_relationship::assertive_opportunity": [
    {
      rebuttalStyle: "operational_use_case",
      coachNoteStyle: "closer_guidance",
      followUpStyle: "commitment_question",
      primaryMove:
        "Frame it as performance: relationships matter, but outcomes pay payroll. If the relationship can’t fund the move that matters this month, take the structure that does.",
      secondaryMove:
        "Ask what they’re trying to accomplish in the next 30 days that can’t wait on relationship timing.",
    },
    {
      rebuttalStyle: "cost_of_delay_redirect",
      coachNoteStyle: "closer_guidance",
      followUpStyle: "direct_question",
      primaryMove:
        "Put delay on the ledger: if they wait for a relationship favor, what does that cost weekly in revenue, inventory, or missed opportunity?",
      secondaryMove:
        "Ask what they lose if funding lands next month instead of next week.",
    },
  ],
};

/** Phase 4.7 base deal-specialized cores (single slot each before 4.6 merges). */
const DEAL_SPECIALIZED_BASE: Record<string, ObjectionResponsePatternCore> = {
  [buildDealSpecializedKey(
    "price_cost_framing",
    "controlled_assertive",
    "business_line_of_credit"
  )]: {
    rebuttalStyle: "daily_burden_reframe",
    coachNoteStyle: "pressure_control",
    followUpStyle: "direct_question",
    primaryMove:
      "Convert total payback into daily payment and force the decision around whether current cash flow can absorb it while the capital is being used productively.",
    secondaryMove:
      "Clarify the full LOC structure in plain steps: funding amount, total payback, and daily payment, then force the objection into either payment pace or total cost.",
  },
  [buildDealSpecializedKey("price_cost_framing", "controlled_assertive", "mca")]: {
    rebuttalStyle: "daily_burden_reframe",
    coachNoteStyle: "pressure_control",
    followUpStyle: "direct_question",
    primaryMove:
      "Frame the MCA as fast, expensive capital and force the conversation around whether the business has a use case valuable enough to justify the daily drag.",
    secondaryMove:
      "Translate the payment into revenue drag or holdback pressure and make the merchant choose whether the speed solves a problem worth paying for.",
  },
  [buildDealSpecializedKey(
    "price_cost_framing",
    "balanced",
    "merchant_services"
  )]: {
    rebuttalStyle: "structure_clarity",
    coachNoteStyle: "risk_control",
    followUpStyle: "direct_question",
    primaryMove:
      "Translate the offer into processing economics and explain how it changes ongoing margin, fees, or effective cost structure instead of treating it like a loan payment.",
    secondaryMove:
      "Keep the conversation on measurable savings, simplicity, or operational fit rather than generic financing language.",
  },
  [buildDealSpecializedKey("payment_fatigue", "controlled_assertive", "mca")]: {
    rebuttalStyle: "qualification_pressure",
    coachNoteStyle: "pressure_control",
    followUpStyle: "use_of_funds_question",
    primaryMove:
      "Separate productive leverage from dead-weight stacking and force clarity on what this MCA changes immediately in the business.",
    secondaryMove:
      "Challenge whether the merchant is reacting to payment fatigue generally or to a stack that is not producing enough return.",
  },
  [buildDealSpecializedKey(
    "payment_fatigue",
    "balanced",
    "business_line_of_credit"
  )]: {
    rebuttalStyle: "qualification_pressure",
    coachNoteStyle: "qualification_guidance",
    followUpStyle: "diagnostic_question",
    primaryMove:
      "Acknowledge existing payment fatigue, then separate this LOC from a fixed-pressure MCA by focusing on whether the structure gives the business enough operating flexibility.",
    secondaryMove:
      "Use the objection to determine whether the issue is overall cash flow strain or simply resistance to adding any new obligation.",
  },
  [buildDealSpecializedKey(
    "timing_delay",
    "controlled_assertive",
    "business_line_of_credit"
  )]: {
    rebuttalStyle: "urgency_without_panic",
    coachNoteStyle: "closer_guidance",
    followUpStyle: "commitment_question",
    primaryMove:
      "Challenge passive delay by forcing the merchant to compare the cost of waiting against the operational benefit they expect the LOC to create.",
    secondaryMove:
      "Make timing concrete by asking what changes in the business if they wait another week or month.",
  },
  [buildDealSpecializedKey("timing_delay", "controlled_assertive", "mca")]: {
    rebuttalStyle: "urgency_without_panic",
    coachNoteStyle: "closer_guidance",
    followUpStyle: "commitment_question",
    primaryMove:
      "Frame the MCA as speed-priced capital and force the merchant to explain whether the delay costs more than the premium for moving now.",
    secondaryMove:
      "Push the conversation toward what urgent problem exists today that this capital is supposed to solve.",
  },
};

/** Phase 4.6 — Deal-specialized expression slots (slot 0 = legacy DEAL_SPECIALIZED row). */
const DEAL_SPECIALIZED_EXPRESSIONS: Record<string, ObjectionResponsePatternCore[]> =
  (() => {
    const out: Record<string, ObjectionResponsePatternCore[]> = {};
    for (const [k, v] of Object.entries(DEAL_SPECIALIZED_BASE)) {
      out[k] = [v];
    }
    const add = (key: string, cores: ObjectionResponsePatternCore[]) => {
      if (out[key]) out[key]!.push(...cores);
    };
    add(buildDealSpecializedKey("price_cost_framing", "controlled_assertive", "mca"), [
      {
        rebuttalStyle: "qualification_pressure",
        coachNoteStyle: "pressure_control",
        followUpStyle: "diagnostic_question",
        primaryMove:
          "Force daily net after pulls and after operating margin—if the spread can’t survive the MCA pace, diagnose whether the issue is price or broken throughput.",
        secondaryMove:
          "Ask what revenue event must land before the payment feels acceptable; without one, you’re arguing rate instead of fixing cash timing.",
      },
      {
        rebuttalStyle: "structure_clarity",
        coachNoteStyle: "pressure_control",
        followUpStyle: "commitment_question",
        primaryMove:
          "Collapse MCA terms to advance, factor, and daily pull in plain numbers—then ask which lever they actually want to negotiate.",
        secondaryMove:
          "If they reject the structure entirely, pivot to whether any speed-priced option fits—or exit cleanly.",
      },
    ]);
    add(buildDealSpecializedKey("price_cost_framing", "controlled_assertive", "business_line_of_credit"), [
      {
        rebuttalStyle: "cost_of_delay_redirect",
        coachNoteStyle: "pressure_control",
        followUpStyle: "diagnostic_question",
        primaryMove:
          "Compare LOC cost to the carrying cost of the unfunded gap—inventory sitting, payroll strain, or revenue left on the table this quarter.",
        secondaryMove:
          "Ask what internal deadline breaks if funding slips another week; make delay own a consequence.",
      },
    ]);
    add(buildDealSpecializedKey("price_cost_framing", "balanced", "merchant_services"), [
      {
        rebuttalStyle: "operational_use_case",
        coachNoteStyle: "risk_control",
        followUpStyle: "diagnostic_question",
        primaryMove:
          "Pin how the stack changes ticket size, chargeback exposure, or labor hours—make them defend “expensive” against measurable throughput.",
        secondaryMove:
          "Ask what operational headache disappears if processing economics improve—tie savings to a line item, not a vibe.",
      },
    ]);
    add(buildDealSpecializedKey("timing_delay", "controlled_assertive", "mca"), [
      {
        rebuttalStyle: "cost_of_delay_redirect",
        coachNoteStyle: "closer_guidance",
        followUpStyle: "direct_question",
        primaryMove:
          "Put the MCA premium next to the weekly burn from the unfunded problem—let them argue which line item hurts more.",
        secondaryMove:
          "Ask what gets worse if funding lands Monday vs three Mondays from now.",
      },
      {
        rebuttalStyle: "urgency_without_panic",
        coachNoteStyle: "closer_guidance",
        followUpStyle: "diagnostic_question",
        primaryMove:
          "Demand whether delay protects cash flow or avoids a decision—diagnose which one they’re hiding behind.",
        secondaryMove:
          "Ask what proof closes timing risk without adding new capital.",
      },
    ]);
    add(buildDealSpecializedKey("timing_delay", "controlled_assertive", "business_line_of_credit"), [
      {
        rebuttalStyle: "cost_of_delay_redirect",
        coachNoteStyle: "closer_guidance",
        followUpStyle: "direct_question",
        primaryMove:
          "Make waiting carry an interest-style cost: idle inventory, missed payroll cushion, or lost revenue window they already named.",
        secondaryMove:
          "Ask what fixed date they’d draw if approval landed today—then test what’s actually blocking that date.",
      },
      {
        rebuttalStyle: "urgency_without_panic",
        coachNoteStyle: "closer_guidance",
        followUpStyle: "diagnostic_question",
        primaryMove:
          "Separate calendar slip from commitment fear—diagnose which one actually controls the pause.",
        secondaryMove:
          "Ask what single document or number removes the timing excuse on the next call.",
      },
    ]);
    add(buildDealSpecializedKey("payment_fatigue", "controlled_assertive", "mca"), [
      {
        rebuttalStyle: "structure_clarity",
        coachNoteStyle: "pressure_control",
        followUpStyle: "commitment_question",
        primaryMove:
          "Stack pulls against gross margin line-by-line—if fatigue is structural, negotiate cadence or product, not optimism.",
        secondaryMove:
          "Ask what they’d cut first if another pull landed tomorrow; silence means the stack already broke them.",
      },
    ]);
    return out;
  })();

export type {
  ObjectionTagBiasInput,
  ObjectionTagScore,
  PatternStatsProvider,
} from "./patternPreference.js";
export {
  applyObjectionTagBias,
  hasObjectionRankingSignal,
} from "./patternPreference.js";
export { defaultPatternStatsProvider } from "./patternPreference.js";

/**
 * Selection only (debugging / analysis). Same scoring as getObjectionResponsePattern.
 */
export async function selectObjectionResponsePattern(
  input: ObjectionPatternInput,
  options?: {
    statsProvider?: PatternStatsProvider;
    advancedStrategies?: boolean;
    /** Multi-tag bias: scored tags from objection classification (Phase 4.4). */
    objectionTags?: import("./patternPreference.js").ObjectionTagScore[];
    primaryObjectionType?: string | null;
    /** Phase 4.4 — deterministic anti-repeat penalty (patternKey → penalty points). */
    repetitionPenalty?: Record<string, number> | null;
  }
): Promise<
  PatternSelectionResult & { selectedCore: ObjectionResponsePatternCore }
> {
  const entries = getObjectionResponsePatternCandidates(input);
  const keys = [...new Set(entries.map((e) => e.candidate.patternKey))];
  const provider = options?.statsProvider ?? defaultPatternStatsProvider;
  const stats = await provider.getStats(keys);
  const tagBias =
    options?.objectionTags != null || options?.primaryObjectionType != null
      ? {
          objectionTags: options.objectionTags ?? [],
          primaryObjectionType: options.primaryObjectionType ?? null,
        }
      : undefined;
  const selection = selectPatternPreference(
    entries,
    stats,
    tagBias,
    options?.repetitionPenalty ?? null
  ) as PatternSelectionResult & {
    selectedCore: ObjectionResponsePatternCore;
  };
  if (!options?.advancedStrategies) {
    return selection;
  }

  return {
    ...selection,
    selectedCore: applyProStrategyAugmentation(input, selection.selectedCore),
  };
}

export async function resolveObjectionResponsePatternWithSelection(
  input: ObjectionPatternInput,
  options?: {
    statsProvider?: PatternStatsProvider;
    advancedStrategies?: boolean;
    objectionTags?: import("./patternPreference.js").ObjectionTagScore[];
    primaryObjectionType?: string | null;
    repetitionPenalty?: Record<string, number> | null;
  }
): Promise<{
  pattern: ObjectionResponsePattern;
  selection: PatternSelectionResult & {
    selectedCore: ObjectionResponsePatternCore;
  };
}> {
  const selection = await selectObjectionResponsePattern(input, options);
  return {
    pattern: attachConfidence(
      input.posture,
      selection.selectedCore as ObjectionResponsePatternCore
    ),
    selection,
  };
}

export async function getObjectionResponsePattern(
  input: ObjectionPatternInput,
  options?: {
    statsProvider?: PatternStatsProvider;
    advancedStrategies?: boolean;
  }
): Promise<ObjectionResponsePattern> {
  const { pattern } = await resolveObjectionResponsePatternWithSelection(
    input,
    options
  );
  return pattern;
}

export function formatResponsePatternBlock(p: ObjectionResponsePattern): string {
  const lines = [
    "RESPONSE PATTERN:",
    `- Rebuttal style: ${p.rebuttalStyle}`,
    `- Coach note style: ${p.coachNoteStyle}`,
    `- Follow-up style: ${p.followUpStyle}`,
    `- Primary move: ${p.primaryMove}`,
  ];
  if (p.secondaryMove) {
    lines.push(`- Secondary move: ${p.secondaryMove}`);
  }
  if (p.strategyTag) {
    lines.push(`- Strategy tag: ${p.strategyTag}`);
  }
  if (p.strategyHint) {
    lines.push(`- Strategy hint: ${p.strategyHint}`);
  }
  return lines.join("\n");
}

export function formatConfidenceStyleBlock(p: ObjectionResponsePattern): string {
  const suffix = p.confidenceStyle === "high" ? " (no hedging)" : "";
  return [`CONFIDENCE STYLE:`, `- ${p.confidenceStyle}${suffix}`].join("\n");
}

export function confidenceAlignmentInstructions(c: ConfidenceStyle): string {
  switch (c) {
    case "high":
      return [
        "Avoid hedging language entirely (rebuttal, coach note, and follow-up).",
        'Do not use "maybe", "might", or "possibly".',
        "Do not mix strong statements with soft follow-ups.",
        "Ensure the follow-up question maintains the same authority as the rebuttal.",
      ].join("\n");
    case "moderate":
      return [
        "Allow balanced phrasing but stay decisive; do not waffle.",
        "Maintain balanced tone across rebuttal, coach note, and follow-up.",
      ].join("\n");
    case "conditional":
      return [
        "Allow uncertainty and discovery-driven language where it serves qualification.",
        "Allow an exploratory tone across rebuttal, coach note, and follow-up.",
      ].join("\n");
    default: {
      const _x: never = c;
      return _x;
    }
  }
}

function hintRebuttalStyle(s: RebuttalStyle): string {
  switch (s) {
    case "daily_burden_reframe":
      return "convert total cost into digestible payment pace and operational framing";
    case "qualification_pressure":
      return "do not over-rebut; use the objection to force clarity";
    case "structure_clarity":
      return "reduce confusion and simplify the offer structure";
    case "urgency_without_panic":
      return "challenge delay without sounding frantic";
    case "operational_use_case":
      return "tie the capital directly to what it changes in the business";
    case "cost_of_delay_redirect":
      return "shift attention to the cost of waiting versus acting";
    case "risk_reduction":
      return "address perceived risk with concrete, simple assurances";
    default: {
      const _x: never = s;
      return _x;
    }
  }
}

function hintCoachNoteStyle(s: CoachNoteStyle): string {
  switch (s) {
    case "closer_guidance":
      return "direct the broker on the next assertive verbal move";
    case "qualification_guidance":
      return "prioritize discovery and qualification for the broker";
    case "pressure_control":
      return "keep pressure operational and controlled, not soft";
    case "risk_control":
      return "neutralize doubt without sounding defensive";
    default: {
      const _x: never = s;
      return _x;
    }
  }
}

function hintFollowUpStyle(s: FollowUpStyle): string {
  switch (s) {
    case "direct_question":
      return "one sharp, answerable question that advances the sale";
    case "diagnostic_question":
      return "a question that surfaces numbers or facts";
    case "commitment_question":
      return "a question that tests willingness to move forward";
    case "use_of_funds_question":
      return "a question that pins down what the money will do in the business";
    default: {
      const _x: never = s;
      return _x;
    }
  }
}

/** Tight alignment instructions for the model (Phase 4.6). */
export function responsePatternAlignmentInstructions(
  pattern: ObjectionResponsePattern
): string {
  const lines = [
    `Align rebuttal wording with rebuttal style "${pattern.rebuttalStyle}": ${hintRebuttalStyle(pattern.rebuttalStyle)}.`,
    `Align the coach note with coach note style "${pattern.coachNoteStyle}": ${hintCoachNoteStyle(pattern.coachNoteStyle)}.`,
    `Close with a follow-up matching "${pattern.followUpStyle}": ${hintFollowUpStyle(pattern.followUpStyle)}.`,
  ];
  if (pattern.strategyHint) {
    lines.push(`Apply Pro strategy hint "${pattern.strategyTag}": ${pattern.strategyHint}`);
  }
  return lines.join("\n");
}
