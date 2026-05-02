/**
 * Canonical Term Loan facts derived from saved deal_context.
 * Covers conventional business term loans (non-SBA).
 */

import { formatUsd } from "./canonicalMcaDeal.js";

export type DealTypeTermLoan = "term_loan";

export interface DealContextTermLoan {
  dealType: DealTypeTermLoan;
  loanAmount?: number;
  interestRate?: number;
  termMonths?: number;
  monthlyPayment?: number;
  monthlyRevenue?: number;
  originationFee?: number;
  lenderName?: string;
  prepaymentPenalty?: boolean;
  collateralRequired?: boolean;
}

export interface CanonicalTermLoanFacts {
  loanAmount: number | null;
  interestRate: number | null;
  termMonths: number | null;
  monthlyPayment: number | null;
  monthlyRevenue: number | null;
  originationFee: number | null;
  estimatedTotalPayback: number | null;
  warnings: string[];
}

function isPositive(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

export function resolveCanonicalTermLoanFacts(
  ctx: DealContextTermLoan | null | undefined
): CanonicalTermLoanFacts | null {
  if (ctx == null || typeof ctx !== "object") return null;
  if (ctx.dealType !== "term_loan") return null;

  const warnings: string[] = [];
  const loanAmount = isPositive(ctx.loanAmount) ? ctx.loanAmount : null;
  const interestRate =
    ctx.interestRate != null &&
    Number.isFinite(ctx.interestRate) &&
    ctx.interestRate >= 0
      ? ctx.interestRate
      : null;
  const termMonths = isPositive(ctx.termMonths) ? ctx.termMonths : null;
  const monthlyPayment = isPositive(ctx.monthlyPayment)
    ? ctx.monthlyPayment
    : null;
  const monthlyRevenue = isPositive(ctx.monthlyRevenue)
    ? ctx.monthlyRevenue
    : null;

  if (loanAmount == null && monthlyPayment == null) return null;

  const estimatedTotalPayback =
    monthlyPayment != null && termMonths != null
      ? monthlyPayment * termMonths
      : null;

  return {
    loanAmount,
    interestRate,
    termMonths,
    monthlyPayment,
    monthlyRevenue,
    originationFee: isPositive(ctx.originationFee) ? ctx.originationFee : null,
    estimatedTotalPayback,
    warnings,
  };
}

export function formatAuthoritativeTermLoanBlock(
  facts: CanonicalTermLoanFacts
): string {
  const lines: string[] = [];
  lines.push(
    "AUTHORITATIVE SAVED DEAL FACTS (Term Loan — use these numbers exactly; do not substitute or invent values.)"
  );
  if (facts.loanAmount != null)
    lines.push(`- Loan amount: $${formatUsd(facts.loanAmount)}`);
  if (facts.interestRate != null)
    lines.push(`- Interest rate: ${facts.interestRate}%`);
  if (facts.termMonths != null)
    lines.push(`- Term: ${facts.termMonths} months`);
  if (facts.monthlyPayment != null)
    lines.push(`- Monthly payment: $${formatUsd(facts.monthlyPayment)}/month`);
  if (facts.estimatedTotalPayback != null)
    lines.push(
      `- Estimated total payback: $${formatUsd(facts.estimatedTotalPayback)}`
    );
  if (facts.originationFee != null && facts.originationFee > 0)
    lines.push(`- Origination fee: $${formatUsd(facts.originationFee)}`);
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

export const AUTHORITATIVE_TERM_LOAN_GROUNDING = `TERM LOAN AUTHORITATIVE GROUNDING:
- This thread is a conventional business term loan. Never use MCA terms (factor rate, advance, payback).
- Use terms: loan amount, interest rate, term, monthly payment, total payback.
- Cite only numbers from AUTHORITATIVE SAVED DEAL FACTS for this product.`;
