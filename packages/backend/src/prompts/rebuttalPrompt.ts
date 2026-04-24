import {
  normalizeToneMode,
  toneModePromptInstruction,
} from "../services/toneAccess.js";

/**
 * rebuttalPrompt.ts
 *
 * Builds a structured Claude prompt from a Phase 2.1 analysis payload.
 * Uses the Acknowledge / Reframe / Position / Redirect (ARPR) framework.
 * Returns ranked rebuttal options as a JSON-structured response.
 */

export interface AnalysisPayload {
  raw_input: string;
  category: string;       // financial, trust, timing, authority, need, competitor, confusion, brush_off, other
  intent?: string;        // stall, genuine_concern, brush_off, etc.
  emotional_tone?: string; // defensive, curious, skeptical, neutral
  urgency?: string;       // low, medium, high
  confidence?: number;    // 0–1
  signals?: string[];
  tone_override?: string; // consultative, assertive, friendly, urgent, analytical, closer, pressure, analytical_breakdown
}

export interface RebuttalOption {
  rank: number;
  text: string;
  tone: string;
  framework: string;
  confidence: number;
}

export interface RebuttalOutput {
  rebuttals: RebuttalOption[];
}

// Per-category ARPR guidance injected into the system prompt
const CATEGORY_GUIDANCE: Record<string, string> = {
  financial:
    "The prospect's core objection is about cost or budget. Acknowledge the financial concern without being dismissive. Reframe around the cost of inaction and long-term ROI. Position the product as an investment, not an expense. Redirect with a question that surfaces the real budget constraint or comparison baseline.",
  price:
    "Same as financial — cost is the stated blocker. Acknowledge the number concern, reframe around value vs. sticker price, position around ROI and peer results, redirect with a discovery question.",
  trust:
    "The prospect is skeptical about credibility or results. Acknowledge the skepticism as reasonable. Reframe by naming the specific doubt directly. Position with specifics (results, proof, social proof). Redirect with a question that surfaces what proof would actually move them.",
  timing:
    "The prospect is deferring. Acknowledge the timing concern without pressure. Reframe around the cost of delay. Position the urgency as theirs, not yours. Redirect with a question that anchors a realistic next step.",
  authority:
    "The prospect lacks or claims to lack decision power. Acknowledge the role boundary. Reframe by mapping the decision path together. Position yourself as helping them make the case internally. Redirect by identifying who else needs to be in the room.",
  need:
    "The prospect doesn't see why this matters to them. Acknowledge their current view. Reframe by questioning whether the problem is truly solved. Position around a hidden cost or missed opportunity. Redirect with a question that surfaces what 'good enough' actually looks like.",
  no_need:
    "Same as need — the prospect denies the problem. Acknowledge without arguing. Reframe by probing whether the problem is invisible, handled, or simply deprioritized. Position around what it would take to change that view. Redirect with a probing question.",
  competitor:
    "The prospect has an incumbent solution. Acknowledge the existing relationship. Reframe from 'switch now' to 'assess your current results'. Position around gaps the incumbent may not cover. Redirect by asking what they'd improve about what they have.",
  confusion:
    "The prospect doesn't understand the offer. Acknowledge clearly — this is your communication gap, not theirs. Reframe by simplifying the core value prop to one sentence. Position by making the mechanism obvious. Redirect by asking which part is still unclear.",
  brush_off:
    "The prospect is avoiding engagement. Acknowledge without chasing. Reframe from 'interested/not interested' to one qualifying question worth answering. Position by making the cost of one answer extremely low. Redirect with a single low-friction question that reveals fit.",
  hesitation:
    "The prospect is stalling or on the fence. Acknowledge the hesitation as normal. Reframe around what's really holding them back (usually not what they said). Position around clarity, not pressure. Redirect by asking what specific concern, if resolved, would change their mind.",
  hidden:
    "The real objection isn't visible yet. Acknowledge the surface resistance. Reframe by opening space for the actual concern. Position by demonstrating you're not in a rush. Redirect with an open-ended question that invites the real blocker to emerge.",
  other:
    "Treat this as a general objection. Acknowledge the concern without assumptions. Reframe around the core value the product delivers. Position simply and directly. Redirect with a clarifying question.",
};

