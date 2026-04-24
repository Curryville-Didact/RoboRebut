/**
 * responseGenerator.ts — Ranked multi-rebuttal generation (secondary paths).
 *
 * Used by: `/api/rebuttal`, `/api/regenerate`, and the `/ws` demo in `server.ts`.
 * NOT used by the production dashboard thread (`coachChatReply` / `POST /api/messages`).
 *
 * Calls Claude (via OpenClaw gateway OpenAI-compat HTTP endpoint) with the
 * structured prompt from rebuttalPrompt.ts and returns ranked rebuttal options.
 *
 * Falls back to template-based rebuttals if the AI call fails, so the
 * WebSocket pipeline is never broken.
 */

import {
  buildRebuttalMessagesForCount,
  type AnalysisPayload,
  type RebuttalOption,
  type RebuttalOutput,
} from "../prompts/rebuttalPrompt.js";
import { trackEvent } from "./eventTracker.js";

// ─── Config ───────────────────────────────────────────────────────────────────

const OPENCLAW_GATEWAY_URL =
  process.env.OPENCLAW_GATEWAY_URL ?? "http://127.0.0.1:18789";

const OPENCLAW_GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN ?? "";

const CLAUDE_MODEL =
  process.env.CLAUDE_MODEL ?? "anthropic/claude-sonnet-4-6";

// ─── Types ────────────────────────────────────────────────────────────────────

export type { AnalysisPayload, RebuttalOption, RebuttalOutput };

// ─── Main service ─────────────────────────────────────────────────────────────

/**
 * Generate ranked rebuttals for a given analysis payload.
 * Uses Claude via the OpenClaw gateway HTTP endpoint.
 */
export async function generateRebuttals(
  payload: AnalysisPayload,
  options?: {
    variantCount?: number;
    priorityGeneration?: boolean;
    planType?: string;
    conversationId?: string | null;
  }
): Promise<RebuttalOutput> {
  const variantCount = normalizeVariantCount(options?.variantCount);
  const priorityGeneration = options?.priorityGeneration === true;
  const messages = buildRebuttalMessagesForCount(payload, variantCount, {
    priorityGeneration,
  });

  if (priorityGeneration) {
    console.info(
      `[responseGenerator] Priority generation enabled for category=${payload.category}`
    );
    trackEvent(console, {
      eventName: "priority_generation_used",
      planType: options?.planType ?? "free",
      conversationId: options?.conversationId ?? null,
      priorityGeneration: true,
      tone: payload.tone_override ?? null,
      objectionType: payload.category,
      surface: "responseGenerator",
    });
  }

  try {
    const response = await fetch(
      `${OPENCLAW_GATEWAY_URL}/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENCLAW_GATEWAY_TOKEN}`,
        },
        body: JSON.stringify({
          model: CLAUDE_MODEL,
          messages,
          temperature: 0.7,
          max_tokens: 1200,
        }),
        signal: AbortSignal.timeout(30_000),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(
        `OpenClaw gateway returned ${response.status}: ${errText}`
      );
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };

    const content = data.choices?.[0]?.message?.content ?? "";
    const parsed = parseRebuttalJSON(content, variantCount);

    if (!parsed) {
      throw new Error("Claude returned invalid or unparseable JSON");
    }

    return parsed;
  } catch (err) {
    console.error("[responseGenerator] AI call failed, using fallback:", err);
    return buildFallbackRebuttals(payload, variantCount);
  }
}

// ─── JSON parsing ─────────────────────────────────────────────────────────────

/**
 * Safely parse Claude's JSON response.
 * Claude occasionally wraps JSON in markdown fences — strip those first.
 */
function parseRebuttalJSON(
  raw: string,
  variantCount: number
): RebuttalOutput | null {
  try {
    // Strip ```json ... ``` or ``` ... ``` markdown fences if present
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/, "")
      .trim();

    const parsed = JSON.parse(cleaned);

    if (!Array.isArray(parsed?.rebuttals) || parsed.rebuttals.length === 0) {
      return null;
    }

    type RawRebuttal = { rank?: unknown; text?: unknown; tone?: unknown; framework?: unknown; confidence?: unknown };

    // Validate shape and coerce types
    const rebuttals: RebuttalOption[] = (parsed.rebuttals as RawRebuttal[])
      .slice(0, variantCount)
      .map((r: RawRebuttal, i: number): RebuttalOption => ({
        rank: typeof r.rank === "number" ? r.rank : i + 1,
        text: typeof r.text === "string" ? r.text : "",
        tone: typeof r.tone === "string" ? r.tone : "consultative",
        framework: typeof r.framework === "string" ? r.framework : "arpr",
        confidence:
          typeof r.confidence === "number"
            ? Math.min(1, Math.max(0, r.confidence))
            : Math.max(0.5, 0.9 - i * 0.07),
      }))
      .filter((r: RebuttalOption) => r.text.length > 0);

    if (rebuttals.length === 0) return null;

    return { rebuttals };
  } catch {
    return null;
  }
}

// ─── Fallback ─────────────────────────────────────────────────────────────────

