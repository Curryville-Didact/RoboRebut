/**
 * Canonical Invoice Factoring facts from saved deal_context.
 * Covers invoice factoring and accounts receivable financing.
 */

import { formatUsd } from "./canonicalMcaDeal.js";

export type DealTypeFactoring = "invoice_factoring";

export interface DealContextFactoring {
  dealType: DealTypeFactoring;
  monthlyInvoiceVolume?: number;
  advanceRate?: number;
  factoringFeePercent?: number;
  monthlyRevenue?: number;
  averageInvoiceDays?: number;
  recourse?: boolean;
  lenderName?: string;
  industryType?: string;
}

export interface CanonicalFactoringFacts {
  monthlyInvoiceVolume: number | null;
  advanceRate: number | null;
  factoringFeePercent: number | null;
  monthlyRevenue: number | null;
  averageInvoiceDays: number | null;
  estimatedMonthlyAdvance: number | null;
  estimatedMonthlyFee: number | null;
  recourse: boolean | null;
  industryType: string | null;
  warnings: string[];
}

function isPositive(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

export function resolveCanonicalFactoringFacts(
  ctx: DealContextFactoring | null | undefined
): CanonicalFactoringFacts | null {
  if (ctx == null || typeof ctx !== "object") return null;
  if (ctx.dealType !== "invoice_factoring") return null;

  const warnings: string[] = [];
  const monthlyInvoiceVolume = isPositive(ctx.monthlyInvoiceVolume)
    ? ctx.monthlyInvoiceVolume
    : null;
  const advanceRate =
    ctx.advanceRate != null &&
    Number.isFinite(ctx.advanceRate) &&
    ctx.advanceRate > 0 &&
    ctx.advanceRate <= 100
      ? ctx.advanceRate
      : null;
  const factoringFeePercent =
    ctx.factoringFeePercent != null &&
    Number.isFinite(ctx.factoringFeePercent) &&
    ctx.factoringFeePercent > 0
      ? ctx.factoringFeePercent
      : null;

  if (monthlyInvoiceVolume == null && advanceRate == null) return null;

  const estimatedMonthlyAdvance =
    monthlyInvoiceVolume != null && advanceRate != null
      ? monthlyInvoiceVolume * (advanceRate / 100)
      : null;

  const estimatedMonthlyFee =
    monthlyInvoiceVolume != null && factoringFeePercent != null
      ? monthlyInvoiceVolume * (factoringFeePercent / 100)
      : null;

  return {
    monthlyInvoiceVolume,
    advanceRate,
    factoringFeePercent,
    monthlyRevenue: isPositive(ctx.monthlyRevenue) ? ctx.monthlyRevenue : null,
    averageInvoiceDays: isPositive(ctx.averageInvoiceDays)
      ? ctx.averageInvoiceDays
      : null,
    estimatedMonthlyAdvance,
    estimatedMonthlyFee,
    recourse: typeof ctx.recourse === "boolean" ? ctx.recourse : null,
    industryType: ctx.industryType ?? null,
    warnings,
  };
}

export function formatAuthoritativeFactoringBlock(
  facts: CanonicalFactoringFacts
): string {
  const lines: string[] = [];
  lines.push(
    "AUTHORITATIVE SAVED DEAL FACTS (Invoice Factoring — use these numbers exactly; do not substitute or invent values.)"
  );
  if (facts.industryType) lines.push(`- Industry: ${facts.industryType}`);
  if (facts.monthlyInvoiceVolume != null)
    lines.push(
      `- Monthly invoice volume: $${formatUsd(facts.monthlyInvoiceVolume)}`
    );
  if (facts.advanceRate != null)
    lines.push(`- Advance rate: ${facts.advanceRate}%`);
  if (facts.estimatedMonthlyAdvance != null)
    lines.push(
      `- Estimated monthly advance: $${formatUsd(facts.estimatedMonthlyAdvance)}`
    );
  if (facts.factoringFeePercent != null)
    lines.push(`- Factoring fee: ${facts.factoringFeePercent}%`);
  if (facts.estimatedMonthlyFee != null)
    lines.push(
      `- Estimated monthly fee: $${formatUsd(facts.estimatedMonthlyFee)}`
    );
  if (facts.averageInvoiceDays != null)
    lines.push(`- Average invoice payment days: ${facts.averageInvoiceDays}`);
  if (facts.recourse != null)
    lines.push(`- Recourse: ${facts.recourse ? "Yes" : "No"}`);
  if (facts.monthlyRevenue != null)
    lines.push(
      `- Monthly revenue (context): $${formatUsd(facts.monthlyRevenue)}`
    );
  if (facts.warnings.length > 0) {
    lines.push("Reconciliation notes:");
    for (const w of facts.warnings) lines.push(`- ${w}`);
  }
  lines.push(
    "If a value is missing above, say it is not in the saved deal context — do not fabricate numbers."
  );
  return lines.join("\n");
}

export const AUTHORITATIVE_FACTORING_GROUNDING = `INVOICE FACTORING AUTHORITATIVE GROUNDING:
- This thread is invoice factoring. Never use MCA or loan terms.
- Use terms: invoice volume, advance rate, factoring fee, funded amount.
- Key objection reframe: this is not debt — it is selling receivables at a discount.
- Cite only numbers from AUTHORITATIVE SAVED DEAL FACTS for this product.`;
