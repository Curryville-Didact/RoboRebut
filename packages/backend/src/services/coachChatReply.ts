/**
 * coachChatReply.ts — PRODUCTION / LIVE APP path for in-app conversation AI replies.
 *
 * Called from `routes/messages.ts` (`POST /api/messages`) only. This is the source of truth
 * for live coaching: deal context, pattern selection (incl. Phase 4.4 ranking), tone gating,
 * usage, and pattern analytics emission for the dashboard thread.
 *
 * Not used by: `GET /ws` demo handler, `runObjectionPipeline`, `/api/rebuttal`, `/api/regenerate`.
 *
 * Model priority (live coach):
 *   - If OPENAI_API_KEY is set: direct OpenAI only (gateway skipped — baseline until OpenClaw model IDs are configured).
 *   - Else if gateway credentials exist: OpenClaw Gateway first, then direct if key is added later.
 *   - Else: placeholder string when no route works.
 *   Direct path: `fetch` to `https://api.openai.com/v1/chat/completions` (no `openai` npm SDK).
 *
 * The gateway exposes an OpenAI-compatible /v1/chat/completions endpoint.
 * Model: OPENCLAW_CHAT_MODEL env var, or "openclaw/gtm-offer" by default.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { ClientContext } from "../types/clientContext.js";
import {
  type DealContext,
  isLineOfCreditContext,
  isMcaContext,
} from "../types/dealContext.js";
import {
  formatAuthoritativeMcaBlock,
  resolveCanonicalMcaFacts,
  type CanonicalMcaFacts,
} from "./canonicalMcaDeal.js";
import {
  AUTHORITATIVE_LOC_GROUNDING,
  formatAuthoritativeLocBlock,
  resolveCanonicalLocFacts,
  type CanonicalLocFacts,
} from "./canonicalLocDeal.js";
import {
  isDirectLocDealQuestion,
  locDirectObjectionCategorySlug,
  tryAnswerDirectLocQuestion,
} from "./directLocDealQuestion.js";
import {
  isDirectMcaDealQuestion,
  tryAnswerDirectMcaQuestion,
} from "./directMcaDealQuestion.js";
import {
  buildClientContextInsight,
  buildClientContextInsightCompressed,
} from "./clientContextInsight.js";
import { buildDealInsight } from "./dealInsightBuilder.js";
import {
  type DealCoachingPosture,
  getDealCoachingGuidance,
  postureSystemInstructions,
  strategyTagForPosture,
} from "./dealCoachingPosture.js";
import type { ObjectionResponsePattern } from "./objectionResponsePattern.js";
import {
  confidenceAlignmentInstructions,
  formatConfidenceStyleBlock,
  formatResponsePatternBlock,
  inferObjectionCategoryFromMessage,
  normalizeObjectionCategory,
  resolveObjectionResponsePatternWithSelection,
  responsePatternAlignmentInstructions,
} from "./objectionResponsePattern.js";
import type {
  PatternCandidate,
  ScoredPatternCandidate,
} from "./patternPreference.js";
import { defaultPatternStatsProvider } from "./patternPreference.js";
import {
  buildBaseFingerprint as buildBaseFingerprintV44,
  extractCallReadyText,
  getRecentPatternIntelEvents,
  responseSignature,
} from "./patternIntelligence.js";
import {
  buildPatternInsightsPayload,
  type PatternInsightsPayload,
} from "./patternInsight.js";
import { resolveDealCalculation } from "./resolveDealCalculator.js";
import {
  createPatternStatsProvider,
  recordPatternGeneratedFromAnalyticsEvent,
} from "./patternPerformanceStore.js";
import {
  buildPatternKey,
  eventFromPayload,
  logPatternAnalyticsEvent,
} from "./patternAnalytics.js";
import type { PatternAnalyticsPayload } from "./patternAnalytics.js";
import type { FreeTierUsageSnapshot } from "./freeTierUsage.js";
import {
  checkFreeTierBlocked,
  countPatternIntelligenceEventsForUser,
  getFreeTierUsageSnapshot,
  getNormalizedUsageForUser,
  incrementUsageCount,
} from "./freeTierUsage.js";
import { getPlanEntitlements } from "./planEntitlements.js";
import {
  resolveToneModeForPlan,
  toneModePromptInstruction,
} from "./toneAccess.js";
import { trackEvent } from "./eventTracker.js";
import { coachInsightFraming } from "./coachInsightFraming.js";
import { buildAssistantStructuredReply } from "./assistantStructuredNormalize.js";
import { formatStructuredCoachReplyToContent } from "./formatStructuredCoachReplyToContent.js";
import {
  applyDeterministicPhrasingVariationLayer,
  extractPhase45VariantPool,
  patternRepeatCountForPatternKey,
} from "./deterministicVariation.js";
import { buildDecisionIntelligenceMeta } from "./decisionIntelligence.js";
import { evaluateMonetization, type PlanType } from "./monetizationGuard.js";
import {
  enrichAssistantStructuredReplyWithObjectionTags,
  resolvePrimaryAndSecondaryObjections,
  type ObjectionClassificationResult,
} from "./objectionMultiTagClassification.js";
import {
  extractMarkerSectionBody,
  extractPrecallV102NumberSections,
  extractPrecallV102StandardSections,
  mergeFastAndContinuationStructuredReply,
  parseContinuationStructuredCoachOutput,
  parseFastStructuredCoachOutput,
  parseStructuredCoachOutputToAssistantReply,
  validateMarkerFormatContinuation,
} from "./parseStructuredCoachOutput.js";
import { buildLiveResponseVisibility } from "../engine/liveVisibility.js";
import {
  applyLiveResponseRefinement,
  type LivePatternDebugMeta,
} from "../engine/liveResponseRefinement.js";
import {
  attachPrecallPrimaryTacticalPattern,
  getLastAssistantPatternFromConversation,
  type PatternContext,
} from "../engine/patternIntelligence.js";
import { applyPrecallPatternIntelligence } from "../engine/precallPatternIntel.js";
import { buildPrecallPatternDriverBlock } from "../engine/precallPatternPrompt.js";
import { patternDescriptions } from "../engine/patterns.js";
import { selectPatterns } from "../engine/selectPattern.js";
import type { AssistantStructuredReply } from "../types/assistantStructuredReply.js";
import {
  parseCoachReplyMode,
  type CoachReplyMode,
} from "../types/coachReplyMode.js";
import {
  parsePreCallDepth,
  type PrecallDepth,
  type PreCallDepth,
} from "../types/preCallDepth.js";
import { applyCoachReplyModeToSuccessPayload } from "./coachReplyModeApply.js";
import {
  buildLiveAssertionOpening,
  buildPrecallAssertionGuidance,
  resolveObjectionTypeAssertionProfile,
} from "./objectionTypeAssertionEngine.js";
import {
  findSimilarObjections,
  buildPatternDrivenMemoryGuidance,
  markObjectionMemoryUsed,
  saveObjectionMemory,
} from "./objectionMemoryService.js";
import { resolveVertical } from "./verticalRouter.js";

export type ThreadMessage = {
  role: "user" | "ai";
  content: string;
  /** When loaded from DB — used for Phase 4.4 pattern continuity (no extra persistence). */
  structuredReply?: Record<string, unknown> | null;
  /** Assistant `messages.strategy_used` (= selected patternKey) when present. */
  patternKey?: string | null;
};

/**
 * Hard fallback when no usable model output exists.
 * Only assigned in {@link generateCoachReply} (OpenAI catch + no-LLM-config path) — each logs [FALLBACK_TRIGGERED].
 */
export const COACH_REPLY_FALLBACK_TEXT =
  "AI is temporarily unavailable. Please try again in a moment.";

/** Live / precall primary completion: validation retries before V9.6 forced decision-pattern patch. */
const PRIMARY_COMPLETION_MAX_RETRIES = 3;

function trimUsable(s: unknown): string {
  if (s == null) return "";
  const t = String(s).trim();
  return /\S/.test(t) ? t : "";
}

function firstStructuredRebuttalSay(
  sr: AssistantStructuredReply | null | undefined
): string {
  if (!sr?.rebuttals?.length) return "";
  for (const r of sr.rebuttals) {
    const t = trimUsable(r.sayThis);
    if (t) return t;
  }
  return "";
}

/**
 * User-visible primary text: prefer non-fallback generated copy, then structured rebuttal, raw model, then hard fallback.
 * Coach insight / framing ({@link coachInsightFraming}) stays in `patternIntel` only — never used as speakable script here.
 */
export function resolveUserVisiblePrimaryText(input: {
  structuredReply: AssistantStructuredReply;
  rawModelText: string | null | undefined;
  generatedText: string | null | undefined;
  fallbackText: string;
  patternSnapshot?: PatternAnalyticsPayload | null;
}): string {
  const fb = input.fallbackText.trim();
  const gen = trimUsable(input.generatedText);

  let chosenText: string;

  if (gen && gen !== fb) {
    chosenText = gen;
  } else {
    let reb = firstStructuredRebuttalSay(input.structuredReply);
    if (reb && reb.trim() === fb) {
      reb = "";
    }
    const raw = trimUsable(input.rawModelText);
    if (reb) {
      chosenText = reb;
    } else if (raw) {
      chosenText = raw;
    } else {
      chosenText = fb;
    }
  }

  return chosenText;
}

function logFallbackTriggered(
  source: string,
  reason: string,
  ctx: {
    text?: string | null;
    structuredReply?: AssistantStructuredReply | null;
    rawModelText?: string | null;
    model?: string;
  }
): void {
  console.error("[FALLBACK_TRIGGERED]", {
    source,
    reason,
    hasText: !!trimUsable(ctx.text),
    hasStructuredReply: !!ctx.structuredReply,
    hasRawModelText: !!trimUsable(ctx.rawModelText),
    model: ctx.model ?? "",
  });
}

/** Non-user-facing: Phase 4.9 adaptive selection trace (debug / future scoring). */
export type CoachPatternSelectionMeta = {
  selectedPatternKey: string;
  selectedSource: "deal_specialized" | "explicit" | "default_posture";
  scoredCandidates: ScoredPatternCandidate[];
  antiRepeatApplied?: boolean;
  antiRepeatReason?: string | null;
  confidenceSupport?: number | null;
  /** Phase 4.7 — observational only; no effect on selection. */
  decisionIntelligence?: import("./decisionIntelligence.js").DecisionIntelligenceMeta;
};

export type CoachReplyResult =
  | {
      ok: true;
      text: string;
      /** Persisted JSON for data-driven UI; legacy `text` remains canonical string copy. */
      structuredReply?: AssistantStructuredReply;
      patternAnalytics?: PatternAnalyticsPayload;
      patternSelection?: CoachPatternSelectionMeta;
      /** Phase 5.2 — internal-safe; optionally exposed to clients. */
      patternInsights?: PatternInsightsPayload;
      explanation?: string;
      /** Tone mode applied to this completion (for UI / persistence). */
      appliedTone?: string | null;
      /** Monotonic timing marks (ms from request start) for latency analysis. */
      timingMs?: Record<string, number>;
      /** Phase 5.3 — after a counted response; omitted when snapshot unavailable. */
      usage?: FreeTierUsageSnapshot;
      /** Background job will fill alternates, coaching blocks, stats overlay, and persist. */
      deferredEnrichment?: CoachDeferredEnrichment;
      /** True when fast structured parse failed and raw model text is shown as primary. */
      fallbackUsed?: boolean;
    }
  | {
      ok: false;
      error: "limit_reached";
      message: "You've reached your usage limit. Upgrade to continue.";
      upgradeRequired: true;
    }
  | { ok: false; error: "limit_reached" };

/** Context for {@link runCoachReplyEnrichmentJob} (after assistant row exists). */
export type CoachDeferredEnrichment = {
  userMessage: string;
  resolvedPlanType: string;
  normalizedObjectionType: string;
  fastRawMarkerText: string;
  fastStructured: AssistantStructuredReply;
  coachReplyMode: CoachReplyMode;
  /** System prompt before any marker contract (deal, pattern, tone). */
  systemContentBase: string;
  patternSnapshot: PatternAnalyticsPayload;
  objectionClassification: ObjectionClassificationResult;
  pattern: ObjectionResponsePattern;
  guidancePosture: DealCoachingPosture;
  dealTypeLabel: string;
  selectedPatternKey: string;
  selectedSource: PatternCandidate["source"];
  rebuttalStyle: string;
  resolvedToneForTracking?: string;
  priorityGeneration: boolean;
};

export type { PatternAnalyticsPayload } from "./patternAnalytics.js";
export type { PatternInsightsPayload } from "./patternInsight.js";

function buildPatternSnapshot(input: {
  objectionCategory: string;
  posture: DealCoachingPosture;
  dealTypeLabel: string;
  pattern: ObjectionResponsePattern;
}): PatternAnalyticsPayload {
  const { objectionCategory, posture, dealTypeLabel, pattern } = input;
  return {
    patternKey: buildPatternKey({
      objectionCategory,
      posture,
      dealType: dealTypeLabel,
      rebuttalStyle: pattern.rebuttalStyle,
      followUpStyle: pattern.followUpStyle,
      confidenceStyle: pattern.confidenceStyle,
    }),
    objectionCategory,
    posture,
    dealType: dealTypeLabel,
    rebuttalStyle: pattern.rebuttalStyle,
    coachNoteStyle: pattern.coachNoteStyle,
    followUpStyle: pattern.followUpStyle,
    confidenceStyle: pattern.confidenceStyle,
  };
}

/** Phase 5.0 + pre-5.1: log + aggregate; dedupe by analytics eventId in pattern_performance_event_receipts. */
function logResponseGeneratedAndAggregate(
  supabase: SupabaseClient | null | undefined,
  payload: PatternAnalyticsPayload,
  conversationId?: string | null
): void {
  const event = eventFromPayload("response_generated", payload, conversationId);
  logPatternAnalyticsEvent(event);
  void recordPatternGeneratedFromAnalyticsEvent(supabase, event);
}

const BYPASS_LIMITS = process.env.BYPASS_USAGE_LIMITS === "true";

const OPENING_LINE_VARIANTS: Record<
  DealCoachingPosture,
  readonly string[]
> = {
  controlled_assertive: [
    "Here’s what actually matters —",
    "Break it down like this —",
    "Look at the numbers this way —",
    "Name the tradeoff plainly —",
  ],
  assertive_opportunity: [
    "Fair — quick question —",
    "Totally fair — quick reset —",
    "Let’s make this practical —",
    "Here’s the clean tradeoff —",

  ],
  balanced: [
    "If we break this down —",
    "Here’s how to think about it —",
    "Step back for one second —",
    "Acknowledge that — then shift —",
  ],
  exploratory: [
    "Before we go further —",
    "Help me understand this —",
    "What would change the math for you —",
    "Unpack that with me —",
  ],
};

function getDeterministicIndex(id: string, length: number): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
    hash |= 0; // Convert to 32bit int
  }
  return Math.abs(hash) % length;
}

/** Lead-in for rebuttal scripts only; index is stable per conversation when conversationId is set. */
export function getOpeningLineVariant(
  posture: DealCoachingPosture,
  conversationId?: string
): string {
  const list = OPENING_LINE_VARIANTS[posture];
  const id = conversationId?.trim();
  const index =
    id && id.length > 0
      ? getDeterministicIndex(id, list.length)
      : 0;
  return list[index]!;
}

const CONFIDENCE_SECTION_CONSISTENCY = `Confidence must remain consistent across:
- rebuttal
- coach note
- follow-up question`;

const GENERATION_QUALITY_RULES = `GENERATION QUALITY RULES (production):
- Do NOT output any placeholder tokens or template fields (especially anything in square brackets). The ONLY allowed square-bracket text in your response is the required marker [OPENING].
- Ground the script in the deal when context exists. If "AUTHORITATIVE SAVED DEAL FACTS" or "DEAL CONTEXT (computed)" contains payment amount, payback, revenue, industry, or use of funds, cite only those figures — but do not lecture or explain them.
- You are a senior closer on a live call: calm, certain, directional — not aggressive, not a coach, not “helpful explainer.” Short lines. Almost zero setup.

STRUCTURE (exactly 3 lines after [OPENING]; each line = one short spoken sentence):
- Line 1: acknowledge + narrow (no numbers, no math).
- Line 2: EXACTLY ONE sentence. Target ≤12 words (one breath). Hard cap 15 words ONLY if you must state a grounded payment figure in that line. Punch, not paragraph. NO product pitch, NO “this helps your business…”, NO “stabilize revenue”, NO “supports growth.”
- Line 3: force a decision — binary or forked. No permission-seeking.

LINE 2 (hard rules):
- ONE sentence only. If you need a number, put it here (when grounded), not on line 1.
- Reframe with simple either/or or blunt contrast — not explanation, not imagery.

MATH / PAYMENT (delay or weaponize):
- Do NOT casually explain payments (“the payment is X because…”).
- Either delay numbers to line 2, OR use them as blunt contrast: e.g. “At $694/day, you run it or it runs you.”
- Tie payment to their stated squeeze OR to the alternative of doing nothing.

EXPLANATION LANGUAGE BAN (do not use, including close paraphrases):
- "this helps", "this supports", "this allows you to", "this gives you", "this will help you", "this is designed to", "this funding helps", "stabilize your revenue", "supports growth."

PASSIVE / SOFT HEDGING BAN:
- Avoid: "can help", "could", "might", "maybe", "possibly", sort of, kind of. Prefer direct framing and contrast.

MANDATORY ROLE LOCK (identity, not tone):
- You are the broker, on the live call, speaking directly to the merchant.
- Do NOT address “the rep,” do NOT give “what to say,” do NOT coach, train, or explain tactics.
- Do NOT narrate your intent or your framework. No meta language.

META / INSTRUCTIONAL LANGUAGE BAN (hard):
- BAN any lines like: "acknowledge that — then shift", "here’s a one-liner", "want a script", "based on your inputs", "the goal is", "you should", "I recommend you say", "use this line", "try this", "framework", "reframe", "position", "redirect".
- If a line describes what the response is doing, delete it and replace with what you'd actually say to the merchant.

EMPATHY SOFTENER LIMIT:
- Allow at most ONE short neutral acknowledgment total (e.g., "Got it.", "Alright.", "Fair.").
- BAN soft empathy padding: "understandable", "I get it", "I hear you" (unless extremely short and immediately followed by pressure).

DECISION CONTROL (line 3 — mandatory):
- BAN soft closes including: "are you ready to move forward?", "does that make sense?", "what do you think?", "how do you feel?"
- USE this style (vary wording; pick one force level that fits the thread):
  - "So which is it — fix it now or keep dealing with it?"
  - "Are we solving this today or waiting?"
  - "If that’s handled, are we moving forward?"
- Line 3 must corner a choice — not check in politely.

NO CLEVERNESS / NO PERFORMATIVE WRITING:
- BAN lines that sound scripted, literary, or “tweet clever” — no dramatic metaphors, no punchy blog phrasing.
- BAN and do not paraphrase into similar performative patterns, e.g.: “the trade you’re staring at”, “eating it blind”, “staring down”, “the math doesn’t lie”, “here’s the thing”, “let that sink in.”
- Use plain, blunt, inevitable wording a tired rep would say without drafting.

MID-CALL REALISM (every line must pass):
- Ask: “Would a real closer say this out loud, mid-call, without thinking?” If it sounds written or clever → rewrite shorter and duller.

TONE:
- Controlled pressure: quiet certainty, not yelling. No stacked clauses. No corporate safety language.`;

/** Legacy per-objection example lists (not injected in live — assertion engine is sole authority there). Kept for precall/hybrid and tooling. */
export function objectionSpecificOpeningGuide(objectionType: string): string {
  switch (normalizeObjectionCategory(objectionType)) {
    case "timing_delay":
      return `Objection-first opening (timing_delay): acknowledge + narrow; then close on today vs later.
Examples (pick one style; don't be robotic):
- "Got it — is it timing, or the payment?"
- "Fair — what’s the hold-up, specifically?"
- "Okay — are we doing this today or kicking it down the road?"`;
    case "price_cost_framing":
      return `Objection-first opening (price_cost_framing): acknowledge the cost concern without defensiveness.
Examples:
- "Totally fair — what number feels heavy?"
- "Got it — is it the total, or the daily?"
- "Okay — compared to what you're doing now?"`;
    case "trust_skepticism":
      return `Objection-first opening (trust_skepticism): validate skepticism + ask what proof would settle it.
Examples:
- "Fair — what would you need to see to feel safe?"
- "I get it — what’s the part you don’t trust?"
- "Totally fair — what’s your bad experience been?"`;
    case "need_indifference":
      return `Objection-first opening (need_indifference): don’t argue; narrow to the real gap, then force exit from “maybe.”
Examples:
- "Got it — what part is actually holding you back?"
- "Fair — is it that you don’t need it, or you don’t see the hit?"
- "Okay — if we fix the piece you’re stuck on, are we moving ahead?"`;
    case "payment_fatigue":
      return `Objection-first opening (payment_fatigue): acknowledge cash pressure and talk through relief/fit.
Examples:
- "I hear you — is it the daily pull that’s killing you?"
- "Fair — is it the payment size or the timing of it?"
- "Got it — what’s your week look like cash-wise?"`;
    case "unknown":
    default:
      return `Objection-first opening (unknown): acknowledge + narrow.
Examples:
- "Got it — what’s holding you back right now?"
- "Fair — what part doesn’t feel right?"
- "Okay — is it the payment, timing, or trust?"`;
  }
}

const AUTHORITATIVE_DEAL_GROUNDING = `AUTHORITATIVE GROUNDING (MCA threads):
- When "AUTHORITATIVE SAVED DEAL FACTS" or "DEAL CONTEXT (computed)" lists numbers, cite only those figures. Do not invent different dollar amounts, factors, or payment examples.
- If the user asks for payback, factor, daily, term, or payment size, answer from those saved facts first.
- If something is not present in the saved deal context, say it is missing — do not fabricate placeholder numbers.
- Do not substitute Business LOC examples or “draw + interest” wording when this thread is MCA.`;

const THREAD_PRODUCT_LOC = `THREAD PRODUCT: Business line of credit. Do not use merchant cash advance scripting, sample MCA dollar amounts, factor rates, or “advance” framing unless the user explicitly asks to compare to an MCA.`;

const EMPATHY_CONSTRAINT_CONTROLLED_ASSERTIVE = `Empathy constraint (controlled_assertive):
- Allow at most ONE short acknowledgment (e.g., "I hear you").
- Do not stack multiple empathy phrases.
- Keep acknowledgment brief and immediately transition into control framing.`;

const PRECALL_CORE_BEHAVIOR = `PRE-CALL BEHAVIOR (broker prep, not training):
- State what is actually happening in the merchant’s situation — cash, margin, timing, fear, stall.
- Turn numbers into business pressure (what they feel operationally), not lectures.
- Expose the real tradeoff: take structured relief vs keep eating the same squeeze.
- When deal context has payment, revenue, industry, or use of funds, use those facts concretely — no invented substitutes.
- In [WHAT_THEY_REALLY_MEAN] and [PRECALL_COACH_NOTE]: internal prep only (diagnosis / leverage / what to avoid).
- In [LANE_1] and [LANE_2]: write the exact lines as spoken to the merchant — first- or second-person, usable on a live call. No meta, no “tell the rep to…”.
- Build conviction and pressure awareness; do not teach “how to sell” in the lanes — that belongs only in [PRECALL_COACH_NOTE].`;

