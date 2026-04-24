import type { AssistantStructuredReply } from "../types/assistantStructuredReply.js";
import {
  choosePatternedVariant,
  type PatternContext,
  type PatternedVariant,
  type PersuasionPattern,
  pv,
} from "./patternIntelligence.js";

function purgeGenericDefaults(text: string): string {
  return text
    .replace(/that payment keeps dragging.*\./gi, "")
    .replace(/keeps hitting your cash flow.*\./gi, "")
    .replace(/keeps costing you.*\./gi, "")
    .replace(/keeps chewing through.*\./gi, "");
}

function compressResponse(text: string): string {
  const sentences = text
    .split(/[.?!]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const kept = sentences.slice(0, 3).join(". ").trim();
  return kept ? `${kept}.` : "";
}

function normalizeSentenceBoundaries(text: string): string {
  let t = text;

  // collapse CRLF/newlines into single spaces
  t = t.replace(/[\r\n]+/g, " ");

  // fix broken cadence specifically
  t = t.replace(
    /But that's not the real decision\s+what matters is/gi,
    "But that's not the real decision — what matters is"
  );

  // Merge only when the prior sentence ends with "decision" and the next starts with "what matters is".
  // Prevents accidental merging of clean 3-sentence scripts (GENERAL / ADVISORY).
  t = t.replace(/\bdecision\.\s+(what matters is)\b/gi, "decision — $1");

  // collapse repeated spaces
  t = t.replace(/\s{2,}/g, " ").trim();

  // defensive rule: if both phrases exist but dash-link is missing, force it
  if (
    /But that's not the real decision/i.test(t) &&
    /\bwhat matters is\b/i.test(t) &&
    !/decision\s*—\s*what matters is/i.test(t)
  ) {
    t = t.replace(
      /But that's not the real decision(?:\s*[\.\n\r]+\s*|\s+)what matters is/gi,
      "But that's not the real decision — what matters is"
    );
  }

  return t;
}

type LiveGeneralSubtype =
  | "THINK_ABOUT_IT"
  | "SEND_ME_SOMETHING"
  | "NO_BRUSH"
  | "TALK_TO_PARTNER"
  | "TIME_DELAY"
  | "RISK_TRUST"
  | "STRUCTURE_STRATEGY"
  | "STATUS_QUO"
  | "PAYMENT_CADENCE"
  | "CONTROL_ACCESS"
  | "COMMITMENT_LOCKIN"
  | "FUTURE_EXPANSION"
  | "TERMS_EXIT"
  | "PRESSURE_BURDEN"
  | "BROKER_TRUST_INTENT"
  | null;

function generalSubtypeOpener(sub: Exclude<LiveGeneralSubtype, null>): string {
  switch (sub) {
    case "CONTROL_ACCESS":
      return "Reframe it this way: access isn't the issue — control is.";
    case "COMMITMENT_LOCKIN":
      return "Different lens: commitment only matters if it strengthens your position and still leaves you room to move.";
    case "TERMS_EXIT":
      return "The real issue isn't fine print — it's whether you have a clean path out when conditions change.";
    case "FUTURE_EXPANSION":
      return "Zoom out: the question is whether this supports the next move or blocks it.";
    case "PRESSURE_BURDEN":
      return "This isn't a willpower test — it's a structure test: does it relieve pressure or add to it.";
    case "BROKER_TRUST_INTENT":
      return "Ignore the pitch and judge the structure cold — that's where trust is earned.";
    case "TIME_DELAY":
      return "Waiting isn't the point — the question is whether delay changes the structure or just delays the decision.";
    case "RISK_TRUST":
      return "You don't need blind trust — you need the mechanics proven under real numbers.";
    case "STRUCTURE_STRATEGY":
      return "Activity isn't the goal — outcome is. Does this change the result or just reshuffle the problem?";
    case "STATUS_QUO":
      return "Being fine isn't the decision test — the test is whether added complexity makes you measurably stronger.";
    case "PAYMENT_CADENCE":
      return "Forget the headline rate for a second — cadence has to match how cash actually moves.";
    case "THINK_ABOUT_IT":
      return "Thinking is fine if it has a decision test; thinking without one turns into drift.";
    case "SEND_ME_SOMETHING":
      return "Paperwork helps only if it answers one missing clarity in plain terms.";
    case "TALK_TO_PARTNER":
      return "Talking to your partner is smart — make it about the decision standard, not feelings.";
    case "NO_BRUSH":
      return "I'm not here to convince you — I just want to know if it's a mismatch or one named blocker.";
    default: {
      const _exhaustive: never = sub;
      return _exhaustive;
    }
  }
}

function detectGeneralSubtype(message: string): LiveGeneralSubtype {
  const t = message.trim().toLowerCase();
  if (!t) return null;

  // Specific > generic: broker / salesmanship challenge before broad "trust" / lender risk.
  if (
    /\banother broker\b/.test(t) ||
    /\bdifferent broker\b/.test(t) ||
    /\bpushing a deal\b/.test(t) ||
    /\bjust push(ing)?\b/.test(t) ||
    /\b(just )?trying to sell\b/.test(t) ||
    /\btrying to sell me\b/.test(t) ||
    /\bsell me (this|on|something)\b/.test(t) ||
    (/you'?re (just )?/i.test(t) &&
      /\b(trying to sell|after (the )?commission|sales pitch)\b/.test(t)) ||
    /\bonly (here )?for the (deal|commission)\b/.test(t) ||
    /\bchasing (a )?commission\b/.test(t)
  ) {
    return "BROKER_TRUST_INTENT";
  }

  // Bank / platform access (before broad RISK_TRUST on "don't trust")
  if (
    /\baccess to (my )?(bank|account|accounts)\b/.test(t) ||
    /\b(bank|checking) account\b/.test(t) ||
    /\bin(to)? my (bank )?account\b/.test(t) ||
    /\b(them|they|you) in my (bank )?account\b/.test(t) ||
    /\bgiving (you |them )?access\b/.test(t) ||
    /\bgive (you |them )?access\b/.test(t) ||
    /\bdon'?t like giving\b/.test(t) ||
    /\bgiving .{0,24}access\b/.test(t) ||
    /\bread[- ]?only\b/.test(t) ||
    /\bplaid\b/.test(t) ||
    /\blink (my )?(bank|account)\b/.test(t) ||
    /\b(log|sign) in to (my )?(bank|account)\b/.test(t)
  ) {
    return "CONTROL_ACCESS";
  }

  // Payoff / exit mechanics (before COMMITMENT lock-in wording overlaps)
  if (
    /\bprepay(ment)?\b/.test(t) ||
    /\bpay\s*off\s+early\b/.test(t) ||
    /\bearly\s+pay\s*off\b/.test(t) ||
    /\bearly\s+payoff\b/.test(t) ||
    /\bpay\s+it\s+off\b/.test(t) ||
    /\bwhat happens if i pay\b/.test(t) ||
    /\bif i pay (it )?off\b/.test(t) ||
    /\bexit (fee|option|clause)?\b/.test(t) ||
    /\btermination\b/.test(t) && /\b(contract|deal|agreement)\b/.test(t)
  ) {
    return "TERMS_EXIT";
  }

  if (
    /\blocked\b/.test(t) ||
    /\block[- ]?in\b/.test(t) ||
    /\bstuck\b/.test(t) ||
    /\bcan'?t get out\b/.test(t) ||
    /\bcannot get out\b/.test(t) ||
    /\b(get|getting) out of\b/.test(t) ||
    /\bno way out\b/.test(t) ||
    /\bwhat if i want to stop\b/.test(t) ||
    /\bwant to stop\b/.test(t) ||
    /\btrapped\b/.test(t)
  ) {
    return "COMMITMENT_LOCKIN";
  }

  if (
    /\bmight expand\b/.test(t) ||
    /\bplanning to grow\b/.test(t) ||
    /\bplan to grow\b/.test(t) ||
    /\bgoing to grow\b/.test(t) ||
    /\bwe'?re growing\b/.test(t) ||
    /\bexpan(d|sion|ding)\b/.test(t) ||
    /\bscaling\b/.test(t) ||
    /\bdon'?t want .{0,40}\binterfere\b/.test(t) ||
    /\binterfere with\b/.test(t) ||
    /\bget in the way\b/.test(t)
  ) {
    return "FUTURE_EXPANSION";
  }

  if (
    /\badd(s|ing)? pressure\b/.test(t) ||
    /\btoo much (going on|on my plate)\b/.test(t) ||
    /\bpayroll\b/.test(t) ||
    /\brent\b/.test(t) && /\b(already|got|have|paying)\b/.test(t) ||
    /\balready have\b/.test(t) && /\b(payroll|rent|bills|overhead)\b/.test(t) ||
    /\bspread too thin\b/.test(t) ||
    /\bstretched thin\b/.test(t) ||
    /\bburden\b/.test(t) ||
    /\boverwhelming\b/.test(t)
  ) {
    return "PRESSURE_BURDEN";
  }

  // TIME / DELAY
  if (
    /\bnot right now\b/.test(t) ||
    /\bnot now\b/.test(t) ||
    /\bwant to wait\b/.test(t) ||
    /\bi(?:'|’)ll build cash\b/.test(t) ||
    /\bbuild cash\b/.test(t) ||
    /\bwait\b/.test(t)
  ) {
    return "TIME_DELAY";
  }

  // RISK / TRUST
  if (
    /\bburned\b/.test(t) ||
    /\bdon'?t trust\b/.test(t) ||
    /\btrust\b/.test(t) ||
    /\bhesitat/.test(t) ||
    /\bscam\b/.test(t) ||
    /\blenders?\b/.test(t)
  ) {
    return "RISK_TRUST";
  }

  // STRUCTURE / STRATEGY
  if (
    /\bshort\s*term\b/.test(t) ||
    /\bshort[-\s]?term\s+fix\b/.test(t) ||
    /\bkicks?\s+the\s+can\b/.test(t) ||
    /\bpatch\b/.test(t) ||
    /\bdoesn'?t solve\b/.test(t) ||
    /\bjust\b.*\bkicks?\b/.test(t)
  ) {
    return "STRUCTURE_STRATEGY";
  }

  // PERFORMANCE / STATUS QUO
  if (
    /\bdoing fine\b/.test(t) ||
    /\bwe'?re fine\b/.test(t) ||
    /\bstable\b/.test(t) ||
    /\bdon'?t need it\b/.test(t) ||
    /\bdo not need it\b/.test(t) ||
    /\bdon'?t need\b/.test(t)
  ) {
    return "STATUS_QUO";
  }

  // PAYMENT / CADENCE
  if (
    /\bdaily\b/.test(t) ||
    /\bweekly\b/.test(t) ||
    /\bwithdraw(als?)\b/.test(t) ||
    /\btoo frequent\b/.test(t) ||
    /\bhits?\s+my\s+account\b/.test(t) ||
    /\bcadence\b/.test(t)
  ) {
    return "PAYMENT_CADENCE";
  }

  if (
    /\bthink\b/.test(t) ||
    /\bneed to think\b/.test(t) ||
    /\bnot ready\b/.test(t) ||
    /\bsleep on it\b/.test(t)
  ) {
    return "THINK_ABOUT_IT";
  }
  if (
    /\bsend me\b/.test(t) ||
    /\bsomething in writing\b/.test(t) ||
    /\bemail\b/.test(t) ||
    /\bpaperwork\b/.test(t)
  ) {
    return "SEND_ME_SOMETHING";
  }
  if (/\bpartner\b/.test(t) || /\bspouse\b/.test(t) || /\btalk to\b/.test(t)) {
    return "TALK_TO_PARTNER";
  }
  if (t === "no" || /\bnot interested\b/.test(t) || /\bpass\b/.test(t)) {
    return "NO_BRUSH";
  }
  return null;
}

/** When GENERAL has no subtype match: single CONTROL-patterned pool (variant count unchanged). */
function generalUnmatchedVariants(): PatternedVariant[] {
  return [
    pv(
      [
        "Here's what we do next: tell me what part feels off so we're not talking past each other.",
        "What matters is whether the structure fits how you operate — not whether we force a yes today.",
        "The decision is whether there's a version that improves your position — if not, we stop here.",
      ],
      "CONTROL"
    ),
  ];
}

/** Per family: index 0–3 = REFRAME, CONDITION, CONSEQUENCE, CONTROL (distinct move types, not rephrases). */
const CONTROL_ACCESS_VARIANTS: PatternedVariant[] = [
  pv(
    [
      "It's not whether you'll share data — it's whether you still run your operation the way you need to.",
      "The real question is control of timing and mechanics, not gatekeeping for its own sake.",
    ],
    "REFRAME"
  ),
  pv(
    [
      "Before we wire access, we need the rails to match how you manage accounts and when cash actually moves.",
      "Unless that fit is real, we reshape first — we don't muscle through a mismatch.",
    ],
    "CONDITION"
  ),
  pv(
    [
      "Otherwise you fight the tool every week — friction becomes the hidden cost that eats the structure.",
      "If not, there's no version here worth signing.",
    ],
    "CONSEQUENCE"
  ),
  pv(
    [
      "Here's what we do next: you draw the borders on visibility and timing — anything past that gets redesigned, not debated to death.",
      "The structure has to live inside your rules, not the other way around.",
    ],
    "CONTROL"
  ),
];

const COMMITMENT_LOCKIN_VARIANTS: PatternedVariant[] = [
  pv(
    [
      "It's not about being 'in' — it's whether the position strengthens or you just traded air for a longer chain.",
      "Lock-in without upside isn't a strategy; it's a bet you can't adjust when reality shifts.",
    ],
    "REFRAME"
  ),
  pv(
    [
      "Before you commit, we need real room to exit, pause, or adapt when revenue moves — not someday, in writing.",
      "This only moves if the shape still leaves you maneuver room you can actually use.",
    ],
    "CONDITION"
  ),
  pv(
    [
      "Otherwise you sign a box you can't step out of — the problem gets heavier every quarter you can't pivot.",
      "If not, we're not proceeding; I'd rather lose the deal than trap you.",
    ],
    "CONSEQUENCE"
  ),
  pv(
    [
      "Here's what we do next: put prepay, pause, and pivot paths in plain terms — how you kill, lighten, or shift.",
      "No handshake until those levers are explicit — that's baseline, not a favor.",
    ],
    "CONTROL"
  ),
];

const TERMS_EXIT_VARIANTS: PatternedVariant[] = [
  pv(
    [
      "It's not boilerplate — it's whether you keep an honest path out once you're funded.",
      "A deal without a clear payoff story is paperwork without protection when conditions change.",
    ],
    "REFRAME"
  ),
  pv(
    [
      "Before capital moves, we need early payoff, buyout, and restructure language in plain English — not implied.",
      "Unless you know the moves if revenue dips or you want out, we stop and rewrite until you do.",
    ],
    "CONDITION"
  ),
  pv(
    [
      "Otherwise guessing your exit burns time and margin — that's a hidden tax on every month you operate.",
      "If not, we don't mobilize capital; we fix the mechanics first.",
    ],
    "CONSEQUENCE"
  ),
  pv(
    [
      "Here's what we do next: list the levers you'll pull before ink — prepay band, refi-out, term shift.",
      "You should know exactly which door opens when — that's baseline, not a favor.",
    ],
    "CONTROL"
  ),
];

const FUTURE_EXPANSION_VARIANTS: PatternedVariant[] = [
  pv(
    [
      "It's not today's payment — it's whether capital clears the next hiring push, inventory swing, or revenue step.",
      "If the instrument fights where you're going, the headline number is the wrong conversation.",
    ],
    "REFRAME"
  ),
  pv(
    [
      "Before we size this, we need headroom that matches your roadmap — not a cap that chokes the next move.",
      "Unless it rides with where you're headed in the next twelve months, we reshape until it does.",
    ],
    "CONDITION"
  ),
  pv(
    [
      "Otherwise you fund today and choke tomorrow — you unwind the same knot twice on your own dime.",
      "If not, we adjust the structure now; postponing the bill isn't the same as fixing it.",
    ],
    "CONSEQUENCE"
  ),
  pv(
    [
      "Here's what we do next: you define growth and payback pace — we bake that into the instrument up front.",
      "Nothing in the terms should handcuff how you operate next year; if it does, we rewrite.",
    ],
    "CONTROL"
  ),
];

const PRESSURE_BURDEN_VARIANTS: PatternedVariant[] = [
  pv(
    [
      "It's not about liking the idea — it's whether the payment shape actually relieves what you're already carrying.",
      "Pressure from a bad fit isn't discipline; it's structural wrongness wearing a polite label.",
    ],
    "REFRAME"
  ),
  pv(
    [
      "Before you say yes, we need the cadence and terms to ease your current load — not stack on top of it.",
      "If this makes your week tighter, we adjust the structure first; no proceed until it breathes.",
    ],
    "CONDITION"
  ),
  pv(
    [
      "Otherwise you're adding leverage to a squeezed week — nothing improves; it compounds.",
      "If not, forcing it just accelerates the crunch you're trying to escape.",
    ],
    "CONSEQUENCE"
  ),
  pv(
    [
      "Here's what we do next: you point to where the pinch is — I rebuild the shape until the pressure curve matches reality.",
      "No handshake until the rhythm matches how cash actually hits your account.",
    ],
    "CONTROL"
  ),
];

const BROKER_TRUST_INTENT_VARIANTS: PatternedVariant[] = [
  pv(
    [
      "It's not whether you like the broker — it's whether the structure survives once the pitch energy is gone.",
      "Strip personality out; if the mechanics don't hold under a skeptical read, the story doesn't matter.",
    ],
    "REFRAME"
  ),
  pv(
    [
      "Before I'd move this forward, we need the deal to work with the sales volume turned down — on paper, not vibes.",
      "Unless it stands without hype, it isn't safe — and I won't pretend it is.",
    ],
    "CONDITION"
  ),
  pv(
    [
      "Otherwise confidence on the call becomes expensive in operations — you pay the gap later in cash and time.",
      "If not, we're done; I'm not staking your business on charm.",
    ],
    "CONSEQUENCE"
  ),
  pv(
    [
      "Here's what we do next: you set the standard — operating numbers and terms, not my urgency.",
      "If you want the straight version without the sell, say so — that's what you'll get from here.",
    ],
    "CONTROL"
  ),
];

const TIME_DELAY_VARIANTS: PatternedVariant[] = [
  pv(
    [
      "It's not about patience — it's whether delay buys a materially better structure or just avoids the decision.",
      "If nothing improves except the calendar, you're drifting — not deciding.",
    ],
    "REFRAME"
  ),
  pv(
    [
      "Before we park this, we need a named condition — what flips for yes, by when, with what proof.",
      "Unless delay is tied to something concrete, we adjust the structure now instead of marking time.",
    ],
    "CONDITION"
  ),
  pv(
    [
      "Otherwise later isn't cleaner — you inherit the same weak shape with less runway to fix it.",
      "If not, we rework now; assuming time fixes structure is how deals go stale.",
    ],
    "CONSEQUENCE"
  ),
  pv(
    [
      "Here's what we do next: either we list what improves with the pause, or we fix what blocks you today — pick one.",
      "Holding off without a defined change doesn't replace the decision standard — it hides it.",
    ],
    "CONTROL"
  ),
];

const RISK_TRUST_VARIANTS: PatternedVariant[] = [
  pv(
    [
      "It's not about trusting a logo — it's whether the structure survives your real operating numbers and downside cases.",
      "Bad experiences in this space are common; skepticism isn't irrational — blind trust is.",
    ],
    "REFRAME"
  ),
  pv(
    [
      "Before you move, we need the mechanics to pass scrutiny — terms, cadence, and what happens when revenue dips.",
      "Unless it holds under pressure-test, we stop; if it does, we proceed with eyes open.",
    ],
    "CONDITION"
  ),
  pv(
    [
      "Otherwise fear without a structure check freezes the business — that's a real cost, not caution.",
      "If not, you stall on emotion while the problem keeps running in the background.",
    ],
    "CONSEQUENCE"
  ),
  pv(
    [
      "Here's what we do next: we match what you're signing to how you actually run payroll, deposits, and downside days.",
      "Labels don't protect you — cadence and written levers do; we don't go forward until that's aligned.",
    ],
    "CONTROL"
  ),
];

const STRUCTURE_STRATEGY_VARIANTS: PatternedVariant[] = [
  pv(
    [
      "It's not about feeling busy — it's whether the structure moves your position or just decorates the problem.",
      "A patch without outcome is activity; capital should change something material or we don't spend it.",
    ],
    "REFRAME"
  ),
  pv(
    [
      "Before I'm in, we need this to fix the underlying issue — not short-term comfort that resets harder later.",
      "Unless it solves a real problem, a yes today is just a deferral with interest.",
    ],
    "CONDITION"
  ),
  pv(
    [
      "Otherwise you're kicking the can — you pay twice when the same issue resurfaces with less room to maneuver.",
      "If not, name that honestly and we reject it; don't dress deferral up as strategy.",
    ],
    "CONSEQUENCE"
  ),
  pv(
    [
      "Here's what we do next: one test — what gets objectively better on paper if you sign, this week and next quarter.",
      "Band-aids don't belong in capital decisions; force the structure to answer that or we redesign.",
    ],
    "CONTROL"
  ),
];

const STATUS_QUO_VARIANTS: PatternedVariant[] = [
  pv(
    [
      "It's not that stable is bad — it's that stable isn't the same as optimized; it only means nothing broke yet.",
      "The only reason to add financing is if it clearly strengthens where you already are — not because change is exciting.",
    ],
    "REFRAME"
  ),
  pv(
    [
      "Before we layer complexity, we need an obvious upside against your current baseline — not a marginal story.",
      "If you're fine today, the bar is higher — this has to earn its place in your operation.",
    ],
    "CONDITION"
  ),
  pv(
    [
      "Otherwise you're trading calm for drag — extra terms and cognitive load for a trajectory that looks the same.",
      "If not, compare two futures: same path versus measurably more runway or flexibility; if you can't see it, don't move.",
    ],
    "CONSEQUENCE"
  ),
  pv(
    [
      "Here's what we do next: set a calm standard — unless this makes you materially stronger, the right move is no move.",
      "We don't disturb steady ops for a rounding error on outcome.",
    ],
    "CONTROL"
  ),
];

const PAYMENT_CADENCE_VARIANTS: PatternedVariant[] = [
  pv(
    [
      "It's not the headline rate — it's whether the rhythm matches how deposits and payroll actually land.",
      "A pretty APR on the wrong weeks is the wrong deal even when the math looks elegant.",
    ],
    "REFRAME"
  ),
  pv(
    [
      "Before we argue basis points, we need the pull schedule to fit your real cash-in days — not the theory.",
      "Unless the cadence mirrors operations, we restructure timing first; nothing else is an honest conversation.",
    ],
    "CONDITION"
  ),
  pv(
    [
      "Otherwise withdrawals hit on the wrong weeks — the deal is structurally wrong even at a 'good' rate.",
      "If not, you fix the payment shape first; debating anything else is rearranging deck chairs.",
    ],
    "CONSEQUENCE"
  ),
  pv(
    [
      "Here's what we do next: map your deposit and payroll cycle — we align pulls so the business runs normally while this pays back.",
      "Anything that forces weekly firefighting in ops gets rewritten; that's non-negotiable.",
    ],
    "CONTROL"
  ),
];

const THINK_ABOUT_IT_VARIANTS: PatternedVariant[] = [
  pv(
    [
      "It's not about rushing you — it's about whether reflection has a target or just becomes drift.",
      "Thinking without a decision test is waiting with extra steps — name what would flip this to a yes.",
    ],
    "REFRAME"
  ),
  pv(
    [
      "Before you go quiet, we need one named gap — structure, timing, downside, or proof — and what clears it.",
      "Unless reflection ties to a specific missing piece, ambiguity isn't a plan — it's postponement.",
    ],
    "CONDITION"
  ),
  pv(
    [
      "Otherwise you sleep on it and wake up with the same unknown — the cost is calendar, not clarity.",
      "If not, tell me the missing fact or term and I'll answer it straight; open loops compound.",
    ],
    "CONSEQUENCE"
  ),
  pv(
    [
      "Here's what we do next: when you're ready, lead with what still has to be true — not whether you felt nudged.",
      "I'm tightening the decision test, not your timeline — the hinge is concrete, not mood.",
    ],
    "CONTROL"
  ),
];

const SEND_ME_SOMETHING_VARIANTS: PatternedVariant[] = [
  pv(
    [
      "It's not about having a deck — it's whether paper answers a named gap or just replaces judgment with volume.",
      "Documents help when they close one hole — not when they bury the decision under attachments.",
    ],
    "REFRAME"
  ),
  pv(
    [
      "Before I send a stack, we need the one clarity you're still missing — term, cadence, downside, or comparison point.",
      "Unless we anchor the write-up to that, paper doesn't pick the structure — you still do, with eyes open.",
    ],
    "CONDITION"
  ),
  pv(
    [
      "Otherwise email becomes noise — you get PDFs without a target question and the decision moves sideways.",
      "If not, we isolate the sticking point first; a pile without a point usually adds delay, not proof.",
    ],
    "CONSEQUENCE"
  ),
  pv(
    [
      "Here's what we do next: align on what proof you're actually looking for — then I put that on the page.",
      "Writing should sharpen the call, not postpone it; the structure still has to work beyond the attachment.",
    ],
    "CONTROL"
  ),
];

const TALK_TO_PARTNER_VARIANTS: PatternedVariant[] = [
  pv(
    [
      "It's not about speed — it's whether you and your partner share one picture of downside and upside.",
      "Alignment beats internal friction later; two different stories become expensive fast.",
    ],
    "REFRAME"
  ),
  pv(
    [
      "Before you loop them in, we need the conversation on standards — terms, cadence, risk — not vibes.",
      "Unless you agree what 'good' means structurally, you'll trade guesses for weeks.",
    ],
    "CONDITION"
  ),
  pv(
    [
      "Otherwise you get two yeses on two different deals — the gap shows up after ink, when it's expensive.",
      "If not, surface the mismatch now; pretending alignment doesn't hold when payroll hits.",
    ],
    "CONSEQUENCE"
  ),
  pv(
    [
      "Here's what we do next: tell me their main worry — I'll give you plain language you can repeat verbatim.",
      "I'm not chasing a fast signature across two people; better slow with shared conditions than fast with split assumptions.",
    ],
    "CONTROL"
  ),
];

const NO_BRUSH_VARIANTS: PatternedVariant[] = [
  pv(
    [
      "It's not a negotiation tactic on my side — a hard no usually means bad fit or something never got unpacked.",
      "Fast pass is fine; I'm not here to reframe your instinct into a maybe.",
    ],
    "REFRAME"
  ),
  pv(
    [
      "Before we close the file, we need one distinction — is it the whole idea or one blocker we never addressed.",
      "If it's one issue, name it; if it's the fit, we're done cleanly with no chase.",
    ],
    "CONDITION"
  ),
  pv(
    [
      "Otherwise 'not interested' stays ambiguous — you leave with the same gap and I can't tell which exit you meant.",
      "If not, say whether it's not this shape or not without data — two different doors.",
    ],
    "CONSEQUENCE"
  ),
  pv(
    [
      "Here's what we do next: if zero version could work, say so — we stop and don't burn cycles.",
      "If one lever would change it, we isolate that once — fast — then respect whichever answer you land on.",
    ],
    "CONTROL"
  ),
];

function patternedVariantsForGeneralSubtype(
  sub: Exclude<LiveGeneralSubtype, null>
): PatternedVariant[] {
  switch (sub) {
    case "CONTROL_ACCESS":
      return CONTROL_ACCESS_VARIANTS;
    case "COMMITMENT_LOCKIN":
      return COMMITMENT_LOCKIN_VARIANTS;
    case "FUTURE_EXPANSION":
      return FUTURE_EXPANSION_VARIANTS;
    case "TERMS_EXIT":
      return TERMS_EXIT_VARIANTS;
    case "PRESSURE_BURDEN":
      return PRESSURE_BURDEN_VARIANTS;
    case "BROKER_TRUST_INTENT":
      return BROKER_TRUST_INTENT_VARIANTS;
    case "TIME_DELAY":
      return TIME_DELAY_VARIANTS;
    case "RISK_TRUST":
      return RISK_TRUST_VARIANTS;
    case "STRUCTURE_STRATEGY":
      return STRUCTURE_STRATEGY_VARIANTS;
    case "STATUS_QUO":
      return STATUS_QUO_VARIANTS;
    case "PAYMENT_CADENCE":
      return PAYMENT_CADENCE_VARIANTS;
    case "THINK_ABOUT_IT":
      return THINK_ABOUT_IT_VARIANTS;
    case "SEND_ME_SOMETHING":
      return SEND_ME_SOMETHING_VARIANTS;
    case "TALK_TO_PARTNER":
      return TALK_TO_PARTNER_VARIANTS;
    case "NO_BRUSH":
      return NO_BRUSH_VARIANTS;
    default: {
      const _exhaustive: never = sub;
      return _exhaustive;
    }
  }
}

export type LivePatternDebugMeta = {
  objectionType?: ReturnType<typeof detectObjectionType> | null;
  liveGeneralSubtype?: string | null;
  lastPatternUsed?: PersuasionPattern | null;
  selectedPattern?: PersuasionPattern | null;
  candidateVariantCount?: number;
  effectivePoolCount?: number;
  antiRepeatFilterApplied?: boolean;
  chosenVariantPrimaryPattern?: PersuasionPattern | null;
  chosenVariantFirstLine?: string | null;
  openerApplied?: boolean;
  enforcePatternToneApplied?: boolean;
  enforceDecisionPressureApplied?: boolean;
  finalSayThis?: string | null;
};

function attachPatternFields(
  sr: AssistantStructuredReply,
  primary: PersuasionPattern | null,
  priorUsed: PersuasionPattern | null
): AssistantStructuredReply {
  if (!primary) return sr;
  return {
    ...sr,
    primaryPersuasionPattern: primary,
    lastPatternUsed: priorUsed,
  };
}

type LiveJudgmentKind = "ADVISORY" | "ACCEPTANCE" | null;

function detectLiveJudgmentQuestion(message: string): LiveJudgmentKind {
  const t = message.trim().toLowerCase();
  if (!t) return null;
  if (
    /\bwhat\s+would\s+you\s+do\b/.test(t) ||
    /\bif\s+you\s+were\s+me\b/.test(t) ||
    /\bwhat\s+do\s+you\s+think\s+i\s+should\s+do\b/.test(t)
  ) {
    return "ADVISORY";
  }
  if (
    /\bwould\s+you\s+(take|accept)\b/.test(t) ||
    /\bshould\s+i\s+(do|take)\s+this\b/.test(t) ||
    /\bwould\s+you\s+move\s+forward\b/.test(t)
  ) {
    return "ACCEPTANCE";
  }
  return null;
}

type LivePriceSubtype = "NEGOTIATE" | "BANK_COMPARISON" | "JUSTIFY" | "DEFAULT";

function detectPriceSubtype(message: string): LivePriceSubtype {
  const t = message.trim().toLowerCase();
  if (!t) return "DEFAULT";
  if (/\bbank\b/.test(t) || /\bmy bank\b/.test(t) || /\bline of credit\b/.test(t)) {
    return "BANK_COMPARISON";
  }
  if (/\bwhy\b/.test(t) && (/\brevenue\b/.test(t) || /\bgood\b/.test(t))) {
    return "JUSTIFY";
  }
  if (/\blower\b/.test(t) || /\bget\b.*\brate\b.*\blower\b/.test(t)) {
    return "NEGOTIATE";
  }
  return "DEFAULT";
}

function pricePrimaryPattern(subtype: LivePriceSubtype): PersuasionPattern {
  if (subtype === "NEGOTIATE") return "CONTROL";
  return "REFRAME";
}

/**
 * LIVE: deterministic tone enforcement for the selected persuasion pattern.
 * When the text already matches the pattern (gating, pressure, directive, contrast), returns unchanged.
 * Otherwise adds a short clause — appended as a sentence when there are fewer than three sentences, merged into the last sentence with an em dash when already at three (no randomness).
 */
export function enforcePatternTone(text: string, pattern: PersuasionPattern): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return t;

  const hasTone = (() => {
    switch (pattern) {
      case "CONDITION":
        return /\b(before\s+.{5,100}\s+we\s+need|before\s+.{3,40},\s+we\s+need|unless\s+|only\s+if\s+|has\s+to\s+be\s+true|what\s+still\s+has\s+to\s+be\s+true)\b/i.test(
          t
        );
      case "CONSEQUENCE":
        return /\b(otherwise|if\s+not|or\s+else)\b/i.test(t);
      case "CONTROL":
        return /\bhere'?s\s+what\s+we\s+do\s+next\b/i.test(t);
      case "REFRAME":
        return (
          (/\bit'?s\s+not\b/i.test(t) && /\b(it'?s|whether)\b/i.test(t)) ||
          (/not\s+the\b/i.test(t) && /\bwhat\s+matters\b/i.test(t))
        );
      default: {
        const _exhaustive: never = pattern;
        return _exhaustive;
      }
    }
  })();

  if (hasTone) return t;

  const clause = (() => {
    switch (pattern) {
      case "CONDITION":
        return "before anything moves we need the condition you're waiting on spelled clearly";
      case "CONSEQUENCE":
        return "if not, you mostly keep the same exposure you have now";
      case "CONTROL":
        return "here's what we do next — name the one gap, then align the structure around it";
      case "REFRAME":
        return "it's not the headline worry — it's whether the structure fits how you operate";
      default: {
        const _exhaustive: never = pattern;
        return _exhaustive;
      }
    }
  })();

  const sentences = t
    .split(/[.?!]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length === 0) return t;

  const last = sentences[sentences.length - 1]!.replace(/[.!?]+$/, "").trim();
  if (sentences.length >= 3) {
    const prefix = sentences.slice(0, -1).join(". ");
    const merged = prefix ? `${prefix}. ${last} — ${clause}.` : `${last} — ${clause}.`;
    return merged.replace(/\s+/g, " ").trim();
  }

  const base = t.replace(/[.!?]+$/, "").trim();
  const cap = clause.charAt(0).toUpperCase() + clause.slice(1);
  return `${base}. ${cap}.`.replace(/\s+/g, " ").trim();
}

