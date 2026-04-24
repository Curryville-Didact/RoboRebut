/**
 * Phase 4.5 — Behavior-layer coaching from deal signals (no calculator math).
 * ISO / alt-lending: closers stay confident and forward-moving; control pressure with authority.
 */

import type { DealInsightFlags } from "./dealInsightBuilder.js";

export type DealCoachingPosture =
  | "exploratory"
  | "balanced"
  | "controlled_assertive"
  | "assertive_opportunity";

export type DealRiskLevel = "unknown" | "low" | "medium" | "high";

export interface DealCoachingGuidance {
  posture: DealCoachingPosture;
  riskLevel: DealRiskLevel;
  coachingPriority:
    | "discovery"
    | "cash_flow_fit"
    | "cost_framing"
    | "forward_motion";
  recommendedToneShift: "curious" | "grounded" | "firm" | "confident";
}

export type DealCoachingGuidanceInput = {
  dealType: string;
  flags?: DealInsightFlags;
  missingInputs?: boolean;
};

export function getDealCoachingGuidance(
  input: DealCoachingGuidanceInput
): DealCoachingGuidance {
  const missing =
    input.missingInputs === true || input.flags?.missingInputs === true;

  if (missing) {
    return {
      posture: "exploratory",
      riskLevel: "unknown",
      coachingPriority: "discovery",
      recommendedToneShift: "curious",
    };
  }

  if (input.flags?.highBurden === true) {
    return {
      posture: "controlled_assertive",
      riskLevel: "high",
      coachingPriority: "cash_flow_fit",
      recommendedToneShift: "firm",
    };
  }

  if (input.dealType === "business_line_of_credit") {
    return {
      posture: "balanced",
      riskLevel: "medium",
      coachingPriority: "cost_framing",
      recommendedToneShift: "grounded",
    };
  }

  return {
    posture: "assertive_opportunity",
    riskLevel: "low",
    coachingPriority: "forward_motion",
    recommendedToneShift: "confident",
  };
}

/** Single strategy tag to append (extend existing tags; do not replace). */
export function strategyTagForPosture(posture: DealCoachingPosture): string {
  switch (posture) {
    case "exploratory":
      return "qualify_cash_flow_fit";
    case "balanced":
      return "reframe_structure";
    case "controlled_assertive":
      return "anchor_pressure_and_direct";
    case "assertive_opportunity":
      return "advance_if_fit_exists";
    default: {
      const _x: never = posture;
      return _x;
    }
  }
}

/**
 * System-prompt appendix: how the model should behave for this posture.
 * High-burden = confident and direct, not cautious or soft.
 */
export function postureSystemInstructions(posture: DealCoachingPosture): string {
  switch (posture) {
    case "exploratory":
      return [
        "Ask for missing context before pushing a close.",
        "Do not assume affordability or fit until inputs are clear.",
        "Guide discovery before persuasion.",
        "Tone: curious and controlled — not vague, not apologetic.",
      ].join("\n");
    case "balanced":
      return [
        "Acknowledge cost and structure plainly.",
        "Frame tradeoffs practically (what they get vs what they pay).",
        "Stay grounded and specific — no hype, no doom.",
        "Tone: grounded and practical.",
      ].join("\n");
    case "controlled_assertive":
      return [
        "Maintain confidence and forward movement. Do NOT sound cautious, hesitant, or soft.",
        "Do NOT give the merchant an easy out or permission to walk away from a viable path.",
        "Acknowledge payment pressure as real — it is operational (cash flow), not emotional.",
        "Frame the decision around whether cash flow can support the obligation while capital is put to work correctly.",
        "Reinforce that the money must be deployed intentionally; weak use of capital is the failure mode, not confidence itself.",
        "Keep authority in tone: direct, steady, in control.",
        "Example framing (adapt, do not quote verbatim): “This isn’t a light payment — it’s real. The question is whether your cash flow can support it while you actually put the capital to work.”",
        "",
        "NON-NEGOTIABLE BEHAVIOR RULES:",
        "- Do not ask the prospect if they are comfortable with the payment",
        "- Do not suggest the deal may not be a fit",
        "- Do not soften statements with uncertainty language (avoid: \"maybe\", \"might\", \"possibly\")",
        "- Do not present backing out as a primary path",
        "",
        "Maintain authority and forward movement at all times.",
      ].join("\n");
    case "assertive_opportunity":
      return [
        "Move toward commitment and next steps.",
        "Assume deal viability unless the thread contradicts it.",
        "Maintain strong forward momentum.",
        "Tone: confident and decisive.",
      ].join("\n");
    default: {
      const _x: never = posture;
      return _x;
    }
  }
}