/**
 * Template-based fallback rebuttals used when the AI call fails.
 * Keeps the WebSocket pipeline alive under any circumstances.
 */
function buildFallbackRebuttals(
  payload: AnalysisPayload,
  variantCount: number
): RebuttalOutput {
  const templates = getFallbackTemplates(payload.category, payload.raw_input);

  return {
    rebuttals: templates.slice(0, variantCount).map((t, i) => ({
      rank: i + 1,
      text: t.text,
      tone: t.tone,
      framework: t.framework,
      confidence: parseFloat((0.82 - i * 0.06).toFixed(2)),
    })),
  };
}

type FallbackTemplate = { text: string; tone: string; framework: string };

function normalizeVariantCount(variantCount?: number): number {
  if (typeof variantCount !== "number" || Number.isNaN(variantCount)) return 3;
  return Math.max(1, Math.min(4, Math.floor(variantCount)));
}

function getFallbackTemplates(
  category: string,
  _raw: string
): FallbackTemplate[] {
  const map: Record<string, FallbackTemplate[]> = {
    financial: [
      {
        text: "I hear you — and that's a fair concern. Most people feel the same way before they see what staying where they are actually costs. What are you comparing this number against right now?",
        tone: "empathetic",
        framework: "acknowledge-redirect",
      },
      {
        text: "Price deserves scrutiny. The real question isn't the upfront number — it's whether the problem you're solving costs more than what we're asking. Let's look at that together.",
        tone: "direct",
        framework: "reframe-position",
      },
      {
        text: "Our clients said the same thing on the first call. Once they ran the numbers on what the problem was costing them in time and lost deals, the math changed quickly. What does that look like for you?",
        tone: "social-proof",
        framework: "reframe-redirect",
      },
    ],
    trust: [
      {
        text: "Fair enough — skepticism is the right instinct. The fastest way to clear that up is to get specific about what feels uncertain. What exactly is giving you pause?",
        tone: "direct",
        framework: "acknowledge-redirect",
      },
      {
        text: "I wouldn't ask you to take that on faith. What would you need to see — specific results, a reference call, a proof of concept — to feel comfortable evaluating this seriously?",
        tone: "consultative",
        framework: "reframe-redirect",
      },
      {
        text: "Most of our clients came in skeptical and asked the same questions you're asking. That's usually a sign they're a serious buyer, not a bad fit. What's the one thing that would change your view?",
        tone: "social-proof",
        framework: "acknowledge-reframe",
      },
    ],
    timing: [
      {
        text: "I'm not trying to force this at the wrong moment. But I do want to understand — is it truly timing, or is timing the easy answer for a deeper concern? What would make this more relevant later?",
        tone: "empathetic",
        framework: "acknowledge-redirect",
      },
      {
        text: "Timing is always the negotiation. The real question is whether the problem gets better on its own while you wait, or whether it compounds. Which is it in your case?",
        tone: "direct",
        framework: "reframe-position",
      },
      {
        text: "The clients who waited usually told us later that the problem didn't shrink with time — it just got more expensive. What milestone would you need to hit before this makes sense?",
        tone: "social-proof",
        framework: "reframe-redirect",
      },
    ],
    authority: [
      {
        text: "That makes sense. If this needs more people involved, the most useful thing we can do right now is map the decision path. Who else would need to weigh in before this moves forward?",
        tone: "consultative",
        framework: "acknowledge-redirect",
      },
      {
        text: "Understood. I don't want to waste your time or theirs. If you were going to make the case internally, what's the one thing that would carry the most weight with the decision-maker?",
        tone: "direct",
        framework: "reframe-position",
      },
      {
        text: "We see this often — the person closest to the problem rarely owns the budget. Would it make sense to set up a short call with you and the decision-maker together so I can address their questions directly?",
        tone: "social-proof",
        framework: "position-redirect",
      },
    ],
    other: [
      {
        text: "That's a fair pushback. Rather than force a response, I'd rather understand what feels most uncertain so we can address the real issue. What part gives you the biggest pause?",
        tone: "consultative",
        framework: "acknowledge-redirect",
      },
      {
        text: "Usually when this comes up, the surface objection isn't the whole story. If we strip it down, is the bigger concern risk, priority, or proof that this will actually work?",
        tone: "direct",
        framework: "reframe-redirect",
      },
      {
        text: "A lot of strong buyers say something similar before they name the actual blocker. Once that comes into the open, the decision usually gets much easier. What's the real hesitation behind this?",
        tone: "social-proof",
        framework: "acknowledge-reframe",
      },
      {
        text: "If this were clearly tied to an outcome you cared about, the objection would probably sound different. What result would have to be on the table for this conversation to feel worth continuing?",
        tone: "challenger",
        framework: "position-redirect",
      },
    ],
  };

  const templates = map[category] ?? map["financial"];
  if (templates.length >= 4) return templates;

  return [
    ...templates,
    {
      text: "The objection makes sense on the surface, but it usually points to a deeper decision variable underneath it. If we solved that underlying issue, what would make this conversation feel worthwhile?",
      tone: "challenger",
      framework: "reframe-redirect",
    },
  ];
}