/** PRE-CALL primary artifact: six-marker standard vs four-marker deal-math (router sets which output contract is appended). */
type PrecallPrimaryContractKind = "standard" | "number";

const MARKER_OUTPUT_CONTRACT_PRECALL_STANDARD = `Respond ONLY in this format, in this exact order (no prose before the first marker or after the last):

[PRECALL_OBJECTION_TYPE]
<Short classification label (examples: Price / Cost Framing; Timing / No Urgency; Cash Flow Volatility; Trust / Skepticism; Rate Comparison / Cost Perception; Margin Compression / Fixed Cost Stack; Documentation / Friction; “Send Me Something” / Brush-Off)>

[WHAT_THEY_REALLY_MEAN]
<1–2 sentences ONLY. Diagnostic interpretation of the real concern under the surface. No sales voice. No “you should”. No solutioning. No persuasion. No “?” in this block.>

[LANE_1]
<MERCHANT-FACING ONLY — 1–2 sentences, max ~35 words. Exact words on the call: direct pressure, tradeoff, timing, structure, margin, qualification — never brochure or “supportive consultant” tone. No “I understand / I hear you”, no funding-partner or testimonial fluff, no coaching meta (focus on, explain that, emphasize, frame, guide, reinforce). No “?” in this block.>

[LANE_2]
<MERCHANT-FACING ONLY — 1–2 sentences, max ~35 words. Different angle from Lane 1 — same strict rules. No “?” in this block.>

[PRECALL_COACH_NOTE]
<2–4 sentences. INTERNAL ONLY — the only place to coach the rep: leverage, risk, what to avoid, what to press. Not merchant-facing dialogue. No “?” in this block.>

[PRECALL_FOLLOW_UP]
<Exactly ONE question sentence that ends with “?”. Advances control and exposes the merchant’s real constraint.>

Global rules:
- No UI or trainer labels in any body.
- HARD BAN (anywhere): “Got it”, “Want a one-liner”, “Here’s the clean tradeoff”, “Why this response”, “How it fits”, “Coach insight”, “Use this on call”, “This objection usually appears when”, assistant-style offer language, filler acknowledgments, any internal/debug fallback (“temporary response gap”, “retrying logic”, etc.).
- Lanes: no soft empathy openers (“I understand”, “I hear you”, “Let’s look at”), no promotional language (testimonials, success stories, “funding partner”, “commitment to transparency”), no meta coaching verbs.
- BROKER_V96_FORCE_DECISION_PATTERN (mandatory in each of [LANE_1] and [LANE_2]): at least one of CONTRAST (doesn’t fix / same squeeze / not what solves) OR TRADEOFF (if you wait / cost of waiting / what happens if you don’t) OR CONDITIONAL (if nothing changes / if this doesn’t) OR DECISION FRAME (either / comes down to / the question is whether / there’s no). Neutral observation-only lanes fail.
- Only [PRECALL_FOLLOW_UP] may contain a question mark.`;

const MARKER_OUTPUT_CONTRACT_PRECALL_NUMBER = `Respond ONLY in this format, in this exact order (no prose before the first marker or after the last):

[PRECALL_METRIC]
<Directly answer the number or modeled figure — concise and explicit. Use only AUTHORITATIVE saved deal facts in the prompt; never invent amounts. If a figure is missing, say so explicitly (e.g. not in saved deal facts).>

[WHAT_THE_NUMBER_MEANS]
<1–3 sentences. Operational interpretation in the sales context — not academic. No filler. No “?” unless essential (prefer none).>

[STRATEGIC_USE]
<2–4 sentences. Broker-grade coaching on how to use that number in conversation — contrast framing allowed. Not a calculator restatement. No “?” in this block.>

[MERCHANT_FACING_LINE]
<1–2 sentences MAX. Only this block may read as direct on-call wording.>

Global rules:
- HARD BAN in every block: “Got it”, “Want a one-liner”, “Here’s the clean tradeoff”, “Why this response”, “How it fits”, “Coach insight”, “Use this on call”, “This objection usually appears when”, assistant offer language.
- No UI labels in bodies.`;

/** Instant pre-call: minimal tokens — three markers only (see {@link MARKER_OUTPUT_CONTRACT_PRECALL_INSTANT}). */
const MARKER_OUTPUT_CONTRACT_PRECALL_INSTANT = `Respond ONLY in this format, in this exact order (no prose before the first marker or after the last):

[PRECALL_OBJECTION_TYPE]
<Short label (e.g. Price / Cost Framing; Timing / No Urgency)>

[PRECALL_INSTANT_CORE]
<Exactly ONE short sentence: the real pressure under the objection — diagnostic only, no persuasion, no “?”>

[PRECALL_INSTANT_CALL_READY]
<MERCHANT-FACING ONLY — 1–2 sentences, max ~35 words. Spoken dialogue on the call: contrast, tradeoff, or decision frame — no soft empathy openers, no “?”, no coaching meta.>

Global rules:
- No other markers. No coach note, no follow-up question, no second lane, no “what they mean” essay.
- HARD BAN: “Got it”, “Want a one-liner”, “Why this response”, “Coach insight”, assistant offer language, debug/fallback phrasing.
- [PRECALL_INSTANT_CALL_READY] MUST embed broker decision pressure: at least one of CONTRAST, TRADEOFF, CONDITIONAL, or DECISION FRAME (same intent as BROKER_V96_FORCE_DECISION_PATTERN).`;

const PRECALL_INSTANT_SYSTEM_CORE = `INSTANT PRE-CALL — speed tier (under a few seconds of model time):
You are arming a broker with the smallest usable prep: label the objection, one diagnostic sentence, one speakable line.
Do not write training essays, second angles, coach notes, or follow-up questions — those are forbidden in this tier.
Tone: decisive, commercially fluent, operational.`;

const PRECALL_V102_SYSTEM_PROMPT = `${PRECALL_CORE_BEHAVIOR}

PRE-CALL — BROKER PREP ARTIFACT (STANDARD = mixed internal + two spoken options):

You are preparing a funding broker before the call.
The exact marker order is defined ONLY by the OUTPUT CONTRACT appended after this message (STANDARD six markers vs NUMBER four markers). Obey that contract literally.

STANDARD contract semantics:
- [WHAT_THEY_REALLY_MEAN] = diagnostic only (internal).
- [LANE_1] and [LANE_2] = merchant-facing dialogue, 1–2 sentences each (~35 words max). Each MUST satisfy BROKER_V96_FORCE_DECISION_PATTERN (embed contrast, tradeoff, conditional pressure, or a decision frame — see OUTPUT CONTRACT). Take control; no neutral observations.
- [PRECALL_COACH_NOTE] = internal coaching only (only place for meta / leverage / what to avoid).
- [PRECALL_FOLLOW_UP] = one control question the rep asks the merchant.

NUMBER contract priorities: (1) state the metric → (2) operational meaning → (3) how to use it on the call → (4) one short merchant-facing line.

Tone: decisive, commercially fluent, operational, non-academic. No soft assistant voice, no vague motivation, no empty teaching copy.

If [MEMORY PATTERN PROFILE] / [RECENT SIMILAR OBJECTIONS] exist: let them inform pressure and structure in lanes, coach note, and merchant-facing line — fresh wording only; never copy recalled lines verbatim.

Sayability: short sentences; concrete business language; no consultant filler.`;

const SYSTEM_PROMPT_PRECALL = PRECALL_V102_SYSTEM_PROMPT;

/** Shorter than full V10.2 — must not reference six-marker lanes (avoids token-heavy contradictory instructions). */
const SYSTEM_PROMPT_PRECALL_INSTANT = `${PRECALL_INSTANT_SYSTEM_CORE}

You are preparing a funding broker before a call.
Follow ONLY the OUTPUT CONTRACT appended after this message (exactly three markers). Do not output lanes, coach notes, or follow-up questions.

- [PRECALL_OBJECTION_TYPE]: short human-readable label.
- [PRECALL_INSTANT_CORE]: one sentence — the real pressure under the objection (diagnostic; no persuasion; no "?").
- [PRECALL_INSTANT_CALL_READY]: merchant-facing dialogue only — 1–2 sentences, embed contrast / tradeoff / decision pressure; no "?".

If deal or client facts appear above, use them briefly — do not invent numbers.

Sayability: short sentences; concrete business language.`;

/** Deep pre-call: full strategic breakdown (UI shows all sections). */
const PRECALL_DEEP_OUTPUT_HINT = `DEEP PRE-CALL — SERIOUS STRATEGIC PREP (UI shows the full coaching artifact):
- Explain the objection clearly; preserve the full structured breakdown: rich [WHAT_THEY_REALLY_MEAN], distinct [LANE_1] and [LANE_2] when useful, substantive [PRECALL_COACH_NOTE], [PRECALL_FOLLOW_UP] — and for number-style prep, the metric / [MERCHANT_FACING_LINE] blocks per contract.
- When [CLIENT CONTEXT] (or equivalent) is present in the system prompt, weave it into diagnosis and lanes — account realism; do not invent facts beyond it.
- Layered persuasion: multiple angles, leverage, risk, and talk-track depth. This should feel materially more detailed than Instant — not a one-liner drill.`;

/** Appended only to precall continuation LLM — marker names stay fixed; prose inside must stay broker-prep, not trainer. */
const PRECALL_CONTINUATION_VOICE_APPEND = `PRECALL CONTINUATION — ENRICHMENT (primary is V10.2 broker prep):

Do not repeat or lightly tweak the primary V10.2 sections. Add NEW substance in the continuation markers only.

Rules:
- Broker-prep voice only — no trainer tone, no UI/meta labels (“Why this response”, “Coach insight”, “Want a one-liner”, “Got it”).
- Analytic sections: no “?” unless the appended contract explicitly allows (follow-up lives in primary for STANDARD).
- Rebuttal script bodies (if any): assertion-first, active ongoing pressure, directional commitment — tighter than primary.`;

function stripCoachRawWrapper(raw: string): string {
  let t = raw.replace(/\r\n/g, "\n").trim();
  if (t.startsWith("```")) {
    t = t
      .replace(/^```[a-zA-Z0-9_-]*\s*\n?/, "")
      .replace(/\n?```\s*$/u, "")
      .trim();
  }
  return t;
}

type LiveIntentKind =
  | "ADVISORY_QUESTION"
  | "ACCEPTANCE_QUESTION"
  | "CLARIFICATION_QUESTION"
  | null;

function classifyLiveIntent(userMessage: string): LiveIntentKind {
  const t = userMessage.trim().toLowerCase();
  if (!t) return null;

  // Advisory: "what would you do if you were me"
  if (
    /\bwhat\s+would\s+you\s+do\b/.test(t) ||
    /\bwhat\s+do\s+you\s+think\s+i\s+should\s+do\b/.test(t) ||
    /\bif\s+you\s+were\s+me\b/.test(t)
  ) {
    return "ADVISORY_QUESTION";
  }

  // Acceptance: "would you accept/take/move forward"
  if (
    /\bwould\s+you\s+(accept|take)\b/.test(t) ||
    /\bwould\s+you\s+move\s+forward\b/.test(t) ||
    /\bshould\s+i\s+take\s+this\b/.test(t)
  ) {
    return "ACCEPTANCE_QUESTION";
  }

  // Clarification: rate/payment/cost
  if (
    /\bwhat\s+(is|am)\s+my\s+(rate|payment)\b/.test(t) ||
    /\bwhat\s+am\s+i\s+really\s+paying\b/.test(t) ||
    /\bhow\s+much\s+is\s+this\s+costing\b/.test(t) ||
    /\bwhat\s+is\s+my\s+(factor|hold|apr|term|payback)\b/.test(t) ||
    /\b(daily|weekly|monthly)\s+payment\b/.test(t)
  ) {
    return "CLARIFICATION_QUESTION";
  }

  return null;
}

function liveIntentSystemAppend(kind: LiveIntentKind): string {
  if (!kind) return "";
  if (kind === "ADVISORY_QUESTION") {
    return `\n\n[LIVE INTENT — ADVISORY QUESTION]\nThe user is asking what YOU would do. Do not answer like a generic objection.\nOutput in [OPENING] as:\n- one direct answer (decisive broker voice)\n- one reason grounded in structure + pressure relief (not generic)\n- optional control question (only if it advances commitment)\nNo assistant phrasing, no filler.\n`;
  }
  if (kind === "ACCEPTANCE_QUESTION") {
    return `\n\n[LIVE INTENT — ACCEPTANCE QUESTION]\nThe user is asking if you'd accept the deal. Answer the acceptance frame directly.\nOutput in [OPENING] as:\n- one acceptance conditional (only take it if it improves the position)\n- one reason (structure must fix the cash-flow problem, not just move it)\n- optional control question\nNo generic payment-pressure lines.\n`;
  }
  return `\n\n[LIVE INTENT — CLARIFICATION QUESTION]\nThe user is asking for deal math / a metric.\nOutput in [OPENING] as:\n- direct metric answer IF the numbers exist in the provided deal context; otherwise say what specific inputs are missing\n- one implication line (how that structure lands operationally)\nNo generic objection language. No assistant offers.\n`;
}

/** V9.6 — injected only after max failed validations; satisfies decision-pattern pressure in the tail. */
function injectDecisionPattern(text: string): string {
  if (!text) {
    return "If nothing changes, nothing improves — either this fixes the pressure or it doesn't.";
  }
  return `${text} — if nothing changes, the pressure stays exactly where it is.`;
}

/** Replace the body under `[MARKER]` / `[MARKER] tail` with `newBody` lines; leaves other markers intact. */
function replaceCoachMarkerSectionBody(
  raw: string,
  marker: string,
  newBody: string
): string {
  const stripped = stripCoachRawWrapper(raw);
  const safe = marker.replace(/[^A-Z0-9_]/g, "");
  if (!safe) return raw;
  const lines = stripped.split("\n");
  const tag = `[${safe}]`;
  const idx = lines.findIndex((l) => {
    const t = l.trim();
    return t === tag || t.startsWith(`${tag} `);
  });
  if (idx < 0) return raw;

  const openLine = lines[idx]?.trim() ?? "";
  const isSameLine = openLine.startsWith(`${tag} `) && openLine !== tag;

  let firstAfterBody = idx + 1;
  if (!isSameLine) {
    for (; firstAfterBody < lines.length; firstAfterBody++) {
      const line = lines[firstAfterBody] ?? "";
      if (/^\[[A-Z0-9_]+\]\s*$/.test(line.trim())) {
        break;
      }
    }
  }

  const before = lines.slice(0, idx);
  const after = lines.slice(firstAfterBody);
  const newBodyLines = newBody.replace(/\r\n/g, "\n").split("\n");
  const rebuilt = [...before, tag, ...newBodyLines, ...after];
  return rebuilt.join("\n");
}

function applyForcedDecisionPatternPatchLive(raw: string): string {
  const t = stripCoachRawWrapper(raw);
  if (/\[CALL_READY_LINE\]/.test(t)) {
    const body = extractMarkerSectionBody(raw, "CALL_READY_LINE") ?? "";
    return replaceCoachMarkerSectionBody(
      raw,
      "CALL_READY_LINE",
      injectDecisionPattern(body.trim())
    );
  }
  if (
    /\[OPENING\]/.test(t) ||
    extractPrecallOpeningBodyForValidation(raw) != null
  ) {
    const body = extractPrecallOpeningBodyForValidation(raw) ?? "";
    return replaceCoachMarkerSectionBody(
      raw,
      "OPENING",
      injectDecisionPattern(body.trim())
    );
  }
  return `[OPENING]\n${injectDecisionPattern("")}`;
}

function applyForcedDecisionPatternPatchPrecallStandard(raw: string): string {
  let out = raw;
  for (const lane of ["LANE_1", "LANE_2"] as const) {
    const body = extractMarkerSectionBody(out, lane) ?? "";
    out = replaceCoachMarkerSectionBody(
      out,
      lane,
      injectDecisionPattern(body.trim())
    );
  }
  return out;
}

function applyForcedDecisionPatternPatchPrecallNumber(raw: string): string {
  const body = extractMarkerSectionBody(raw, "MERCHANT_FACING_LINE") ?? "";
  return replaceCoachMarkerSectionBody(
    raw,
    "MERCHANT_FACING_LINE",
    injectDecisionPattern(body.trim())
  );
}

function applyForcedDecisionPatternPatchPrecallInstant(raw: string): string {
  const body =
    extractMarkerSectionBody(raw, "PRECALL_INSTANT_CALL_READY") ?? "";
  return replaceCoachMarkerSectionBody(
    raw,
    "PRECALL_INSTANT_CALL_READY",
    injectDecisionPattern(body.trim())
  );
}

/** LIVE: extract [OPENING] block (legacy precall tried [CALL_READY_LINE] first). */
function extractPrecallOpeningBodyForValidation(raw: string): string | null {
  const fromMarker = extractMarkerSectionBody(raw, "CALL_READY_LINE");
  if (fromMarker != null && fromMarker.trim().length > 0) {
    return fromMarker.trim();
  }
  const text = stripCoachRawWrapper(raw);
  const lines = text.split("\n");
  const idx = lines.findIndex((l) => l.trim().startsWith("[OPENING]"));
  if (idx < 0) return null;
  const openLine = lines[idx]?.trim() ?? "";
  const sameLine = openLine.match(/^\[OPENING\]\s*(.+)$/);
  if (sameLine?.[1]?.trim()) {
    return sameLine[1].trim();
  }
  const body: string[] = [];
  for (let i = idx + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (/^\[[A-Z0-9_]+\]\s*$/.test(line.trim())) {
      break;
    }
    body.push(line);
  }
  const content = body.join("\n").trim();
  return content.length > 0 ? content : null;
}

function precallPrimaryHasV102StandardContract(raw: string): boolean {
  const t = stripCoachRawWrapper(raw);
  return (
    t.includes("[PRECALL_OBJECTION_TYPE]") &&
    t.includes("[WHAT_THEY_REALLY_MEAN]") &&
    t.includes("[LANE_1]") &&
    t.includes("[LANE_2]") &&
    t.includes("[PRECALL_COACH_NOTE]") &&
    t.includes("[PRECALL_FOLLOW_UP]")
  );
}

function precallPrimaryHasV102NumberContract(raw: string): boolean {
  const t = stripCoachRawWrapper(raw);
  return (
    t.includes("[PRECALL_METRIC]") &&
    t.includes("[WHAT_THE_NUMBER_MEANS]") &&
    t.includes("[STRATEGIC_USE]") &&
    t.includes("[MERCHANT_FACING_LINE]")
  );
}

function precallPrimaryHasV102InstantContract(raw: string): boolean {
  const t = stripCoachRawWrapper(raw);
  return (
    t.includes("[PRECALL_OBJECTION_TYPE]") &&
    t.includes("[PRECALL_INSTANT_CORE]") &&
    t.includes("[PRECALL_INSTANT_CALL_READY]")
  );
}

