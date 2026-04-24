/**
 * OBJECTION TYPE ASSERTION ENGINE V1
 *
 * Maps normalized objection category (+ optional primary tag + user text) to
 * assertion families with mode-specific prompt blocks. Does not replace the classifier.
 */

import { normalizeObjectionCategory } from "./objectionResponsePattern.js";

export type ObjectionAssertionFamily =
  | "price_cost_framing"
  | "payment_affordability"
  | "margin_profitability"
  | "trust_risk"
  | "timing_delay"
  | "competing_offers"
  | "cashflow_instability"
  | "leverage_net_figures"
  | "fallback";

export type ObjectionAssertionProfile = {
  family: ObjectionAssertionFamily;
  assertionAnchor: string;
  pressureVerbBank: string[];
  decisionForkBank: string[];
  allowedLine2Framing: string[];
  bannedPhrasing: string[];
  preferredBusinessNouns: string[];
  mathPostureRules: string;
  liveBehavior: string;
  precallBehavior: string;
};

const PROFILES: Record<ObjectionAssertionFamily, ObjectionAssertionProfile> = {
  price_cost_framing: {
    family: "price_cost_framing",
    assertionAnchor:
      "Sticker shock — money is expensive only if the underlying business pain stays unfixed.",
    pressureVerbBank: [
      "keeps eating",
      "keeps hitting",
      "keeps costing",
      "keeps stacking",
    ],
    decisionForkBank: [
      "fix the squeeze or keep feeding it",
      "solve the leak or keep paying it in cash",
      "lock the number or keep bleeding on the old path",
    ],
    allowedLine2Framing: [
      "Compare the payment to what they lose weekly if nothing changes.",
      "Tie the dollar to unresolved pain, not to ‘rate’ in the abstract.",
    ],
    bannedPhrasing: [
      "here’s how to think about it",
      "the key idea is",
      "this helps",
      "purely a rate question",
    ],
    preferredBusinessNouns: [
      "sticker",
      "squeeze",
      "leak",
      "weekly hit",
      "pain",
    ],
    mathPostureRules:
      "Use deal numbers only when present; frame as cost of unfixed pain vs cost of structured relief — never generic rate talk alone.",
    liveBehavior:
      "Line 1: acknowledge + name sticker/heavy number. Line 2: cost vs unfixed pain. Line 3: binary fork (fix vs keep feeding). No diagnostic questions.",
    precallBehavior:
      "Spell out how price objection is usually mislabeled pain; give 2–3 blunt ways to tie sticker to unresolved operations. No coach worksheet labels.",
  },
  payment_affordability: {
    family: "payment_affordability",
    assertionAnchor:
      "Burden — payment either gets controlled or it keeps controlling operations and cash timing.",
    pressureVerbBank: [
      "keeps landing",
      "keeps chewing",
      "keeps pulling",
      "keeps tightening",
    ],
    decisionForkBank: [
      "control it or keep wearing it",
      "get a plan around it or keep absorbing it",
      "fix cash timing or keep chasing the week",
    ],
    allowedLine2Framing: [
      "Ongoing squeeze, not abstract ‘affordability’.",
      "Weekly rhythm: same hit unless structure changes.",
    ],
    bannedPhrasing: [
      "can you afford",
      "budget-friendly",
      "comfortable payment",
    ],
    preferredBusinessNouns: [
      "daily pull",
      "weekly hit",
      "cash timing",
      "room",
      "float",
    ],
    mathPostureRules:
      "Anchor to daily/weekly if deal context has it; otherwise say numbers are missing — don’t invent.",
    liveBehavior:
      "Line 1: payment hitting cash flow. Line 2: ongoing chew if no plan. Line 3: control vs absorb fork.",
    precallBehavior:
      "Explain affordability as operational control, not a comfort label; pressure path for recurring pull.",
  },
  margin_profitability: {
    family: "margin_profitability",
    assertionAnchor:
      "Margin — payment chews what’s left; inaction still takes profit.",
    pressureVerbBank: [
      "keeps eating margin",
      "keeps bleeding",
      "keeps stripping",
    ],
    decisionForkBank: [
      "plug the leak or keep donating margin",
      "fix the take or keep losing it on the same line",
    ],
    allowedLine2Framing: [
      "Compare structured payment to current margin leak.",
      "If margin is already thin, delay keeps the same takeout.",
    ],
    bannedPhrasing: [
      "margin is important",
      "profitability is key",
    ],
    preferredBusinessNouns: [
      "margin",
      "take",
      "line items",
      "fuel",
      "maintenance",
    ],
    mathPostureRules:
      "Tie payment to margin line items when merchant names them (fuel, insurance, etc.).",
    liveBehavior:
      "Line 1: margin tight / payment lands in margin. Line 2: keeps eating if unfixed. Line 3: plug vs donate fork.",
    precallBehavior:
      "Map how this objection type hides margin math; give blunt margin-vs-payment comparisons.",
  },
  trust_risk: {
    family: "trust_risk",
    assertionAnchor:
      "Risk — waiting doesn’t remove exposure; unstructured drift keeps it alive.",
    pressureVerbBank: [
      "keeps exposed",
      "keeps open",
      "keeps hanging",
    ],
    decisionForkBank: [
      "controlled move vs unstructured exposure",
      "lock terms or keep flying loose",
      "put guardrails on it or keep carrying the risk raw",
    ],
    allowedLine2Framing: [
      "Name what they’re afraid of, then frame controlled structure vs open-ended exposure.",
    ],
    bannedPhrasing: [
      "trust the process",
      "we’re fully transparent",
    ],
    preferredBusinessNouns: [
      "exposure",
      "terms",
      "guardrails",
      "clarity",
    ],
    mathPostureRules:
      "Use numbers to reduce ambiguity when available; no hype — plain structure.",
    liveBehavior:
      "Line 1: validate fear without therapy. Line 2: exposure stays without a move. Line 3: controlled vs loose fork.",
    precallBehavior:
      "Prep how to reduce fear with structure and clarity — not slogans.",
  },
  timing_delay: {
    family: "timing_delay",
    assertionAnchor:
      "Delay — not neutral; same pain stays in place while they wait.",
    pressureVerbBank: [
      "keeps costing",
      "keeps stacking",
      "keeps landing",
    ],
    decisionForkBank: [
      "move now or keep wearing the same hit",
      "fix the window or keep drifting",
      "decide today or keep carrying it",
    ],
    allowedLine2Framing: [
      "Cost of waiting vs cost of structure — make stall expensive.",
    ],
    bannedPhrasing: [
      "take your time",
      "whenever you’re ready",
    ],
    preferredBusinessNouns: [
      "window",
      "stall",
      "drift",
      "same squeeze",
    ],
    mathPostureRules:
      "If relevant, quantify delay cost from deal context only.",
    liveBehavior:
      "Line 1: not now / unsure. Line 2: delay keeps pain. Line 3: move vs drift fork — no ‘what’s holding you back’ filler.",
    precallBehavior:
      "Prep move-vs-drift language for stalls and ‘I need time’ patterns.",
  },
  competing_offers: {
    family: "competing_offers",
    assertionAnchor:
      "Shopping — cheaper is noise if the business pressure stays unsolved.",
    pressureVerbBank: [
      "keeps landing",
      "keeps open",
      "keeps dragging",
    ],
    decisionForkBank: [
      "solve the hole or keep shopping noise",
      "fix the squeeze or chase a lower sticker",
      "pick structure or keep comparing",
    ],
    allowedLine2Framing: [
      "Contrast lower rate vs same operational hole.",
    ],
    bannedPhrasing: [
      "we’re the best",
      "our rate is competitive",
    ],
    preferredBusinessNouns: [
      "hole",
      "squeeze",
      "structure",
      "apples-to-apples",
    ],
    mathPostureRules:
      "Compare on what clears the operational gap, not headline rate alone.",
    liveBehavior:
      "Line 1: comparing / cheaper elsewhere. Line 2: cheaper doesn’t fix open hole. Line 3: solve vs shop fork.",
    precallBehavior:
      "Prep how to dismantle ‘cheaper’ without sounding defensive — tie to solved vs unsolved pressure.",
  },
  cashflow_instability: {
    family: "cashflow_instability",
    assertionAnchor:
      "Volatility — inconsistent weeks already exist; question is control vs absorbing turbulence.",
    pressureVerbBank: [
      "keeps swinging",
      "keeps catching",
      "keeps thinning",
    ],
    decisionForkBank: [
      "build a floor or keep riding the swings",
      "stabilize draws or keep eating variance",
    ],
    allowedLine2Framing: [
      "Seasonality / slow weeks: no plan keeps costing when revenue thins.",
    ],
    bannedPhrasing: [
      "markets are unpredictable",
      "it is what it is",
    ],
    preferredBusinessNouns: [
      "variance",
      "slow weeks",
      "seasonality",
      "floor",
    ],
    mathPostureRules:
      "Reference volatility in merchant’s terms (restaurants, weather, etc.) without lecturing.",
    liveBehavior:
      "Line 1: unpredictable / swings. Line 2: turbulence already there — absorb or control. Line 3: floor vs ride fork.",
    precallBehavior:
      "Prep turbulence framing: control vs passive absorption.",
  },
  leverage_net_figures: {
    family: "leverage_net_figures",
    assertionAnchor:
      "Net reality — gross is the wrong fight if take-home gap stays open.",
    pressureVerbBank: [
      "keeps hitting net",
      "keeps after expenses",
    ],
    decisionForkBank: [
      "close the net gap or keep arguing gross",
      "fix what you keep vs what you quote",
    ],
    allowedLine2Framing: [
      "Acknowledge net, then tie offer to closing the gap they actually feel.",
    ],
    bannedPhrasing: [
      "gross is strong",
      "top-line looks good",
    ],
    preferredBusinessNouns: [
      "net",
      "take-home",
      "after expenses",
      "real margin",
    ],
    mathPostureRules:
      "Never argue gross vs merchant net — align to net and post-expense reality.",
    liveBehavior:
      "Line 1: net vs gross callout. Line 2: deal tied to net gap. Line 3: fix gap vs stay stuck on headline fork.",
    precallBehavior:
      "Prep net-vs-gross handling without generic revenue talk.",
  },
  fallback: {
    family: "fallback",
    assertionAnchor:
      "Pressure-first: name the real constraint, then consequence, then fork.",
    pressureVerbBank: ["keeps hitting", "keeps costing", "keeps dragging"],
    decisionForkBank: [
      "fix it or keep wearing it",
      "move on it or keep carrying it",
    ],
    allowedLine2Framing: ["Consequence before polish."],
    bannedPhrasing: [
      "here’s how to think about it",
      "the key idea is",
    ],
    preferredBusinessNouns: ["squeeze", "cash", "timing", "terms"],
    mathPostureRules: "Use saved deal numbers only.",
    liveBehavior:
      "Three-line live script: acknowledge + assert, pressure, fork — no generic diagnostics.",
    precallBehavior:
      "Broker prep: pressure logic plainspoken; no training-meta.",
  },
};

