/**
 * Canonical Business LOC facts from saved deal_context — source of truth for coach prompts.
 * Uses lineOfCreditCalculator; never MCA advance/factor framing.
 */

import type {
  DealContextLineOfCredit,
  LineOfCreditPaymentFrequency,
} from "../types/dealContext.js";
import { formatUsd } from "./canonicalMcaDeal.js";
import { computeLineOfCreditMetrics } from "./lineOfCreditCalculator.js";

function isPositive(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

export type CanonicalLocFacts = {
  drawnAmount: number | null;
  creditLimit: number | null;
  interestRatePercent: number | null;
  originationFee: number | null;
  paymentFrequency: LineOfCreditPaymentFrequency | null;
  termDays: number | null;
  termMonths: number | null;
  /** Illustrative total from drawn + interest (+ origination); not an MCA payback factor. */
  estimatedTotalPayback: number | null;
  dailyPayment: number | null;
  weeklyPayment: number | null;
  monthlyPayment: number | null;
  monthlyRevenue: number | null;
  /** User-entered override when present. */
  estimatedPaymentOverride: number | null;
  missingFields: string[];
  calculatorHadEnoughForSchedule: boolean;
  warnings: string[];
};

/**
 * Returns null only when there is no usable LOC identity (no drawn/limit/rate at all).
 */
export function resolveCanonicalLocFacts(
  ctx: DealContextLineOfCredit | null | undefined
): CanonicalLocFacts | null {
  if (ctx == null || typeof ctx !== "object") return null;
  if (ctx.dealType !== "business_line_of_credit") return null;

  const warnings: string[] = [];
  const drawnAmount = isPositive(ctx.drawnAmount) ? ctx.drawnAmount : null;
  const creditLimit = isPositive(ctx.creditLimit) ? ctx.creditLimit : null;
  const interestRatePercent =
    ctx.interestRate != null && Number.isFinite(ctx.interestRate) && ctx.interestRate >= 0
      ? ctx.interestRate
      : null;
  const originationFee =
    ctx.originationFee != null && Number.isFinite(ctx.originationFee) && ctx.originationFee >= 0
      ? ctx.originationFee
      : null;

  if (drawnAmount == null && creditLimit == null && interestRatePercent == null) {
    return null;
  }

  const calc = computeLineOfCreditMetrics(ctx);
  const freq = ctx.paymentFrequency;
  const paymentFrequency: LineOfCreditPaymentFrequency | null =
    freq === "daily" || freq === "weekly" || freq === "monthly" ? freq : null;

  const termDays = isPositive(ctx.termDays) ? ctx.termDays : null;
  const termMonths = isPositive(ctx.termMonths) ? ctx.termMonths : null;
  const monthlyRevenue = isPositive(ctx.monthlyRevenue) ? ctx.monthlyRevenue : null;
  const estimatedPaymentOverride =
    ctx.estimatedPayment != null &&
    Number.isFinite(ctx.estimatedPayment) &&
    ctx.estimatedPayment > 0
      ? ctx.estimatedPayment
      : null;

  const estimatedTotalPayback =
    calc.estimatedTotalPayback != null && Number.isFinite(calc.estimatedTotalPayback)
      ? calc.estimatedTotalPayback
      : null;

  if (
    drawnAmount != null &&
    interestRatePercent != null &&
    estimatedTotalPayback != null &&
    creditLimit != null &&
    drawnAmount > creditLimit
  ) {
    warnings.push("Drawn amount exceeds credit limit in saved context — verify values.");
  }

  return {
    drawnAmount,
    creditLimit,
    interestRatePercent,
    originationFee,
    paymentFrequency,
    termDays,
    termMonths,
    estimatedTotalPayback,
    dailyPayment: calc.dailyPayment ?? null,
    weeklyPayment: calc.weeklyPayment ?? null,
    monthlyPayment: calc.monthlyPayment ?? null,
    monthlyRevenue,
    estimatedPaymentOverride,
    missingFields: [...calc.missingFields],
    calculatorHadEnoughForSchedule: calc.hasEnoughInputs,
    warnings,
  };
}

export function formatAuthoritativeLocBlock(facts: CanonicalLocFacts): string {
  const lines: string[] = [];
  lines.push(
    "AUTHORITATIVE SAVED LOC DEAL FACTS (Business line of credit — use these numbers exactly; this is NOT a merchant cash advance. Do not use MCA framing: no advance amount, no factor rate, no MCA-style factor math.)"
  );
  if (facts.drawnAmount != null) {
    lines.push(`- Drawn balance (outstanding): $${formatUsd(facts.drawnAmount)}`);
  }
  if (facts.creditLimit != null) {
    lines.push(`- Credit limit: $${formatUsd(facts.creditLimit)}`);
  }
  if (facts.interestRatePercent != null) {
    lines.push(
      `- Interest rate on drawn balance (as stored, % points): ${facts.interestRatePercent}%`
    );
  }
  if (facts.originationFee != null && facts.originationFee > 0) {
    lines.push(`- Origination fee (included in illustrative total when modeled): $${formatUsd(facts.originationFee)}`);
  }
  if (facts.paymentFrequency != null) {
    lines.push(`- Payment frequency: ${facts.paymentFrequency}`);
  }
  if (facts.termDays != null) {
    lines.push(`- Term (calendar days, when daily/weekly): ${facts.termDays}`);
  }
  if (facts.termMonths != null) {
    lines.push(`- Term (months, when monthly): ${facts.termMonths}`);
  }
  if (facts.estimatedTotalPayback != null) {
    lines.push(
      `- Illustrative total obligation (simple model: drawn + interest on draw + origination): $${formatUsd(facts.estimatedTotalPayback)}`
    );
  }
  if (facts.estimatedPaymentOverride != null) {
    lines.push(
      `- User-estimated payment (saved): $${formatUsd(facts.estimatedPaymentOverride)}`
    );
  }
  if (facts.dailyPayment != null) {
    lines.push(`- Modeled payment (daily schedule): $${formatUsd(facts.dailyPayment)}/day`);
  }
  if (facts.weeklyPayment != null) {
    lines.push(`- Modeled payment (weekly schedule): $${formatUsd(facts.weeklyPayment)}/week`);
  }
  if (facts.monthlyPayment != null) {
    lines.push(`- Modeled payment (monthly schedule): $${formatUsd(facts.monthlyPayment)}/month`);
  }
  if (facts.monthlyRevenue != null) {
    lines.push(`- Monthly revenue (burden context): $${formatUsd(facts.monthlyRevenue)}`);
  }
  if (facts.missingFields.length > 0) {
    lines.push(`- Calculator notes (missing for full schedule): ${facts.missingFields.join(", ")}`);
  }
  if (facts.warnings.length > 0) {
    for (const w of facts.warnings) lines.push(`- Note: ${w}`);
  }
  lines.push(
    "If a value is missing above, say it is not in the saved deal context — do not substitute MCA-style examples or invented dollar amounts."
  );
  return lines.join("\n");
}

export const AUTHORITATIVE_LOC_GROUNDING = `LOC AUTHORITATIVE GROUNDING:
- This thread is a Business line of credit. Never describe the deal using merchant cash advance terms (advance, factor, remittance) unless the user explicitly compares products.
- Cite only numbers from AUTHORITATIVE SAVED LOC DEAL FACTS and DEAL CONTEXT (computed) for this product.
- For “payback” or “total cost,” use the illustrative LOC total obligation from saved facts, not MCA payback math.`;