function isPrecallDealMathOrNumberQuestion(userMessage: string): boolean {
  const m = userMessage.trim().toLowerCase();
  if (m.length < 4) return false;
  const tests = [
    /\bwhat('?s| is)\s+(my|the)\s+(daily|weekly|monthly|payment)\b/,
    /\bwhat('?s| is)\s+my\s+(factor|payback|term|hold|apr)\b/,
    /\bdaily payment\b/,
    /\bweekly payment\b/,
    /\b(monthly|equal)\s+daily\b/,
    /\bmodel(ed)?\s+(equal\s+)?daily\b/,
    /\bpayment\s+(per\s+)?(day|week)\b/,
    /\bhow\s+much\b.*\b(per|a\s+)?\s*(day|daily|week|weeks)\b/,
    /\bhow\s+much\b.*\bpayment\b/,
    /\bnumber\b.*\b(payment|daily)\b/,
    /\bfactor\s+(rate|is|was|so)\b/,
    /\bpayback\b/,
    /\btotal\s+(cost|payback|repay|pay)\b/,
    /\bhold\s*(%|percent|percentage)?\b/,
    /\bapr\b/,
    /\bafford/,
    /\bwhat('?s| is)\s+the\b.*\bpayment\b/,
    /\bhow\s+much\b.*\b(i|do we|are we)\s+(pay|paying)\b/,
    /\bgive\s+me\b.*\b(daily|payment|number)\b/,
    /\bwhy\b.*\b(factor|rate|payment|apr)\b.*\b(high|big|so)\b/,
    /\b(factor|rate)\b.*\b(so\s+high|high|expensive)\b/,
    /\bdeal\s+math\b/,
    /\bstructure\b.*\b(compare|versus|vs\.?)\b/,
    /\bcost\s+per\b/,
    /\btrue\s+cost\b/,
    /\bedp\b/,
    /\bequal\s+payment\b/,
  ];
  return tests.some((re) => re.test(m));
}

function resolvePrecallPrimaryContractKind(input: {
  userMessage: string;
  primaryObjectionTag: string;
}): PrecallPrimaryContractKind {
  if (isPrecallDealMathOrNumberQuestion(input.userMessage)) {
    return "number";
  }
  const msg = input.userMessage.toLowerCase();
  const numberLeanTags = new Set([
    "payment_affordability",
    "payment_fatigue",
  ]);
  if (
    numberLeanTags.has(input.primaryObjectionTag) &&
    /\b(payment|pay\s+back|payback|daily|weekly|factor|rate|apr|hold|pull)\b/.test(
      msg
    )
  ) {
    return "number";
  }
  return "standard";
}

function precallV10NormalizeTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3);
}

function precallV10Jaccard(a: string, b: string): number {
  const A = new Set(precallV10NormalizeTokens(a));
  const B = new Set(precallV10NormalizeTokens(b));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const w of A) {
    if (B.has(w)) inter += 1;
  }
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

function precallV10WordCount(text: string): number {
  return precallV10NormalizeTokens(text).length;
}

const PRECALL_V102_PERSUASION_IN_DIAGNOSIS_REGEX =
  /\b(you should|we should|tell them to|your best move|sell them|pitch this|close with|recommended next step|move forward with)\b/i;

const PRECALL_V102_BANNED_SUBSTRINGS = [
  "got it",
  "want a one-liner",
  "want a one liner",
  "here's the clean tradeoff",
  "here’s the clean tradeoff",
  "why this response",
  "how it fits",
  "coach insight",
  "use this on call",
  "this objection usually appears when",
  "temporary response gap",
  "retrying logic path",
  "retrying logic",
  "response gap",
] as const;

/** Never surface in user-visible copy (any mode). */
const USER_VISIBLE_DEBUG_OR_FALLBACK_LEAK_REGEX =
  /temporary response gap|retrying logic path|\bresponse gap\b|\bretrying\b.*\blogic\b|internal fallback|placeholder response/i;

/**
 * V9.6 FINAL — merchant-facing copy must carry broker decision pressure (not neutral observation).
 * At least ONE match required per LIVE [OPENING], each PRECALL lane, and [MERCHANT_FACING_LINE].
 */
const BROKER_V96_FORCE_DECISION_PATTERN =
  /doesn'?t fix|does not fix|doesn'?t stop|isn'?t the problem|not what solves|same problem|same squeeze|not just because|if you wait|waiting means|cost of waiting|what happens if you don'?t|what changes if you don'?t|if nothing changes|if the pressure is already|if this doesn'?t|if that were true|\beither\b|or it doesn'?t|\s+or\s+keep|\s+or\s+it|\s+or\s+you|\s+or\s+wear|there'?s no|comes down to|the question is whether/i;

function brokerV96RequireForceDecisionPattern(
  text: string,
  reasonSuffix: string
): string[] {
  const t = text.trim();
  if (!t) return [`BROKER_V96_FORCE_DECISION_PATTERN${reasonSuffix}`];
  return BROKER_V96_FORCE_DECISION_PATTERN.test(t)
    ? []
    : [`BROKER_V96_FORCE_DECISION_PATTERN${reasonSuffix}`];
}

/**
 * V9.6 — soft empathy, promo, consultant filler in merchant-facing / live output.
 * (Lanes, LIVE [OPENING], [MERCHANT_FACING_LINE]; not applied to internal coach-only blocks.)
 */
const BROKER_V96_SOFT_PROMO_EMPATHY_RULES: Array<{ re: RegExp; code: string }> = [
  { re: /\bi understand\b/i, code: "soft_i_understand" },
  { re: /\bi hear you\b/i, code: "soft_i_hear_you" },
  { re: /\bi get that\b/i, code: "soft_i_get_that" },
  { re: /\bi get it\b/i, code: "soft_i_get_it" },
  { re: /\bi get wanting\b/i, code: "soft_i_get_wanting" },
  { re: /\bthe real question is\b/i, code: "soft_real_question_is" },
  { re: /\blet's look at\b/i, code: "soft_lets_look_at" },
  { re: /\blet us look at\b/i, code: "soft_let_us_look" },
  { re: /\bconsider this\b/i, code: "soft_consider_this" },
  { re: /\bit'?s important to\b/i, code: "promo_its_important_to" },
  { re: /\bfunding partner\b/i, code: "promo_funding_partner" },
  {
    re: /\bprioritizes your business'?s needs\b/i,
    code: "promo_prioritizes_business",
  },
  { re: /\btestimonials?\b/i, code: "promo_testimonials" },
  { re: /\bi can share\b/i, code: "promo_i_can_share" },
  { re: /\bsuccess stories\b/i, code: "promo_success_stories" },
  { re: /\bother merchants have\b/i, code: "promo_other_merchants" },
  { re: /\bwe can address together\b/i, code: "promo_address_together" },
  {
    re: /\bcommitment to transparency\b/i,
    code: "promo_commitment_transparency",
  },
  {
    re: /\btransparency and reliability\b/i,
    code: "promo_transparency_reliability",
  },
];

function precallV102ScanBannedPhrases(haystack: string): string[] {
  const reasons: string[] = [];
  const low = haystack.toLowerCase();
  for (const p of PRECALL_V102_BANNED_SUBSTRINGS) {
    if (low.includes(p)) reasons.push(`banned_phrase:${p.slice(0, 24)}`);
  }
  if (/\bopening\s*:\s*/i.test(haystack)) {
    reasons.push("banned_label_opening");
  }
  if (/\bwant a one-?liner\b/i.test(haystack)) {
    reasons.push("banned_want_one_liner");
  }
  return reasons;
}

/** V9.6: lanes must be merchant-facing script — fail if they read like rep coaching / trainer outline. */
const PRECALL_V102_LANE_INSTRUCTIONAL_RULES: Array<{
  re: RegExp;
  code: string;
}> = [
  { re: /\bfocus on\b/i, code: "instructional_focus_on" },
  { re: /\bexplain that\b/i, code: "instructional_explain_that" },
  { re: /\bemphasize\b/i, code: "instructional_emphasize" },
  { re: /\bframe the conversation\b/i, code: "instructional_frame_conversation" },
  { re: /\bframe it as\b/i, code: "instructional_frame_it_as" },
  { re: /\bguide the merchant\b/i, code: "instructional_guide_merchant" },
  { re: /\breinforce\b/i, code: "instructional_reinforce" },
  { re: /\bposition this as\b/i, code: "instructional_position_this" },
  { re: /\bposition it as\b/i, code: "instructional_position_it" },
  { re: /\bthe rep should\b/i, code: "instructional_rep_should" },
  { re: /\btell them that\b/i, code: "instructional_tell_them_that" },
  { re: /\bhighlight the\b/i, code: "instructional_highlight_the" },
  { re: /\bunderscore\b/i, code: "instructional_underscore" },
  { re: /\bwalk them through\b/i, code: "instructional_walk_through" },
  { re: /\blead with\b/i, code: "instructional_lead_with" },
  { re: /\bopen with\b/i, code: "instructional_open_with" },
  { re: /\bclose with\b/i, code: "instructional_close_with" },
  { re: /\byour goal is to\b/i, code: "instructional_your_goal" },
  { re: /\bmake sure you\b/i, code: "instructional_make_sure_you" },
  { re: /\bdrive home\b/i, code: "instructional_drive_home" },
  { re: /\bstress that\b/i, code: "instructional_stress_that" },
];

function precallV102ScanLaneInstructionalPhrasing(
  lane: string,
  which: "lane1" | "lane2"
): string[] {
  const reasons: string[] = [];
  const t = lane.trim();
  if (!t) return reasons;
  for (const { re, code } of PRECALL_V102_LANE_INSTRUCTIONAL_RULES) {
    if (re.test(t)) reasons.push(`v102_${which}_${code}`);
  }
  return reasons;
}

function brokerV96ScanDebugLeak(text: string): string[] {
  const t = text.trim();
  if (!t) return [];
  return USER_VISIBLE_DEBUG_OR_FALLBACK_LEAK_REGEX.test(t)
    ? ["v96_debug_or_fallback_leak"]
    : [];
}

function brokerV96ScanSoftPromoOnly(text: string): string[] {
  const reasons: string[] = [];
  const t = text.trim();
  if (!t) return reasons;
  for (const { re, code } of BROKER_V96_SOFT_PROMO_EMPATHY_RULES) {
    if (re.test(t)) reasons.push(`v96_${code}`);
  }
  return reasons;
}

function brokerV96ScanInstructionalMerchantOrLive(text: string): string[] {
  const reasons: string[] = [];
  const t = text.trim();
  if (!t) return reasons;
  for (const { re, code } of PRECALL_V102_LANE_INSTRUCTIONAL_RULES) {
    if (re.test(t)) reasons.push(`v96_instructional_${code}`);
  }
  return reasons;
}

/** Lanes: debug leak + soft/promo + instructional + forced decision pressure (coach-only blocks excluded elsewhere). */
function brokerV96ScanPrecallLane(lane: string, which: "lane1" | "lane2"): string[] {
  const suffix = which === "lane1" ? "_lane1" : "_lane2";
  return [
    ...brokerV96ScanDebugLeak(lane),
    ...brokerV96ScanSoftPromoOnly(lane),
    ...precallV102ScanLaneInstructionalPhrasing(lane, which),
    ...brokerV96RequireForceDecisionPattern(lane, suffix),
  ];
}

function precallV102LanePlainWordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function brokerV96ScanLiveOpening(text: string): string[] {
  return [
    ...brokerV96ScanDebugLeak(text),
    ...brokerV96ScanSoftPromoOnly(text),
    ...brokerV96ScanInstructionalMerchantOrLive(text),
    ...brokerV96RequireForceDecisionPattern(text, "_live"),
  ];
}

function precallV102LaneSentenceCount(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  const parts = t
    .split(/(?<=[.!?])\s+/)
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
  return parts.length > 0 ? parts.length : 1;
}

function validatePrecallV102Standard(raw: string): {
  ok: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  const s = extractPrecallV102StandardSections(raw);
  if (s == null) {
    return { ok: false, reasons: ["v102_missing_standard_section"] };
  }
  const {
    objectionTypeLabel,
    whatTheyReallyMean,
    lane1,
    lane2,
    coachNote,
    followUp,
  } = s;

  const fullBody = `${objectionTypeLabel}\n${whatTheyReallyMean}\n${lane1}\n${lane2}\n${coachNote}\n${followUp}`;
  reasons.push(...precallV102ScanBannedPhrases(fullBody));
  reasons.push(...brokerV96ScanDebugLeak(fullBody));

  if (precallV10WordCount(objectionTypeLabel) < 2) {
    reasons.push("v102_objection_type_too_thin");
  }
  if (precallV10WordCount(whatTheyReallyMean) < 10) {
    reasons.push("v102_what_they_mean_too_thin");
  }
  if (PRECALL_V102_PERSUASION_IN_DIAGNOSIS_REGEX.test(whatTheyReallyMean)) {
    reasons.push("v102_meaning_contains_persuasion");
  }
  reasons.push(...brokerV96ScanPrecallLane(lane1, "lane1"));
  reasons.push(...brokerV96ScanPrecallLane(lane2, "lane2"));
  if (precallV10WordCount(lane1) < 14) reasons.push("v102_lane1_too_thin");
  if (precallV10WordCount(lane2) < 14) reasons.push("v102_lane2_too_thin");
  if (precallV102LanePlainWordCount(lane1) > 35) {
    reasons.push("v102_lane1_over_35_words");
  }
  if (precallV102LanePlainWordCount(lane2) > 35) {
    reasons.push("v102_lane2_over_35_words");
  }
  if (precallV102LaneSentenceCount(lane1) > 2) {
    reasons.push("v102_lane1_must_be_1_to_2_sentences");
  }
  if (precallV102LaneSentenceCount(lane2) > 2) {
    reasons.push("v102_lane2_must_be_1_to_2_sentences");
  }
  if (precallV10WordCount(coachNote) < 16) reasons.push("v102_coach_note_too_thin");
  if (precallV10WordCount(followUp) < 6) reasons.push("v102_follow_up_too_thin");

  const noQ = [objectionTypeLabel, whatTheyReallyMean, lane1, lane2, coachNote];
  for (let i = 0; i < noQ.length; i++) {
    if (/\?/.test(noQ[i] ?? "")) reasons.push("v102_stray_question_mark");
  }
  const qn = (followUp.match(/\?/g) ?? []).length;
  if (qn !== 1) reasons.push("v102_follow_up_must_have_exactly_one_question_mark");

  if (precallV10Jaccard(lane1, lane2) >= 0.38) {
    reasons.push("v102_lanes_too_similar");
  }
  if (precallV10Jaccard(whatTheyReallyMean, lane1) >= 0.52) {
    reasons.push("v102_meaning_collapsed_into_lane1");
  }
  if (precallV10Jaccard(whatTheyReallyMean, lane2) >= 0.52) {
    reasons.push("v102_meaning_collapsed_into_lane2");
  }
  if (precallV10Jaccard(coachNote, lane1) >= 0.42) {
    reasons.push("v102_coach_note_paraphrases_lane1");
  }
  if (precallV10Jaccard(coachNote, lane2) >= 0.42) {
    reasons.push("v102_coach_note_paraphrases_lane2");
  }

  const densityWords =
    precallV10WordCount(fullBody);
  if (densityWords < 85) {
    reasons.push("v102_anti_collapse_density_too_low");
  }

  return { ok: reasons.length === 0, reasons };
}

/** Minimal validation for three-marker instant pre-call (fast path). */
function validatePrecallV102Instant(raw: string): {
  ok: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  const objectionTypeLabel =
    extractMarkerSectionBody(raw, "PRECALL_OBJECTION_TYPE")?.trim() ?? "";
  const core =
    extractMarkerSectionBody(raw, "PRECALL_INSTANT_CORE")?.trim() ?? "";
  const say =
    extractMarkerSectionBody(raw, "PRECALL_INSTANT_CALL_READY")?.trim() ?? "";
  if (!objectionTypeLabel || !core || !say) {
    return { ok: false, reasons: ["v102_instant_missing_section"] };
  }
  const fullBody = `${objectionTypeLabel}\n${core}\n${say}`;
  reasons.push(...precallV102ScanBannedPhrases(fullBody));
  reasons.push(...brokerV96ScanDebugLeak(fullBody));
  if (PRECALL_V102_PERSUASION_IN_DIAGNOSIS_REGEX.test(core)) {
    reasons.push("v102_instant_core_contains_persuasion");
  }
  if (precallV10WordCount(objectionTypeLabel) < 2) {
    reasons.push("v102_objection_type_too_thin");
  }
  if (precallV10WordCount(core) < 5) {
    reasons.push("v102_instant_core_too_thin");
  }
  if (precallV102LaneSentenceCount(core) > 1) {
    reasons.push("v102_instant_core_must_be_one_sentence");
  }
  if (/\?/.test(objectionTypeLabel) || /\?/.test(core)) {
    reasons.push("v102_instant_stray_question_mark");
  }
  reasons.push(...brokerV96ScanPrecallLane(say, "lane1"));
  reasons.push(...brokerV96RequireForceDecisionPattern(say, "_instant_say"));
  if (precallV10WordCount(say) < 8) reasons.push("v102_instant_say_too_thin");
  if (precallV102LanePlainWordCount(say) > 38) {
    reasons.push("v102_instant_say_over_38_words");
  }
  if (precallV102LaneSentenceCount(say) > 2) {
    reasons.push("v102_instant_say_must_be_1_to_2_sentences");
  }
  if (/\?/.test(say)) reasons.push("v102_instant_question_in_say");
  const densityWords = precallV10WordCount(fullBody);
  if (densityWords < 18) {
    reasons.push("v102_instant_anti_collapse_density_too_low");
  }
  return { ok: reasons.length === 0, reasons };
}

function validatePrecallV102Number(raw: string): {
  ok: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  const s = extractPrecallV102NumberSections(raw);
  if (s == null) {
    return { ok: false, reasons: ["v102_missing_number_section"] };
  }
  const { metric, whatNumberMeans, strategicUse, merchantFacingLine } = s;
  const fullBody = `${metric}\n${whatNumberMeans}\n${strategicUse}\n${merchantFacingLine}`;
  reasons.push(...precallV102ScanBannedPhrases(fullBody));
  reasons.push(...brokerV96ScanDebugLeak(fullBody));
  reasons.push(...brokerV96ScanDebugLeak(merchantFacingLine));
  reasons.push(...brokerV96ScanSoftPromoOnly(merchantFacingLine));
  reasons.push(...brokerV96ScanInstructionalMerchantOrLive(merchantFacingLine));
  reasons.push(
    ...brokerV96RequireForceDecisionPattern(merchantFacingLine, "_merchant_line")
  );

  const metricConcrete =
    /[\d$]|\d+\s*%|\bpercent\b|\bn\/a\b|\bmissing\b|\bnot in\b|authoritative|saved deal|not modeled/i.test(
      metric
    );
  if (!metricConcrete) reasons.push("v102_metric_not_concrete");

  if (precallV10WordCount(whatNumberMeans) < 12) {
    reasons.push("v102_what_number_means_too_thin");
  }
  if (precallV10WordCount(strategicUse) < 22) {
    reasons.push("v102_strategic_use_too_thin_or_calc_only");
  }
  if (precallV10Jaccard(strategicUse, metric) >= 0.62) {
    reasons.push("v102_strategic_use_restates_metric");
  }
  if (precallV10WordCount(merchantFacingLine) < 8) {
    reasons.push("v102_merchant_line_too_thin");
  }
  const roughSents = merchantFacingLine
    .split(/(?<=[.!?])\s+/)
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
  if (roughSents.length < 1 || roughSents.length > 2) {
    reasons.push("v102_merchant_line_must_be_1_to_2_sentences");
  }
  if (/\?/.test(strategicUse) || /\?/.test(whatNumberMeans)) {
    reasons.push("v102_stray_question_in_number_sections");
  }
  const densityWords = precallV10WordCount(fullBody);
  if (densityWords < 55) {
    reasons.push("v102_number_anti_collapse_density_too_low");
  }
  return { ok: reasons.length === 0, reasons };
}

const PRECALL_WEAK_STATIC_PRESSURE_REGEX =
  /\b(this affects your business|this impacts cash flow)\b/i;

/** Live: precall weak static + generic “this affects / impacts …” static framing. */
const LIVE_WEAK_STATIC_PRESSURE_REGEX =
  /\b(this affects your business|this impacts cash flow|this\s+affects|this\s+impacts)\b/i;

/** Explanatory connectors — not active pressure (clean-but-safe). */
const PRECALL_EXPLANATORY_CONNECTOR_REGEX =
  /\b(that affects|that impacts|that creates|that leads to|this results in|this causes|this means)\b/i;

/** Live: explanatory / static causality (ongoing pressure required instead). */
const LIVE_EXPLANATORY_STATIC_BANNED_REGEX =
  /\b(affects|impacts|causes|leads to|results in)\b/i;

/** Live line 1: business-impact nouns (core list + pull/payment/hole for real openings). */
const LIVE_LINE1_BUSINESS_NOUN_REGEX =
  /\b(margin|cash|revenue|pipeline|deals?|weeks?|volume|pull|payment|hole)\b/i;

/** Live line 1: damage verbs only — no weak “impact / affect” phrasing (see LIVE_LINE1_WEAK_VERB_BAN_REGEX). */
const LIVE_LINE1_DAMAGE_VERB_REGEX =
  /\b(eating|dragging|hitting|bleeding|costing|pulling|squeezing|chewing|landing|close|closes|closing)\b/i;

/** Banned on line 1 (weak / consult verbs). */
const LIVE_LINE1_WEAK_VERB_BAN_REGEX =
  /\b(affecting|impacting|influencing|touching)\b/i;

/** Line 1 intensity: high-impact tension OR strong damage (eating/dragging/hitting/bleeding). */
const LIVE_LINE1_HIGH_IMPACT_TENSION_REGEX =
  /\b(heavy|tight|squeezed|bleeding|dragging|stuck|eating)\b/i;

/** Intensity “strong damage” = approved line-1 damage verbs except close/closing (hole pairing handled below). */
const LIVE_LINE1_STRONG_DAMAGE_FOR_INTENSITY_REGEX =
  /\b(eating|dragging|hitting|bleeding|landing|chewing|costing|pulling|squeezing)\b/i;

/** Ongoing pressure anywhere in [OPENING] (flexible — not only “every week”). */
const LIVE_ONGOING_PRESSURE_REGEX =
  /\b(keeps|still|continues|again|every)\b/i;

/** Final line: soft / optional decision language. */
const LIVE_WEAK_DECISION_REGEX =
  /\b(move\s+forward|proceed|wait|consider|think\s+about)\b/i;

/** Final line must include at least one forceful action verb. */
const LIVE_STRONG_DECISION_VERB_REGEX =
  /\b(fix|lock|handle|solve|stop|clean\s+up)\b/i;

/** Live final line: weak / optional framing (must not appear on fork line). */
const LIVE_WEAK_FORK_REGEX =
  /\b(could|might|consider|think\s+about)\b/i;

/** Line 2 only: no explanatory / cause-effect tails (pressure must stay direct). */
const LIVE_LINE2_EXPLANATORY_TAIL_REGEX =
  /\b(before\s+you|so\s+you|which\s+means|because|allowing\s+you|so\s+that)\b/i;

/** LIVE VARIATION BANK v1 — style targets for prompt only; output must still pass all live validators. */
const LIVE_VARIATION_LINE1_SHAPES = [
  "That payment's eating your margin.",
  "That pull keeps hitting cash.",
  "That number's heavy for what's left.",
  "That weekly drag is real.",
  "That payment keeps chewing margin.",
  "That deal keeps squeezing cash.",
] as const;

const LIVE_VARIATION_LINE2_SHAPES = [
  "It keeps dragging every week.",
  "It keeps landing the same way.",
  "It keeps chewing what's left.",
  "It keeps chewing through the same week.",
  "It keeps squeezing every cycle.",
] as const;

const LIVE_VARIATION_LINE3_SHAPES = [
  "Fix it or keep dealing with it.",
  "Handle it or let it keep running.",
  "Solve it or keep wearing it.",
  "Lock it in or keep chasing it.",
  "Stop it or keep feeding it.",
] as const;

const LIVE_VARIATION_BANK_V1_BLOCK = `[LIVE VARIATION BANK v1 — STYLE TARGETS]

You may vary phrasing ONLY within this shape. These are style targets, not fixed scripts — rotate wording, do not copy verbatim every time.

LINE 1 — blunt business pain (declarative; business-impact first):
${LIVE_VARIATION_LINE1_SHAPES.map((s) => `- ${s}`).join("\n")}

LINE 2 — ongoing pressure / repeated cost (active; no static causality):
${LIVE_VARIATION_LINE2_SHAPES.map((s) => `- ${s}`).join("\n")}

LINE 3 — forceful action fork (strong verb; declarative):
${LIVE_VARIATION_LINE3_SHAPES.map((s) => `- ${s}`).join("\n")}

[LIVE VARIATION — ROTATE, DO NOT REPEAT]

- Do not default to the same verb trio every reply (e.g. eating + dragging + dealing with it on every turn).
- Rotate verbs and business nouns while holding the same pressure level.
- Stay plainspoken and dull-tough — not clever, not literary.
- Variation does NOT mean softer, more explanatory, more verbose, or more diagnostic.
- Variation does NOT relax any rule in [OUTPUT CONTRACT] or [EDGE ENFORCEMENT].

[LIVE VARIATION — EXPLICIT BANS (still in force)]

- No "let me", no meta coaching, no "fair" / "quick reset" / acknowledge-then-shift rapport patterns.
- No diagnostic openers: "is it...", "what part...", "what's causing..."
- No weak modals: could, might, consider, think about.
- No weak damage verbs: impacting, affecting, influencing (and other banned forms above).`;

/** Stems: duplicate use in one [OPENING] suggests lazy repetition (live-only retry). */
const LIVE_DUPLICATE_PRESSURE_STEMS: string[] = [
  "keeps dragging",
  "keep dragging",
  "keeps landing",
  "keeps hitting",
  "keeps chewing",
  "keeps eating",
  "keeps squeezing",
  "keeps bleeding",
  "keeps costing",
  "keeps pulling",
  "keeps wearing",
  "keeps feeding",
  "keeps chasing",
];

/** Fork-tail phrases: if the same fragment appears twice in one opening, nudge a rewrite. */
const LIVE_REPEATED_FORK_FRAGMENTS: string[] = [
  "keep dealing with it",
  "let it keep running",
  "keep wearing it",
  "keep chasing it",
  "keep feeding it",
  "or keep dealing",
];

/** Nouns: if the same one appears on every line, push variation (live-only). */
const LIVE_REPETITION_TRACKED_NOUNS = [
  "margin",
  "margins",
  "cash",
  "payment",
  "payments",
  "pull",
  "revenue",
  "pipeline",
  "week",
  "weeks",
  "deal",
  "deals",
  "hole",
  "number",
] as const;

function liveOpeningHasDuplicatePressureStem(body: string): boolean {
  const lower = body.toLowerCase();
  for (const s of LIVE_DUPLICATE_PRESSURE_STEMS) {
    const first = lower.indexOf(s);
    if (first >= 0 && lower.indexOf(s, first + s.length) >= 0) return true;
  }
  return false;
}

function liveOpeningHasRepeatedDecisionPhrase(body: string): boolean {
  const lower = body.toLowerCase();
  for (const f of LIVE_REPEATED_FORK_FRAGMENTS) {
    const first = lower.indexOf(f);
    if (first >= 0 && lower.indexOf(f, first + f.length) >= 0) return true;
  }
  return false;
}

function liveOpeningHasAwkwardNounRepetition(lines: string[]): boolean {
  if (lines.length < 2) return false;
  for (const w of LIVE_REPETITION_TRACKED_NOUNS) {
    const re = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    const lineHits = lines.filter((l) => re.test(l)).length;
    if (lineHits >= lines.length) return true;
  }
  return false;
}

/** Neutral decision forks — invalid on live fork line. */
const PRECALL_NEUTRAL_FORK_REGEX =
  /\b(move forward or wait|do this or not|go with this or pass|wait or move|pass or take)\b/i;

function precallOpeningHasOngoingIntensity(body: string): boolean {
  if (
    /\b(keeps|continues|still|again|keep (hitting|costing|dragging|landing|wearing|feeding|chasing)|keeps (hitting|costing|dragging|landing|chewing|bleeding)|same (way|hit|squeeze)|nothing changes|if nothing changes|keeps chewing|keeps bleeding|thins)\b/i.test(
      body
    )
  ) {
    return true;
  }
  if (/\bevery\s+time\b/i.test(body)) return true;
  if (
    /\b(keep wearing|keep costing|same hit|keeps landing|costs more|left alone|kept alive|passed on|keeps dragging|bleeding you)\b/i.test(
      body
    )
  ) {
    return true;
  }
  return /\b(no plan|when revenue)\b/i.test(body);
}

function precallOpeningHasDecisionFork(body: string): boolean {
  if (
    /\b(either\b|or it keeps|or you keep|vs\.?\s|versus\b|you either|this either|this gets|keep (chasing|wearing|feeding|shopping|landing|dragging)|passed on|protects you|leaves you|stabil|handled|gets fixed|getting fixed|kept alive|left alone)\b/i.test(
      body
    )
  ) {
    return true;
  }
  return /\s+\bor\s+/i.test(body);
}

function liveOpeningHasOngoingPressure(body: string): boolean {
  if (LIVE_ONGOING_PRESSURE_REGEX.test(body)) return true;
  return precallOpeningHasOngoingIntensity(body);
}

function liveLine1MeetsIntensityFloor(line1: string): boolean {
  if (LIVE_LINE1_HIGH_IMPACT_TENSION_REGEX.test(line1)) return true;
  if (LIVE_LINE1_STRONG_DAMAGE_FOR_INTENSITY_REGEX.test(line1)) return true;
  if (/\b(close|closes|closing)\b/i.test(line1) && /\bhole\b/i.test(line1)) {
    return true;
  }
  return false;
}

/** True if final line uses weak decision language (“wait” allows “don’t wait”). */
function liveFinalLineHasWeakDecisionLanguage(last: string): boolean {
  const t = last.trim();
  if (/\b(don't|dont)\s+wait\b/i.test(t)) return false;
  return LIVE_WEAK_DECISION_REGEX.test(t);
}

/** Final line: declarative fork (weak modals banned on full body via LIVE_WEAK_FORK_REGEX). */
function liveOpeningLastLineHasAcceptableFork(lines: string[]): boolean {
  const last = (lines[lines.length - 1] ?? "").trim();
  if (!last) return false;
  if (/[?]/.test(last)) return false;
  if (PRECALL_NEUTRAL_FORK_REGEX.test(last)) return false;
  return precallOpeningHasDecisionFork(last);
}

function buildPrecallRegenerationUserMessage(
  reasons: string[],
  contract: PrecallPrimaryContractKind | "instant"
): string {
  if (contract === "instant") {
    return `REGENERATION REQUIRED. Prior INSTANT pre-call output failed checks: ${reasons.join("; ")}.

Rewrite the ENTIRE assistant reply in the exact INSTANT format, in order (three markers only):
[PRECALL_OBJECTION_TYPE]
[PRECALL_INSTANT_CORE]
[PRECALL_INSTANT_CALL_READY]

Rules:
- No coach note, no follow-up, no lanes, no extra markers.
- [PRECALL_INSTANT_CALL_READY] = merchant-facing only; include decision pressure (contrast / tradeoff / conditional / decision frame); no "?".
- No banned filler phrases. Output nothing outside those three markers.`;
  }
  const contractBlock =
    contract === "number"
      ? `Rewrite the ENTIRE assistant reply in the exact NUMBER (deal-math) format, in order:
[PRECALL_METRIC]
[WHAT_THE_NUMBER_MEANS]
[STRATEGIC_USE]
[MERCHANT_FACING_LINE]`
      : `Rewrite the ENTIRE assistant reply in the exact STANDARD format, in order:
[PRECALL_OBJECTION_TYPE]
[WHAT_THEY_REALLY_MEAN]
[LANE_1]
[LANE_2]
[PRECALL_COACH_NOTE]
[PRECALL_FOLLOW_UP]`;
  return `REGENERATION REQUIRED. Prior PRE-CALL output failed checks: ${reasons.join("; ")}.

${contractBlock}

Obey the OUTPUT CONTRACT and system rules:
- STANDARD: [LANE_1] and [LANE_2] = merchant-facing script only — 1–2 sentences each, ~35 words max each. Each lane MUST include broker decision pressure: at least one of CONTRAST (e.g. doesn’t fix / same squeeze), TRADEOFF (waiting means / cost of waiting / if you wait), CONDITIONAL (if nothing changes / if this doesn’t), or DECISION FRAME (either / comes down to / the question is whether). No neutral observation-only lines. No “I understand / I hear you”, no funding-partner or testimonial language, no coaching verbs. Put leverage in [PRECALL_COACH_NOTE]. Never output debug/fallback phrasing.
- NUMBER: [MERCHANT_FACING_LINE] must include the same kind of decision-pressure pattern (not flat description). Same soft/promo bans.
- No banned filler phrases; STANDARD lanes must differ materially; follow-up must be exactly one question with one "?". Output nothing outside those markers.`;
}

type PrecallAdaptivePressureLevel = "low" | "medium" | "high";

type PrecallDominantFrameV95 =
  | "ongoing_cash_drain"
  | "volatility_exposure"
  | "sticker_vs_unresolved_pain"
  | "shopping_noise_vs_real_fix"
  | "hesitation_vs_known_leak"
  | "trust_gap_vs_unfixed_risk"
  | "generic_pressure";


/** V9.5: collapse memory-derived frame labels into a strict frame set used for persistence checks. */
function normalizeDominantFrameV95(frame?: string | null): PrecallDominantFrameV95 {
  const t = String(frame ?? "")
    .trim()
    .toLowerCase();
  if (!t) return "generic_pressure";

  if (/\bongoing_cash_drain\b/.test(t) || /\bongoing\s+cash\s+drain\b/.test(t)) {
    return "ongoing_cash_drain";
  }
  if (/\b(volatility|volatile|instability|unpredictable|slow\s+week)\b/.test(t)) {
    return "volatility_exposure";
  }
  if (/\b(sticker|expensive|too\s+high|price|cost\s+framing|rate)\b/.test(t)) {
    return "sticker_vs_unresolved_pain";
  }
  if (/\b(shopping|cheaper|elsewhere|compare|comparing|offers?|quotes?)\b/.test(t)) {
    return "shopping_noise_vs_real_fix";
  }
  if (/\b(hesitat|not\s+sure|waiting|wait|later|hold\s+off|stall|drift|not\s+ready)\b/.test(t)) {
    return "hesitation_vs_known_leak";
  }
  if (/\b(trust|skeptic|skeptical|uncertain|uncertainty|risk|terms|paper|doubt)\b/.test(t)) {
    return "trust_gap_vs_unfixed_risk";
  }
  return "generic_pressure";
}

function buildFramePersistenceInstructionV95(frame: PrecallDominantFrameV95): string {
  const body =
    frame === "ongoing_cash_drain"
      ? `Dominant frame: ongoing_cash_drain\n- Line 1 names squeeze / margin / cash drag / payment burden plainly.\n- Line 2 stays on recurring drain.\n- Line 3 forces fixing the drain vs continuing it.`
      : frame === "volatility_exposure"
        ? `Dominant frame: volatility_exposure\n- Line 1 names instability / swings / slow-week exposure.\n- Line 2 stays on what keeps happening when the floor drops.\n- Line 3 forces locking protection vs riding exposure.`
        : frame === "sticker_vs_unresolved_pain"
          ? `Dominant frame: sticker_vs_unresolved_pain\n- Line 1 names the sticker / number / payment complaint.\n- Line 2 reframes against unresolved business pain.\n- Line 3 forces solving the real pain vs staying stuck on price.`
          : frame === "shopping_noise_vs_real_fix"
            ? `Dominant frame: shopping_noise_vs_real_fix\n- Line 1 names comparison / cheaper / shopping.\n- Line 2 states cheaper does not solve the underlying pressure.\n- Line 3 forces solving it now vs shopping noise.`
            : frame === "hesitation_vs_known_leak"
              ? `Dominant frame: hesitation_vs_known_leak\n- Line 1 names hesitation / pause / waiting.\n- Line 2 says waiting keeps the same leak / squeeze alive.\n- Line 3 forces fixing it now vs drifting.`
              : frame === "trust_gap_vs_unfixed_risk"
                ? `Dominant frame: trust_gap_vs_unfixed_risk\n- Line 1 names uncertainty / trust gap / concern.\n- Line 2 reframes the real risk as leaving the business issue unfixed.\n- Line 3 forces resolving the business risk vs sitting in doubt.`
                : `Dominant frame: generic_pressure\n- Line 1 direct problem.\n- Line 2 recurring consequence.\n- Line 3 directional decision.`;

  return `[FRAME PERSISTENCE TARGET]\n\n${body}`;
}


const V94_HIGH_USER_CUES =
  /\b(slow|delays?|delay|stalls?|stalling|behind|dragging|every week|every time|keeps happening|unpredictable|volatile|stuck|shopping around|waiting|week after week|same problem|while you wait|cost of waiting)\b/i;
const V94_RECURRENCE_CUES =
  /\b(every|again|keeps|still|recurring|repeat|weekly|daily|always|keeps landing|keeps hitting|keeps dragging)\b/i;
const V94_LOW_USER_CUES =
  /\b(expensive|too high|feels heavy|not sure|don'?t know|dont know|hesitant|hesitation|uncomfortable|sticker)\b/i;
const V94_COMPARISON_DRIFT =
  /\b(shopping|comparing|cheaper|elsewhere|quotes?|other offer|better rate|around|options)\b/i;

/** V9.4: scale pressure to the objection context; intensity must fit, not merely escalate. */
function inferAdaptivePressureLevelV94(input: {
  userMessage: string;
  normalizedObjectionType: string;
  objectionAssertionFamily: string;
  memoryPatternProfilePresent: boolean;
  dominantFrameHint?: string | undefined;
}): PrecallAdaptivePressureLevel {
  if (!input.memoryPatternProfilePresent) {
    return "medium";
  }

  const msg = (input.userMessage || "").toLowerCase();
  const fam = (input.objectionAssertionFamily || "").trim().toLowerCase();
  const normCat = (input.normalizedObjectionType || "").trim().toLowerCase();
  const frame = (input.dominantFrameHint || "").toLowerCase();

  const hasHighCue = V94_HIGH_USER_CUES.test(msg) || V94_COMPARISON_DRIFT.test(msg);
  const hasRecurrence = V94_RECURRENCE_CUES.test(msg);
  const hasLowCue = V94_LOW_USER_CUES.test(msg);

  const upBiasFamily =
    fam === "cashflow_instability" || fam === "timing_delay" || fam === "competing_offers";
  const downBiasFamily =
    fam === "price_cost_framing" || normCat.includes("price_cost");

  let level: PrecallAdaptivePressureLevel = "medium";

  if (downBiasFamily && hasLowCue && !hasRecurrence && !hasHighCue) {
    level = "low";
  } else if (hasHighCue || hasRecurrence) {
    level = "high";
  } else if (hasLowCue && !hasRecurrence) {
    level = "low";
  } else if (upBiasFamily) {
    level = "medium";
  }

  if (frame) {
    if (
      /\b(ongoing_cash_drain|instability|shopping_noise|margin_compression|payment_burden)\b/.test(
        frame
      ) &&
      level === "medium"
    ) {
      level = "high";
    }
  }

  return level;
}

function buildAdaptivePressureInstructionV94(
  level: PrecallAdaptivePressureLevel
): string {
  const body =
    level === "low"
      ? `Required level: LOW (firm, controlled).

LINE 2: Show clear consequence — but avoid severe-collapse phrasing (no bleeding, no "eating alive", no "every time/week you wait", no "keeps landing the same way", no "keep wearing it" on the fork).
Example shapes: "It keeps costing margin." / ongoing cost without ultimatum drama.

LINE 3: Force a decision with a calmer, direct fork (still declarative, not neutral).
Example shapes: "Fix it now or keep carrying it."

Do not sound flat: consequence must be real; the fork must commit — just not HIGH-register escalation.`
      : level === "medium"
        ? `Required level: MEDIUM (active recurring pressure + directional fork).

LINE 2: Active recurring pressure (ongoing operational hit).
Example shapes: "It keeps dragging cash every week."

LINE 3: Directional, asymmetrical fork — not balanced or advisory.
Example shapes: "Solve it now or keep dealing with it."`
        : `Required level: HIGH (deterioration / cost-of-delay + hard fork).

LINE 2: Recurring pressure with deterioration or cost-of-delay flavor (things keep getting worse or keep landing while they wait).
Example shapes: "It keeps landing the same way every time you wait."

LINE 3: Hard directional fork — forceful contrast, not two equal options.
Example shapes: "Lock it in or keep wearing it."

Stay sharp and professional — no cartoon aggression or macho fluff.`;

  return `[ADAPTIVE PRESSURE TARGET]\n\n${body}`;
}


/** Live [OPENING] guard: zero questions, line-1 business impact, ongoing pressure, fork line, compression. */
function validateLiveOpeningShape(body: string): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const t = body.trim();
  if (!t) return { ok: false, reasons: ["empty_opening"] };

  reasons.push(...brokerV96ScanLiveOpening(t));

  const livePlainWords = t.split(/\s+/).filter(Boolean).length;
  if (livePlainWords < 20) {
    reasons.push("live_word_count_below_quality_floor");
  }

  if (/[?]/.test(t)) {
    reasons.push("zero_question_marks_required");
  }

  if (PRECALL_EXPLANATORY_CONNECTOR_REGEX.test(t)) {
    reasons.push("explanatory_connector_phrase");
  }
  if (LIVE_EXPLANATORY_STATIC_BANNED_REGEX.test(t)) {
    reasons.push("static_explanatory_causality");
  }
  if (
    PRECALL_WEAK_STATIC_PRESSURE_REGEX.test(t) ||
    LIVE_WEAK_STATIC_PRESSURE_REGEX.test(t)
  ) {
    reasons.push("weak_static_pressure");
  }
  if (LIVE_WEAK_FORK_REGEX.test(t)) {
    reasons.push("weak_modal_language");
  }

  const lines = t
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2 || lines.length > 3) {
    reasons.push(`lines_must_be_2_or_3_got_${lines.length}`);
  }

  const line1 = lines[0] ?? "";
  if (
    /^\s*(is it|what\s|why\s|does it|can you|are you|were you|how do)\b/i.test(
      line1
    )
  ) {
    reasons.push("line1_diagnostic_question");
  }

  if (!LIVE_LINE1_BUSINESS_NOUN_REGEX.test(line1)) {
    reasons.push("line1_missing_business_impact_noun");
  }
  if (!LIVE_LINE1_DAMAGE_VERB_REGEX.test(line1)) {
    reasons.push("line1_missing_damage_verb");
  }
  if (LIVE_LINE1_WEAK_VERB_BAN_REGEX.test(line1)) {
    reasons.push("line1_weak_damage_verb");
  }
  if (!liveLine1MeetsIntensityFloor(line1)) {
    reasons.push("line1_intensity_floor");
  }

  const line2 = lines[1] ?? "";
  if (lines.length >= 2 && LIVE_LINE2_EXPLANATORY_TAIL_REGEX.test(line2)) {
    reasons.push("line2_explanatory_tail");
  }

  if (!liveOpeningHasOngoingPressure(t)) {
    reasons.push("missing_ongoing_pressure");
  }

  if (!liveOpeningLastLineHasAcceptableFork(lines)) {
    const last = (lines[lines.length - 1] ?? "").trim();
    if (PRECALL_NEUTRAL_FORK_REGEX.test(last)) {
      reasons.push("neutral_decision_fork");
    } else if (!precallOpeningHasDecisionFork(last)) {
      reasons.push("final_line_missing_decision_fork");
    } else {
      reasons.push("final_line_fork_invalid");
    }
  }

  const lastLine = (lines[lines.length - 1] ?? "").trim();
  if (lastLine) {
    if (liveFinalLineHasWeakDecisionLanguage(lastLine)) {
      reasons.push("decision_line_weak_phrasing");
    }
    if (!LIVE_STRONG_DECISION_VERB_REGEX.test(lastLine)) {
      reasons.push("decision_line_missing_force_verb");
    }
  }

  for (const line of lines) {
    const wc = line.split(/\s+/).filter(Boolean).length;
    if (wc > 12) {
      reasons.push("line_over_12_words");
    }
    if (/,/.test(line)) {
      reasons.push("comma_not_allowed");
    }
    if (/\s+and\s+/i.test(line)) {
      reasons.push("and_joins_ideas");
    }
  }

  if (liveOpeningHasDuplicatePressureStem(t)) {
    reasons.push("duplicate_pressure_stem_live");
  }
  if (liveOpeningHasRepeatedDecisionPhrase(t)) {
    reasons.push("repeated_decision_phrase_live");
  }
  if (liveOpeningHasAwkwardNounRepetition(lines)) {
    reasons.push("awkward_noun_repetition_live");
  }

  return { ok: reasons.length === 0, reasons };
}

function buildLiveRegenerationUserMessage(reasons: string[]): string {
  return `OUTPUT CONTRACT / ASSERTION PROFILE VIOLATION. Prior [OPENING] failed: ${reasons.join("; ")}.

Regenerate the ENTIRE reply: [OPENING] only, then 2–3 lines (max 12 words per line, no commas, no "and" joining ideas). Zero "?" in the block. Line 1 = real business impact (approved nouns + damage verb); ongoing pressure; final line = forced fork, no could/might/consider.

MANDATORY (BROKER_V96_FORCE_DECISION_PATTERN): the full [OPENING] block must match at least one of — CONTRAST (doesn't fix / isn't the problem / same squeeze), TRADEOFF (if you wait / waiting means / cost of waiting / what happens if you don't), CONDITIONAL (if nothing changes / if the pressure is already / if this doesn't), DECISION FRAME (either / or it doesn't / there's no / comes down to / the question is whether). No descriptive-only fragment stacks.

HARD BAN: "I understand", "I hear you", "Let's look at", "funding partner", "testimonials", coaching verbs, debug/fallback phrasing. Obey [ASSERTION ENGINE — LIVE OPENING AUTHORITY] and [ASSERTION PROFILE].`;
}

/**
 * Precall enrichment: same routing/deal context as fast pass, plus continuation contract and broker voice rules.
 */
function buildPrecallContinuationSystemPrompt(systemContentBase: string): string {
  return `${systemContentBase}\n\n${PRECALL_CONTINUATION_VOICE_APPEND}\n\n${MARKER_OUTPUT_CONTRACT_CONTINUATION}`;
}

/** Live path: assertion engine is primary authority; GENERATION_QUALITY_RULES is subordinate where it conflicts. */
const LIVE_ASSERTION_ENGINE_AUTHORITY = `[ASSERTION ENGINE — LIVE OPENING AUTHORITY]

You MUST generate the opening using the objection-type assertion pattern provided in the [ASSERTION PROFILE] block appended to this system message after objection classification.

This block OVERRIDES all other examples, guides, or prior patterns in this prompt.

Do NOT:
- ask diagnostic questions on line 1
- use soft consultant phrasing
- mix in alternative structures from older example lists

You MUST:
- follow the 3-line structure (assertion → pressure → decision)
- use the tone and pressure style defined in [ASSERTION PROFILE]

If any other instruction conflicts with [ASSERTION PROFILE], IGNORE it.

${LIVE_VARIATION_BANK_V1_BLOCK}

[OUTPUT CONTRACT — NON-NEGOTIABLE]

Your response must:
- Start immediately after [OPENING] with the script (no extra labels)
- Be 2–3 lines total
- Each line = one idea, max 12 words per line
- No commas. Do not use "and" to join two ideas on one line
- No "?" anywhere in the [OPENING] block — zero question marks
- No meta language

[EDGE ENFORCEMENT]

Line 1 must state a real business impact, not a feeling.

Pressure must feel ongoing, not static — no "affects / impacts / causes / leads to / results in" framing.

The final line must force a decision, not suggest one — no could / might / consider / think about.

Use forceful verbs, not neutral ones.

"impacting" is weak. "eating", "dragging", "bleeding" are correct.

Every line should feel like pressure is happening now, not hypothetically.

The decision line must push action, not suggest it.

[HARD BAN — LIVE SCRIPT QUALITY]

Never use placeholder empathy or promo: no "I understand", "I hear you", "I get that", "the real question is", "Let's look at", "Consider this", "funding partner", "testimonials", "success stories", "commitment to transparency", or coaching-instruction verbs ("focus on", "explain that", "emphasize", "frame it as", "guide the merchant", "reinforce") in [OPENING].
Never emit internal/debug text (e.g. temporary response gap, retrying logic).

MANDATORY — BROKER_V96_FORCE_DECISION_PATTERN: the whole [OPENING] must include at least one of: CONTRAST (doesn't fix / same squeeze / not what solves), TRADEOFF (if you wait / cost of waiting / what happens if you don't), CONDITIONAL (if nothing changes / if this doesn't), DECISION FRAME (either / or it doesn't / there's no / comes down to / the question is whether). Take control — not neutral narration.

If you violate this structure, regenerate internally before responding.`;

function buildVerticalPersona(vertical: string): string {
  switch (vertical) {
    case "sba_loan":
      return `You are RoboRebut — you write what a top-tier SBA loan officer says on a live call: confident, credible, process-aware. You speak in loan terms: loan amount, interest rate, monthly payment, term. You never say factor rate, advance, or payback. You know SBA 7(a) closes in 60-90 days and that objection is usually fear of the process, not the product.`;
    case "term_loan":
      return `You are RoboRebut — you write what a top-tier business lending officer says on a live call: direct, numbers-driven, low drama. You speak in loan terms: principal, rate, term, monthly payment. You never use MCA language. You know the objection is almost always about monthly cash flow commitment.`;
    case "equipment_financing":
      return `You are RoboRebut — you write what a top-tier equipment financing rep says on a live call: practical, asset-focused, low pressure. The equipment pays for itself — that is your anchor. You speak in: equipment cost, monthly payment, term, buy rate. The asset is the collateral — that is your advantage over unsecured lending objections.`;
    case "invoice_factoring":
      return `You are RoboRebut — you write what a top-tier factoring rep says on a live call: cash-flow focused, B2B savvy, non-debt framing. You speak in: invoice volume, advance rate, factoring fee, funded amount. Your core reframe: this is not a loan — they are selling receivables. The merchant gets paid today instead of in 45 days.`;
    case "business_line_of_credit":
      return `You are RoboRebut — you write what a top-tier business credit officer says on a live call: flexible, revolving-credit savvy, interest-only focused. You speak in: credit limit, drawn balance, interest rate, draw period. Your anchor: they only pay interest on what they use — it is not like a term loan.`;
    case "merchant_services":
      return `You are RoboRebut — you write what a top-tier merchant services rep says on a live call: savings-focused, processing-savvy, zero-lending framing. You speak in: effective rate, processing volume, per-transaction fee, monthly savings. Your anchor: this costs them nothing extra — it replaces what they already pay.`;
    default:
      return `You are RoboRebut — you write what a top-tier MCA closer says on a live call: fast, tight, controlling, minimal. You speak in MCA terms: advance, factor rate, payback, daily payment. You never use loan terminology.`;
  }
}

function buildSystemPromptLive(vertical: string): string {
  return `${LIVE_ASSERTION_ENGINE_AUTHORITY}

${buildVerticalPersona(vertical)}

VERTICAL CONTEXT: This conversation is about ${vertical.replace(/_/g, " ").toUpperCase()}. Every response must use the native language of this product. Never cross-contaminate terminology from other products.

BROKER PSYCHOLOGY RULES:
- The broker is on a live call RIGHT NOW. They need words, not strategy.
- Speak AS the broker TO the merchant. First person. Present tense.
- Acknowledge the objection in one short phrase — then immediately pivot to pressure.
- Use social proof with specifics when deal context is available: reference the actual numbers.
- End every response with a micro-commitment or forced choice — never a soft check-in.
- If the merchant says "I need to think about it" — that IS the objection. Treat it as stalling.

${GENERATION_QUALITY_RULES}`;
}

const MARKER_OUTPUT_CONTRACT_FAST = `Respond ONLY in this format:

[OPENING]
<your response>`;

const MARKER_OUTPUT_CONTRACT_CONTINUATION = `Output ONLY these markers in this exact order. No prose outside markers.
[PATTERN_STATUS]
[WHY_THIS_RESPONSE]
[HOW_IT_FITS]
[COACH_INSIGHT]
[REBUTTAL_2_TITLE]
[REBUTTAL_2_SAY]
[REBUTTAL_2_SUPPORT]
[COACH_NOTE]
[FOLLOW_UP]`;

/** Default fast model for live path (override with COACH_LIVE_MODEL). */
const COACH_LIVE_MODEL_DEFAULT = "gpt-4o-mini";

/**
 * Pre-call Instant tier: lower-latency primary completion (override with COACH_PRECALL_INSTANT_MODEL).
 * Deep / live / non-instant precall keep using {@link resolveLiveCoachModelConfig}.
 */
const COACH_PRECALL_INSTANT_MODEL_DEFAULT = "gpt-4o-mini";

/** Direct OpenAI API (`api.openai.com`) — never blank when API key exists. */
export type LiveCoachOpenAiConfig =
  | {
      hasOpenAiKey: true;
      resolvedModel: string;
      modelSource: "COACH_LIVE_MODEL" | "OPENAI_CHAT_MODEL" | "default_gpt-4o-mini";
    }
  | { hasOpenAiKey: false; reason: string };

/**
 * Single source of truth for direct OpenAI completions.
 * Priority: COACH_LIVE_MODEL → OPENAI_CHAT_MODEL → gpt-4o-mini (requires OPENAI_API_KEY).
 */
export function resolveLiveCoachModelConfig(): LiveCoachOpenAiConfig {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    return {
      hasOpenAiKey: false,
      reason: "OPENAI_API_KEY is missing or empty",
    };
  }
  const coach = process.env.COACH_LIVE_MODEL?.trim();
  if (coach) {
    return {
      hasOpenAiKey: true,
      resolvedModel: coach,
      modelSource: "COACH_LIVE_MODEL",
    };
  }
  const ocm = process.env.OPENAI_CHAT_MODEL?.trim();
  if (ocm) {
    return {
      hasOpenAiKey: true,
      resolvedModel: ocm,
      modelSource: "OPENAI_CHAT_MODEL",
    };
  }
  return {
    hasOpenAiKey: true,
    resolvedModel: COACH_LIVE_MODEL_DEFAULT,
    modelSource: "default_gpt-4o-mini",
  };
}

/** Model string for OpenClaw gateway (includes OPENCLAW_CHAT_MODEL). */
function resolveGatewayLiveModelString(): string {
  return (
    process.env.COACH_LIVE_MODEL?.trim() ??
    process.env.OPENCLAW_CHAT_MODEL?.trim() ??
    COACH_LIVE_MODEL_DEFAULT
  );
}

/** Gateway path when `precall` + `instant` — prefer dedicated env, then fast default. */
function resolveGatewayPrecallInstantModelString(): string {
  return (
    process.env.COACH_PRECALL_INSTANT_MODEL?.trim() ??
    process.env.OPENCLAW_GATEWAY_PRECALL_INSTANT_MODEL?.trim() ??
    process.env.COACH_LIVE_MODEL?.trim() ??
    process.env.OPENCLAW_CHAT_MODEL?.trim() ??
    COACH_PRECALL_INSTANT_MODEL_DEFAULT
  );
}

/**
 * Primary coach completion model + stable source tag for logs.
 * - Instant precall: `COACH_PRECALL_INSTANT_MODEL` or built-in instant default (not the live coach chain).
 * - Else: `resolveLiveCoachModelConfig` (COACH_LIVE_MODEL → OPENAI_CHAT_MODEL → default mini).
 */
function resolveCoachPrimaryCompletionModelSelection(input: {
  useGatewayFirst: boolean;
  isInstantPrecall: boolean;
  liveCfg: LiveCoachOpenAiConfig;
}): { model: string; modelSource: string } {
  const { useGatewayFirst, isInstantPrecall, liveCfg } = input;
  if (useGatewayFirst) {
    if (isInstantPrecall) {
      return {
        model: resolveGatewayPrecallInstantModelString(),
        modelSource: process.env.COACH_PRECALL_INSTANT_MODEL?.trim()
          ? "gateway_instant_env"
          : "gateway_instant_chain",
      };
    }
    return {
      model: resolveGatewayLiveModelString(),
      modelSource: "gateway_live_chain",
    };
  }
  if (!liveCfg.hasOpenAiKey) {
    return {
      model: COACH_LIVE_MODEL_DEFAULT,
      modelSource: "fallback_no_openai_key",
    };
  }
  if (isInstantPrecall) {
    const envInstant = process.env.COACH_PRECALL_INSTANT_MODEL?.trim();
    if (envInstant) {
      return { model: envInstant, modelSource: "instant_model" };
    }
    return {
      model: COACH_PRECALL_INSTANT_MODEL_DEFAULT,
      modelSource: "instant_default",
    };
  }
  return {
    model: liveCfg.resolvedModel,
    modelSource: `live_model:${liveCfg.modelSource}`,
  };
}

function serializeErr(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    const o: Record<string, unknown> = {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
    const st = (err as { status?: number }).status;
    if (st != null) o.status = st;
    return o;
  }
  return { message: String(err) };
}

/** One-time startup visibility for env-driven live coach. */
export function logLlmStartupStatus(): void {
  const liveCfg = resolveLiveCoachModelConfig();
  // startup-only log
  console.log("[LLM_STARTUP_STATUS]", {
    hasOpenAiKey: liveCfg.hasOpenAiKey,
    coachLiveModel: process.env.COACH_LIVE_MODEL ?? null,
    openAiChatModel: process.env.OPENAI_CHAT_MODEL ?? null,
    openClawChatModel: process.env.OPENCLAW_CHAT_MODEL ?? null,
    resolvedOpenAiModel: liveCfg.hasOpenAiKey ? liveCfg.resolvedModel : null,
    openAiModelSource: liveCfg.hasOpenAiKey ? liveCfg.modelSource : null,
    hasGatewayUrl: !!process.env.OPENCLAW_GATEWAY_URL?.trim(),
    hasGatewayToken: !!process.env.OPENCLAW_GATEWAY_TOKEN?.trim(),
  });
  const hasUsableGateway =
    !!process.env.OPENCLAW_GATEWAY_URL?.trim() &&
    !!process.env.OPENCLAW_GATEWAY_TOKEN?.trim();
  if (!liveCfg.hasOpenAiKey && !hasUsableGateway) {
    console.warn(
      "[LLM_STARTUP_STATUS] No usable live LLM route: set OPENAI_API_KEY (direct OpenAI, model defaults to gpt-4o-mini if unset) or both OPENCLAW_GATEWAY_URL and OPENCLAW_GATEWAY_TOKEN."
    );
  }
}

/**
 * NEXT PHASE (not implemented): fast-first primary reply + deferred pattern/insight hydration
 * to target ~3–4s perceived latency on paid tiers while preserving full analysis async.
 */

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Temporary UX when live LLM failed but classification + coach insight exist (debug period). */
const TEMP_OPENING_WHEN_INSIGHT_ONLY =
  "Give me a second — the live rebuttal didn't generate, but the objection was classified correctly.";

/** No official `openai` npm package — live path uses REST `POST /v1/chat/completions` via `fetch`. */
export type DirectOpenAiCompletionResult = {
  rawModelText: string;
  provider: "openai-direct";
  model: string;
};

const MINIMAL_PROBE_MESSAGES: ChatMessage[] = [
  { role: "system", content: "Reply in one sentence." },
  { role: "user", content: "Say hello." },
];

function normalizeMessageContentToString(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const part of content) {
      if (typeof part === "string") {
        parts.push(part);
        continue;
      }
      if (part && typeof part === "object") {
        const p = part as Record<string, unknown>;
        if (p.type === "text" && typeof p.text === "string") parts.push(p.text);
        else if (typeof p.text === "string") parts.push(p.text);
      }
    }
    return parts.join("");
  }
  return String(content);
}

/**
 * Ensure every chat message uses plain string `content` (Chat Completions API contract).
 */
export function normalizeChatMessagesForOpenAi(
  messages: ChatMessage[]
): ChatMessage[] {
  return messages.map((m) => ({
    role: m.role,
    content: normalizeMessageContentToString(m.content).trimEnd(),
  }));
}

function extractChoice0AssistantText(data: {
  choices?: Array<{
    message?: { content?: unknown; refusal?: unknown };
    finish_reason?: string;
  }>;
}): string {
  const ch0 = data.choices?.[0];
  const msg = ch0?.message;
  if (!msg) return "";
  if (typeof msg.refusal === "string" && /\S/.test(msg.refusal)) {
    return msg.refusal.trim();
  }
  return normalizeMessageContentToString(msg.content).trim();
}

function isDirectOpenAiEndpoint(endpoint: string): boolean {
  return endpoint.includes("api.openai.com");
}

function logOpenAiCallErrorFull(model: string, err: unknown): void {
  const e = err as Record<string, unknown> & {
    name?: string;
    message?: string;
    status?: number;
    code?: string;
    type?: string;
    param?: string;
    stack?: string;
  };
  let serialized = "";
  try {
    if (err instanceof Error) {
      serialized = JSON.stringify(err, Object.getOwnPropertyNames(err));
    } else {
      serialized = JSON.stringify(err);
    }
  } catch {
    serialized = String(err);
  }
  console.error("[OPENAI_CALL_ERROR_FULL]", {
    model,
    name: e?.name,
    message: e?.message ?? String(err),
    status: e?.status,
    code: e?.code,
    type: e?.type,
    param: e?.param,
    stack: err instanceof Error ? err.stack : undefined,
    serialized,
  });
}

/**
 * One-shot connectivity test: same REST path + model as live coach direct OpenAI.
 * Set `COACH_OPENAI_PROBE_FIRST=1` to run before the real completion; set `COACH_OPENAI_MINIMAL_PROBE=1`
 * to replace the live prompt with this minimal exchange only.
 */
export async function runOpenAiDirectMinimalProbe(resolvedModel: string): Promise<void> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    console.error("[OPENAI_MINIMAL_PROBE_FAIL]", {
      reason: "no_OPENAI_API_KEY",
      model: resolvedModel,
    });
    return;
  }
  const msgs = normalizeChatMessagesForOpenAi(MINIMAL_PROBE_MESSAGES);
  try {
    await callChatCompletions(
      "https://api.openai.com",
      `Bearer ${key}`,
      resolvedModel,
      msgs,
      80,
      { logLabel: "minimal_probe", temperature: 0.3 }
    );
  } catch (err) {
    console.error("[OPENAI_MINIMAL_PROBE_FAIL]", {
      model: resolvedModel,
      ...serializeErr(err),
    });
    logOpenAiCallErrorFull(resolvedModel, err);
  }
}

