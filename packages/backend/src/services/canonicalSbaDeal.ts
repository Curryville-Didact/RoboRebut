/**
 * Canonical SBA Loan facts derived from saved deal_context.
 * Covers SBA 7(a) and SBA 504 structures.
 */

import { formatUsd } from "./canonicalMcaDeal.js";

export type DealTypeSba = "sba_loan";

export interface DealContextSba {
  dealType: DealTypeSba;
  loanAmount?: number;
  interestRate?: number;
  termMonths?: number;
  monthlyPayment?: number;
  monthlyRevenue?: number;
  sbaProgram?: "7a" | "504" | "express";
  collateralRequired?: boolean;
  lenderName?: string;
  guarantyFeePercent?: number;
  originationFee?: number;
}

export interface CanonicalSbaFacts {
  loanAmount: number | null;
  interestRate: number | null;
  termMonths: number | null;
  monthlyPayment: number | null;
  monthlyRevenue: number | null;
  sbaProgram: string | null;
  estimatedTotalPayback: number | null;
  guarantyFeePercent: number | null;
  originationFee: number | null;
  warnings: string[];
}

function isPositive(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

export function resolveCanonicalSbaFacts(
  ctx: DealContextSba | null | undefined
): CanonicalSbaFacts | null {
  if (ctx == null || typeof ctx !== "object") return null;
  if (ctx.dealType !== "sba_loan") return null;

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
    sbaProgram: ctx.sbaProgram ?? null,
    estimatedTotalPayback,
    guarantyFeePercent: ctx.guarantyFeePercent ?? null,
    originationFee: isPositive(ctx.originationFee) ? ctx.originationFee : null,
    warnings,
  };
}

export function formatAuthoritativeSbaBlock(
  facts: CanonicalSbaFacts
): string {
  const lines: string[] = [];
  lines.push(
    "AUTHORITATIVE SAVED DEAL FACTS (SBA Loan — use these numbers exactly; do not substitute or invent values.)"
  );
  if (facts.sbaProgram) lines.push(`- SBA program: ${facts.sbaProgram}`);
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
  if (facts.guarantyFeePercent != null)
    lines.push(`- SBA guaranty fee: ${facts.guarantyFeePercent}%`);
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

export const AUTHORITATIVE_SBA_GROUNDING = `SBA LOAN AUTHORITATIVE GROUNDING:
- This thread is an SBA loan. Never describe the deal using MCA terms (factor rate, advance, payback).
- Use terms: loan amount, interest rate, term, monthly payment.
- Cite only numbers from AUTHORITATIVE SAVED DEAL FACTS for this product.
- SBA 7(a) max is $5M. SBA 504 is for fixed assets. Express loans close faster but have lower limits.`;
