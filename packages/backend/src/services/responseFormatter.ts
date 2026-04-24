/**
 * responseFormatter.ts — Package ranked rebuttals for `/api/rebuttal`, `/api/regenerate`, `/ws`.
 *
 * Not used by `coachChatReply` / live conversation persistence (single assistant `content` string).
 */

import {
  type RebuttalOutput,
  type RebuttalOption,
  type AnalysisPayload,
} from "../prompts/rebuttalPrompt.js";

// Re-export for consumers that import from this module
export type { RebuttalOption };

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FormattedResponse {
  response: {
    primary: string;
    alternatives: string[];
    tone: string;
    confidence: number;
  };
  delivery: {
    mode: "suggestion" | "assist" | "auto";
    editable: boolean;
  };
  metadata: {
    objection_type: string;
    strategy: string;
    session_id: string;
    raw_input: string;
    intent?: string;
    emotional_tone?: string;
    urgency?: string;
    classification_confidence?: number;
  };
  rebuttals: RebuttalOption[]; // full array preserved for frontend
}

// ─── Main formatter ───────────────────────────────────────────────────────────

export function formatResponse(
  rebuttals: RebuttalOutput,
  payload: AnalysisPayload,
  options?: {
    mode?: "suggestion" | "assist" | "auto";
    session_id?: string;
    variantCount?: number;
  }
): FormattedResponse {
  const variantCount =
    typeof options?.variantCount === "number"
      ? Math.max(1, Math.floor(options.variantCount))
      : rebuttals.rebuttals.length;
  const sorted = [...rebuttals.rebuttals]
    .sort((a, b) => a.rank - b.rank)
    .slice(0, variantCount);

  const primary = sorted[0];
  const alternatives = sorted.slice(1).map((r) => r.text);

  const mode = options?.mode ?? "suggestion";
  const session_id = options?.session_id ?? crypto.randomUUID();

  return {
    response: {
      primary: primary?.text ?? "",
      alternatives,
      tone: primary?.tone ?? "consultative",
      confidence: primary?.confidence ?? 0,
    },
    delivery: {
      mode,
      editable: true,
    },
    metadata: {
      objection_type: payload.category,
      strategy: primary?.framework ?? "arpr",
      session_id,
      raw_input: payload.raw_input,
      intent: payload.intent,
      emotional_tone: payload.emotional_tone,
      urgency: payload.urgency,
      classification_confidence: payload.confidence,
    },
    rebuttals: sorted,
  };
}