function applyTemporaryOpeningGuardrail(
  sr: AssistantStructuredReply
): AssistantStructuredReply {
  const insight = trimUsable(sr.patternIntel?.coachInsight);
  if (!insight) return sr;
  const reb = sr.rebuttals;
  if (!reb?.length) return sr;
  const openingIdx = reb.findIndex((r) => r.title.trim() === "Opening");
  const idx = openingIdx >= 0 ? openingIdx : 0;
  if (trimUsable(reb[idx]?.sayThis)) return sr;
  const next = reb.map((r, i) =>
    i === idx ? { ...r, sayThis: TEMP_OPENING_WHEN_INSIGHT_ONLY } : r
  );
  return { ...sr, rebuttals: next };
}

/**
 * Coach / pattern-intel text must not be copied into speakable rebuttals; leave empty for downstream resolution.
 */
function applyFirstRebuttalSayThisDebugGuardrail(
  sr: AssistantStructuredReply
): AssistantStructuredReply {
  return sr;
}

function logFinalRebuttalObjectDebug(_input: {
  structuredReply: AssistantStructuredReply;
  replyText: string;
  rawModelText: string | null | undefined;
  livePatternIntel?: LivePatternDebugMeta | null;
}): void {
  void _input;
}

const COACH_CHAT_TEMP_PRIMARY = 0.65;
const COACH_CHAT_TEMP_MARKER_RETRY = 0.35;

