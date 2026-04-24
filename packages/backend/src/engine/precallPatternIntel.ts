import type { AssistantStructuredReply } from "../types/assistantStructuredReply.js";
import type { RebuttalPattern } from "./patterns.js";
import { selectPatterns } from "./selectPattern.js";

function normalizeTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3);
}

/** Aligned with precall lane similarity check in coachChatReply validation. */
export function precallLaneJaccard(a: string, b: string): number {
  const A = new Set(normalizeTokens(a));
  const B = new Set(normalizeTokens(b));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const w of A) {
    if (B.has(w)) inter += 1;
  }
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

export type Lane2RegenerateFn = (input: {
  lane1: string;
  lane2: string;
  lane2Pattern: RebuttalPattern;
  userMessage: string;
}) => Promise<string | null>;

const PATTERN_INSIGHT_BASE: Record<string, string> = {
  REFRAME_VALUE:
    "They are focused on cost, but the real issue is the impact on their business if nothing changes.",
  FUTURE_PAIN:
    "They are reacting to short-term discomfort, but not accounting for how this compounds over time.",
  OPPORTUNITY_COST:
    "They are weighing price, but not recognizing what staying in the current position is costing them.",
  CONTROL_CHOICE:
    "They are hesitating, but this is really about deciding whether to take control or stay in the same position.",
  MINIMIZE_RISK:
    "They are uncertain about risk, but the bigger risk is staying in the current situation.",
  STATUS_QUO_ATTACK:
    "They are defaulting to inaction, but the current situation is what's actually creating pressure.",
};

function dealContextHasRevenueAndPayment(dealContext: unknown): boolean {
  if (!dealContext || typeof dealContext !== "object") return false;
  const o = dealContext as Record<string, unknown>;
  const rev = o.monthlyRevenue;
  const pay =
    o.paymentAmount ??
    o.paybackAmount ??
    o.estimatedPayment ??
    o.advanceAmount;
  return (
    typeof rev === "number" &&
    rev > 0 &&
    (typeof pay === "number" ? pay > 0 : Boolean(pay))
  );
}

/**
 * Pattern-aware + context-aware diagnostic for [WHAT_THEY_REALLY_MEAN] (post-parse).
 */
export function buildDynamicInsight({
  objectionType: _objectionType,
  pattern,
  dealContext,
}: {
  objectionType: string;
  pattern: string;
  dealContext?: unknown;
}): string {
  void _objectionType;
  let insight =
    PATTERN_INSIGHT_BASE[pattern] ?? PATTERN_INSIGHT_BASE["REFRAME_VALUE"];

  if (dealContextHasRevenueAndPayment(dealContext)) {
    insight += ` Their current payment structure is already affecting their cash flow rhythm.`;
  }

  return insight;
}

function diversifyLanguage(text: string): string {
  return text
    .replace(/you can either/gi, "the reality is")
    .replace(/either .* or/gi, "it comes down to this")
    .replace(/you can (either )?/gi, "")
    .replace(/or keep/gi, "otherwise you'll keep")
    .replace(/or continue/gi, "otherwise it continues")
    .replace(/\bsame\s+(pressure|squeeze)\b/gi, "this pressure")
    .replace(/\bit keeps dragging\b/gi, "it keeps draining")
    .replace(/\bbottom line\b/gi, "net effect")
    .replace(/\bcash flow issues\b/gi, "cash flow drag");
}

function countMatches(text: string, re: RegExp): number {
  const m = text.match(re);
  return m ? m.length : 0;
}

function dedupeOveruseAcrossLanes(input: { lane1: string; lane2: string }): {
  lane1: string;
  lane2: string;
} {
  let { lane1, lane2 } = input;

  // If "if you keep waiting" appears more than once across lanes, diversify lane2.
  const waitingRe = /\bif you keep waiting\b/gi;
  const totalWaiting =
    countMatches(lane1, waitingRe) + countMatches(lane2, waitingRe);
  if (totalWaiting > 1) {
    lane2 = lane2.replace(waitingRe, "if this stays as-is");
  }

  // If both lanes repeat the exact phrase "cash flow drag", diversify lane2.
  const cfd = /\bcash flow drag\b/gi;
  if (cfd.test(lane1) && cfd.test(lane2)) {
    lane2 = lane2.replace(cfd, "margin drain");
  }

  return { lane1, lane2 };
}