/**
 * LIVE: ensure outputs contain at least one forward-driving clause.
 * Deterministic (no randomness): if missing, appends a short clause while preserving sentence limits.
 */
export function enforceDecisionPressure(text: string, pattern: PersuasionPattern): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return t;
  if (shouldSkipPressure(pattern)) return t;

  // Accept any one of the required forward-driving signals.
  if (/\botherwise\b/i.test(t)) return t;
  if (/\bso we can\b/i.test(t)) return t;
  if (/\bbefore that\b/i.test(t)) return t;

  const sentences = t
    .split(/[.?!]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length === 0) return t;

  const clause = (() => {
    // If there is already a gating/conditional structure, prefer "before that".
    if (/\b(before|unless|only if|has to be true)\b/i.test(t)) return "Before that, we need the missing condition named clearly";
    // If there is a directive/next-step vibe, prefer "so we can".
    if (/\b(here'?s what we do next|tell me|we (need|do)|next)\b/i.test(t))
      return "So we can move, we name the one blocker and align the structure around it";
    // Default to explicit forward-pressure.
    return "Otherwise, we keep circling the same concern without a clean decision";
  })();

  // Add the clause in a compact way to avoid blowing past the 3-sentence cap.
  if (sentences.length >= 3) {
    const prefix = sentences.slice(0, -1).join(". ");
    const last = sentences[sentences.length - 1]!.replace(/[.!?]+$/, "").trim();
    const dashClause = clause.length ? clause.charAt(0).toLowerCase() + clause.slice(1) : clause;
    const merged = prefix ? `${prefix}. ${last} — ${dashClause}.` : `${last} — ${dashClause}.`;
    return merged.replace(/\s+/g, " ").trim();
  }

  const base = t.replace(/[.!?]+$/, "").trim();
  // Keep it minimal: one forward-driving sentence.
  return `${base}. ${clause}.`.replace(/\s+/g, " ").trim();
}

export function shouldSkipPressure(pattern: PersuasionPattern): boolean {
  return pattern === "CONTROL";
}

function hasHesitationKeywords(input: string): boolean {
  const t = input.toLowerCase();
  return /\b(i don['’]t know|idk|i mean|maybe|we['’]ll see|not sure)\b/.test(t);
}

function detectMultiObjectionSignals(
  input: string
): Array<"PRICE" | "TRUST" | "CREDIT" | "TAX" | "TIME_DELAY"> {
  const t = input.toLowerCase();
  const signals: Array<"PRICE" | "TRUST" | "CREDIT" | "TAX" | "TIME_DELAY"> = [];
  if (/\b(rate|factor|expensive|too high|costs? too much|price)\b/.test(t)) signals.push("PRICE");
  if (/\b(trust|predatory|trap|scam|sounds like|feels like)\b/.test(t)) signals.push("TRUST");
  if (/\b(credit|hard pull|inquiry)\b/.test(t)) signals.push("CREDIT");
  if (/\b(tax|deductible|accountant)\b/.test(t)) signals.push("TAX");
  if (/\b(wait|later|not now|think about it)\b/.test(t)) signals.push("TIME_DELAY");
  return signals;
}

function dualObjectionAckSentence(userMessage: string): string | null {
  const uniq = [...new Set(detectMultiObjectionSignals(userMessage))];
  if (uniq.length < 2) return null;
  const has = (k: (typeof uniq)[number]) => uniq.includes(k);

  if (has("PRICE") && has("TRUST")) return "You're weighing cost and trust. Good.";
  if (has("PRICE") && has("CREDIT")) return "It's price and exposure. Good.";
  if (has("TRUST") && has("CREDIT")) return "It's trust and exposure. Good.";
  if (has("PRICE") && has("TIME_DELAY")) return "Sounds like it's price and timing.";
  if (has("TRUST") && has("TIME_DELAY")) return "Sounds like it's trust and timing.";
  const order = ["PRICE", "TRUST", "CREDIT", "TAX", "TIME_DELAY"] as const;
  const labels: Record<(typeof order)[number], string> = {
    PRICE: "cost",
    TRUST: "trust",
    CREDIT: "credit",
    TAX: "tax",
    TIME_DELAY: "delay",
  };
  const words = order.filter((k) => uniq.includes(k)).map((k) => labels[k]);
  if (words.length === 2) return `Sounds like ${words[0]} and ${words[1]} are both in play.`;
  if (words.length > 2)
    return `Sounds like ${words.slice(0, -1).join(", ")}, and ${words[words.length - 1]} are all in play.`;
  return null;
}

function injectDualObjectionAck(text: string, userMessage: string): string {
  const ack = dualObjectionAckSentence(userMessage);
  if (!ack) return text;
  const t = text.trim();
  if (!t) return ack;
  if (
    /\byou're weighing\b|\bsounds like it's\b|\bboth in play\b|\ball in play\b|\bprice and exposure\b|\btrust and exposure\b/i.test(
      t
    )
  ) {
    return t;
  }
  return `${ack} ${t}`.trim();
}

function normalizeCloserLexicon(text: string, pattern: PersuasionPattern): string {
  let t = text;

  // Suppress weak/soft phrases (deterministic).
  t = t.replace(/\b(i understand|i hear you|it makes sense)\b[^.?!]*[.?!]/gi, "");
  t = t.replace(/\b(ultimately|at the end of the day)\b\s*,?\s*/gi, "");

  // Prefer closer phrases by pattern.
  if (pattern === "REFRAME") {
    t = t.replace(/\bbut that's not the real decision\b/gi, "That's the surface concern");
    t = t.replace(/\bwhat matters is\b/gi, "The real issue is");
    // Strip consequence-style remnants to preserve calm correction.
    t = t.replace(/\bwe keep circling\b[^.?!]*[.?!]?/gi, "");
  } else if (pattern === "CONDITION") {
    t = t.replace(/\bthis only moves when\b/gi, "Before this makes sense");
  } else if (pattern === "CONSEQUENCE") {
    t = t.replace(/\botherwise\b/gi, "If nothing changes,");
  } else if (pattern === "CONTROL") {
    t = t.replace(/\bhere'?s what we do next\b/gi, "Here's what we do");
    t = t.replace(/\bhere'?s how i'?d look at it\b/gi, "Here's what we do");
  }

  t = t
    .replace(/—\s*The real issue is\b/g, "— the real issue is")
    .replace(/That's the surface concern\s*—\s*the real issue is/gi, "That's the surface concern. The real issue is");
  return t.replace(/\s+/g, " ").trim();
}

type CloserVoiceContext = {
  userMessage: string;
  priorPattern: PersuasionPattern | null;
};

/**
 * LIVE Step 5.1: deterministic closer-edge failure tags (evaluation / audit).
 * Used to flag hedging, soft openers, drag, and abstract phrasing before or after normalization.
 */
export type CloserEdgeFailureSignature =
  | "hedging_modal_may_might"
  | "hedging_could_be"
  | "hedging_helper_may_might_help"
  | "soft_goal_or_idea_frame"
  | "bloated_what_this_means_is"
  | "filler_kind_of_sort_of"
  | "soft_at_that_point"
  | "low_energy_opener"
  | "soft_opener_well_so"
  | "overlong_sentence"
  | "over_explaining_second"
  | "weak_meta_punchline"
  | "weak_explanatory_finale"
  | "abstract_system_phrasing"
  | "abstract_operational_distance"
  | "passive_weakening"
  | "passive_being_construct"
  | "rhetorical_softness_control"
  | "rhetorical_softness_condition";

const CLOSER_EDGE_LOW_ENERGY =
  /\b(it'?s important to note that|just to be clear,?|i would (say|argue) that|to be honest,?|for what it'?s worth,?)\s+/gi;

const CLOSER_EDGE_ABSTRACT =
  /\b(the (?:underlying )?dynamic here is|from a structural (?:standpoint|perspective)|at a high level,?|in theory,?)\s+/gi;

const CLOSER_EDGE_WEAK_FINAL =
  /\b(in other words|to put it simply|what i'?m (?:really )?driving at is|so ultimately,?|the point i'?m making is)\b/gi;

const CLOSER_EDGE_EXPLANATORY_FINALE =
  /\b(because that'?s|which is why|and that'?s (?:basically )?(?:why|the point)|—\s*(?:and )?that'?s (?:basically )?why)\b/gi;

function closerEdgeEnsureLeadCase(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return t;
  return t[0]!.toUpperCase() + t.slice(1);
}

/**
 * Scan LIVE closer text for edge failures (deterministic; no side effects).
 */
export function detectCloserEdgeFailureSignatures(
  text: string,
  pattern: PersuasionPattern
): CloserEdgeFailureSignature[] {
  const t = text.trim();
  if (!t) return [];
  const out: CloserEdgeFailureSignature[] = [];
  const push = (s: CloserEdgeFailureSignature) => {
    if (!out.includes(s)) out.push(s);
  };

  if (/\bit may\b|\bit might\b|\bmight not\b|\bmay not\b/i.test(t)) push("hedging_modal_may_might");
  if (/\bit could be\b|\bcould be a\b|\bcould be an\b/i.test(t)) push("hedging_could_be");
  if (/\bit (?:may|might|could) help\b|\bwe (?:may|might) want to\b/i.test(t)) push("hedging_helper_may_might_help");
  if (/\bthe goal is\b|\bthe idea is\b/i.test(t)) push("soft_goal_or_idea_frame");
  if (/\bwhat this means is\b/i.test(t)) push("bloated_what_this_means_is");
  if (/\bkind of\b|\bsort of\b/i.test(t)) push("filler_kind_of_sort_of");
  if (/\bat that point\b/i.test(t)) push("soft_at_that_point");
  if (CLOSER_EDGE_LOW_ENERGY.test(t)) push("low_energy_opener");
  CLOSER_EDGE_LOW_ENERGY.lastIndex = 0;

  const sents = splitSentences(t);
  const first = sents[0] ?? "";
  const last = sents.length ? sents[sents.length - 1]! : "";
  if (/^(well|so),/i.test(first.trim())) push("soft_opener_well_so");
  if (CLOSER_EDGE_EXPLANATORY_FINALE.test(last)) push("weak_explanatory_finale");
  CLOSER_EDGE_EXPLANATORY_FINALE.lastIndex = 0;

  if (sents.some((s) => s.length > 140)) push("overlong_sentence");
  if (
    sents.length >= 2 &&
    /\b(in order to|so that we can|the reason (?:for this )?is that|what that (?:really )?means is|what this boils down to is)\b/i.test(
      sents[1]!
    )
  ) {
    push("over_explaining_second");
  }
  if (CLOSER_EDGE_WEAK_FINAL.test(t)) push("weak_meta_punchline");
  CLOSER_EDGE_WEAK_FINAL.lastIndex = 0;
  if (CLOSER_EDGE_ABSTRACT.test(t)) push("abstract_system_phrasing");
  CLOSER_EDGE_ABSTRACT.lastIndex = 0;

  if (
    /\bin this scenario\b|\bfrom a structural (?:standpoint|perspective)\b|\bone could argue\b|\bthe net effect is\b/i.test(t)
  ) {
    push("abstract_operational_distance");
  }

  if (/\bthere needs to be\b|\bit would be helpful if\b|\bwe should probably\b|\bwe probably need\b/i.test(t)) {
    push("passive_weakening");
  }
  if (/\b(?:is|are) being\b|\bit is important that\b|\bit's important that\b/i.test(t)) push("passive_being_construct");

  if (pattern === "CONTROL") {
    if (/\b(let'?s maybe|we can try to|if you want to|when you get a chance)\b/i.test(t)) {
      push("rhetorical_softness_control");
    }
  }
  if (pattern === "CONDITION") {
    if (/\b(i think|i believe|probably|kind of need)\b/i.test(t)) push("rhetorical_softness_condition");
  }

  return out;
}

// --- Step 5.2: Adaptive entry (deterministic; no randomness) ---

const CONTROL_OPENERS = [
  "Let's isolate it.",
  "Walk me through it.",
  "Show me where it breaks.",
  "Point to the gap.",
  "What specifically isn't lining up?",
] as const;

const HARD_BRIDGES = [
  "That's fair.",
  "I hear that.",
  "That makes sense.",
  "I get why you'd say that.",
] as const;

const REFRAME_ENGAGE = [
  "What part of it feels off?",
  "Where specifically does it break for you?",
  "Which part doesn't line up?",
  "What's the piece that doesn't make sense yet?",
] as const;

function detectObjectionIntensity(input: string): "hard" | "soft" | "neutral" {
  const hardSignals = [
    "won't work",
    "doesn't work",
    "not interested",
    "not for me",
    "no way",
    "don't trust",
    "sounds expensive",
  ];

  const softSignals = ["not sure", "maybe", "i think", "i guess", "we'll see"];

  const lower = input.toLowerCase();

  if (hardSignals.some((s) => lower.includes(s))) return "hard";
  if (softSignals.some((s) => lower.includes(s))) return "soft";
  return "neutral";
}

function selectControlOpener(text: string): string {
  const n = CONTROL_OPENERS.length;
  const start = text.length % n;
  for (let k = 0; k < n; k++) {
    const idx = (start + k) % n;
    const op = CONTROL_OPENERS[idx]!;
    const opIsIsolate = /^let's isolate it/i.test(op);
    if (opIsIsolate && /\blet's isolate it\b/i.test(text)) {
      continue;
    }
    return op;
  }
  return CONTROL_OPENERS[start]!;
}

function selectBridge(text: string): string {
  return HARD_BRIDGES[text.length % HARD_BRIDGES.length]!;
}

/** Step 5.3: map merchant wording → pressure style (deterministic; text shaping only). */
function classifyObjectionType(input: string): "deflection" | "comparison" | "hesitation" | "rejection" {
  const lower = input.toLowerCase();

  if (lower.includes("send") || lower.includes("pricing") || lower.includes("info")) return "deflection";
  if (lower.includes("already have") || lower.includes("working with")) return "comparison";
  if (lower.includes("not sure") || lower.includes("maybe") || lower.includes("i think")) return "hesitation";
  if (lower.includes("won't work") || lower.includes("not for me") || lower.includes("don't want"))
    return "rejection";

  return "hesitation";
}

/** Step 5.4 / 5.8: rejection subtype for CONTROL copy (strict order; only when objection is rejection-class). */
function classifyRejectionSubtype(input: string): "cost" | "fit" | "trust" | "brush_off" {
  const t = input.toLowerCase();

  if (t.includes("expensive") || t.includes("price") || t.includes("cost")) {
    return "cost";
  }

  if (t.includes("trust") || t.includes("scam") || t.includes("trap")) {
    return "trust";
  }

  if (t.includes("not interested") || t.includes("no thanks")) {
    return "brush_off";
  }

  if (t.includes("won't work") || t.includes("not for me")) {
    return "fit";
  }

  return "fit";
}

const REJECTION_SUBTYPE_SET = new Set<string>(["cost", "fit", "trust", "brush_off"]);

/**
 * Step 5.5: natural variation after HARD_BRIDGE (idx = input.length % length; no randomness).
 * Replaces static single lines per subtype from Step 5.4.
 */
const COST_VARIANTS = [
  "That's fair—does this put you in a better position week to week, or are we just arguing about the rate on paper?",
  "That's fair—what outcome are you protecting if the payment hits your account the wrong way?",
] as const;

const FIT_VARIANTS = [
  "Got it—where specifically does it break for your situation?",
  "Understood—where does it break against how you actually run the business?",
] as const;

const TRUST_VARIANTS = [
  "I hear that—what specifically makes it feel risky to you?",
  "That makes sense—what's the part that doesn't feel right?",
] as const;

const BRUSH_VARIANTS = [
  "Before we leave it, what didn't land for you?",
  "Fair enough—what part didn't actually connect?",
] as const;

function selectRejectionNaturalVariant(sub: "cost" | "fit" | "trust" | "brush_off", input: string): string {
  const idx = input.length;
  switch (sub) {
    case "cost":
      return COST_VARIANTS[idx % COST_VARIANTS.length]!;
    case "fit":
      return FIT_VARIANTS[idx % FIT_VARIANTS.length]!;
    case "trust":
      return TRUST_VARIANTS[idx % TRUST_VARIANTS.length]!;
    case "brush_off":
      return BRUSH_VARIANTS[idx % BRUSH_VARIANTS.length]!;
    default: {
      const _exhaustive: never = sub;
      return _exhaustive;
    }
  }
}

/** Step 5.6: single sentence; strip trailing extras for brush-off redirect. */
function firstSentenceOnly(text: string): string {
  const parts = splitSentences(text);
  if (parts.length === 0) return text.trim();
  const endsWithQuestion = /\?\s*$/.test(text.trim());
  const s = parts[0]!.replace(/[.!?]+$/, "").trim();
  return endsWithQuestion ? `${s}?` : `${s}.`;
}

/** Step 5.6 trust: no structure/control framing / “real issue” drift; keep risk + specific ask. */
function stripTrustAbstractLanguage(text: string): string {
  let t = text
    .replace(/\b(the real issue is|real issue is|control framing|what matters is whether)\b/gi, "")
    .replace(/\bstructure\b/gi, "what you're signing")
    .replace(/\b(in theory|at a high level|philosophically)\b/gi, "")
    .replace(/\s+—\s*—+/g, " — ")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!/\b(risk|risks|risky|unsafe|worry|worried|concern|sketchy|feel right|feel off|doesn'?t feel)\b/i.test(t)) {
    t = `Worth naming the risk — ${t}`;
  }
  if (!/\?/.test(t)) {
    t = `${t} What's the specific concern?`;
  }
  return closerEdgeEnsureLeadCase(t.replace(/\s+/g, " ").trim());
}

/** Step 5.6 cost: position / outcome / real-world effect (not abstract structure-only). */
function ensureCostGrounding(text: string): string {
  const grounded =
    /\b(position|outcome|week to week|account|payment|rate on paper|operate|cash|payroll|bottom line)\b/i.test(
      text
    );
  if (grounded) return text.trim();
  const pad = text.replace(/[.?!]+$/, "").trim();
  return closerEdgeEnsureLeadCase(
    `${pad} Does it actually improve your position day to day?`.replace(/\s+/g, " ").trim()
  );
}

/** Step 5.6 fit: “where it breaks” lane; ban generic “doesn’t line up”. */
function enforceFitPrecision(text: string): string {
  let t = text.replace(/\bdoesn'?t line up\b/gi, "doesn't match how you operate");
  const hasBreak = /\b(where.*break|what.*break|break for|break against|does it break)\b/i.test(t);
  if (!hasBreak) {
    return "Got it—where specifically does it break for your situation?";
  }
  return closerEdgeEnsureLeadCase(t.replace(/\s+/g, " ").trim());
}

/**
 * Step 5.6: objection behavior enforcement after natural variant selection (deterministic).
 */
function enforceRejectionSubtypeBehavior(
  text: string,
  subtype: "cost" | "fit" | "trust" | "brush_off"
): string {
  let t = text.replace(/\s+/g, " ").trim();
  switch (subtype) {
    case "brush_off":
      return firstSentenceOnly(t);
    case "trust":
      return stripTrustAbstractLanguage(t);
    case "cost":
      return ensureCostGrounding(t);
    case "fit":
      return enforceFitPrecision(t);
    default: {
      const _exhaustive: never = subtype;
      return _exhaustive;
    }
  }
}

/** Step 5.7: sentence count for subtype rule checks (split on . ? !). */
function sentenceCount(text: string): number {
  return splitSentences(text.trim()).length;
}

/**
 * Step 5.7: hard violation check — if true, replace entire line (no soft fix).
 */
function violatesSubtypeRules(
  text: string,
  subtype: "cost" | "fit" | "trust" | "brush_off"
): boolean {
  const t = text.toLowerCase();

  if (subtype === "trust") {
    return (
      t.includes("the decision is whether") ||
      t.includes("gives you more control") ||
      t.includes("real issue") ||
      t.includes("structure")
    );
  }

  if (subtype === "brush_off") {
    return (
      sentenceCount(text) > 1 ||
      t.includes("the real issue") ||
      t.includes("surface concern")
    );
  }

  if (subtype === "cost") {
    return (
      t.includes("structure") &&
      !t.includes("position") &&
      !t.includes("cash") &&
      !t.includes("payment")
    );
  }

  return false;
}

/** Step 5.7: deterministic compliant replacements when soft enforcement fails. */
const HARD_OVERRIDES = {
  trust: [
    "That makes sense—what specifically feels off to you?",
    "I hear that—what part doesn't feel right?",
  ],
  brush_off: [
    "Got it—what didn't land for you?",
    "No problem—what part didn't connect?",
  ],
  cost: [
    "That's fair—the question is whether it actually improves your position. Where does it break for you?",
    "I get that—the real question is what it does to your cash flow. Where does it break?",
  ],
} as const;

function selectOverride(subtype: keyof typeof HARD_OVERRIDES, input: string): string {
  const pool = HARD_OVERRIDES[subtype];
  return pool[input.length % pool.length]!;
}

function enforceHardOverride(
  text: string,
  subtype: "cost" | "fit" | "trust" | "brush_off",
  input: string
): string {
  if (!violatesSubtypeRules(text, subtype)) return text;
  if (subtype === "fit") return text;
  return selectOverride(subtype, input);
}

// --- Step 5.9: family-level behavior enforcement (final safety net; deterministic; no routing changes) ---

export type LiveEnforcementFamily = "TRUST" | "PRICE" | "BRUSH_OFF" | "FIT_STYLE";

export function resolveLiveEnforcementFamily(
  objectionType: ReturnType<typeof detectObjectionType>,
  userMessage: string,
  liveGeneralSubtype: string | null
): LiveEnforcementFamily | null {
  const lower = userMessage.toLowerCase();
  if (objectionType === "TRUST") return "TRUST";
  if (objectionType === "PRICE") return "PRICE";
  if (objectionType === "GENERAL") {
    if (liveGeneralSubtype === "NO_BRUSH") return "BRUSH_OFF";
    if (/\b(not interested|no thanks)\b/.test(lower)) return "BRUSH_OFF";
    if (/\b(won'?t work|not for me|doesn'?t fit|won'?t work for me)\b/i.test(lower)) {
      return "FIT_STYLE";
    }
  }
  return null;
}

const FAMILY_ENFORCE_TRUST = HARD_OVERRIDES.trust;
const FAMILY_ENFORCE_PRICE = HARD_OVERRIDES.cost;
const FAMILY_ENFORCE_BRUSH = HARD_OVERRIDES.brush_off;
const FAMILY_ENFORCE_FIT: readonly string[] = FIT_VARIANTS as unknown as string[];

function violatesFamilyTrust(text: string): boolean {
  const t = text.toLowerCase();
  return (
    t.includes("the decision is whether") ||
    t.includes("gives you more control") ||
    t.includes("real issue") ||
    t.includes("structure around it") ||
    /\bstructure puts you in control\b/i.test(t)
  );
}

/** PRICE family only: stricter than subtype rules — long abstract template lines → deterministic pool. */
function violatesFamilyPrice(text: string): boolean {
  const t = text.toLowerCase();
  if (sentenceCount(text) > 2) return true;
  if (t.includes("surface concern")) return true;
  if (t.includes("number by itself")) return true;
  if (t.includes("the real issue is")) return true;
  if (/\bstructure\b/i.test(text)) {
    const hasConcreteStructureCue =
      /\bcash flow\b/i.test(text) ||
      /\bpayment\b/i.test(text) ||
      /\bweek\s*to\s*week\b/i.test(text) ||
      /week-to-week/i.test(text) ||
      /\baccount\b/i.test(text) ||
      /\baffordability\b/i.test(text) ||
      /what it does to your position/i.test(text);
    if (!hasConcreteStructureCue) return true;
  }
  return false;
}

function violatesFamilyBrush(text: string): boolean {
  const t = text.toLowerCase();
  return (
    sentenceCount(text) > 1 ||
    t.includes("surface concern") ||
    t.includes("the real issue") ||
    /\breal issue\b/.test(t)
  );
}

function violatesFamilyFit(text: string): boolean {
  const t = text.toLowerCase();
  const hasBreak =
    /\b(where.*break|what.*break|break for|break against|doesn'?t fit|does not fit)\b/i.test(t);
  return !hasBreak;
}

function enforceFamilyBehavior(
  text: string,
  family: LiveEnforcementFamily | null,
  userMsg: string
): string {
  if (!family) return text.trim();
  const i = userMsg.length;
  switch (family) {
    case "TRUST":
      if (!violatesFamilyTrust(text)) return text.trim();
      return FAMILY_ENFORCE_TRUST[i % FAMILY_ENFORCE_TRUST.length]!;
    case "PRICE":
      if (!violatesFamilyPrice(text)) return text.trim();
      return FAMILY_ENFORCE_PRICE[i % FAMILY_ENFORCE_PRICE.length]!;
    case "BRUSH_OFF":
      if (!violatesFamilyBrush(text)) return text.trim();
      return FAMILY_ENFORCE_BRUSH[i % FAMILY_ENFORCE_BRUSH.length]!;
    case "FIT_STYLE":
      if (!violatesFamilyFit(text)) return text.trim();
      return FAMILY_ENFORCE_FIT[i % FAMILY_ENFORCE_FIT.length]!;
    default: {
      const _exhaustive: never = family;
      return _exhaustive;
    }
  }
}

/** Step 5.9: family shaping after all lane generation (no debug prefixes on live text). */
function applyFinalFamilyEnforcement(
  sayThis: string,
  userMessage: string,
  objectionType: ReturnType<typeof detectObjectionType>,
  liveGeneralSubtype: string | null | undefined
): string {
  const family = resolveLiveEnforcementFamily(objectionType, userMessage, liveGeneralSubtype ?? null);
  return enforceFamilyBehavior(sayThis.trim(), family, userMessage);
}

const CONTROL_CALIBRATION_DEFLECTION = [
  "Happy to send that — what do you want to see first so it's actually useful?",
  "I can get you that — what should land first so it's useful?",
] as const;

const CONTROL_CALIBRATION_COMPARISON = [
  "Makes sense. What are they handling well — and where do you still see gaps?",
  "Got it. What are they doing right — and where is the gap for you?",
] as const;

const CONTROL_CALIBRATION_HESITATION = [
  "That usually means something isn't fully clear yet — walk me through the one gap.",
  "That reads as one open question — walk me through the one gap.",
] as const;

function isRichControlPreserve(text: string): boolean {
  const low = text.toLowerCase();
  if (splitSentences(text).length >= 4) return true;
  if (text.length > 450) return true;
  if (/\b(i get|fair to look at|the decision is whether|what matters is whether|your accountant)\b/i.test(low))
    return true;
  return false;
}

/** Peel dual-objection ack prefix so calibration can replace only the CONTROL body. */
function splitDualAckControlPrefix(full: string): { prefix: string; rest: string } {
  const t = full.trim();
  const patterns: RegExp[] = [
    /^You're weighing[^.]+\.\s*Good\.\s*/i,
    /^It's price and exposure\.\s*Good\.\s*/i,
    /^It's trust and exposure\.\s*Good\.\s*/i,
    /^Sounds like it's price and timing\.\s*/i,
    /^Sounds like it's trust and timing\.\s*/i,
    /^Sounds like [^.]+ are both in play\.\s*/i,
    /^Sounds like [^.]+ are all in play\.\s*/i,
  ];
  for (const p of patterns) {
    const m = t.match(p);
    if (m) {
      return { prefix: m[0].trim() + " ", rest: t.slice(m[0].length).trim() };
    }
  }
  return { prefix: "", rest: t };
}

function trimControlToMaxTwoSentences(text: string): string {
  const endsWithQuestion = /\?\s*$/.test(text.trim());
  const parts = splitSentences(text);
  if (parts.length <= 2) return text;
  const a = parts[0]!.replace(/[.!?]+$/, "").trim();
  const b = parts[1]!.replace(/[.!?]+$/, "").trim();
  const last = endsWithQuestion ? `${b}?` : `${b}.`;
  return `${a}. ${last}`.replace(/\s+/g, " ").trim();
}

/** Phase 6.0: pre-rejection intent (routing only; does not replace objection/rejection classification). */
export type ConversationIntent =
  | "REJECTION"
  | "REQUEST"
  | "HESITATION"
  | "STALL"
  | "COMPARISON"
  | "NEUTRAL";

/**
 * Deterministic first-match intent for CONTROL short-path routing before `applyControlPressureCalibration`.
 * Order: REJECTION → REQUEST → HESITATION → STALL → COMPARISON → NEUTRAL.
 */
export function classifyConversationIntent(input: string): ConversationIntent {
  const s = input.trim();
  if (!s) return "NEUTRAL";
  const lower = s.toLowerCase();
  if (
    lower.includes("not interested") ||
    /\bwon'?t work\b/i.test(s) ||
    lower.includes("not for me") ||
    lower.includes("too expensive")
  ) {
    return "REJECTION";
  }
  if (
    /\bsend\b/i.test(s) ||
    /\bshow\b/i.test(s) ||
    /\bpricing\b/i.test(s) ||
    /\binfo\b/i.test(s) ||
    /\bdetails\b/i.test(s)
  ) {
    return "REQUEST";
  }
  if (lower.includes("not sure") || lower.includes("thinking") || lower.includes("maybe")) {
    return "HESITATION";
  }
  if (
    /\btalk to\b/i.test(s) ||
    /\bspeak to\b/i.test(s) ||
    lower.includes("partner") ||
    lower.includes("later") ||
    lower.includes("circle back")
  ) {
    return "STALL";
  }
  if (lower.includes("already have") || lower.includes("using someone")) {
    return "COMPARISON";
  }
  return "NEUTRAL";
}

/** Fixed 1-sentence CONTROL lines for non-rejection intents (question-close; no calibration pools). */
function conversationIntentControlLine(intent: Exclude<ConversationIntent, "REJECTION" | "NEUTRAL">): string {
  switch (intent) {
    case "REQUEST":
      return "Happy to — what specifically are you trying to evaluate?";
    case "HESITATION":
      return "Got it—what feels unclear right now?";
    case "STALL":
      return "Makes sense—what are they going to focus on so we can line that up now?";
    case "COMPARISON":
      return "Got it—what are they doing right, and where is the gap for you?";
    default: {
      const _exhaustive: never = intent;
      return _exhaustive;
    }
  }
}

/**
 * Step 5.3 + 5.4: cooperative / comparative / interpretive CONTROL lines for short-template paths.
 * Rejection (5.5 + 5.6): pool selection, then enforceSubtypeBehavior (brush/trust/cost/fit rules).
 */
function applyControlPressureCalibration(text: string, userMsg: string): string {
  const u = userMsg.trim();
  if (!u) return text;
  if (isRichControlPreserve(text)) return text;

  const kind = classifyObjectionType(u);
  if (kind === "rejection") {
    const { prefix, rest } = splitDualAckControlPrefix(text);
    const body = rest.length ? rest : text.trim();
    if (isRichControlPreserve(body)) return text;

    const sub = classifyRejectionSubtype(u);
    if (!REJECTION_SUBTYPE_SET.has(sub)) {
      throw new Error("Missing rejection subtype");
    }

    const core = selectRejectionNaturalVariant(sub, u);
    let merged = enforceRejectionSubtypeBehavior(core, sub);
    merged = enforceHardOverride(merged, sub, u);
    return closerEdgeEnsureLeadCase((prefix + merged).replace(/\s+/g, " ").trim());
  }

  const { prefix, rest } = splitDualAckControlPrefix(text);
  const body = rest.length ? rest : text.trim();
  if (isRichControlPreserve(body)) return text;

  const idx = u.length;
  let calibrated: string;
  if (kind === "deflection") {
    calibrated = CONTROL_CALIBRATION_DEFLECTION[idx % CONTROL_CALIBRATION_DEFLECTION.length]!;
  } else if (kind === "comparison") {
    calibrated = CONTROL_CALIBRATION_COMPARISON[idx % CONTROL_CALIBRATION_COMPARISON.length]!;
  } else {
    calibrated = CONTROL_CALIBRATION_HESITATION[idx % CONTROL_CALIBRATION_HESITATION.length]!;
  }

  const out = (prefix + calibrated).replace(/\s+/g, " ").trim();
  return closerEdgeEnsureLeadCase(out);
}

/** Lowercase line without trailing sentence punctuation (CONTROL collision matching). */
function normControlLine(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.?!]+$/g, "")
    .trim();
}

/** Deterministic specificity for CONTROL lines when the same root intent appears twice. */
function controlLineSpecificity(norm: string): number {
  let score = norm.split(/\s+/).filter(Boolean).length * 10;
  if (/\b(the one gap|one gap|where it breaks|specifically|isn'?t lining up)\b/.test(norm)) score += 8;
  if (/\bwalk me through the\b/.test(norm)) score += 5;
  if (/\bshow me where\b/.test(norm)) score += 5;
  if (/\bit\b/.test(norm) && !/\bthe one\b/.test(norm)) score -= 4;
  return score;
}

type ControlCollision = "drop_first" | "drop_second" | "none";

function controlCollisionAction(a: string, b: string): ControlCollision {
  if (!a || !b) return "none";
  const aw = a.split(/\s+/);
  const bw = b.split(/\s+/);
  let common = 0;
  for (let j = 0; j < Math.min(aw.length, bw.length); j++) {
    if (aw[j] === bw[j]) common++;
    else break;
  }

  // Explicit: "name the gap" ⊂ "name the one gap"
  if (/^name the gap$/.test(a) && /^name the one gap/.test(b)) return "drop_first";

  // Explicit: vague "walk me through it" + fuller walk-me-through directive
  if (/^walk me through it$/.test(a) && /^walk me through .+/.test(b) && a !== b) return "drop_first";

  // "show me …" + "show me …" — keep the more specific line only
  if (aw[0] === "show" && aw[1] === "me" && bw[0] === "show" && bw[1] === "me") {
    const sa = controlLineSpecificity(a);
    const sb = controlLineSpecificity(b);
    if (sa > sb) return "drop_second";
    if (sa < sb) return "drop_first";
    return "none";
  }

  // Shared prefix (≥3 words): drop the less specific / shorter substantive line
  if (common >= 3) {
    const sa = controlLineSpecificity(a);
    const sb = controlLineSpecificity(b);
    if (sa > sb) return "drop_second";
    if (sa < sb) return "drop_first";
    if (aw.length < bw.length) return "drop_first";
    if (bw.length < aw.length) return "drop_second";
  }

  return "none";
}

/**
 * When opener + directive share the same root intent, keep the more specific line only.
 * Deterministic; does not alter opener/directive selection upstream.
 */
function suppressControlOpenerDirectiveCollision(text: string): string {
  const endsWithQuestion = /\?\s*$/.test(text.trim());
  const parts = splitSentences(text);
  if (parts.length < 2) return text;

  const out: string[] = [];
  let i = 0;
  while (i < parts.length) {
    const cur = parts[i]!;
    const nxt = parts[i + 1];
    if (nxt === undefined) {
      out.push(cur);
      break;
    }
    const action = controlCollisionAction(normControlLine(cur), normControlLine(nxt));
    if (action === "drop_first") {
      i += 1;
      continue;
    }
    if (action === "drop_second") {
      out.push(cur);
      i += 2;
      continue;
    }
    out.push(cur);
    i += 1;
  }

  if (out.length === 0) return text.trim();

  const joined = out
    .map((s, idx) => {
      const core = s.replace(/[.!?]+$/, "").trim();
      const isLast = idx === out.length - 1;
      if (!isLast) return `${core}.`;
      return endsWithQuestion ? `${core}?` : `${core}.`;
    })
    .join(" ");

  return joined.replace(/\s+/g, " ").trim();
}

/**
 * Strip trailing meta-explanation from the last sentence so cost-of-inaction / directives land clean.
 */
function landCloserFinalSentence(text: string, pattern: PersuasionPattern): string {
  const endsWithQuestion = /\?\s*$/.test(text);
  const parts = splitSentences(text);
  if (parts.length === 0) return text;
  const li = parts.length - 1;
  let last = parts[li]!.trim();

  const stripFinale = () => {
    last = last
      .replace(/\s*—\s*(?:and )?that'?s (?:basically )?(?:why|the point)\b.*$/i, "")
      .replace(/,?\s*which (?:is )?why\b.*$/i, "")
      .replace(/,?\s*because that'?s\b.*$/i, "")
      .replace(/\s*—\s*in other words\b.*$/i, "");
  };

  if (pattern === "CONSEQUENCE" || pattern === "CONTROL") {
    stripFinale();
  } else if (pattern === "REFRAME") {
    last = last.replace(/\s*—\s*in other words\b.*$/i, "");
  }

  parts[li] = last.trim();
  let out = joinSentences(parts, 4).replace(/\s+/g, " ").trim();
  if (endsWithQuestion && out.endsWith(".")) out = `${out.slice(0, -1)}?`;
  return closerEdgeEnsureLeadCase(out);
}

/**
 * LIVE Step 5.1 + 5.2: final deterministic sharpness pass (after lexicon + cadence + fingerprint).
 * Step 5.2 adaptive entry runs after all Step 5.1 rules and `landCloserFinalSentence`.
 */
function normalizeCloserEdge(text: string, pattern: PersuasionPattern, input?: string): string {
  let t = text.replace(/\s+/g, " ").trim();
  if (!t) return t;

  // Phase 6.0: intent layer runs before rejection calibration and before edge rewrites (minimal question-close lines).
  const userMsgForIntent = input?.trim() ?? "";
  if (userMsgForIntent) {
    const convIntent = classifyConversationIntent(userMsgForIntent);
    if (
      convIntent === "REQUEST" ||
      convIntent === "HESITATION" ||
      convIntent === "STALL" ||
      convIntent === "COMPARISON"
    ) {
      return closerEdgeEnsureLeadCase(conversationIntentControlLine(convIntent));
    }
  }

  // --- Global: strip low-energy leads & meta framing ---
  t = t.replace(CLOSER_EDGE_LOW_ENERGY, "");
  t = t.replace(CLOSER_EDGE_ABSTRACT, "");
  t = t.replace(CLOSER_EDGE_WEAK_FINAL, "");

  // --- Global: hedging & filler ---
  t = t.replace(/\bkind of\b|\bsort of\b/gi, "");
  t = t.replace(/\bat that point\b/gi, "then");
  t = t.replace(/\bwhat this means is,?\s*/gi, "");
  t = t.replace(/\bthe goal is to\b/gi, "we need to");
  t = t.replace(/\bthe goal is\b/gi, "we need");
  t = t.replace(/\bthe idea is to\b/gi, "let's");
  t = t.replace(/\bthe idea is\b/gi, "");
  t = t.replace(/\bit could be a\b/gi, "it's a");
  t = t.replace(/\bit could be an\b/gi, "it's an");
  t = t.replace(/\bit may be\b/gi, "it's");
  t = t.replace(/\bit might be\b/gi, "it's");
  t = t.replace(/\bit may not\b/gi, "it doesn't");
  t = t.replace(/\bit might not\b/gi, "it doesn't");
  t = t.replace(/\bit may help to\b/gi, "we need to");
  t = t.replace(/\bit might help to\b/gi, "we need to");
  t = t.replace(/\bit could help to\b/gi, "we need to");
  t = t.replace(/\bwe may want to\b/gi, "we");
  t = t.replace(/\bwe might want to\b/gi, "we");
  t = t.replace(/\bit is important that\b/gi, "we need");
  t = t.replace(/\bit's important that\b/gi, "we need");
  t = t.replace(/\bthere needs to be\b/gi, "we need");
  t = t.replace(/\bit would be helpful if\b/gi, "we need");
  t = t.replace(/\bwe should probably\b/gi, "we");
  t = t.replace(/\bwe probably need to\b/gi, "we need to");
  t = t.replace(/\bLet'?s maybe\b/gi, "Let's");
  t = t.replace(/\bone way to look at it is\b/gi, "");
  t = t.replace(/\bin this scenario\b/gi, "here");
  t = t.replace(/\bfrom a structural (?:standpoint|perspective)\b/gi, "in your operation");
  t = t.replace(/\bone could argue that\b/gi, "");
  t = t.replace(/\bthe net effect is\b/gi, "you end up with");

  // --- Fingerprint-tuned ---
  if (pattern === "REFRAME") {
    t = t.replace(/^\s*Well,?\s+/i, "");
    t = t.replace(/^\s*So,?\s+/i, "");
    t = t.replace(/\bBasically,?\s+/gi, "");
    t = t.replace(/\bEssentially,?\s+/gi, "");
    t = t.replace(/\bSo,?\s+the real issue is\b/gi, "The real issue is");
    t = t.replace(/\bI think the real issue\b/gi, "The real issue");
    t = t.replace(/\bthe real issue is that\b/gi, "the real issue is");
    t = t.replace(/\bThat'?s the surface concern,?\s+and\s+/gi, "That's the surface concern. ");
    // Trim drag in the contrast tail (keep merchant-facing "you/your" when present).
    t = t.replace(/\b—\s*and\s+what that really (?:means|boils down to) is\b/gi, " — ");
    t = t.replace(/\bwhat that (?:really )?means is\b/gi, "");
  }

  if (pattern === "CONDITION") {
    t = t.replace(/\bI think we need\b/gi, "We need");
    t = t.replace(/\bI think you need\b/gi, "You need");
    t = t.replace(/\bBefore this makes sense,?\s+I think\b/gi, "Before this makes sense,");
    t = t.replace(/\bwe need to probably\b/gi, "we need to");
    t = t.replace(/\bBefore we (?:move|go|proceed),?\s+I think\b/gi, "Before we move,");
  }

  if (pattern === "CONSEQUENCE") {
    t = t.replace(/\b,?\s*which is why\b/gi, ".");
    t = t.replace(/\b,?\s*which means that\b/gi, ";");
    t = t.replace(/\band the reason is that\b/gi, "");
    t = t.replace(/\bif nothing changes,?\s+nothing improves,?\s+and\s+/gi, "If nothing changes, nothing improves. ");
  }

  if (pattern === "CONTROL") {
    t = t.replace(/,?\s*if you want to\b/gi, "");
    t = t.replace(/\bwhen you get a chance\b/gi, "now");
    t = t.replace(/\bwe can try to\b/gi, "we");
    t = t.replace(/\bplease consider\b/gi, "");
    t = t.replace(/\bfeel free to\b/gi, "");
    t = t.replace(/\byou might want to\b/gi, "you");
    t = t.replace(/\bif you'?re open to it,?\s*/gi, "");
    t = t.replace(/\s+,/g, ",");
    t = t.replace(/\s+\./g, ".");
  }

  t = t.replace(/\s*,\s*,/g, ",");
  t = t.replace(/\s*;\s*\./g, ".");
  t = t.replace(/\.\s*\./g, ".");
  t = t.replace(/\s{2,}/g, " ").trim();
  t = closerEdgeEnsureLeadCase(t);

  // Second pass: trim explanatory drag on sentence 2 (and shorten if overlong) without adding sentences.
  const endsWithQuestion = /\?\s*$/.test(t);
  const parts = splitSentences(t);
  if (parts.length >= 2 && pattern !== "CONTROL") {
    const maxLen = pattern === "REFRAME" ? 130 : pattern === "CONDITION" ? 125 : 130;
    const idx = 1;
    const orig = parts[idx]!;
    const dragRx =
      /\b(in order to|so that we can|the reason (?:for this )?is that|what that boils down to is|what we'?re really saying is)\b[^.]*$/i;
    let s = orig;
    let candidate = s.replace(dragRx, "").trim();
    if (candidate.length > 0 && candidate.length + 8 < s.length) s = candidate;
    if (s.length > maxLen) {
      candidate = s.replace(dragRx, "").trim();
      if (candidate.length + 5 < s.length) s = candidate;
    }
    if (s !== orig) {
      parts[idx] = s;
      t = joinSentences(parts, 4);
      if (endsWithQuestion && t.endsWith(".")) t = `${t.slice(0, -1)}?`;
      t = closerEdgeEnsureLeadCase(t.replace(/\s+/g, " ").trim());
    }
  }

  t = landCloserFinalSentence(t, pattern);
  t = t.replace(/\s{2,}/g, " ").replace(/\.\s*\./g, ".").trim();

  // --- Step 5.2: Adaptive entry (after Step 5.1; preserves landCloserFinalSentence + edge rules above) ---
  const userMsg = input ?? "";

  if (pattern === "CONTROL") {
    if (/\blet's isolate it\b/i.test(t)) {
      const chosen = selectControlOpener(t).trim();
      // Consume optional period after "isolate it" so we don't leave "opener.. directive" (double dot).
      t = t.replace(/\bLet'?s isolate it\.?\s*/i, `${chosen} `);
    }

    const pressureKind = userMsg ? classifyObjectionType(userMsg) : "hesitation";
    const trimmedForBridge = t.trim();
    const alreadyAcked =
      /^(that's fair|i hear that|that makes sense|i get why|you're weighing|sounds like)/i.test(trimmedForBridge) ||
      /\b(i get|fair to|makes sense to look at)\b/i.test(trimmedForBridge.slice(0, 220));
    const hard = userMsg && detectObjectionIntensity(userMsg) === "hard";
    const isRejectionKind = pressureKind === "rejection";
    // Short-template rejection: Step 5.4 applies HARD_BRIDGE + subtype (avoid double bridge here).
    const shortRejectionTemplate = userMsg && isRejectionKind && !isRichControlPreserve(trimmedForBridge);

    if (userMsg && !alreadyAcked && (hard || isRejectionKind)) {
      if (!(isRejectionKind && shortRejectionTemplate)) {
        const bridge = selectBridge(userMsg).replace(/\s+$/, "");
        const bridgeOut = bridge.endsWith(".") ? bridge : `${bridge}.`;
        t = `${bridgeOut} ${trimmedForBridge}`.replace(/\s+/g, " ").trim();
      }
    }
    t = closerEdgeEnsureLeadCase(t.replace(/\s+/g, " ").trim());
    t = suppressControlOpenerDirectiveCollision(t);
    t = closerEdgeEnsureLeadCase(t.replace(/\s+/g, " ").trim());
    // Step 5.3 + 5.4: pressure calibration (short-template CONTROL only; preserves rich typed lanes).
    t = applyControlPressureCalibration(t, userMsg);
    if (
      !isRichControlPreserve(t) &&
      splitSentences(t).length > 2 &&
      pressureKind !== "rejection"
    ) {
      t = trimControlToMaxTwoSentences(t);
    }
    t = closerEdgeEnsureLeadCase(t.replace(/\s+/g, " ").trim());
  }

  if (pattern === "REFRAME") {
    const trimmed = t.trim();
    if (trimmed && !trimmed.endsWith("?")) {
      const hasEngage = REFRAME_ENGAGE.some((q) =>
        trimmed.includes(q.replace(/\?$/, "").trim())
      );
      if (!hasEngage) {
        const q = REFRAME_ENGAGE[trimmed.length % REFRAME_ENGAGE.length]!;
        const parts = splitSentences(trimmed);
        if (parts.length >= 3) {
          const a = parts[0]!.replace(/[.!?]+$/, "").trim();
          const b = parts[1]!.replace(/[.!?]+$/, "").trim();
          t = `${a}. ${b}. ${q}`.replace(/\s+/g, " ").trim();
        } else {
          const base = trimmed.replace(/[.!?]+$/, "").trim();
          t = `${base}. ${q}`.replace(/\s+/g, " ").trim();
        }
        t = closerEdgeEnsureLeadCase(t.replace(/\s+/g, " ").trim());
      }
    }
  }

  return t.trim();
}

function normalizeCloserCadence(
  text: string,
  pattern: PersuasionPattern,
  ctx: CloserVoiceContext
): string {
  const rest = splitSentences(text).map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (rest.length === 0) return text.trim();

  const take = (pred: (s: string) => boolean): string | null => rest.find(pred) ?? null;

  // Remove cross-fingerprint sentences for CONTROL up front.
  const filteredForControl =
    pattern === "CONTROL"
      ? rest.filter((s) => !/\b(not the real decision|what matters is)\b/i.test(s))
      : rest;

  const pool = pattern === "CONTROL" ? filteredForControl : rest;

  const out: string[] = [];
  const first = pool[0] ?? "";

  if (pattern === "CONTROL") {
    const joined = pool.join(" ");
    const preserveReason =
      rest.length >= 3 ||
      /\bi get\b/i.test(joined) ||
      /\bthe decision is whether\b/i.test(joined) ||
      /\bfair to\b/i.test(joined) ||
      (/\bwhat matters is\b/i.test(joined) && rest.length >= 2);

    // Typed lanes (TRUST/CREDIT/TAX) and richer CONTROL bodies: keep substance; do not swap in the short template.
    if (preserveReason) {
      return joinSentences(filteredForControl, 4);
    }

    const hes = hasHesitationKeywords(ctx.userMessage);
    const longInput = ctx.userMessage.trim().length >= 140;
    const style: "isolate" | "direct" | "collab" = (() => {
      if (hes) return "collab";
      if (ctx.priorPattern === "REFRAME") return "isolate";
      if (ctx.priorPattern === "CONDITION") return "direct";
      if (longInput) return "isolate";
      return "direct";
    })();

    const lead = style === "direct" ? "Here's what we do" : "Let's isolate it";

    // 3 deterministic directive styles (isolate / collab / direct).
    const directive =
      style === "isolate"
        ? "What's the one gap"
        : style === "collab"
          ? "Walk me through the one gap"
          : "Name the one gap";
    const end = style === "direct" ? "." : "?";
    const body = `${lead.replace(/[.!?]+$/, "").trim()}. ${directive.trim()}${end}`.replace(/\s+/g, " ").trim();
    const ack = dualObjectionAckSentence(ctx.userMessage);
    return ack ? `${ack} ${body}` : body;
  }

  if (pattern === "REFRAME") {
    if (first.length <= 80) out.push(first);
    else out.push("That's the surface concern");
    const main =
      take((s) => /\b(the real issue is|surface concern|not the|whether)\b/i.test(s)) ??
      pool[1] ??
      first;
    if (main && main !== out[0]) out.push(main);
    // Prefer 2 sentences; only allow 3rd for clarification (question).
    const third = pool.find((s) => /\?\s*$/.test(s));
    if (third && out.length < 3) out.push(third);
    return joinSentences(out);
  }

  if (pattern === "CONDITION") {
    if (/^\s*(before|unless|only if)\b/i.test(first)) out.push(first);
    else out.push("Before this makes sense, we need one thing clear");
    const main =
      take((s) => /\b(before|unless|only if|need)\b/i.test(s)) ??
      pool[1] ??
      first;
    if (main && main !== out[0]) out.push(main);
    const third = pool.find((s) => /\?\s*$/.test(s));
    if (third && out.length < 3) out.push(third);
    return joinSentences(out);
  }

  // CONSEQUENCE
  if (/\b(if nothing changes|otherwise|if not|or else)\b/i.test(first)) out.push(first);
  else out.push("If nothing changes, nothing improves");
  const main =
    take((s) => /\b(if nothing changes|otherwise|if not|or else)\b/i.test(s)) ??
    pool[1] ??
    first;
  if (main && main !== out[0]) out.push(main);
  if (pool[2] && out.length < 3) out.push(pool[2]);
  return joinSentences(out);
}

function normalizeCloserVoice(text: string, pattern: PersuasionPattern, ctx: CloserVoiceContext): string {
  let t = text.replace(/\s+/g, " ").trim();
  if (!t) return t;

  // Clean known punctuation artifacts first.
  t = t
    .replace(/—\s*,\s*/g, "— ")
    .replace(/\s+,/g, ",")
    .replace(/\s+—/g, " —")
    .replace(/,\s*—/g, " —");

  t = normalizeCloserLexicon(t, pattern);
  t = normalizeCloserCadence(t, pattern, ctx);

  // Final cleanup.
  t = t
    .replace(/—\s*[.!?]\s*$/g, ".")
    .replace(/—\s*$/g, "")
    .replace(/\s+\./g, ".")
    .replace(/\s+/g, " ")
    .trim();
  if (t && !/[.!?]$/.test(t)) t = `${t}.`;

  t = normalizeCloserEdge(t, pattern, ctx.userMessage);
  if (t && !/[.!?]$/.test(t)) t = `${t}.`;

  return t;
}

function stripDirectiveLanguage(text: string): string {
  let t = text;
  t = t.replace(/\bhere'?s\s+what\s+we\s+do\s+next\b\s*:?\s*/gi, "");
  return t.replace(/\s+/g, " ").trim();
}

function stripPressureLanguage(text: string): string {
  return text.replace(/\b(otherwise|if\s+not|or\s+else|before that|so we can)\b/gi, "").replace(/\s+/g, " ").trim();
}

function splitSentences(text: string): string[] {
  return text
    .split(/[.?!]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function joinSentences(sentences: string[], maxSentences = 3): string {
  const kept = sentences.map((s) => s.replace(/[.!?]+$/, "").trim()).filter(Boolean);
  if (kept.length === 0) return "";
  return `${kept.slice(0, maxSentences).join(". ")}.`;
}

/**
 * LIVE: enforce a single dominant "fingerprint" per pattern by stripping cross-pattern cues.
 * This is deterministic and only rewrites text; it does not affect routing or selection.
 */
export function enforceFingerprintShape(text: string, pattern: PersuasionPattern): string {
  let t = text.replace(/\s+/g, " ").trim();
  if (!t) return t;

  // Always normalize any repeated whitespace after removals.
  const original = t;

  const sentences = splitSentences(t);

  switch (pattern) {
    case "REFRAME": {
      // Remove directive language; keep contrast framing dominant.
      const filtered = sentences.filter((s) => !/\bhere'?s\s+what\s+we\s+do\s+next\b/i.test(s));
      t = joinSentences(filtered);
      t = stripDirectiveLanguage(t);
      // Remove pressure/consequence cues so REFRAME stays a single dominant move.
      t = stripPressureLanguage(t)
        .replace(/—\s*,\s*/g, "— ")
        .replace(/\s+,/g, ",")
        .replace(/\s+/g, " ")
        .trim();
      // Ensure we still have contrast framing; if not, keep original (tone layer should handle).
      if (!/\bit'?s\s+not\b/i.test(t) && !/\bnot\s+the\b/i.test(t) && !/\bwhat\s+matters\b/i.test(t)) {
        return original;
      }
      return t.replace(/\s+/g, " ").trim();
    }
    case "CONDITION": {
      // Strip directive tone while preserving gating.
      const filtered = sentences.filter((s) => !/\bhere'?s\s+what\s+we\s+do\s+next\b/i.test(s));
      t = joinSentences(filtered);
      t = stripDirectiveLanguage(t);
      // Keep gating cues; if we lost them, fall back.
      if (!/\b(before|unless|only if|has to be true|need)\b/i.test(t)) return original;
      return t.replace(/\s+/g, " ").trim();
    }
    case "CONSEQUENCE": {
      // Strip directive tone; keep "otherwise/if not" outcome pressure dominant.
      const filtered = sentences.filter((s) => !/\bhere'?s\s+what\s+we\s+do\s+next\b/i.test(s));
      t = joinSentences(filtered);
      t = stripDirectiveLanguage(t);
      // Ensure consequence cue exists; if not, fall back.
      if (!/\b(otherwise|if\s+not|or\s+else)\b/i.test(t)) return original;
      return t.replace(/\s+/g, " ").trim();
    }
    case "CONTROL": {
      // Remove consequence/pressure language to keep directive dominant.
      const filtered = sentences.filter((s) => !/\b(otherwise|if\s+not|or\s+else)\b/i.test(s));
      t = joinSentences(filtered);
      t = stripPressureLanguage(t);
      // Remove analytical framing that belongs to non-CONTROL patterns.
      t = t
        // Keep directive tail after an em dash (common pattern: "The decision is whether ... — do X").
        .replace(
          /\b(the decision is whether|it comes down to whether|what matters is whether|the real question is whether)\b[^—]{0,220}—\s*/gi,
          ""
        )
        .replace(
          /\b(the decision is whether|it comes down to whether|what matters is whether|the real question is whether)\b[^.?!]*[.?!]?/gi,
          ""
        )
        .replace(/\bbut that's not the real decision\b[^.?!]*[.?!]?/gi, "")
        .replace(/\s+/g, " ")
        .trim();
      // Ensure directive is present; if missing, fall back (tone layer should add).
      // Accept "Here's what we do" (lexicon-normalized) or "Here's what we do next".
      if (!/\bhere'?s\s+what\s+we\s+do(?:\s+next)?\b/i.test(t)) return original;
      return t.replace(/\s+/g, " ").trim();
    }
    default: {
      const _exhaustive: never = pattern;
      return _exhaustive;
    }
  }
}

function hasDoubleDecisionPhrase(text: string): boolean {
  const m = text.match(/\bthe decision is whether\b/gi);
  return (m?.length ?? 0) >= 2;
}

function varyDecisionPhraseOnce(text: string): string {
  // Only for GENERAL / ADVISORY / PRICE branches (not CREDIT/TAX templates).
  if (!hasDoubleDecisionPhrase(text)) return text;
  // Replace the first occurrence only.
  return text.replace(/\bthe decision is whether\b/i, "It comes down to whether");
}

function looksLikeSystemLeak(text: string): boolean {
  const t = text.toLowerCase();
  if (t.includes("want a one-liner")) return true;
  if (t.includes("saved deal")) return true;
  if (/\byour factor\b/.test(t)) return true;
  if (/\bdeal context\b/.test(t)) return true;
  if (/\bmodeled equal (daily|weekly) payment\b/.test(t)) return true;
  // Pure metric dumps: $/%, per-day/per-week without any control framing.
  const hasNumbers = /[$\d]\s*\d|\b\d+(\.\d+)?%|\b\/(day|week)\b/i.test(t);
  const hasControl = /(position|control|improve|decision|what matters|real question|comes down to)/i.test(
    text
  );
  if (hasNumbers && !hasControl) return true;
  return false;
}

function guardDecisionCadence(text: string): string {
  // Normalize split cadence across punctuation/newlines/spaces:
  // - "decision what matters"
  // - "decision. what matters"
  // - "decision\nwhat matters"
  // - "decision\r\nwhat matters"
  //
  // Examples:
  // Input:  "… decision what matters is …"
  // Output: "… decision — what matters is …"
  // Input:  "… decision.\nwhat matters is …"
  // Output: "… decision — what matters is …"
  let t = text.replace(
    /decision(?:\s*[\.\n\r]+\s*|\s+)what matters/gi,
    "decision — what matters"
  );

  // Defensive merge if "what matters is" starts a new sentence/line after "decision".
  t = t.replace(
    /decision\s*[\.\n\r]+\s*(what matters is)/gi,
    "decision — $1"
  );

  return t.replace(/[ \t]{2,}/g, " ").trim();
}

function normalizeOpening(text: string): string {
  let t = text
    .trim()
    .replace(/^the credit impact/i, "The credit impact")
    .replace(/^the risk perception/i, "The concern you've heard")
    .replace(/^the tax treatment/i, "The tax treatment")
    .replace(/^the price/i, "The number");

  if (!t) return t;

  // Ensure first letter is capitalized.
  t = t[0]!.toUpperCase() + t.slice(1);

  // Ensure grammatically complete sentence ending.
  if (!/[.!?]$/.test(t)) t = `${t}.`;
  return t;
}

function removePressureConcepts(text: string): string {
  return text
    .replace(/exposing you every week/gi, "")
    .replace(/hurting you every week/gi, "")
    .replace(/costing you every week/gi, "")
    .replace(/dragging.*weekly/gi, "")
    // Global pressure-language bans (must never appear)
    .replace(/squeezing/gi, "")
    .replace(/dragging/gi, "")
    .replace(/bleeding/gi, "")
    .replace(/chewing/gi, "")
    .replace(/hitting.*weekly/gi, "");
}

/** Key phrase from the merchant's words — anchors LIVE opening to the actual objection. */
export function extractObjectionAnchor(message: string): string | null {
  const lower = message.toLowerCase();

  if (lower.includes("accountant")) return "your accountant's concern";
  if (lower.includes("not deductible")) return "the tax treatment";
  if (lower.includes("predatory") || lower.includes("trapped"))
    return "the risk perception";
  if (lower.includes("credit") || /\bhard\s+pull\b/.test(lower))
    return "the credit impact";

  return null;
}

export function detectObjectionType(
  message: string
): "TRUST" | "PRICE" | "CREDIT" | "TAX" | "GENERAL" {
  const lower = message.toLowerCase();

  if (
    lower.includes("trust") ||
    lower.includes("predatory") ||
    lower.includes("trap")
  ) {
    return "TRUST";
  }
  if (
    lower.includes("rate") ||
    lower.includes("factor") ||
    lower.includes("too high") ||
    lower.includes("expensive") ||
    /\btoo\s+expensive\b/i.test(lower) ||
    /\bcosts?\s+too\s+much\b/i.test(lower)
  ) {
    return "PRICE";
  }
  // Narrow CREDIT: require inquiry/impact language, not plain "credit" alone.
  const creditHasImpact =
    /\bhard pull(s)?\b/i.test(lower) ||
    /\b(hit|hurt|affect|impact)\s+my\s+credit\b/i.test(lower) ||
    /\bcredit\s+(check|inquiry|inquiries)\b/i.test(lower) ||
    /\binquiry\b/i.test(lower);
  if (creditHasImpact) return "CREDIT";
  if (
    lower.includes("accountant") ||
    lower.includes("deductible") ||
    lower.includes("tax")
  ) {
    return "TAX";
  }

  return "GENERAL";
}

export function injectAssertion(text: string): string {
  if (
    /i[’']d|i would|i wouldn[’']t|here[’']s how i[’']d look at it/i.test(text)
  ) {
    return text;
  }
  return `Here's how I'd look at it — ${text}`;
}

function dropAssertionPrefix(text: string): string {
  return text.replace(/^\s*here['’]s how i['’]d look at it\s*[—-]\s*/i, "");
}

function userMessageLooksSpecific(lower: string): boolean {
  return /\baccountant|credit|deductible|predatory|trapped|hard pull|mca|not deductible\b/i.test(
    lower
  );
}

function hasGenericCashFlowPhrases(text: string): boolean {
  return /that payment keeps dragging|keeps hitting your cash flow|keeps costing you every week/i.test(
    text
  );
}

/** Remove generic cash-flow filler sentences when the objection is specific. */
function stripGenericCashFlowPhrases(text: string): string {
  const chunks = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const kept = chunks.filter((s) => {
    const x = s.toLowerCase();
    if (/that payment keeps dragging|keeps hitting your cash flow|keeps costing you every week/i.test(x))
      return false;
    return true;
  });
  return kept.join(" ").trim();
}

function replaceSoftControlQuestions(text: string): string {
  // LIVE validators forbid question marks; keep as a control statement.
  return text.replace(
    /\bwhat specific concerns are holding you back\??/gi,
    "The question is what would need to change for you to feel comfortable moving forward."
  );
}

function stripWrongLanguageForType(
  objectionType: ReturnType<typeof detectObjectionType>,
  text: string
): string {
  let t = text;

  // Kill generic defaults completely when type is known.
  if (objectionType !== "GENERAL") {
    t = t.replace(
      /that payment keeps dragging|keeps hitting your cash flow|keeps costing you(?: every week)?/gi,
      ""
    );
  }

  if (objectionType === "TRUST") {
    t = t.replace(/\bcash\s*flow\b/gi, "");
    t = t.replace(/\bpayment pressure\b/gi, "");
    t = t.replace(/\bdaily payment\b/gi, "");
  }

  if (objectionType === "CREDIT") {
    t = t.replace(/\bcash\s*flow\b/gi, "");
    t = t.replace(/\bpayment pressure\b/gi, "");
    t = t.replace(/\bdaily payment\b/gi, "");
    t = t.replace(/\bif nothing changes\b/gi, "");
    t = t.replace(/\bsame (pressure|squeeze)\b/gi, "");
  }

  return t.replace(/\s{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function forcedTypeOpening(
  objectionType: ReturnType<typeof detectObjectionType>
): string | null {
  switch (objectionType) {
    case "TRUST":
      return "The concern you've heard makes sense — but the real issue is whether this structure puts you in control or not.";
    case "CREDIT":
      return "The real question isn't the inquiry — it's what position this capital puts you in.";
    case "PRICE":
      return "Looking at the number alone doesn't tell you whether the deal actually works for you.";
    case "TAX":
      return "Your accountant is looking at tax treatment — but that's not what determines if this helps your business.";
    default:
      return null;
  }
}

function forcedDecisionFrame(
  objectionType: ReturnType<typeof detectObjectionType>
): string | null {
  switch (objectionType) {
    case "TRUST":
      return "The decision is whether this gives you more control or keeps you in the same position.";
    case "PRICE":
      return "The decision is whether the structure improves your position, not just the headline number.";
    case "CREDIT":
      return "The decision is whether this capital improves your position fast enough to justify the inquiry.";
    case "TAX":
      return "The decision is whether the structure improves the business outcome, regardless of the tax treatment.";
    default:
      return null;
  }
}

function applyAnchorLead(anchor: string, body: string): string {
  const lead = `${anchor} makes sense to look at — but that's not the real decision here.`;
  const b = body.trim();
  if (!b) return lead;
  if (/\bmakes sense to look at\b/i.test(b) && /\bnot the real decision\b/i.test(b)) {
    return b;
  }
  return `${lead}\n\n${b}`;
}

/**
 * LIVE-only: anchor to objection text, strip generic fallback, inject judgment, tighten control questions.
 */
export function applyLiveResponseRefinement(
  sr: AssistantStructuredReply,
  userMessage: string,
  patternContext: PatternContext = {},
  onPatternDebug?: (m: LivePatternDebugMeta) => void
): AssistantStructuredReply {
  const raw = sr.rebuttals?.[0]?.sayThis?.trim() ?? "";
  if (!raw) return sr;

  const priorPattern: PersuasionPattern | null =
    patternContext.lastPatternUsed ?? null;

  const lower = userMessage.toLowerCase();
  const objectionType = detectObjectionType(userMessage);
  const anchor = extractObjectionAnchor(userMessage);

  // PRICE is a hard override: ignore model text completely (no exceptions).
  if (objectionType === "PRICE") {
    const subtype = detectPriceSubtype(userMessage);
    const s1 =
      subtype === "BANK_COMPARISON"
        ? "Your bank's number isn't the decision — what matters is whether this structure actually improves your position."
        : subtype === "NEGOTIATE"
          ? "We can talk numbers, but the number by itself isn't the decision — what matters is whether the structure actually improves your position."
          : subtype === "JUSTIFY"
            ? "If your revenue is solid, the question isn't the headline number — it's whether the structure actually improves your position."
            : "Looking at the number by itself doesn't tell you if this works — what matters is whether the structure actually improves your position.";
    const s2 =
      subtype === "NEGOTIATE"
        ? "The decision is whether the structure puts you in a stronger spot — then we tighten the number inside that structure."
        : "The decision is whether this puts you in a stronger spot — not just what it costs on paper.";
    let out = `${s1} ${s2}`;
    out = removePressureConcepts(out).replace(/\s+/g, " ").trim();
    out = normalizeOpening(out);
    const pricePattern = pricePrimaryPattern(subtype);
    const beforeTone = out;
    out = enforcePatternTone(out, pricePattern);
    const toneApplied = out !== beforeTone;
    const beforePressure = out;
    out = enforceDecisionPressure(out, pricePattern);
    const pressureApplied = out !== beforePressure;
    out = injectDualObjectionAck(out, userMessage);
    out = enforceFingerprintShape(out, pricePattern);
    out = normalizeCloserVoice(out, pricePattern, { userMessage, priorPattern });
    const outFamily = applyFinalFamilyEnforcement(out, userMessage, objectionType, null);
    onPatternDebug?.({
      objectionType,
      liveGeneralSubtype: `PRICE_${subtype}`,
      lastPatternUsed: priorPattern,
      selectedPattern: pricePattern,
      candidateVariantCount: 1,
      effectivePoolCount: 1,
      antiRepeatFilterApplied: false,
      chosenVariantPrimaryPattern: pricePattern,
      chosenVariantFirstLine: null,
      openerApplied: false,
      enforcePatternToneApplied: toneApplied,
      enforceDecisionPressureApplied: pressureApplied,
      finalSayThis: outFamily,
    });
    return attachPatternFields(
      {
        ...sr,
        rebuttals: [
          {
            title: sr.rebuttals?.[0]?.title?.trim() || "Opening",
            sayThis: outFamily,
            support: sr.rebuttals?.[0]?.support ?? null,
          },
        ],
      },
      pricePattern,
      priorPattern
    );
  }

  // ADVISORY / ACCEPTANCE: deterministic broker judgment (no generic pressure loop).
  const jk = detectLiveJudgmentQuestion(userMessage);
  if (jk) {
    const s1 =
      jk === "ADVISORY"
        ? "I'd judge it off whether the structure actually improves your position or just reshuffles the problem."
        : "I'd only take it if the structure improves your position, not if it just buys time.";
    const s2 =
      "What matters is what this capital lets you fix or unlock immediately, and whether the payback cadence fits your reality.";
    const s3 =
      "The decision is whether the structure puts you in a stronger spot — if it doesn't, we change the structure before you move.";
    let out = `${s1} ${s2} ${s3}`;
    out = normalizeSentenceBoundaries(out);
    out = guardDecisionCadence(out);
    out = removePressureConcepts(out).replace(/\s+/g, " ").trim();
    out = compressResponse(out);
    out = varyDecisionPhraseOnce(out);
    out = normalizeOpening(out);
    let advisoryPattern: PersuasionPattern = "CONDITION";
    if (looksLikeSystemLeak(out)) {
      out =
        "I'm not going to answer this like a calculator or a system readout. What matters is whether the structure improves your position. Tell me what part feels off — the structure, or how it's being explained.";
      out = normalizeSentenceBoundaries(out);
      out = guardDecisionCadence(out);
      out = removePressureConcepts(out).replace(/\s+/g, " ").trim();
      out = compressResponse(out);
      out = normalizeOpening(out);
      advisoryPattern = "CONTROL";
    }
    const beforeTone = out;
    out = enforcePatternTone(out, advisoryPattern);
    const toneApplied = out !== beforeTone;
    const beforePressure = out;
    out = enforceDecisionPressure(out, advisoryPattern);
    const pressureApplied = out !== beforePressure;
    out = injectDualObjectionAck(out, userMessage);
    out = enforceFingerprintShape(out, advisoryPattern);
    out = normalizeCloserVoice(out, advisoryPattern, { userMessage, priorPattern });
    const outAdvFamily = applyFinalFamilyEnforcement(out, userMessage, objectionType, null);
    onPatternDebug?.({
      objectionType,
      liveGeneralSubtype: jk === "ADVISORY" ? "LIVE_ADVISORY" : "LIVE_ACCEPTANCE",
      lastPatternUsed: priorPattern,
      selectedPattern: advisoryPattern,
      candidateVariantCount: 1,
      effectivePoolCount: 1,
      antiRepeatFilterApplied: false,
      chosenVariantPrimaryPattern: advisoryPattern,
      chosenVariantFirstLine: null,
      openerApplied: false,
      enforcePatternToneApplied: toneApplied,
      enforceDecisionPressureApplied: pressureApplied,
      finalSayThis: outAdvFamily,
    });
    return attachPatternFields(
      {
        ...sr,
        rebuttals: [
          {
            title: sr.rebuttals?.[0]?.title?.trim() || "Opening",
            sayThis: outAdvFamily,
            support: sr.rebuttals?.[0]?.support ?? null,
          },
        ],
      },
      advisoryPattern,
      priorPattern
    );
  }

  // GENERAL: subtype-driven control scripts (no payment-loop filler).
  if (objectionType === "GENERAL") {
    // Price-justification questions sometimes come through without rate/factor keywords.
    // Handle safely here without changing objection-type selection logic.
    const g = userMessage.toLowerCase();
    if (/\bwhy\b/.test(g) && /\bhigh\b/.test(g) && /\brevenue\b/.test(g)) {
      const s1 = normalizeOpening(
        "If your revenue is solid, the question isn't the headline number — it's whether the structure actually improves your position."
      );
      const s2 = normalizeOpening(
        "The decision is whether this puts you in a stronger spot — not just what it costs on paper."
      );
      let out = `${s1} ${s2}`.trim();
      out = normalizeSentenceBoundaries(out);
      out = guardDecisionCadence(out);
      out = removePressureConcepts(out).replace(/\s+/g, " ").trim();
      out = compressResponse(out);
      out = normalizeOpening(out);
      const beforeTone = out;
      out = enforcePatternTone(out, "REFRAME");
      const toneApplied = out !== beforeTone;
      const beforePressure = out;
      out = enforceDecisionPressure(out, "REFRAME");
      const pressureApplied = out !== beforePressure;
      out = injectDualObjectionAck(out, userMessage);
      out = enforceFingerprintShape(out, "REFRAME");
      out = normalizeCloserVoice(out, "REFRAME", { userMessage, priorPattern });
      const outPjFamily = applyFinalFamilyEnforcement(
        out,
        userMessage,
        objectionType,
        "GENERAL_PRICE_JUSTIFY_SHORTCUT"
      );
      onPatternDebug?.({
        objectionType,
        liveGeneralSubtype: "GENERAL_PRICE_JUSTIFY_SHORTCUT",
        lastPatternUsed: priorPattern,
        selectedPattern: "REFRAME",
        candidateVariantCount: 1,
        effectivePoolCount: 1,
        antiRepeatFilterApplied: false,
        chosenVariantPrimaryPattern: "REFRAME",
        chosenVariantFirstLine: null,
        openerApplied: false,
        enforcePatternToneApplied: toneApplied,
        enforceDecisionPressureApplied: pressureApplied,
        finalSayThis: outPjFamily,
      });
      return attachPatternFields(
        {
          ...sr,
          rebuttals: [
            {
              title: sr.rebuttals?.[0]?.title?.trim() || "Opening",
              sayThis: outPjFamily,
              support: sr.rebuttals?.[0]?.support ?? null,
            },
          ],
        },
        "REFRAME",
        priorPattern
      );
    }
    const sub = detectGeneralSubtype(userMessage);
    const variants = sub
      ? patternedVariantsForGeneralSubtype(sub)
      : generalUnmatchedVariants();
    const subKey = sub ?? "GENERAL_UNMATCHED";
    const { variant, meta } = choosePatternedVariant(
      userMessage,
      subKey,
      variants,
      {
        ...patternContext,
        patternSeedInput: subKey,
      }
    );
    const lines = variant.lines;
    const opener = sub ? generalSubtypeOpener(sub) : "";
    let out = [opener, ...lines].map((x) => x.trim()).filter(Boolean).join(" ");
    out = normalizeSentenceBoundaries(out);
    out = guardDecisionCadence(out);
    out = removePressureConcepts(out).replace(/\s+/g, " ").trim();
    out = compressResponse(out);
    out = varyDecisionPhraseOnce(out);
    out = normalizeOpening(out);
    let generalPattern: PersuasionPattern = variant.primaryPattern;
    if (looksLikeSystemLeak(out)) {
      out =
        "I'm not going to answer this like a calculator. What matters is what still has to be true for this to be a yes. Tell me the one thing that's unclear and I'll make it plain.";
      out = normalizeSentenceBoundaries(out);
      out = guardDecisionCadence(out);
      out = removePressureConcepts(out).replace(/\s+/g, " ").trim();
      out = compressResponse(out);
      out = normalizeOpening(out);
      generalPattern = "CONTROL";
    }
    const beforeTone = out;
    out = enforcePatternTone(out, generalPattern);
    const toneApplied = out !== beforeTone;
    const beforePressure = out;
    out = enforceDecisionPressure(out, generalPattern);
    const pressureApplied = out !== beforePressure;
    out = injectDualObjectionAck(out, userMessage);
    out = enforceFingerprintShape(out, generalPattern);
    out = normalizeCloserVoice(out, generalPattern, { userMessage, priorPattern: meta.lastPatternUsed });
    const outGenFamily = applyFinalFamilyEnforcement(out, userMessage, objectionType, sub);
    onPatternDebug?.({
      objectionType,
      liveGeneralSubtype: sub,
      lastPatternUsed: meta.lastPatternUsed,
      selectedPattern: generalPattern,
      candidateVariantCount: meta.candidateVariantCount,
      effectivePoolCount: meta.effectivePoolCount,
      antiRepeatFilterApplied: meta.antiRepeatFilterApplied,
      chosenVariantPrimaryPattern: variant.primaryPattern,
      chosenVariantFirstLine: variant.lines?.[0] ?? null,
      openerApplied: sub != null,
      enforcePatternToneApplied: toneApplied,
      enforceDecisionPressureApplied: pressureApplied,
      finalSayThis: outGenFamily,
    });
    return attachPatternFields(
      {
        ...sr,
        rebuttals: [
          {
            title: sr.rebuttals?.[0]?.title?.trim() || "Opening",
            sayThis: outGenFamily,
            support: sr.rebuttals?.[0]?.support ?? null,
          },
        ],
      },
      generalPattern,
      priorPattern
    );
  }

  let t = purgeGenericDefaults(raw).trim();
  if (!t) t = raw;

  if (hasGenericCashFlowPhrases(t) && userMessageLooksSpecific(lower) && anchor) {
    t = stripGenericCashFlowPhrases(t);
    if (!t.trim()) {
      t = raw;
    }
  }

  t = stripWrongLanguageForType(objectionType, t);

  // Remove concept-level weekly pressure loops before any final shaping.
  t = removePressureConcepts(t).trim();

  const forcedOpen = forcedTypeOpening(objectionType);
  if (forcedOpen) {
    const body = t.replace(/\s+/g, " ").trim();
    t = `${forcedOpen}\n\n${body}`.trim();
  }

  if (anchor) {
    t = applyAnchorLead(anchor, t);
    t = dropAssertionPrefix(t);
  }

  t = replaceSoftControlQuestions(t);
  if (!anchor) {
    t = injectAssertion(t);
  }

  const decision = forcedDecisionFrame(objectionType);
  if (decision && !/\bthe decision is whether\b/i.test(t)) {
    t = `${t.trim()} ${decision}`.trim();
  }

  // Output precision override for non-general objections:
  // enforce clean 2–3 sentence structure with control framing and decision.
  if (objectionType === "CREDIT") {
    const s1 = normalizeOpening("It's fair to look at the credit impact.");
    const s2 = normalizeOpening(
      "But that's not the real decision — what matters is what position this capital puts you in."
    );
    const s3 = normalizeOpening(
      "The decision is whether this improves your position fast enough to justify moving forward."
    );
    const sentences = [s1.trim(), s2.trim(), s3.trim()].filter(Boolean);
    t = sentences.join(" ");
  } else if (objectionType === "TRUST") {
    const s1 = normalizeOpening("I get why that concern is there.");
    const s2 = normalizeOpening(
      "But that's not the real decision — what matters is whether this structure puts you in control or not."
    );
    const s3 = normalizeOpening(
      "The decision is whether this gives you more control or keeps you in the same position."
    );
    const sentences = [s1.trim(), s2.trim(), s3.trim()].filter(Boolean);
    t = sentences.join(" ");
  } else if (objectionType === "TAX") {
    const s1 = normalizeOpening("Your accountant is looking at the tax side, which is fair.");
    const s2 = normalizeOpening(
      "But that's not the real decision — what matters is whether the structure puts you in control operationally, not how it's labeled."
    );
    const s3 = normalizeOpening(
      "The decision is whether the structure improves the business outcome, regardless of the tax treatment."
    );
    const sentences = [s1.trim(), s2.trim(), s3.trim()].filter(Boolean);
    t = sentences.join(" ");
  } else {
    t = compressResponse(t.replace(/\s+/g, " ").trim());
  }

  // Final safeguard: purge pressure concepts again and compress to <= 3 sentences.
  t = compressResponse(removePressureConcepts(t).replace(/\s+/g, " ").trim());
  t = guardDecisionCadence(t);

  // Sentence-count validation: ensure 2–3 sentences.
  const parts = t
    .split(/[.?!]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length > 3) {
    t = `${parts.slice(0, 3).join(". ")}.`.trim();
  } else if (parts.length < 2) {
    const decision = forcedDecisionFrame(objectionType);
    if (decision) {
      t = `${t.replace(/[.!?]+$/, "").trim()}. ${decision}`.trim();
    }
  }

  // Final sanity check: capitalization, terminal period, no banned words, control framing present.
  t = t.replace(/\s+/g, " ").trim();
  if (t) {
    t = t[0]!.toUpperCase() + t.slice(1);
    if (!t.endsWith(".")) t = `${t}.`;
  }
  t = removePressureConcepts(t).replace(/\s+/g, " ").trim();
  t = guardDecisionCadence(t);
  if (!/(position|control|improve)/i.test(t)) {
    const fallbackDecision =
      forcedDecisionFrame(objectionType) ??
      "The decision is whether this improves your position or keeps you in the same spot.";
    t = compressResponse(`${t.replace(/[.!?]+$/, "").trim()}. ${fallbackDecision}`.trim());
  }

  // Apply cadence guard immediately before returning (final pass).
  t = normalizeSentenceBoundaries(t);
  t = guardDecisionCadence(t);
  t = normalizeSentenceBoundaries(t);
  t = removePressureConcepts(t).replace(/\s+/g, " ").trim();
  if (t) {
    t = t[0]!.toUpperCase() + t.slice(1);
    if (!t.endsWith(".")) t = `${t}.`;
  }

  const typedTailPattern: PersuasionPattern =
    objectionType === "CREDIT"
      ? "CONTROL"
      : objectionType === "TRUST"
        ? "CONTROL"
        : objectionType === "TAX"
          ? "REFRAME"
          : "CONTROL";

  const beforeTone = t;
  t = enforcePatternTone(t, typedTailPattern);
  const toneApplied = t !== beforeTone;
  const beforePressure = t;
  t = enforceDecisionPressure(t, typedTailPattern);
  const pressureApplied = t !== beforePressure;
  t = injectDualObjectionAck(t, userMessage);
  t = enforceFingerprintShape(t, typedTailPattern);
  t = normalizeCloserVoice(t, typedTailPattern, { userMessage, priorPattern });
  const tFamily = applyFinalFamilyEnforcement(t, userMessage, objectionType, null);
  onPatternDebug?.({
    objectionType,
    liveGeneralSubtype: `TYPED_${objectionType}`,
    lastPatternUsed: priorPattern,
    selectedPattern: typedTailPattern,
    candidateVariantCount: 1,
    effectivePoolCount: 1,
    antiRepeatFilterApplied: false,
    chosenVariantPrimaryPattern: typedTailPattern,
    chosenVariantFirstLine: null,
    openerApplied: false,
    enforcePatternToneApplied: toneApplied,
    enforceDecisionPressureApplied: pressureApplied,
    finalSayThis: tFamily,
  });

  return attachPatternFields(
    {
      ...sr,
      rebuttals: [
        {
          title: sr.rebuttals?.[0]?.title?.trim() || "Opening",
          sayThis: tFamily,
          support: sr.rebuttals?.[0]?.support ?? null,
        },
      ],
    },
    typedTailPattern,
    priorPattern
  );
}