async function callChatCompletions(
  endpoint: string,
  authHeader: string,
  model: string,
  messages: ChatMessage[],
  maxTokens: number,
  options?: {
    priorityGeneration?: boolean;
    logLabel?: string;
    planType?: string;
    conversationId?: string | null;
    tone?: string;
    /** Overrides default coach temperature (e.g. lower on marker-format retry). */
    temperature?: number;
    /** True on second LLM attempt after invalid marker output. */
    markerRetry?: boolean;
  }
): Promise<string> {
  if (options?.priorityGeneration) {
    console.info(
      `[coachChatReply] Priority generation enabled${options.logLabel ? ` (${options.logLabel})` : ""}`
    );
    trackEvent(console, {
      eventName: "priority_generation_used",
      planType: options.planType ?? "free",
      conversationId: options.conversationId ?? null,
      priorityGeneration: true,
      tone: options.tone ?? null,
      surface: options.logLabel ? `coachChatReply:${options.logLabel}` : "coachChatReply",
    });
  }
  if (options?.markerRetry) {
    console.info(
      `[coachChatReply] marker_format_retry_llm temp=${options.temperature ?? COACH_CHAT_TEMP_PRIMARY}`
    );
  }
  const res = await fetch(`${endpoint}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      temperature: options?.temperature ?? COACH_CHAT_TEMP_PRIMARY,
    }),
    signal: AbortSignal.timeout(45_000),
  });

  const bodyText = await res.text();
  if (!res.ok) {
    let apiMsg = bodyText.slice(0, 800);
    let code: string | undefined;
    let type: string | undefined;
    let param: string | undefined;
    try {
      const parsed = JSON.parse(bodyText) as {
        error?: { message?: string; code?: string; type?: string; param?: string };
      };
      if (parsed?.error?.message) {
        apiMsg = parsed.error.message;
        code = parsed.error.code;
        type = parsed.error.type;
        param = parsed.error.param;
      }
    } catch {
      /* keep raw slice */
    }
    const err = new Error(`OpenAI HTTP ${res.status}: ${apiMsg}`) as Error & {
      status?: number;
      code?: string;
      type?: string;
      param?: string;
    };
    err.status = res.status;
    err.code = code;
    err.type = type;
    err.param = param;
    throw err;
  }

  let data: {
    choices?: Array<{
      message?: { content?: unknown; refusal?: unknown };
      finish_reason?: string;
    }>;
  };
  try {
    data = JSON.parse(bodyText) as typeof data;
  } catch {
    throw new Error("Invalid JSON from chat completions");
  }

  const text = extractChoice0AssistantText(data);
  if (!text.trim()) {
    console.error("[OPENAI_EMPTY_RESPONSE_DETECTED]");
    return "";
  }
  return text;
}

type CoachChatCompletionOptions = NonNullable<
  Parameters<typeof callChatCompletions>[5]
>;

/** OpenAI-compatible stream chunk: delta.content, message.content (some gateways), or legacy text. */
function extractStreamAssistantContent(json: unknown): string {
  if (typeof json !== "object" || json == null) return "";
  const o = json as Record<string, unknown>;
  const choices = o.choices;
  if (!Array.isArray(choices) || choices.length === 0) return "";
  const ch0 = choices[0] as Record<string, unknown>;
  const delta = ch0.delta as Record<string, unknown> | undefined;
  if (delta) {
    const c = delta.content;
    if (typeof c === "string" && c.length > 0) return c;
    if (Array.isArray(c)) {
      const s = normalizeMessageContentToString(c);
      if (s.length > 0) return s;
    }
    const rc = delta.reasoning_content;
    if (typeof rc === "string" && rc.length > 0) return rc;
  }
  const msg = ch0.message as Record<string, unknown> | undefined;
  if (msg && typeof msg.content === "string" && msg.content.length > 0) {
    return msg.content;
  }
  if (typeof ch0.text === "string" && ch0.text.length > 0) return ch0.text;
  return "";
}

async function callChatCompletionsStream(
  endpoint: string,
  authHeader: string,
  model: string,
  messages: ChatMessage[],
  maxTokens: number,
  options?: CoachChatCompletionOptions & { onDelta?: (chunk: string) => void }
): Promise<string> {
  const directOpenAi = isDirectOpenAiEndpoint(endpoint);
  const res = await fetch(`${endpoint}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      temperature: options?.temperature ?? COACH_CHAT_TEMP_PRIMARY,
      stream: true,
    }),
    signal: AbortSignal.timeout(45_000),
  });

  if (!res.ok) {
    const errText = await res.text();
    let apiMsg = errText.slice(0, 800);
    let code: string | undefined;
    let type: string | undefined;
    let param: string | undefined;
    try {
      const parsed = JSON.parse(errText) as {
        error?: { message?: string; code?: string; type?: string; param?: string };
      };
      if (parsed?.error?.message) {
        apiMsg = parsed.error.message;
        code = parsed.error.code;
        type = parsed.error.type;
        param = parsed.error.param;
      }
    } catch {
      /* keep */
    }
    const err = new Error(`OpenAI HTTP ${res.status}: ${apiMsg}`) as Error & {
      status?: number;
      code?: string;
      type?: string;
      param?: string;
    };
    err.status = res.status;
    err.code = code;
    err.type = type;
    err.param = param;
    throw err;
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body for stream");

  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n");
    buffer = parts.pop() ?? "";
    for (const line of parts) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const json = JSON.parse(payload) as unknown;
        const piece = extractStreamAssistantContent(json);
        if (piece) {
          full += piece;
          options?.onDelta?.(piece);
        }
      } catch {
        /* ignore partial SSE lines */
      }
    }
  }
  const tail = buffer.trim();
  if (tail.startsWith("data:")) {
    const payload = tail.slice(5).trim();
    if (payload !== "[DONE]") {
      try {
        const json = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) {
          full += delta;
          options?.onDelta?.(delta);
        }
      } catch {
        /* ignore */
      }
    }
  }
  const text = full.trim();
  if (directOpenAi) {
    if (!text) {
      console.error("[OPENAI_EMPTY_RESPONSE_DETECTED]");
      return "";
    }
    return text;
  }
  if (!text) throw new Error("Empty streamed model response");
  return text;
}

/**
 * Single completion (no strict marker validation). Parsing runs only after full text is available.
 * Stream path accumulates the full body before any parse in {@link finalizeCoachLlmReply}.
 */
async function callCoachChatWithFastMarkerRetry(
  endpoint: string,
  authHeader: string,
  model: string,
  messages: ChatMessage[],
  maxTokens: number,
  options?: CoachChatCompletionOptions & { onStreamDelta?: (chunk: string) => void }
): Promise<string> {
  const runBuffered = async () => {
    const raw = await callChatCompletions(
      endpoint,
      authHeader,
      model,
      messages,
      maxTokens,
      { ...options, temperature: COACH_CHAT_TEMP_PRIMARY }
    );
    return raw;
  };

  if (options?.onStreamDelta) {
    try {
      const streamed = await callChatCompletionsStream(
        endpoint,
        authHeader,
        model,
        messages,
        maxTokens,
        {
          ...options,
          onDelta: options.onStreamDelta,
          temperature: COACH_CHAT_TEMP_PRIMARY,
        }
      );
      return streamed;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[FAST_PATH_REQUEST_FAILURE] stream (${msg}), buffered fallback`);
    }
  }

  try {
    const out = await runBuffered();
    return out;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[FAST_PATH_REQUEST_FAILURE] buffered (${msg})`);
    throw e;
  }
}

/**
 * Direct `https://api.openai.com/v1/chat/completions` (REST, not OpenAI SDK) with [OPENAI_CALL_*] logs.
 * Use whenever the live path targets OpenAI (including after gateway failure).
 */
async function callOpenAiDirectChatCompletionsWithLogs(
  model: string,
  messages: ChatMessage[],
  maxTokens: number,
  options?: CoachChatCompletionOptions & {
    onStreamDelta?: (chunk: string) => void;
  }
): Promise<DirectOpenAiCompletionResult> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    throw new Error("OPENAI_API_KEY missing for direct OpenAI completion");
  }
  const normalized = normalizeChatMessagesForOpenAi(messages);
  try {
    const text = await callCoachChatWithFastMarkerRetry(
      "https://api.openai.com",
      `Bearer ${key}`,
      model,
      normalized,
      maxTokens,
      options
    );
    return {
      rawModelText: text,
      provider: "openai-direct",
      model,
    };
  } catch (err) {
    console.error("[OPENAI_CALL_ERROR]", {
      model,
      ...serializeErr(err),
    });
    logOpenAiCallErrorFull(model, err);
    throw err;
  }
}

async function callCoachChatWithContinuationRetry(
  endpoint: string,
  authHeader: string,
  model: string,
  messages: ChatMessage[],
  maxTokens: number,
  options?: CoachChatCompletionOptions
): Promise<string> {
  const raw1 = await callChatCompletions(
    endpoint,
    authHeader,
    model,
    messages,
    maxTokens,
    { ...options, temperature: COACH_CHAT_TEMP_PRIMARY }
  );
  if (validateMarkerFormatContinuation(raw1)) {
    return raw1;
  }
  const raw2 = await callChatCompletions(
    endpoint,
    authHeader,
    model,
    messages,
    maxTokens,
    {
      ...options,
      temperature: COACH_CHAT_TEMP_MARKER_RETRY,
      markerRetry: true,
    }
  );
  if (validateMarkerFormatContinuation(raw2)) {
    return raw2;
  }
  return raw1;
}

