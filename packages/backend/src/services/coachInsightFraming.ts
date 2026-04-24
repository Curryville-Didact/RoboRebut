/**
 * Phase 5.3 — Deterministic “Coach Insight” framing (no LLM, no performance claims).
 */

const FRAMING: Record<string, string> = {
  price_cost_framing:
    "This objection usually appears when the prospect is close on fit but stress-testing price. Handled correctly, it keeps the conversation under your control.",
  timing_delay:
    "Often a decision-stage stall, not just curiosity. Clarify timing without letting the call drift.",
  trust_skepticism:
    "Common when money is on the table and the merchant needs reassurance. Credibility and clarity matter more than volume here.",
  need_indifference:
    "Usually signals they have not felt consequence or urgency yet. Your job is to surface fit without sounding pushy.",
  payment_fatigue:
    "Often shows up when cash flow is tight. Reframe into manageable terms and keep the decision structured.",
  unknown:
    "Handled well, this keeps the deal in a decision frame rather than a casual Q&A.",
};

/**
 * Maps multi-tag / UI canonical slugs onto the same framing keys as {@link FRAMING}
 * so we do not fall through to {@link FRAMING.unknown} when a close bucket exists.
 */
const FRAMING_KEY_ALIASES: Record<string, keyof typeof FRAMING> = {
  trust_risk: "trust_skepticism",
  comparison_shopping: "need_indifference",
  payment_affordability: "price_cost_framing",
  cash_flow_pressure: "payment_fatigue",
  margin_profitability: "price_cost_framing",
  confusion_clarity: "trust_skepticism",
  urgency_absent: "timing_delay",
  decision_avoidance: "timing_delay",
  past_bad_experience: "trust_skepticism",
  not_a_fit: "need_indifference",
  authority_constraint: "timing_delay",
  receivables_lag: "payment_fatigue",
  structure_mismatch: "need_indifference",
  documentation_verification: "trust_skepticism",
};

function resolveFramingKey(
  objectionCategory: string | undefined
): keyof typeof FRAMING {
  const raw =
    objectionCategory &&
    typeof objectionCategory === "string" &&
    objectionCategory.trim().length > 0
      ? objectionCategory.trim()
      : "unknown";
  if (raw === "unknown") return "unknown";
  const viaAlias = FRAMING_KEY_ALIASES[raw];
  if (viaAlias != null) return viaAlias;
  if (raw in FRAMING) return raw as keyof typeof FRAMING;
  return "unknown";
}

/**
 * One compact line for monetization / coaching context UI.
 */
export function coachInsightFraming(objectionCategory: string | undefined): string {
  return FRAMING[resolveFramingKey(objectionCategory)];
}