function getCategoryGuidance(category: string): string {
  return CATEGORY_GUIDANCE[category] ?? CATEGORY_GUIDANCE["other"];
}

function toneHint(emotional_tone?: string): string {
  switch (emotional_tone) {
    case "defensive":
      return "The prospect is defensive. Lead with empathy and low pressure.";
    case "skeptical":
      return "The prospect is skeptical. Lead with specificity and directness.";
    case "curious":
      return "The prospect is curious. Lead with insight and invitation.";
    default:
      return "Tone is neutral. Balance warmth with directness.";
  }
}

function urgencyHint(urgency?: string): string {
  switch (urgency) {
    case "high":
      return "Urgency is high — the prospect may be close to a decision. Don't waste the moment.";
    case "low":
      return "Urgency is low — don't push. Focus on planting seeds for a natural next step.";
    default:
      return "Urgency is medium — keep it moving without applying pressure.";
  }
}

/**
 * Build the full system + user messages for Claude.
 * Returns an array of messages in OpenAI chat format.
 */
export function buildRebuttalMessages(payload: AnalysisPayload): {
  role: "system" | "user";
  content: string;
}[] {
  return buildRebuttalMessagesForCount(payload, 3);
}

export function buildRebuttalMessagesForCount(
  payload: AnalysisPayload,
  variantCount: number,
  options?: { priorityGeneration?: boolean }
): {
  role: "system" | "user";
  content: string;
}[] {
  const guidance = getCategoryGuidance(payload.category);
  const tone = toneHint(payload.emotional_tone);
  const urgency = urgencyHint(payload.urgency);
  const normalizedToneOverride = normalizeToneMode(payload.tone_override);
  const priorityLine = options?.priorityGeneration
    ? "Priority generation is enabled for this request. Keep the response high-signal and latency-aware without reducing quality."
    : "";
  const toneOverrideLine = payload.tone_override
    ? `Tone override requested by user: ${payload.tone_override}. Every rebuttal must reflect this tone. The "tone" field in each rebuttal must match this override.${normalizedToneOverride ? ` ${toneModePromptInstruction(normalizedToneOverride)}` : ""}`
    : "";

  const system = `You are RoboRebut — a real-time sales objection handling engine built for professional closers.

Your job: generate ${variantCount} ranked rebuttal options for a live sales objection, using the Acknowledge / Reframe / Position / Redirect (ARPR) framework.

## ARPR Framework
- Acknowledge: Validate the prospect's concern without agreeing with their conclusion.
- Reframe: Shift the frame of reference in a way that serves the prospect's real interest.
- Position: Briefly position the product/service as the natural answer to the reframed concern.
- Redirect: End with a question that moves the conversation forward.

## Objection Category: ${payload.category.toUpperCase()}
${guidance}

## Tone and Urgency
${tone}
${urgency}
${priorityLine}
${toneOverrideLine}

## Output Rules
- Return ONLY valid JSON. No markdown. No explanation outside the JSON.
- Return exactly ${variantCount} rebuttals, ranked 1–${variantCount} by fit.
- Each rebuttal should be 2–4 sentences. No bullet points inside the text.
- Vary the tones naturally across the set while keeping each rebuttal useful and distinct.
- confidence scores should descend by rank.
- framework field: name the primary ARPR move(s) used (e.g., "acknowledge-reframe", "reframe-position", "redirect-challenge").
- tone field: one of: empathetic | direct | social-proof | challenger | consultative | assertive | friendly | urgent | analytical | closer | pressure | analytical_breakdown

## Required JSON shape
{
  "rebuttals": [
    { "rank": 1, "text": "...", "tone": "...", "framework": "...", "confidence": 0.0 }
  ]
}`;

  const user = `Generate ${variantCount} ranked rebuttals for the following live sales objection.

Objection: "${payload.raw_input}"
Category: ${payload.category}
Intent: ${payload.intent ?? "unknown"}
Emotional tone: ${payload.emotional_tone ?? "neutral"}
Urgency: ${payload.urgency ?? "medium"}
Confidence in classification: ${payload.confidence ?? 0.8}
${payload.signals?.length ? `Signals detected: ${payload.signals.join(", ")}` : ""}

Return only the JSON object.`;

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}