export async function generateCoachReply(input: {
  supabase: SupabaseClient;
  userId: string;
  conversationTitle: string;
  priorMessages: ThreadMessage[];
  userMessage: string;
  toneOverride?: string | null;
  /** Optional JSON from `conversations.deal_context`; insight is appended to system prompt only when safe. */
  dealContext?: DealContext | null;
  /** Optional JSON from `conversations.client_context`; grounded account intel for prompts (not Pro-gated). */
  clientContext?: ClientContext | null;
  /**
   * Optional objection type (e.g. price_cost_framing). If omitted, inferred from userMessage.
   */
  objectionType?: string | null;
  /** Stable per thread; used to pick a deterministic opening-line variant (no extra DB reads). */
  conversationId?: string | null;
  /** Stream primary completion tokens (OpenAI-compatible streaming); falls back to buffered on failure. */
  onStreamDelta?: (chunk: string) => void;
  /** `live` = call script only (fast); `precall` = richer broker prep + enrichment. */
  coachReplyMode?: CoachReplyMode | string | null;
  /**
   * Pre-call only: `instant` = faster, leaner primary + skipped async enrichment; `deep` = full prep.
   * Prefer this field (matches `precall_depth` on the wire). Ignored when `coachReplyMode` is `live`.
   */
  precallDepth?: PrecallDepth | string | null;
  /** @deprecated Prefer `precallDepth` (same semantics). */
  preCallDepth?: PreCallDepth | string | null;
}): Promise<CoachReplyResult> {
  const coachReplyMode = parseCoachReplyMode(input.coachReplyMode);
  const preCallDepth: PreCallDepth =
    coachReplyMode === "live"
      ? "deep"
      : parsePreCallDepth(
          input.precallDepth ?? input.preCallDepth ?? "deep"
        );
  const isInstantPrecall =
    coachReplyMode === "precall" && preCallDepth === "instant";
  const primaryMaxTokens =
    coachReplyMode === "precall"
      ? preCallDepth === "instant"
        ? 400
        : 1200
      : 650;

  const usageGate = await checkFreeTierBlocked(input.supabase, input.userId);
  // DEV ONLY: Allows bypassing usage limits to test backend flows (e.g. deal calculators)
  if (usageGate.blocked && !BYPASS_LIMITS) {
    return { ok: false, error: "limit_reached" };
  }

  /** Last 2 turns (4 messages max) for LLM context — reduces tokens. */
  const threadTail = input.priorMessages.slice(-4);
  const prior: ChatMessage[] = threadTail.map((m) => ({
    role: m.role === "ai" ? ("assistant" as const) : ("user" as const),
    content: m.content,
  }));

  const vertical = resolveVertical(input.dealContext).vertical;
  let systemContent =
    coachReplyMode === "live"
      ? buildSystemPromptLive(vertical === "general" ? "mca" : vertical)
      : isInstantPrecall
        ? SYSTEM_PROMPT_PRECALL_INSTANT
        : SYSTEM_PROMPT_PRECALL;
  let patternSnapshot: PatternAnalyticsPayload | undefined;
  let patternSelectionMeta: CoachPatternSelectionMeta | undefined;
  let patternInsightsPayload: PatternInsightsPayload | undefined;
  let patternExplanation: string | undefined;
  let patternForDeferred: ObjectionResponsePattern | undefined;
  let guidancePostureForDeferred: DealCoachingPosture | undefined;
  let priorityGeneration = false;
  let resolvedPlanType = "free";
  let resolvedToneForTracking: string | undefined;
  let normalizedObjectionTypeForTracking: string | undefined;
  let normalizedObjectionTypeForMemory = "unknown";
  let objectionAssertionFamilyForMemory = "fallback";
  let strategyTagForTracking: string | undefined;
  let responseVariantsForTracking: number | undefined;
  const t0 = performance.now();
  let tAfterDb = t0;
  let tAfterPromptContext = t0;
  let tBeforeLlm = t0;
  const timingMs: Record<string, number> = {};
  const mark = (label: string) => {
    timingMs[label] = Math.round(performance.now() - t0);
  };
  let canonicalMca: CanonicalMcaFacts | null = null;
  let canonicalLoc: CanonicalLocFacts | null = null;
  let objectionTagBundle: ObjectionClassificationResult | undefined;
  let precallPrimaryContract: PrecallPrimaryContractKind = "standard";
  let monetization:
    | import("./monetizationGuard.js").MonetizationDecision
    | null = null;
  try {
    const usageRow = await getNormalizedUsageForUser(input.supabase, input.userId);
    mark("after_usage_plan");
    tAfterDb = performance.now();
    const planType = (usageRow?.plan ?? "free") as PlanType;
    resolvedPlanType = planType;

    // Phase 5.0 / 5.1 — same count as `getFreeTierUsageSnapshot` → `usage.used`.
    const usageCount = input.supabase
      ? await countPatternIntelligenceEventsForUser(input.supabase, input.userId)
      : 0;

    monetization = evaluateMonetization({
      userId: input.userId,
      planType,
      usageCount,
    });
    if (!monetization.allow) {
      return {
        ok: false,
        error: "limit_reached",
        message: "You've reached your usage limit. Upgrade to continue.",
        upgradeRequired: true,
      };
    }

    const entitlements = getPlanEntitlements(planType);
    responseVariantsForTracking = entitlements.responseVariants;
    priorityGeneration = entitlements.priorityGeneration;
    if (priorityGeneration) {
      console.info(
        `[coachChatReply] Priority generation resolved for ${input.userId}`
      );
    }
    const resolvedTone = resolveToneModeForPlan(input.toneOverride, planType);
    resolvedToneForTracking = resolvedTone.tone;
    if (resolvedTone.acceptedAdvanced && resolvedTone.tone) {
      console.info(
        `[coachChatReply] Advanced tone accepted for ${input.userId}: ${resolvedTone.tone}`
      );
    } else if (resolvedTone.downgraded && resolvedTone.requested) {
      console.info(
        `[coachChatReply] Advanced tone downgraded for ${input.userId}: ${resolvedTone.requested} -> ${resolvedTone.tone}`
      );
    }
    let insight = buildDealInsight(input.dealContext ?? null);
    if (
      isInstantPrecall &&
      insight.summary &&
      insight.summary.length > 280
    ) {
      insight = {
        ...insight,
        summary: `${insight.summary.slice(0, 277)}…`,
      };
    }
    const resolved = resolveDealCalculation(input.dealContext ?? null);
    canonicalMca =
      input.dealContext != null && isMcaContext(input.dealContext)
        ? resolveCanonicalMcaFacts(input.dealContext)
        : null;
    canonicalLoc =
      input.dealContext != null && isLineOfCreditContext(input.dealContext)
        ? resolveCanonicalLocFacts(input.dealContext)
        : null;
    const guidance = getDealCoachingGuidance({
      dealType: resolved.dealType,
      flags: insight.flags,
      missingInputs: insight.flags?.missingInputs === true,
    });

    const categoryRaw =
      input.objectionType?.trim() ||
      inferObjectionCategoryFromMessage(input.userMessage);
    const normalizedObjectionType = normalizeObjectionCategory(categoryRaw);
    normalizedObjectionTypeForTracking = normalizedObjectionType;
    normalizedObjectionTypeForMemory = normalizedObjectionType;

    // LIVE: legacy objectionSpecificOpeningGuide is NOT injected — assertion engine (after classification) is sole opening authority.
    if (coachReplyMode !== "live") {
      systemContent += isInstantPrecall
        ? `\n\nOBJECTION HINT (normalized): ${normalizedObjectionType}\n- INSTANT pre-call: follow the appended three-marker OUTPUT CONTRACT only.`
        : `\n\nOBJECTION HINT (normalized): ${normalizedObjectionType}\n- PRE-CALL V10.2: follow the appended OUTPUT CONTRACT (STANDARD six markers or NUMBER four markers). Diagnose first; arm the rep; do not write as if you are on the live call (except MERCHANT_FACING_LINE in NUMBER mode).`;
    }

    const priorUserMessages = threadTail
      .filter((m) => m.role === "user")
      .map((m) => m.content);
    const tClassificationStart = performance.now();
    objectionTagBundle = resolvePrimaryAndSecondaryObjections({
      userMessage: input.userMessage,
      legacyNormalizedCategory: normalizedObjectionType,
      dealTypeLabel: resolved.dealType,
      posture: guidance.posture,
      dealContext: input.dealContext ?? null,
      conversationHistory: { priorUserMessages },
    });
    timingMs.classification_ms = Math.round(
      performance.now() - tClassificationStart
    );

    const assertionProfile = resolveObjectionTypeAssertionProfile({
      normalizedObjectionType,
      userMessage: input.userMessage,
      primaryObjectionTag: objectionTagBundle.primaryObjectionType,
    });
    objectionAssertionFamilyForMemory = assertionProfile.family;
    if (coachReplyMode === "live") {
      systemContent += `\n\n[ASSERTION PROFILE]\n${buildLiveAssertionOpening(assertionProfile)}`;
    } else {
      systemContent += `\n\n${buildPrecallAssertionGuidance(assertionProfile)}`;
    }

    // PRECALL ONLY (V2): recall of recent similar objections (no live injection). Skipped for instant tier (lighter prompt).
    if (coachReplyMode === "precall" && preCallDepth !== "instant") {
      const selected = findSimilarObjections({
        normalizedObjectionType,
        objectionAssertionFamily: objectionAssertionFamilyForMemory,
        userMessage: input.userMessage,
      });
      if (selected.length > 0) {
        const seenExample = new Set<string>();
        const examples = selected
          .map((r) => ({
            id: r.id,
            text: r.generatedOpening.replace(/\s+/g, " ").trim(),
          }))
          .filter((x) => x.text.length > 0)
          .filter((x) => {
            const key = x.text.toLowerCase();
            if (seenExample.has(key)) return false;
            seenExample.add(key);
            return true;
          })
          .slice(0, 3);

        if (examples.length > 0) {
          for (const ex of examples) {
            markObjectionMemoryUsed(ex.id);
          }
          systemContent += `\n\n[RECENT SIMILAR OBJECTIONS]\n\n${examples
            .map((x) => `- "${x.text}"`)
            .join("\n")}`;

          const patternProfile = buildPatternDrivenMemoryGuidance(selected);
          if (patternProfile) {
            systemContent += `\n\n${patternProfile}`;
            const dominantFrameHint = patternProfile
              .match(/-\s*Dominant frame:\s*([^\n]+)/i)?.[1]
              ?.trim();
            const memoryAdaptivePressureLevel = inferAdaptivePressureLevelV94({
              userMessage: input.userMessage,
              normalizedObjectionType,
              objectionAssertionFamily: objectionAssertionFamilyForMemory,
              memoryPatternProfilePresent: true,
              dominantFrameHint,
            });
            systemContent += `\n\n${buildAdaptivePressureInstructionV94(
              memoryAdaptivePressureLevel
            )}`;
            const memoryDominantFrameV95 = normalizeDominantFrameV95(dominantFrameHint);
            systemContent += `\n\n${buildFramePersistenceInstructionV95(
              memoryDominantFrameV95
            )}`;
          }
        }
      }
    }

    // Phase 4.4 — allow deterministic posture variation under repetition pressure for price objections
    // without removing the price assertion/override family behavior.
    let postureForRouting = guidance.posture;
    const isPriceFamily = normalizedObjectionType === "price_cost_framing";

    const statsProvider = isInstantPrecall
      ? defaultPatternStatsProvider
      : createPatternStatsProvider(input.supabase);
    const tRankingStart = performance.now();
    // Phase 4.4 production ranking: pattern candidate order from `selectPatternPreference`
    // (+ `patternRankingWeight`) before the single coach LLM completion.
    // Phase 4.4 — deterministic anti-repeat bias (live mode only; bounded lookup).
    let repetitionPenalty: Record<string, number> | null = null;
    let antiRepeatApplied = false;
    let antiRepeatReason: string | null = null;
    let confidenceSupport: number | null = null;
    if (coachReplyMode === "live" && input.conversationId) {
      try {
        const recent = await getRecentPatternIntelEvents(input.supabase, {
          userId: input.userId,
          conversationId: input.conversationId,
          limit: 8,
        });

        const recentKeys = recent
          .map((r) => (r.pattern_key ?? r.strategy_tag ?? "").trim())
          .filter(Boolean);
        const lastKey = recentKeys[0] ?? "";
        const last2 = recentKeys.slice(0, 2);

        repetitionPenalty = {};
        // Penalize repeating the exact same route used in the last 1–2 turns.
        for (const pk of last2) {
          repetitionPenalty[pk] = Math.max(
            repetitionPenalty[pk] ?? 0,
            pk === lastKey ? 14 : 9
          );
        }

        // Price objections are frequently single-variant per posture; in that case, we still want
        // deterministic posture softening to take effect as soon as we're in a repeat window.
        if (isPriceFamily && lastKey) {
          antiRepeatApplied = true;
          if (!antiRepeatReason) antiRepeatReason = "price_repeat_window";
        }

        // Phase 4.4 — semantic repetition signals (from persisted pattern_intelligence_events).
        const recentBaseFps = recent
          .map((r) => (r.base_fingerprint ?? "").trim())
          .filter(Boolean);
        const recentFps = recent
          .map((r) => (r.fingerprint ?? "").trim())
          .filter(Boolean);
        const recentPrimarySigs = recent
          .map((r) => (r.primary_response_signature ?? "").trim())
          .filter(Boolean);
        const recentCallReadySigs = recent
          .map((r) => (r.call_ready_signature ?? "").trim())
          .filter(Boolean);

        const lastBaseFp = recentBaseFps[0] ?? "";
        const lastFp = recentFps[0] ?? "";
        const lastPrimarySig = recentPrimarySigs[0] ?? "";
        const lastCallReadySig = recentCallReadySigs[0] ?? "";

        const isPrimarySigRepeat =
          !!lastPrimarySig && recentPrimarySigs.slice(1).includes(lastPrimarySig);
        const isCallReadySigRepeat =
          !!lastCallReadySig && recentCallReadySigs.slice(1).includes(lastCallReadySig);
        const isFingerprintRepeat =
          !!lastFp && recentFps.slice(1).includes(lastFp);
        const isBaseFingerprintRepeat =
          !!lastBaseFp && recentBaseFps.slice(1).includes(lastBaseFp);

        // Strongest: primary response signature repeat → push harder off the last route.
        if (isPrimarySigRepeat && lastKey) {
          repetitionPenalty[lastKey] = Math.max(repetitionPenalty[lastKey] ?? 0, 26);
          antiRepeatApplied = true;
          antiRepeatReason = "primary_signature_repeat";
        }
        // Secondary: call-ready signature repeat.
        if (isCallReadySigRepeat && lastKey) {
          repetitionPenalty[lastKey] = Math.max(repetitionPenalty[lastKey] ?? 0, 20);
          antiRepeatApplied = true;
          if (!antiRepeatReason) antiRepeatReason = "call_ready_signature_repeat";
        }
        // Fingerprint repeat: same baseFingerprint + strategy routing (moderate).
        if (isFingerprintRepeat && lastKey) {
          repetitionPenalty[lastKey] = Math.max(repetitionPenalty[lastKey] ?? 0, 18);
          antiRepeatApplied = true;
          if (!antiRepeatReason) antiRepeatReason = "fingerprint_repeat";
        }

        const baseFp = buildBaseFingerprintV44({
          objectionFamily: objectionTagBundle.primaryObjectionType ?? null,
          objectionType: normalizedObjectionType,
          tone: resolvedTone.tone ?? null,
          coachReplyMode,
          dealType: resolved.dealType,
        });
        const baseSeen = recent.filter((r) => (r.base_fingerprint ?? "") === baseFp).length;
        if (baseSeen >= 2 && lastKey) {
          repetitionPenalty[lastKey] = Math.max(repetitionPenalty[lastKey] ?? 0, 18);
          antiRepeatApplied = true;
          if (!antiRepeatReason) antiRepeatReason = "base_fingerprint_repeat";
        }

        // Price objection softening: when repetition pressure is present, allow routing posture to shift
        // deterministically within the already-supported pattern pool (no randomness).
        if (isPriceFamily && antiRepeatApplied) {
          // Price hard-override stays intact (family is unchanged). Under repetition pressure only,
          // allow deterministic posture shift to unlock an alternate approved pattern pool.
          postureForRouting = "balanced";
        }

        // Strategy repeat frequency (recent window): light penalty for overuse (routing bias).
        const counts = new Map<string, number>();
        for (const k of recentKeys.slice(0, 6)) {
          counts.set(k, (counts.get(k) ?? 0) + 1);
        }
        for (const [k, cnt] of counts.entries()) {
          if (cnt >= 2) {
            repetitionPenalty[k] = Math.max(repetitionPenalty[k] ?? 0, 8 + (cnt - 2) * 3);
          }
        }

        // Confidence support: deterministic integer in [-4..4]
        let cs = 0;
        if (baseSeen >= 1) cs += 2;
        if (isBaseFingerprintRepeat) cs -= 1;
        if (isFingerprintRepeat) cs -= 1;
        if (isCallReadySigRepeat) cs -= 2;
        if (isPrimarySigRepeat) cs -= 3;
        if (lastKey && recentKeys[0] === lastKey) cs -= 1;
        confidenceSupport = Math.max(-4, Math.min(4, cs));
      } catch {
        repetitionPenalty = null;
        antiRepeatApplied = false;
        antiRepeatReason = null;
        confidenceSupport = null;
      }
    }

    const { pattern, selection } =
      await resolveObjectionResponsePatternWithSelection(
        {
          objectionType: normalizedObjectionType,
          posture: postureForRouting,
          dealType: resolved.dealType,
        },
        {
          statsProvider,
          advancedStrategies: entitlements.advancedStrategies,
          objectionTags: objectionTagBundle.objectionTags,
          primaryObjectionType: objectionTagBundle.primaryObjectionType,
          repetitionPenalty,
        }
      );
    if (entitlements.advancedStrategies && pattern.strategyTag) {
      strategyTagForTracking = pattern.strategyTag;
      console.info(
        `[coachChatReply] Pro strategy augmentation applied for user ${input.userId}: ${pattern.strategyTag} (${normalizedObjectionType})`
      );
    }
    patternSnapshot = buildPatternSnapshot({
      objectionCategory: normalizedObjectionType,
      posture: guidance.posture,
      dealTypeLabel: resolved.dealType,
      pattern,
    });
    patternSelectionMeta = {
      selectedPatternKey: selection.selected.patternKey,
      selectedSource: selection.selected.source,
      scoredCandidates: selection.scoredCandidates,
      ...(coachReplyMode === "live" && {
        antiRepeatApplied: antiRepeatApplied || false,
        antiRepeatReason,
        confidenceSupport,
      }),
    };
    timingMs.ranking_ms = Math.round(performance.now() - tRankingStart);
    patternForDeferred = pattern;
    guidancePostureForDeferred = guidance.posture;

    if (insight.hasInsight && insight.summary) {
      systemContent += `\n\nDEAL CONTEXT (computed):\n${insight.summary}`;
      if (
        !isInstantPrecall &&
        insight.flags &&
        Object.keys(insight.flags).length > 0
      ) {
        systemContent += `\n\nDEAL SIGNALS:\n${JSON.stringify(insight.flags)}`;
      }
    }

    if (canonicalMca != null) {
      systemContent += `\n\n${formatAuthoritativeMcaBlock(canonicalMca)}`;
      systemContent += `\n\n${AUTHORITATIVE_DEAL_GROUNDING}`;
    }

    if (canonicalLoc != null) {
      systemContent += `\n\n${formatAuthoritativeLocBlock(canonicalLoc)}`;
      systemContent += `\n\n${AUTHORITATIVE_LOC_GROUNDING}`;
      systemContent += `\n\n${THREAD_PRODUCT_LOC}`;
    }

    const clientContextBlock = isInstantPrecall
      ? buildClientContextInsightCompressed(input.clientContext ?? null)
      : buildClientContextInsight(input.clientContext ?? null);
    if (clientContextBlock) {
      systemContent += `\n\n${clientContextBlock}`;
    }

    if (resolvedTone.tone) {
      systemContent += `\n\nTONE OVERRIDE:\n- Requested tone: ${resolvedTone.tone}\n- ${toneModePromptInstruction(resolvedTone.tone)}`;
    }

    if (
      objectionTagBundle?.objectionTags.some((o) => o.tag === "trust_risk") ||
      objectionTagBundle?.objectionTags.some((o) => o.tag === "confusion_clarity")
    ) {
      systemContent +=
        "\n\nOBJECTION TAG BIAS (tone): Prefer transparent, plain-number explanations over jargon when drafting scripts.";
    }

    if (priorityGeneration) {
      systemContent +=
        "\n\nPRIORITY GENERATION:\n- This is a Pro priority request. Keep reasoning tight and output high-signal without unnecessary delay.";
    }

    if (input.dealContext != null) {
      systemContent += `\n\nCOACHING POSTURE (${guidance.posture}):\n${postureSystemInstructions(guidance.posture)}`;
      systemContent += `\nPriority: ${guidance.coachingPriority}. Target tone: ${guidance.recommendedToneShift}. Risk level (signal): ${guidance.riskLevel}.`;
      systemContent += `\n\nCOACHING FOCUS:\n- Primary: ${guidance.coachingPriority}\n- Secondary: operational_execution`;

      const flagRecord = insight.flags as Record<string, unknown> | undefined;
      const existing = flagRecord?.strategy_tags;
      const tags: string[] = [];
      if (Array.isArray(existing)) {
        for (const t of existing) {
          if (typeof t === "string") tags.push(t);
        }
      }
      tags.push(strategyTagForPosture(guidance.posture));
      if (pattern.strategyTag) {
        tags.push(pattern.strategyTag);
      }
      systemContent += `\n\nSTRATEGY_TAGS (extend):\n${tags.join(", ")}`;

      const instantPrecallLite =
        coachReplyMode === "precall" && preCallDepth === "instant";
      if (!instantPrecallLite) {
        systemContent += `\n\n${formatResponsePatternBlock(pattern)}`;
        systemContent += `\n\n${formatConfidenceStyleBlock(pattern)}`;
        systemContent += `\n\n${CONFIDENCE_SECTION_CONSISTENCY}`;
        systemContent += `\n\nCONFIDENCE ALIGNMENT:\n${confidenceAlignmentInstructions(pattern.confidenceStyle)}`;
      }
      if (guidance.posture === "controlled_assertive") {
        systemContent += `\n\n${EMPATHY_CONSTRAINT_CONTROLLED_ASSERTIVE}`;
      }
      if (coachReplyMode === "live") {
        systemContent += `\n\nOPENING LINE (rebuttal only — start the first rebuttal script with this phrase or a minimal grammatical tweak; use once, not in coach note or follow-up; avoid generic openers like "Let me make this simple", "Here's the real picture", or "Let's put this in perspective"):\n${getOpeningLineVariant(guidance.posture, input.conversationId ?? undefined)}`;
      }
      if (!instantPrecallLite) {
        systemContent += `\n\nPATTERN ALIGNMENT:\n${responsePatternAlignmentInstructions(pattern)}`;
      }
    }
    tAfterPromptContext = performance.now();
  } catch {
    /* keep base prompt only */
    tAfterPromptContext = performance.now();
  }

  if (coachReplyMode === "precall") {
    const fallbackTag =
      objectionTagBundle?.primaryObjectionType ??
      normalizeObjectionCategory(
        input.objectionType?.trim() ||
          inferObjectionCategoryFromMessage(input.userMessage)
      );
    precallPrimaryContract = resolvePrecallPrimaryContractKind({
      userMessage: input.userMessage,
      primaryObjectionTag: fallbackTag,
    });
  }

  let systemContentForMarkers = systemContent;
  if (
    coachReplyMode === "precall" &&
    precallPrimaryContract === "standard" &&
    preCallDepth !== "instant"
  ) {
    const slugForPatterns =
      objectionTagBundle?.primaryObjectionType ??
      normalizeObjectionCategory(
        input.objectionType?.trim() ||
          inferObjectionCategoryFromMessage(input.userMessage)
      );
    systemContentForMarkers += `\n\n${buildPrecallPatternDriverBlock(
      selectPatterns(slugForPatterns),
      input.userMessage
    )}`;
  }
  if (coachReplyMode === "precall" && preCallDepth === "deep") {
    systemContentForMarkers += `\n\n${PRECALL_DEEP_OUTPUT_HINT}`;
  }
  const liveIntent =
    coachReplyMode === "live" ? classifyLiveIntent(input.userMessage) : null;
  const systemContentBase = `${systemContentForMarkers}${liveIntentSystemAppend(liveIntent)}`;
  systemContent = `${systemContentBase}\n\n${
    coachReplyMode === "precall"
      ? precallPrimaryContract === "number"
        ? MARKER_OUTPUT_CONTRACT_PRECALL_NUMBER
        : preCallDepth === "instant"
          ? MARKER_OUTPUT_CONTRACT_PRECALL_INSTANT
          : MARKER_OUTPUT_CONTRACT_PRECALL_STANDARD
      : MARKER_OUTPUT_CONTRACT_FAST
  }`;

  const objectionClassification =
    objectionTagBundle ??
    resolvePrimaryAndSecondaryObjections({
      userMessage: input.userMessage,
      legacyNormalizedCategory:
        normalizedObjectionTypeForTracking ??
        normalizeObjectionCategory(
          input.objectionType?.trim() ||
            inferObjectionCategoryFromMessage(input.userMessage)
        ),
      dealTypeLabel: patternSnapshot?.dealType ?? null,
      posture: patternSnapshot?.posture ?? null,
      dealContext: input.dealContext ?? null,
      conversationHistory: {
        priorUserMessages: threadTail
          .filter((m) => m.role === "user")
          .map((m) => m.content),
      },
    });

  const enrichStructuredWithTags = (
    sr: AssistantStructuredReply
  ): AssistantStructuredReply =>
    enrichAssistantStructuredReplyWithObjectionTags(sr, objectionClassification);

  const structuredFrom = (
    replyText: string,
    analytics?: PatternAnalyticsPayload
  ): AssistantStructuredReply =>
    buildAssistantStructuredReply({
      text: replyText,
      objectionType:
        analytics?.objectionCategory ??
        normalizedObjectionTypeForTracking ??
        null,
      toneUsed: resolvedToneForTracking ?? null,
      patternInsights: patternInsightsPayload,
      explanation: patternExplanation,
      coachInsightLine:
        analytics?.objectionCategory != null
          ? coachInsightFraming(analytics.objectionCategory)
          : null,
    });

  /**
   * Parse only after full model output (buffered or completed stream).
   * Streaming must finish before this runs — rawModelText is the full accumulated string.
   */
  const finalizeCoachLlmReply = (
    rawModelText: string
  ): {
    text: string;
    structuredReply: AssistantStructuredReply;
    fallbackUsed: boolean;
  } => {
    const rawTrim = trimUsable(rawModelText);
    if (!rawTrim) {
      console.warn("[COACH_REPLY_EMPTY_MODEL_OUTPUT] using structured fallback without debug copy");
      const safeLine = injectDecisionPattern("");
      let structuredReply = enrichStructuredWithTags(
        structuredFrom(safeLine, patternSnapshot)
      );
      structuredReply = applyTemporaryOpeningGuardrail(structuredReply);
      structuredReply = applyFirstRebuttalSayThisDebugGuardrail(structuredReply);
      let finalText = resolveUserVisiblePrimaryText({
        structuredReply,
        rawModelText: null,
        generatedText: safeLine,
        fallbackText: COACH_REPLY_FALLBACK_TEXT,
        patternSnapshot,
      });
      if (!trimUsable(finalText)) {
        console.warn(
          "[V9.6 FALLBACK TRIGGERED — forced decision pattern injected]"
        );
        structuredReply = enrichStructuredWithTags(
          structuredFrom(injectDecisionPattern(""), patternSnapshot)
        );
        structuredReply = applyTemporaryOpeningGuardrail(structuredReply);
        structuredReply = applyFirstRebuttalSayThisDebugGuardrail(structuredReply);
        finalText = injectDecisionPattern("");
      }
      return {
        text: finalText,
        structuredReply,
        fallbackUsed: true,
      };
    }
    const fastResult = parseFastStructuredCoachOutput(rawModelText);

    let structuredReply: AssistantStructuredReply;
    let generatedCandidate: string;
    let parseFailed = false;

    if (fastResult.parsed) {
      structuredReply = enrichStructuredWithTags(fastResult.structured);
      generatedCandidate = formatStructuredCoachReplyToContent(
        fastResult.structured
      );
    } else {
      const fullMarker = parseStructuredCoachOutputToAssistantReply(rawModelText);
      if (fullMarker != null) {
        structuredReply = enrichStructuredWithTags(fullMarker);
        generatedCandidate = formatStructuredCoachReplyToContent(fullMarker);
      } else {
        parseFailed = true;
        const primary =
          trimUsable(fastResult.primary) ||
          rawTrim ||
          trimUsable(rawModelText);
        structuredReply = enrichStructuredWithTags(
          structuredFrom(
            primary.length > 0 ? primary : rawModelText,
            patternSnapshot
          )
        );
        generatedCandidate =
          primary.length > 0 ? primary : rawModelText.trim();
      }
    }

    structuredReply = applyTemporaryOpeningGuardrail(structuredReply);
    structuredReply = applyFirstRebuttalSayThisDebugGuardrail(structuredReply);

    let fallbackUsed = parseFailed;

    let finalText = resolveUserVisiblePrimaryText({
      structuredReply,
      rawModelText: rawTrim,
      generatedText: generatedCandidate,
      fallbackText: COACH_REPLY_FALLBACK_TEXT,
      patternSnapshot,
    });
    if (!trimUsable(finalText)) {
      console.warn(
        "[V9.6 FALLBACK TRIGGERED — forced decision pattern injected]"
      );
      const safeLine = injectDecisionPattern("");
      structuredReply = enrichStructuredWithTags(
        structuredFrom(safeLine, patternSnapshot)
      );
      structuredReply = applyTemporaryOpeningGuardrail(structuredReply);
      structuredReply = applyFirstRebuttalSayThisDebugGuardrail(structuredReply);
      finalText = resolveUserVisiblePrimaryText({
        structuredReply,
        rawModelText: rawTrim,
        generatedText: safeLine,
        fallbackText: COACH_REPLY_FALLBACK_TEXT,
        patternSnapshot,
      });
      if (!trimUsable(finalText)) {
        finalText = safeLine;
      }
      fallbackUsed = true;
    }

    return {
      text: finalText,
      structuredReply,
      fallbackUsed,
    };
  };

  const tGenerationStart = performance.now();

  if (
    coachReplyMode !== "live" &&
    canonicalLoc != null &&
    isDirectLocDealQuestion(input.userMessage)
  ) {
    const directLocText = tryAnswerDirectLocQuestion(
      input.userMessage,
      canonicalLoc
    );
    if (directLocText != null) {
      const locObjectionCategory = locDirectObjectionCategorySlug(
        input.userMessage
      );
      const patternSnapshotLoc =
        patternSnapshot != null
          ? {
              ...patternSnapshot,
              objectionCategory: locObjectionCategory,
              patternKey: buildPatternKey({
                objectionCategory: locObjectionCategory,
                posture: patternSnapshot.posture,
                dealType: patternSnapshot.dealType,
                rebuttalStyle: patternSnapshot.rebuttalStyle,
                followUpStyle: patternSnapshot.followUpStyle,
                confidenceStyle: patternSnapshot.confidenceStyle,
              }),
            }
          : undefined;
      if (patternSelectionMeta && patternSnapshot) {
        const statsProviderLoc = createPatternStatsProvider(input.supabase);
        const statsLoc = await statsProviderLoc.getStats([
          patternSelectionMeta.selectedPatternKey,
        ]);
        const selStats = statsLoc[patternSelectionMeta.selectedPatternKey];
        const ib = buildPatternInsightsPayload({
          selectedPatternKey: patternSelectionMeta.selectedPatternKey,
          selectedSource: patternSelectionMeta.selectedSource,
          stats: selStats,
          objectionCategory: locObjectionCategory,
          posture: patternSnapshot.posture as DealCoachingPosture,
          rebuttalStyle: patternSnapshot.rebuttalStyle,
        });
        patternInsightsPayload = ib.patternInsights;
        patternExplanation = ib.explanation;
      }
      timingMs.generation_ms = Math.round(
        performance.now() - tGenerationStart
      );
      mark("after_llm");
      console.info(
        `[coachChatReply] latency_ms plan=${resolvedPlanType} direct_loc_fact`,
        { ...timingMs, total: Math.round(performance.now() - t0) }
      );
      trackEvent(console, {
        eventName: "response_generated",
        planType: resolvedPlanType,
        conversationId: input.conversationId ?? null,
        priorityGeneration,
        responseVariants: responseVariantsForTracking ?? null,
        tone: resolvedToneForTracking ?? null,
        objectionType: locObjectionCategory,
        strategyTag: strategyTagForTracking ?? null,
        surface: "coachChatReply:direct_loc",
      });
      await incrementUsageCount(input.supabase, input.userId);
      if (patternSnapshotLoc) {
        logResponseGeneratedAndAggregate(
          input.supabase,
          patternSnapshotLoc,
          input.conversationId
        );
      }
      const usageSnap = await getFreeTierUsageSnapshot(
        input.supabase,
        input.userId
      );
      mark("after_usage_snapshot");
      const locStructured = enrichStructuredWithTags(
        structuredFrom(directLocText, patternSnapshotLoc ?? patternSnapshot)
      );
      const locApplied = applyCoachReplyModeToSuccessPayload({
        mode: coachReplyMode,
        text: directLocText,
        structuredReply: locStructured,
        precallDepth:
          coachReplyMode === "precall" ? preCallDepth : undefined,
        patternInsights: patternInsightsPayload,
        explanation: patternExplanation,
        deferredEnrichment: undefined,
      });
      return {
        ok: true,
        text: locApplied.text,
        structuredReply: locApplied.structuredReply,
        patternAnalytics: patternSnapshotLoc ?? patternSnapshot,
        patternSelection: patternSelectionMeta,
        ...(locApplied.patternInsights != null
          ? { patternInsights: locApplied.patternInsights as PatternInsightsPayload }
          : {}),
        ...(locApplied.explanation != null
          ? { explanation: locApplied.explanation as string }
          : {}),
        appliedTone: resolvedToneForTracking ?? null,
        timingMs: { ...timingMs, total: Math.round(performance.now() - t0) },
        ...(usageSnap != null ? { usage: usageSnap } : {}),
      };
    }
  }

  if (
    coachReplyMode !== "live" &&
    canonicalMca != null &&
    isDirectMcaDealQuestion(input.userMessage)
  ) {
    const directText = tryAnswerDirectMcaQuestion(
      input.userMessage,
      canonicalMca
    );
    if (directText != null) {
      if (patternSelectionMeta && patternSnapshot) {
        const statsProviderMca = createPatternStatsProvider(input.supabase);
        const statsMca = await statsProviderMca.getStats([
          patternSelectionMeta.selectedPatternKey,
        ]);
        const selStatsMca = statsMca[patternSelectionMeta.selectedPatternKey];
        const ibMca = buildPatternInsightsPayload({
          selectedPatternKey: patternSelectionMeta.selectedPatternKey,
          selectedSource: patternSelectionMeta.selectedSource,
          stats: selStatsMca,
          objectionCategory: normalizedObjectionTypeForTracking ?? "unknown",
          posture: patternSnapshot.posture as DealCoachingPosture,
          rebuttalStyle: patternSnapshot.rebuttalStyle,
        });
        patternInsightsPayload = ibMca.patternInsights;
        patternExplanation = ibMca.explanation;
      }
      timingMs.generation_ms = Math.round(
        performance.now() - tGenerationStart
      );
      mark("after_llm");
      console.info(
        `[coachChatReply] latency_ms plan=${resolvedPlanType} direct_mca_fact`,
        { ...timingMs, total: Math.round(performance.now() - t0) }
      );
      trackEvent(console, {
        eventName: "response_generated",
        planType: resolvedPlanType,
        conversationId: input.conversationId ?? null,
        priorityGeneration,
        responseVariants: responseVariantsForTracking ?? null,
        tone: resolvedToneForTracking ?? null,
        objectionType: normalizedObjectionTypeForTracking ?? null,
        strategyTag: strategyTagForTracking ?? null,
        surface: "coachChatReply:direct_mca",
      });
      await incrementUsageCount(input.supabase, input.userId);
      if (patternSnapshot) {
        logResponseGeneratedAndAggregate(
          input.supabase,
          patternSnapshot,
          input.conversationId
        );
      }
      const usageSnap = await getFreeTierUsageSnapshot(
        input.supabase,
        input.userId
      );
      mark("after_usage_snapshot");
      const mcaStructured = enrichStructuredWithTags(
        structuredFrom(directText, patternSnapshot)
      );
      const mcaApplied = applyCoachReplyModeToSuccessPayload({
        mode: coachReplyMode,
        text: directText,
        structuredReply: mcaStructured,
        precallDepth:
          coachReplyMode === "precall" ? preCallDepth : undefined,
        patternInsights: patternInsightsPayload,
        explanation: patternExplanation,
        deferredEnrichment: undefined,
      });
      return {
        ok: true,
        text: mcaApplied.text,
        structuredReply: mcaApplied.structuredReply,
        patternAnalytics: patternSnapshot,
        patternSelection: patternSelectionMeta,
        ...(mcaApplied.patternInsights != null
          ? { patternInsights: mcaApplied.patternInsights as PatternInsightsPayload }
          : {}),
        ...(mcaApplied.explanation != null
          ? { explanation: mcaApplied.explanation as string }
          : {}),
        appliedTone: resolvedToneForTracking ?? null,
        timingMs: { ...timingMs, total: Math.round(performance.now() - t0) },
        ...(usageSnap != null ? { usage: usageSnap } : {}),
      };
    }
  }

  tBeforeLlm = performance.now();

  const messages: ChatMessage[] = [
    { role: "system", content: systemContent },
    ...prior,
    { role: "user", content: input.userMessage },
  ];

  const liveCfg = resolveLiveCoachModelConfig();
  const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL?.trim();
  const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN?.trim();
  const hasGateway = !!(gatewayUrl && gatewayToken);
  /** When API key exists, use direct OpenAI only (do not call gateway). */
  const useGatewayFirst = hasGateway && !liveCfg.hasOpenAiKey;

  const { model: coachPrimaryCompletionModel, modelSource: coachPrimaryModelSource } =
    resolveCoachPrimaryCompletionModelSelection({
      useGatewayFirst,
      isInstantPrecall,
      liveCfg,
    });

  let messagesForLlm = normalizeChatMessagesForOpenAi(messages);
  await runOpenAiDirectMinimalProbe(
    liveCfg.hasOpenAiKey ? coachPrimaryCompletionModel : COACH_LIVE_MODEL_DEFAULT
  );
  if (
    process.env.COACH_OPENAI_MINIMAL_PROBE?.trim() === "1" &&
    liveCfg.hasOpenAiKey
  ) {
    messagesForLlm = normalizeChatMessagesForOpenAi(MINIMAL_PROBE_MESSAGES);
  }

  const baseOpts: CoachChatCompletionOptions & {
    onStreamDelta?: (chunk: string) => void;
  } = {
    priorityGeneration,
    planType: resolvedPlanType,
    conversationId: input.conversationId,
    tone: resolvedToneForTracking,
    onStreamDelta: input.onStreamDelta,
  };

  const finishSuccessfulLlm = async (
    text: string
  ): Promise<Extract<CoachReplyResult, { ok: true }>> => {
    timingMs.generation_ms = Math.round(performance.now() - tGenerationStart);
    timingMs.total_ms = Math.round(performance.now() - t0);
    mark("after_llm");
    console.info("[coachChatReply] timings_ms", {
      classification_ms: timingMs.classification_ms,
      ranking_ms: timingMs.ranking_ms,
      generation_ms: timingMs.generation_ms,
      total_ms: timingMs.total_ms,
    });
    console.info(
      `[coachChatReply] latency_ms plan=${resolvedPlanType}`,
      { ...timingMs, total: timingMs.total_ms }
    );
    trackEvent(console, {
      eventName: "response_generated",
      planType: resolvedPlanType,
      conversationId: input.conversationId ?? null,
      priorityGeneration,
      responseVariants: responseVariantsForTracking ?? null,
      tone: resolvedToneForTracking ?? null,
      objectionType: normalizedObjectionTypeForTracking ?? null,
      strategyTag: strategyTagForTracking ?? null,
      surface: "coachChatReply",
    });
    await incrementUsageCount(input.supabase, input.userId);
    if (patternSnapshot) {
      logResponseGeneratedAndAggregate(
        input.supabase,
        patternSnapshot,
        input.conversationId
      );
    }
    const usageSnap = await getFreeTierUsageSnapshot(
      input.supabase,
      input.userId
    );
    mark("after_usage_snapshot");
    const tParseStart = performance.now();
    const out = finalizeCoachLlmReply(text);
    /** Parse-time variant pool (`rebuttals[0].variants`) before live/precall transforms may strip extras. */
    const phase45VariantPool = extractPhase45VariantPool(out.structuredReply);
    const tParseEnd = performance.now();
    if (
      isInstantPrecall &&
      process.env.COACH_PRECALL_INSTANT_TIMING?.trim() === "1"
    ) {
      console.info("[precall_instant_timing_ms]", {
        model_used: coachPrimaryCompletionModel,
        model_source: coachPrimaryModelSource,
        db_usage_plan_ms: Math.round(tAfterDb - t0),
        context_classification_ranking_ms: Math.round(
          tAfterPromptContext - tAfterDb
        ),
        prompt_finalize_contract_ms: Math.round(
          tBeforeLlm - tAfterPromptContext
        ),
        model_roundtrip_ms: timingMs.generation_ms,
        parse_post_process_ms: Math.round(tParseEnd - tParseStart),
        total_ms: Math.round(tParseEnd - t0),
      });
    }

    let structuredAfterPatterns = out.structuredReply;
    let textAfterPatterns = out.text;
    let livePatternIntelDebug: LivePatternDebugMeta | null = null;
    if (
      coachReplyMode === "precall" &&
      preCallDepth !== "instant" &&
      structuredAfterPatterns.precallArtifact === "v102_standard"
    ) {
      const slugForIntel =
        objectionTagBundle?.primaryObjectionType ??
        normalizedObjectionTypeForTracking ??
        null;
      structuredAfterPatterns = await applyPrecallPatternIntelligence(
        structuredAfterPatterns,
        {
          precallArtifact: structuredAfterPatterns.precallArtifact,
          objectionSlug: slugForIntel,
          objectionType:
            structuredAfterPatterns.precallObjectionTypeLabel?.trim() ||
            slugForIntel,
          userMessage: input.userMessage,
          dealContext: input.dealContext ?? undefined,
          regenerateLane2IfSimilar:
            liveCfg.hasOpenAiKey &&
            structuredAfterPatterns.precallLane1?.trim() &&
            structuredAfterPatterns.precallLane2?.trim()
              ? async (args) => {
                  try {
                    const res = await callOpenAiDirectChatCompletionsWithLogs(
                      liveCfg.resolvedModel,
                      [
                        {
                          role: "system",
                          content: `You rewrite ONLY the second merchant-facing rebuttal line.

Pattern (mandatory): ${args.lane2Pattern}
Meaning: ${patternDescriptions[args.lane2Pattern]}

Constraints:
- One or two short sentences, max ~35 words total
- Must NOT reuse phrasing or structure from Lane 1
- Different persuasion angle than Lane 1
- No question marks
- Direct spoken dialogue

Return ONLY the rebuttal line, no quotes or labels.`,
                        },
                        {
                          role: "user",
                          content: `Objection: ${args.userMessage.replace(/\s+/g, " ").trim().slice(0, 1500)}

Lane 1 (do not mimic): ${args.lane1}

Too-similar Lane 2 (replace completely): ${args.lane2}`,
                        },
                      ],
                      220,
                      baseOpts
                    );
                    return res.rawModelText?.trim() ?? null;
                  } catch {
                    return null;
                  }
                }
              : null,
        }
      );
      const regen = formatStructuredCoachReplyToContent(structuredAfterPatterns);
      textAfterPatterns = resolveUserVisiblePrimaryText({
        structuredReply: structuredAfterPatterns,
        rawModelText: text,
        generatedText: regen,
        fallbackText: COACH_REPLY_FALLBACK_TEXT,
        patternSnapshot,
      });
    }

    structuredAfterPatterns =
      attachPrecallPrimaryTacticalPattern(structuredAfterPatterns);

    if (coachReplyMode === "live") {
      const lastAssistantPattern =
        getLastAssistantPatternFromConversation(input.priorMessages);
      const livePatternContext: PatternContext = {
        lastPatternUsed: lastAssistantPattern,
      };
      structuredAfterPatterns = applyLiveResponseRefinement(
        structuredAfterPatterns,
        input.userMessage,
        livePatternContext,
        (m) => {
          livePatternIntelDebug = m;
        }
      );
      if (livePatternIntelDebug) {
        structuredAfterPatterns = {
          ...structuredAfterPatterns,
          liveResponseVisibility: buildLiveResponseVisibility(
            livePatternIntelDebug,
            input.userMessage
          ),
        };
      }
      const refinedSay =
        structuredAfterPatterns.rebuttals?.[0]?.sayThis?.trim() ?? "";
      textAfterPatterns = resolveUserVisiblePrimaryText({
        structuredReply: structuredAfterPatterns,
        rawModelText: text,
        generatedText: refinedSay || undefined,
        fallbackText: COACH_REPLY_FALLBACK_TEXT,
        patternSnapshot,
      });
    }

    // Phase 4.5 — deterministic phrasing variation after selection + structured pipeline (optional `variants[]` only).
    const patternRepeatCount = patternRepeatCountForPatternKey(
      input.priorMessages,
      patternSelectionMeta?.selectedPatternKey ?? null
    );
    const callReadySigForDvl = responseSignature(
      extractCallReadyText({
        coachReplyMode,
        structuredReply: structuredAfterPatterns as Record<string, unknown>,
      })
    );
    const phase45Applied = applyDeterministicPhrasingVariationLayer({
      structuredReply: structuredAfterPatterns,
      conversationId: input.conversationId ?? null,
      patternKey: patternSelectionMeta?.selectedPatternKey ?? null,
      callReadySignature: callReadySigForDvl,
      patternRepeatCount,
      variantStringsOverride: phase45VariantPool ?? undefined,
    });
    const dvlApplied = phase45Applied.applied;
    const dvlVariantIndex = phase45Applied.variantIndex;
    structuredAfterPatterns = phase45Applied.structuredReply;
    if (phase45Applied.applied) {
      if (coachReplyMode === "live") {
        const refinedSayAfterDvl =
          structuredAfterPatterns.rebuttals?.[0]?.sayThis?.trim() ?? "";
        textAfterPatterns = resolveUserVisiblePrimaryText({
          structuredReply: structuredAfterPatterns,
          rawModelText: text,
          generatedText: refinedSayAfterDvl || undefined,
          fallbackText: COACH_REPLY_FALLBACK_TEXT,
          patternSnapshot,
        });
      } else {
        const regenAfterDvl = formatStructuredCoachReplyToContent(structuredAfterPatterns);
        textAfterPatterns = resolveUserVisiblePrimaryText({
          structuredReply: structuredAfterPatterns,
          rawModelText: text,
          generatedText: trimUsable(regenAfterDvl) ? regenAfterDvl : undefined,
          fallbackText: COACH_REPLY_FALLBACK_TEXT,
          patternSnapshot,
        });
      }
    }

    // Phase 5.0 — depth degradation by plan (slice AFTER pipeline only).
    if (monetization?.allow && typeof monetization.degrade.maxCandidates === "number") {
      const max = monetization.degrade.maxCandidates;
      const reb = Array.isArray(structuredAfterPatterns.rebuttals)
        ? structuredAfterPatterns.rebuttals
        : [];
      structuredAfterPatterns = {
        ...structuredAfterPatterns,
        rebuttals: reb.slice(0, Math.max(0, max)),
      };
    }

    // Phase 4.7 — decision intelligence (observational only; must not affect selection or text).
    if (patternSelectionMeta) {
      const antiRepeatAppliedMeta = patternSelectionMeta.antiRepeatApplied === true;
      patternSelectionMeta.decisionIntelligence = buildDecisionIntelligenceMeta({
        selection: {
          selected: {
            patternKey: patternSelectionMeta.selectedPatternKey,
            source: patternSelectionMeta.selectedSource,
          } as any,
          scoredCandidates: patternSelectionMeta.scoredCandidates,
        },
        antiRepeatApplied: antiRepeatAppliedMeta,
        antiRepeatReason: patternSelectionMeta.antiRepeatReason ?? null,
        confidenceSupport: patternSelectionMeta.confidenceSupport ?? null,
        dvlApplied,
        variantIndex: dvlVariantIndex,
      });
    }

    logFinalRebuttalObjectDebug({
      structuredReply: structuredAfterPatterns,
      replyText: textAfterPatterns,
      rawModelText: text,
      livePatternIntel: livePatternIntelDebug,
    });
    const deferredEnrichment: CoachDeferredEnrichment | undefined =
      coachReplyMode === "precall" &&
      preCallDepth !== "instant" &&
      patternForDeferred &&
      patternSnapshot &&
      patternSelectionMeta &&
      normalizedObjectionTypeForTracking
        ? {
            userMessage: input.userMessage,
            resolvedPlanType,
            normalizedObjectionType: normalizedObjectionTypeForTracking,
            fastRawMarkerText: text,
            fastStructured: structuredAfterPatterns,
            coachReplyMode: "precall",
            systemContentBase,
            patternSnapshot,
            objectionClassification,
            pattern: patternForDeferred,
            guidancePosture: (guidancePostureForDeferred ??
              patternSnapshot.posture) as DealCoachingPosture,
            dealTypeLabel: patternSnapshot.dealType,
            selectedPatternKey: patternSelectionMeta.selectedPatternKey,
            selectedSource: patternSelectionMeta.selectedSource,
            rebuttalStyle: patternForDeferred.rebuttalStyle,
            resolvedToneForTracking,
            priorityGeneration,
          }
        : undefined;
    const modeApplied = applyCoachReplyModeToSuccessPayload({
      mode: coachReplyMode,
      text: textAfterPatterns,
      structuredReply: structuredAfterPatterns,
      precallDepth:
        coachReplyMode === "precall" ? preCallDepth : undefined,
      patternInsights: patternInsightsPayload,
      explanation: patternExplanation,
      deferredEnrichment,
    });
    return {
      ok: true,
      text: modeApplied.text,
      structuredReply: modeApplied.structuredReply,
      patternAnalytics: patternSnapshot,
      patternSelection: patternSelectionMeta,
      appliedTone: resolvedToneForTracking ?? null,
      timingMs: { ...timingMs, total: timingMs.total_ms ?? Math.round(performance.now() - t0) },
      ...(usageSnap != null ? { usage: usageSnap } : {}),
      ...(modeApplied.deferredEnrichment != null
        ? { deferredEnrichment: modeApplied.deferredEnrichment as CoachDeferredEnrichment }
        : {}),
      ...(out.fallbackUsed ? { fallbackUsed: true } : {}),
      ...(modeApplied.patternInsights != null
        ? { patternInsights: modeApplied.patternInsights as PatternInsightsPayload }
        : {}),
      ...(modeApplied.explanation != null
        ? { explanation: modeApplied.explanation as string }
        : {}),
    };
  };

  /** Precall / live: up to {@link PRIMARY_COMPLETION_MAX_RETRIES} tries; last failure gets a decision-pattern patch (no extra LLM). Minimal probe: single pass-through. */
  const runPrimaryCompletionWithValidation = async (
    invoke: (msgs: ChatMessage[], stream: boolean) => Promise<string>
  ): Promise<string> => {
    if (process.env.COACH_OPENAI_MINIMAL_PROBE?.trim() === "1") {
      return invoke(messagesForLlm, !!input.onStreamDelta);
    }
    if (coachReplyMode === "live") {
      let msgs = messagesForLlm;
      let last = "";
      for (let attempt = 0; attempt < PRIMARY_COMPLETION_MAX_RETRIES; attempt++) {
        const stream = attempt === 0 && !!input.onStreamDelta;
        last = await invoke(msgs, stream);
        const opening = extractPrecallOpeningBodyForValidation(last);
        if (opening == null) {
          console.warn("[live_validation] missing_opening_block");
          if (attempt === PRIMARY_COMPLETION_MAX_RETRIES - 1) {
            console.warn(
              "[V9.6 FALLBACK TRIGGERED — forced decision pattern injected]"
            );
            return applyForcedDecisionPatternPatchLive(last);
          }
          msgs = normalizeChatMessagesForOpenAi([
            ...msgs,
            {
              role: "user",
              content: buildLiveRegenerationUserMessage([
                "missing_opening_block",
              ]),
            },
          ]);
          continue;
        }
        const v = validateLiveOpeningShape(opening);
        if (v.ok) {
          // LIVE ONLY (V1): store only final validated opening body (no failed attempts).
          saveObjectionMemory({
            id: randomUUID(),
            conversationId: input.conversationId ?? "unknown",
            rawUserMessage: input.userMessage,
            normalizedObjectionType: normalizedObjectionTypeForMemory,
            objectionAssertionFamily: objectionAssertionFamilyForMemory,
            generatedOpening: opening,
            canonicalKey: "",
            signalKey: "",
            variationHash: "",
            usageCount: 0,
            lastUsedAt: undefined,
            createdAt: new Date().toISOString(),
          });
          return last;
        }
        console.warn("[live_validation] failed", v.reasons);
        if (attempt === PRIMARY_COMPLETION_MAX_RETRIES - 1) {
          console.warn(
            "[V9.6 FALLBACK TRIGGERED — forced decision pattern injected]"
          );
          return applyForcedDecisionPatternPatchLive(last);
        }
        msgs = normalizeChatMessagesForOpenAi([
          ...msgs,
          { role: "user", content: buildLiveRegenerationUserMessage(v.reasons) },
        ]);
      }
      return last;
    }
    if (coachReplyMode === "precall") {
      let msgs = messagesForLlm;
      let last = "";
      for (let attempt = 0; attempt < PRIMARY_COMPLETION_MAX_RETRIES; attempt++) {
        const stream = attempt === 0 && !!input.onStreamDelta;
        last = await invoke(msgs, stream);
        if (precallPrimaryContract === "number") {
          if (!precallPrimaryHasV102NumberContract(last)) {
            console.warn("[precall_validation] missing_v102_number_contract");
            if (attempt === PRIMARY_COMPLETION_MAX_RETRIES - 1) {
              return last;
            }
            msgs = normalizeChatMessagesForOpenAi([
              ...msgs,
              {
                role: "user",
                content: buildPrecallRegenerationUserMessage(
                  ["missing_v102_number_contract"],
                  "number"
                ),
              },
            ]);
            continue;
          }
          const vn = validatePrecallV102Number(last);
          if (!vn.ok) {
            console.warn("[precall_validation] v102_number_failed", vn.reasons);
            if (attempt === PRIMARY_COMPLETION_MAX_RETRIES - 1) {
              console.warn(
                "[V9.6 FALLBACK TRIGGERED — forced decision pattern injected]"
              );
              return applyForcedDecisionPatternPatchPrecallNumber(last);
            }
            msgs = normalizeChatMessagesForOpenAi([
              ...msgs,
              {
                role: "user",
                content: buildPrecallRegenerationUserMessage(vn.reasons, "number"),
              },
            ]);
            continue;
          }
          return last;
        }

        if (preCallDepth === "instant" && precallPrimaryContract === "standard") {
          if (!precallPrimaryHasV102InstantContract(last)) {
            console.warn("[precall_validation] missing_v102_instant_contract");
            if (attempt === PRIMARY_COMPLETION_MAX_RETRIES - 1) {
              return last;
            }
            msgs = normalizeChatMessagesForOpenAi([
              ...msgs,
              {
                role: "user",
                content: buildPrecallRegenerationUserMessage(
                  ["missing_v102_instant_contract"],
                  "instant"
                ),
              },
            ]);
            continue;
          }
          const vi = validatePrecallV102Instant(last);
          if (!vi.ok) {
            console.warn("[precall_validation] v102_instant_failed", vi.reasons);
            if (attempt === PRIMARY_COMPLETION_MAX_RETRIES - 1) {
              console.warn(
                "[V9.6 FALLBACK TRIGGERED — forced decision pattern injected]"
              );
              return applyForcedDecisionPatternPatchPrecallInstant(last);
            }
            msgs = normalizeChatMessagesForOpenAi([
              ...msgs,
              {
                role: "user",
                content: buildPrecallRegenerationUserMessage(vi.reasons, "instant"),
              },
            ]);
            continue;
          }
          return last;
        }

        if (!precallPrimaryHasV102StandardContract(last)) {
          console.warn("[precall_validation] missing_v102_standard_contract");
          if (attempt === PRIMARY_COMPLETION_MAX_RETRIES - 1) {
            return last;
          }
          msgs = normalizeChatMessagesForOpenAi([
            ...msgs,
            {
              role: "user",
              content: buildPrecallRegenerationUserMessage(
                ["missing_v102_standard_contract"],
                "standard"
              ),
            },
          ]);
          continue;
        }
        const vs = validatePrecallV102Standard(last);
        if (!vs.ok) {
          console.warn("[precall_validation] v102_standard_failed", vs.reasons);
          if (attempt === PRIMARY_COMPLETION_MAX_RETRIES - 1) {
            console.warn(
              "[V9.6 FALLBACK TRIGGERED — forced decision pattern injected]"
            );
            return applyForcedDecisionPatternPatchPrecallStandard(last);
          }
          msgs = normalizeChatMessagesForOpenAi([
            ...msgs,
            {
              role: "user",
              content: buildPrecallRegenerationUserMessage(vs.reasons, "standard"),
            },
          ]);
          continue;
        }
        return last;
      }
      return last;
    }
    return invoke(messagesForLlm, !!input.onStreamDelta);
  };

  let lastLlmError: unknown;

  if (useGatewayFirst) {
    try {
      const text = await runPrimaryCompletionWithValidation(
        async (msgs, stream) =>
          callCoachChatWithFastMarkerRetry(
            gatewayUrl!,
            `Bearer ${gatewayToken}`,
            coachPrimaryCompletionModel,
            msgs,
            primaryMaxTokens,
            {
              ...baseOpts,
              logLabel: "openclaw",
              onStreamDelta: stream ? input.onStreamDelta : undefined,
            }
          )
      );
      return await finishSuccessfulLlm(text);
    } catch (gwErr) {
      console.warn("[GATEWAY_FAILURE]", serializeErr(gwErr));
      // Gateway path only runs when `!liveCfg.hasOpenAiKey` — no OpenAI fallback here.
      lastLlmError = gwErr;
    }
  } else if (liveCfg.hasOpenAiKey) {
    try {
      const text = await runPrimaryCompletionWithValidation(
        async (msgs, stream) => {
          const direct = await callOpenAiDirectChatCompletionsWithLogs(
            coachPrimaryCompletionModel,
            msgs,
            primaryMaxTokens,
            {
              ...baseOpts,
              logLabel: "openai",
              onStreamDelta: stream ? input.onStreamDelta : undefined,
            }
          );
          return direct.rawModelText;
        }
      );
      return await finishSuccessfulLlm(text);
    } catch (openErr) {
      lastLlmError = openErr;
    }
  }

  if (lastLlmError != null && liveCfg.hasOpenAiKey) {
    const msg =
      lastLlmError instanceof Error
        ? lastLlmError.message
        : String(lastLlmError);
    logOpenAiCallErrorFull(coachPrimaryCompletionModel, lastLlmError);
    console.warn(
      `[coachChatReply] OpenAI path failed (after gateway or direct): ${msg}`
    );
    if (patternSnapshot) {
      logResponseGeneratedAndAggregate(
        input.supabase,
        patternSnapshot,
        input.conversationId
      );
    }
    mark("after_llm_error_path");
    const modelUsed = coachPrimaryCompletionModel;
    let errStructured = applyTemporaryOpeningGuardrail(
      enrichStructuredWithTags(structuredFrom("", patternSnapshot))
    );
    errStructured = applyFirstRebuttalSayThisDebugGuardrail(errStructured);
    logFallbackTriggered("generateCoachReply:openai_try_catch", msg, {
      text: null,
      structuredReply: errStructured,
      rawModelText: null,
      model: modelUsed,
    });
    const textOut = resolveUserVisiblePrimaryText({
      structuredReply: errStructured,
      rawModelText: null,
      generatedText: null,
      fallbackText: COACH_REPLY_FALLBACK_TEXT,
      patternSnapshot,
    });
    logFinalRebuttalObjectDebug({
      structuredReply: errStructured,
      replyText: textOut,
      rawModelText: null,
    });
    const errApplied = applyCoachReplyModeToSuccessPayload({
      mode: coachReplyMode,
      text: textOut,
      structuredReply: errStructured,
      precallDepth:
        coachReplyMode === "precall" ? preCallDepth : undefined,
      patternInsights: patternInsightsPayload,
      explanation: patternExplanation,
      deferredEnrichment: undefined,
    });
    return {
      ok: true,
      text: errApplied.text,
      structuredReply: errApplied.structuredReply,
      patternAnalytics: patternSnapshot,
      patternSelection: patternSelectionMeta,
      ...(errApplied.patternInsights != null
        ? { patternInsights: errApplied.patternInsights as PatternInsightsPayload }
        : {}),
      ...(errApplied.explanation != null
        ? { explanation: errApplied.explanation as string }
        : {}),
      appliedTone: resolvedToneForTracking ?? null,
      timingMs: { ...timingMs, total: Math.round(performance.now() - t0) },
      fallbackUsed: true,
    };
  }

  // --- Path 3: Nothing configured (no successful LLM completion) ---
  if (patternSnapshot) {
    logResponseGeneratedAndAggregate(
      input.supabase,
      patternSnapshot,
      input.conversationId
    );
  }
  mark("no_config_fallback");
  let noModelStructured = applyTemporaryOpeningGuardrail(
    enrichStructuredWithTags(structuredFrom("", patternSnapshot))
  );
  noModelStructured = applyFirstRebuttalSayThisDebugGuardrail(noModelStructured);
  const noLlmWhy =
    !liveCfg.hasOpenAiKey && !hasGateway
      ? "no_OPENAI_API_KEY_and_no_gateway_credentials"
      : !liveCfg.hasOpenAiKey && hasGateway
        ? "gateway_configured_but_OPENAI_API_KEY_missing_and_gateway_call_failed_or_skipped"
        : liveCfg.hasOpenAiKey
          ? "unexpected_no_success_after_openai_key_present"
          : "no_usable_llm_route";
  console.error("[NO_LLM_CONFIG_DETAIL]", {
    hasOpenAiKey: liveCfg.hasOpenAiKey,
    hasGatewayUrl: !!process.env.OPENCLAW_GATEWAY_URL?.trim(),
    hasGatewayToken: !!process.env.OPENCLAW_GATEWAY_TOKEN?.trim(),
    coachLiveModel: process.env.COACH_LIVE_MODEL ?? null,
    openAiChatModel: process.env.OPENAI_CHAT_MODEL ?? null,
    openClawChatModel: process.env.OPENCLAW_CHAT_MODEL ?? null,
    reasonNoOpenAiKey: liveCfg.hasOpenAiKey ? null : liveCfg.reason,
    lastLlmError: lastLlmError != null ? serializeErr(lastLlmError) : null,
    why: noLlmWhy,
  });
  logFallbackTriggered(
    "generateCoachReply:no_llm_config",
    noLlmWhy,
    {
      text: null,
      structuredReply: noModelStructured,
      rawModelText: null,
      model: "",
    }
  );
  const textNoModel = resolveUserVisiblePrimaryText({
    structuredReply: noModelStructured,
    rawModelText: null,
    generatedText: null,
    fallbackText: COACH_REPLY_FALLBACK_TEXT,
    patternSnapshot,
  });
  logFinalRebuttalObjectDebug({
    structuredReply: noModelStructured,
    replyText: textNoModel,
    rawModelText: null,
  });
  const noModelApplied = applyCoachReplyModeToSuccessPayload({
    mode: coachReplyMode,
    text: textNoModel,
    structuredReply: noModelStructured,
    precallDepth:
      coachReplyMode === "precall" ? preCallDepth : undefined,
    patternInsights: patternInsightsPayload,
    explanation: patternExplanation,
    deferredEnrichment: undefined,
  });
  return {
    ok: true,
    text: noModelApplied.text,
    structuredReply: noModelApplied.structuredReply,
    patternAnalytics: patternSnapshot,
    patternSelection: patternSelectionMeta,
    ...(noModelApplied.patternInsights != null
      ? { patternInsights: noModelApplied.patternInsights as PatternInsightsPayload }
      : {}),
    ...(noModelApplied.explanation != null
      ? { explanation: noModelApplied.explanation as string }
      : {}),
    appliedTone: resolvedToneForTracking ?? null,
    timingMs: { ...timingMs, total: Math.round(performance.now() - t0) },
    fallbackUsed: true,
  };
}

