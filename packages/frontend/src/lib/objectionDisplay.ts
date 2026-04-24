/**
 * User-facing labels for stored `objection_type` (thread header).
 * Canonical matrix keys keep default underscore → space formatting.
 */

const LOC_DIRECT_LABELS: Record<string, string> = {
  deal_clarity: "Deal clarity",
  loc_payment_clarity: "LOC payment clarity",
  pricing_repayment_clarity: "Pricing / repayment clarity",
};

export function formatObjectionTypeLabel(value: string | null | undefined): string {
  if (value == null || value === "") return "";
  if (LOC_DIRECT_LABELS[value]) return LOC_DIRECT_LABELS[value]!;
  return value.replace(/_/g, " ");
}