function scorePersuasionStrength(text: string): number {
  let score = 0;

  // Strong framing
  if (/the reality is/i.test(text)) score += 3;
  if (/comes down to/i.test(text)) score += 2;

  // Urgency / consequence
  if (/now/i.test(text)) score += 2;
  if (/keeps|continues|worsens|drags/i.test(text)) score += 2;

  // Specificity
  if (/cash flow|bottom line|operations|revenue/i.test(text)) score += 2;

  // Weak patterns penalty
  if (/you can either/i.test(text)) score -= 3;

  return score;
}

function buildCallReady(bestLane: string, followUp: string) {
  return `${bestLane} — ${followUp}`;
}

function enforceCloseStructure(text: string): string {
  if (!/what|how|where|when/i.test(text)) {
    return text + " What needs to change for you to move on this today?";
  }
  return text;
}

function compressCallReadySeed(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return t;
  // Prefer first sentence; keep it punchy.
  const first = t.split(/(?<=[.!?])\s+/)[0] ?? t;
  return first.trim().replace(/[.!?]+$/, "");
}

/**
 * Post-parse: tactical insight, call-ready line, pattern labels, optional lane2 rewrite.
 */
export async function applyPrecallPatternIntelligence(
  sr: AssistantStructuredReply,
  opts: {
    precallArtifact: AssistantStructuredReply["precallArtifact"];
    objectionSlug: string | null;
    objectionType?: string | null;
    userMessage: string;
    dealContext?: unknown;
    regenerateLane2IfSimilar: Lane2RegenerateFn | null;
  }
): Promise<AssistantStructuredReply> {
  if (opts.precallArtifact !== "v102_standard") {
    return sr;
  }

  const patterns = selectPatterns(opts.objectionSlug ?? "");
  const lane1Pattern = patterns[0] ?? "REFRAME_VALUE";
  const lane2Pattern = patterns[1] ?? "FUTURE_PAIN";

  let lane1 = sr.precallLane1?.trim() ?? "";
  let lane2 = sr.precallLane2?.trim() ?? "";
  const followUp = sr.followUp?.trim() ?? "";

  if (lane1 && lane2 && precallLaneJaccard(lane1, lane2) >= 0.38) {
    const regen = opts.regenerateLane2IfSimilar;
    if (regen) {
      const next = await regen({
        lane1,
        lane2,
        lane2Pattern,
        userMessage: opts.userMessage,
      });
      if (next?.trim()) {
        lane2 = next.trim();
      }
    }
  }

  lane1 = diversifyLanguage(lane1).trim();
  lane2 = diversifyLanguage(lane2).trim();
  ({ lane1, lane2 } = dedupeOveruseAcrossLanes({ lane1, lane2 }));

  const objectionTypeLabel =
    (opts.objectionType?.trim() ||
      sr.precallObjectionTypeLabel?.trim() ||
      opts.objectionSlug?.trim() ||
      "") ?? "";

  const insight = buildDynamicInsight({
    objectionType: objectionTypeLabel,
    pattern: lane1Pattern,
    dealContext: opts.dealContext,
  });

  const bestLane =
    lane1 && lane2
      ? scorePersuasionStrength(lane2) > scorePersuasionStrength(lane1)
        ? lane2
        : lane1
      : lane1 || lane2;

  const seed = compressCallReadySeed(bestLane);
  const shouldAppendFollowUp =
    !!followUp &&
    followUp.length >= 10 &&
    followUp.length <= 140 &&
    !/\?\s*$/.test(seed) &&
    !seed.toLowerCase().includes(followUp.toLowerCase());

  let callReadyLine: string | null =
    seed && shouldAppendFollowUp
      ? buildCallReady(seed, followUp)
      : seed || followUp || null;

  // Only append the forced close if the line is still short enough to stay usable.
  if (callReadyLine && callReadyLine.length < 175) {
    callReadyLine = enforceCloseStructure(callReadyLine);
  }

  if (!callReadyLine || callReadyLine.toLowerCase().includes("unavailable")) {
    callReadyLine =
      lane1 && followUp
        ? buildCallReady(lane1, followUp)
        : lane1 || followUp || callReadyLine;
  }
  if (!callReadyLine || callReadyLine.length < 20) {
    callReadyLine = lane1 && followUp ? buildCallReady(lane1, followUp) : callReadyLine;
  }

  return {
    ...sr,
    precallWhatTheyReallyMean: insight,
    precallLane1: lane1 || null,
    precallLane2: lane2 || null,
    followUp: followUp || null,
    callReadyLine,
    precallPrimaryPersuasionPattern: lane1Pattern,
    lane2PersuasionPattern: lane2Pattern,
  };
}