function overlayStatsOnPatternIntel(
  reply: AssistantStructuredReply,
  insightBuilt: ReturnType<typeof buildPatternInsightsPayload>,
  objectionCategory: string
): AssistantStructuredReply {
  const pi = reply.patternIntel ?? {};
  const cl = insightBuilt.patternInsights.confidenceLevel;
  const statusLabel =
    cl === "high"
      ? "Strong signal"
      : cl === "medium"
        ? "Refining"
        : "Learning";
  const coachLine = coachInsightFraming(objectionCategory);
  return {
    ...reply,
    patternIntel: {
      status: pi.status?.trim() || statusLabel,
      whyThisResponse:
        pi.whyThisResponse?.trim() || insightBuilt.patternInsights.reason,
      howItFits: pi.howItFits?.trim() || insightBuilt.explanation,
      coachInsight: pi.coachInsight?.trim() || coachLine,
    },
  };
}

/**
 * Second-pass LLM + stats overlay; updates `messages.content` and `structured_reply`.
 * Fire-and-forget from the messages route after the fast response is persisted.
 */
export async function runCoachReplyEnrichmentJob(
  supabase: SupabaseClient,
  ctx: CoachDeferredEnrichment & {
    messageId: string;
    conversationId: string | null;
    userId: string;
  }
): Promise<void> {
  const t0 = performance.now();
  try {
    if (ctx.coachReplyMode !== "precall") {
      return;
    }
    const statsProvider = createPatternStatsProvider(supabase);
    const continuationUser = `Merchant / broker message:
"""${ctx.userMessage}"""

Primary PRE-CALL draft (four-marker prep + [CALL_READY_LINE] — stay aligned with deal/pattern context in system):
"""${ctx.fastRawMarkerText}"""

Output the remaining enrichment marker sections only, in the exact order specified.`;

    const contMessages: ChatMessage[] = normalizeChatMessagesForOpenAi([
      {
        role: "system",
        content: buildPrecallContinuationSystemPrompt(ctx.systemContentBase),
      },
      { role: "user", content: continuationUser },
    ]);

    const openCfg = resolveLiveCoachModelConfig();
    const model = openCfg.hasOpenAiKey
      ? openCfg.resolvedModel
      : COACH_LIVE_MODEL_DEFAULT;
    const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL?.trim();
    const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN?.trim();
    const openaiKey = process.env.OPENAI_API_KEY?.trim();

    const commonOpts = {
      priorityGeneration: ctx.priorityGeneration,
      planType: ctx.resolvedPlanType,
      conversationId: ctx.conversationId,
      tone: ctx.resolvedToneForTracking,
    };

    const [statsForSelected, rawCont] = await Promise.all([
      statsProvider.getStats([ctx.selectedPatternKey]),
      (async (): Promise<string> => {
        if (openaiKey) {
          return callCoachChatWithContinuationRetry(
            "https://api.openai.com",
            `Bearer ${openaiKey}`,
            model,
            contMessages,
            500,
            { ...commonOpts, logLabel: "openai_enrich" }
          );
        }
        if (gatewayUrl && gatewayToken) {
          return callCoachChatWithContinuationRetry(
            gatewayUrl,
            `Bearer ${gatewayToken}`,
            model,
            contMessages,
            500,
            { ...commonOpts, logLabel: "openclaw_enrich" }
          );
        }
        return "";
      })(),
    ]);

    const selectedPerfStats = statsForSelected[ctx.selectedPatternKey];
    const insightBuilt = buildPatternInsightsPayload({
      selectedPatternKey: ctx.selectedPatternKey,
      selectedSource: ctx.selectedSource,
      stats: selectedPerfStats,
      objectionCategory: ctx.normalizedObjectionType,
      posture: ctx.guidancePosture,
      rebuttalStyle: ctx.rebuttalStyle,
    });

    const contParsed = rawCont
      ? parseContinuationStructuredCoachOutput(rawCont)
      : null;
    let merged =
      contParsed != null
        ? mergeFastAndContinuationStructuredReply(ctx.fastStructured, contParsed)
        : ctx.fastStructured;

    merged = overlayStatsOnPatternIntel(
      merged,
      insightBuilt,
      ctx.patternSnapshot.objectionCategory
    );
    merged = enrichAssistantStructuredReplyWithObjectionTags(
      merged,
      ctx.objectionClassification
    );

    merged = { ...merged, coachReplyMode: "precall" };

    const text = formatStructuredCoachReplyToContent(merged);

    const { error } = await supabase
      .from("messages")
      .update({ content: text, structured_reply: merged })
      .eq("id", ctx.messageId)
      .eq("user_id", ctx.userId);

    if (error) {
      console.warn(
        `[coachChatReply] enrichment persist failed: ${error.message}`
      );
    } else {
      console.info(
        `[coachChatReply] enrichment_done_ms=${Math.round(performance.now() - t0)}`
      );
    }
  } catch (e) {
    console.warn("[coachChatReply] enrichment failed", e);
  }
}
