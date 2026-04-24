/**
 * Persuasion patterns for PRE-CALL lane generation (Pattern → Strategy → Structured Output).
 */

export type RebuttalPattern =
  | "REFRAME_VALUE"
  | "FUTURE_PAIN"
  | "OPPORTUNITY_COST"
  | "CONTROL_CHOICE"
  | "MINIMIZE_RISK"
  | "STATUS_QUO_ATTACK";

export const patternDescriptions: Record<RebuttalPattern, string> = {
  REFRAME_VALUE:
    "Shift focus from price to outcome and business impact",
  FUTURE_PAIN:
    "Emphasize consequences of inaction over time",
  OPPORTUNITY_COST:
    "Highlight what they are losing by waiting",
  CONTROL_CHOICE:
    "Position decision as taking control vs staying stuck",
  MINIMIZE_RISK:
    "Reduce perceived risk and uncertainty",
  STATUS_QUO_ATTACK:
    "Attack current situation as the real problem",
};

/** Tactical, mid-call diagnostic — replaces passive “what they mean” filler. */
export const DEFAULT_PRECALL_WHAT_THEY_REALLY_MEAN_INSIGHT = `They are not reacting to price alone.

They are reacting to pressure on cash flow and uncertainty about committing.

This is a hesitation to act, not a rejection of the solution.`;