function inferFamilyFromMessageText(userMessage: string): ObjectionAssertionFamily | null {
  const t = userMessage.toLowerCase();

  if (
    /\b(cheaper|somewhere else|another (lender|company|offer)|shop around|shopping|beat (your|this)|compare|compet)\b/i.test(
      t
    )
  ) {
    return "competing_offers";
  }
  if (
    /\b(gross|net\b|actually net|what i net|bottom line|after expenses|real margin)\b/i.test(
      t
    )
  ) {
    return "leverage_net_figures";
  }
  if (
    /\b(unpredictable|seasonality|slow(s)? down|volatile|restaurant|weather|inconsistent|ups and downs)\b/i.test(
      t
    )
  ) {
    return "cashflow_instability";
  }
  if (
    /\b(margin|fuel|maintenance|insurance|comes? out of margin|weekly payment.*margin)\b/i.test(
      t
    )
  ) {
    return "margin_profitability";
  }
  if (
    /\b(can'?t handle|afford|cash flow|daily payment|pull|ach|every week)\b/i.test(t) &&
    !/\bcheaper\b/i.test(t)
  ) {
    return "payment_affordability";
  }
  return null;
}

function mapCanonicalToFamily(
  normalized: string,
  primaryTag: string | null | undefined
): ObjectionAssertionFamily {
  const p = primaryTag?.trim().toLowerCase().replace(/\s+/g, "_");
  if (p === "trust_risk" || p === "confusion_clarity") return "trust_risk";
  if (p === "price_cost") return "price_cost_framing";

  switch (normalized) {
    case "price_cost_framing":
      return "price_cost_framing";
    case "payment_fatigue":
      return "payment_affordability";
    case "trust_skepticism":
      return "trust_risk";
    case "timing_delay":
      return "timing_delay";
    case "need_indifference":
      return "timing_delay";
    default:
      return "fallback";
  }
}

export type ResolveAssertionInput = {
  normalizedObjectionType: string;
  userMessage: string;
  /** Optional: from `resolvePrimaryAndSecondaryObjections` when available. */
  primaryObjectionTag?: string | null;
};

/**
 * Resolve the assertion profile for this turn. Uses message-keyword refinement first,
 * then normalized category + optional primary tag.
 */
export function resolveObjectionTypeAssertionProfile(
  input: ResolveAssertionInput
): ObjectionAssertionProfile {
  const normalized = normalizeObjectionCategory(input.normalizedObjectionType);
  const fromText = inferFamilyFromMessageText(input.userMessage);
  if (fromText != null) {
    return PROFILES[fromText];
  }
  const family = mapCanonicalToFamily(normalized, input.primaryObjectionTag);
  return PROFILES[family];
}

export function getAssertionConstraintsForType(
  family: ObjectionAssertionFamily
): ObjectionAssertionProfile {
  return PROFILES[family];
}

function formatBank(label: string, items: string[]): string {
  return `${label}:\n${items.map((x) => `- ${x}`).join("\n")}`;
}

/**
 * Prompt block for LIVE mode — short, sayable, no coach layer; complements existing live rules.
 */
export function buildLiveAssertionOpening(profile: ObjectionAssertionProfile): string {
  return `OBJECTION TYPE ASSERTION ENGINE V1 (LIVE — follow this pressure pattern for THIS objection family: ${profile.family}):

PRIORITY: If any shorter example block elsewhere in the system prompt conflicts with this engine, follow THIS block (pressure-first, no generic diagnostic questions).

ASSERTION ANCHOR: ${profile.assertionAnchor}

LINE SHAPE (after [OPENING], 2–3 short lines total, spoken):
- Line 1: brief acknowledge + assert the real problem (no diagnostic questions, no "is it X or Y?", no "what’s holding you back?").
- Line 2: ${profile.allowedLine2Framing[0] ?? "Consequence / pressure in this family’s terms."}
- Line 3: force a binary fork — use this family’s decision style (declarative, not soft check-ins).

${formatBank("Pressure verbs (rotate; do not repeat the same stem twice)", profile.pressureVerbBank)}
${formatBank("Decision fork style (pick one flavor; vary wording)", profile.decisionForkBank)}

BANNED in live script: ${profile.bannedPhrasing.join("; ")}

MATH: ${profile.mathPostureRules}

FAMILY-SPECIFIC LIVE RULE: ${profile.liveBehavior}

MANDATORY — BROKER_V96_FORCE_DECISION_PATTERN (entire [OPENING] block): include at least one of CONTRAST (doesn't fix / same squeeze / isn't the problem), TRADEOFF (if you wait / cost of waiting / what happens if you don't), CONDITIONAL (if nothing changes / if this doesn't), DECISION FRAME (either / or it doesn't / there's no / comes down to / the question is whether). No descriptive-only lines — rebuttal must steer the conversation.`;
}

/**
 * Prompt block for PRECALL mode — richer broker prep; applies to Lane 1 / Lane 2 and Coach Note under V10.2 (not LIVE [OPENING]).
 */
export function buildPrecallAssertionGuidance(profile: ObjectionAssertionProfile): string {
  return `OBJECTION TYPE ASSERTION ENGINE V1 (PRECALL — family: ${profile.family}):

ASSERTION ANCHOR: ${profile.assertionAnchor}

${formatBank("Pressure verb bank (vary across lines)", profile.pressureVerbBank)}
${formatBank("Decision fork bank (consequence-driven; rotate)", profile.decisionForkBank)}
${formatBank("Preferred business nouns", profile.preferredBusinessNouns)}

LINE-2 FRAMING OPTIONS:
${profile.allowedLine2Framing.map((x) => `- ${x}`).join("\n")}

BANNED phrasing: ${profile.bannedPhrasing.join("; ")}

MATH POSTURE: ${profile.mathPostureRules}

PRECALL BEHAVIOR: ${profile.precallBehavior}

[LANE_1] and [LANE_2] are merchant-facing script (two different angles). Each line MUST satisfy BROKER_V96_FORCE_DECISION_PATTERN: at least one of CONTRAST, TRADEOFF, CONDITIONAL PRESSURE, or DECISION FRAME (e.g. doesn't fix, if you wait, cost of waiting, either, comes down to, the question is whether). No neutral observation-only lanes. No soft empathy openers (“I understand”, “I hear you”), no partner/testimonial pitch, no “focus on / explain / frame” coaching.

[WHAT_THEY_REALLY_MEAN] stays diagnostic only. Put leverage, risk, and what to avoid in [PRECALL_COACH_NOTE] only.

Do not add meta training labels ("why this response", "how it fits", "coach insight") or duplicate follow-up questions outside [PRECALL_FOLLOW_UP].`;
}
