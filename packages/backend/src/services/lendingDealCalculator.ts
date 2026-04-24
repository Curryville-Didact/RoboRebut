/**
 * Phase 4.1 — Lending / MCA-style deal calculation engine (deterministic, auditable).
 *
 * NOT wired into AI or prompts. Consumes optional `DealContextMca`; returns structured metrics.
 *
 * ## Assumptions (explicit)
 *
 * 1. **termDays** — Length of the repayment period in **calendar days** (e.g. 120 = 120-day term).
 *    Inline: all payment splits divide by this calendar-day count, not business days only.
 * 2. **Payment schedule derivation** — From total payback and term only:
 *    - `dailyPayment = estimatedTotalPayback / termDays` (equal daily amortization).
 *    - `weeklyPayment = estimatedTotalPayback / (termDays / 7)` (equal weekly amortization;
 *      i.e. `termDays / 7` fractional weeks in the term). Same total; different payment cadence.
 * 3. **Total payback** — If `paybackAmount` is set, it is authoritative. Otherwise
 *    `estimatedTotalPayback = advanceAmount * factorRate` (multiplicative factor, e.g. 1.20).
 * 4. **Monthly repayment estimate** — For burden metrics we use **dailyPayment × 21** as a
 *    proxy for one month of **business-day** collections (21 weekdays/month assumption; not ISO calendar).
 * 5. **holdPercentage** — `repaymentBurden × 100` (same ratio as percentage; not capped).
 * 6. **repaymentBurden** — `approxMonthlyRepayment / monthlyRevenue` (uncapped ratio).
 * 7. **paymentFrequency** on `DealContextMca` — Intentionally unused in Phase 4.1; daily and weekly
 *    implied payments are both derived from calendar `termDays` only.
 *
 * ## Not modeled (Phase 4.1)
 * Lender-specific splits, holidays, business-day-only calendars, or true APR.
 */

import type { DealContextMca } from "../types/dealContext.js";
import type { DealCalculationResult } from "../types/dealCalculation.js";

const PAYBACK_OR_ADVANCE_FACTOR =
  "paybackAmount or (advanceAmount and factorRate)";
const TERM_DAYS = "termDays";
const MONTHLY_REVENUE = "monthlyRevenue";

function isPositiveNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

/**
 * Resolve total repayment amount from deal_context rules.
 */
export function resolveEstimatedTotalPayback(
  ctx: DealContextMca | null | undefined
): { value: number } | { missing: string[] } {
  if (!ctx || typeof ctx !== "object") {
    return { missing: [PAYBACK_OR_ADVANCE_FACTOR] };
  }

  if (isPositiveNumber(ctx.paybackAmount)) {
    return { value: ctx.paybackAmount };
  }

  if (isPositiveNumber(ctx.advanceAmount) && isPositiveNumber(ctx.factorRate)) {
    return { value: ctx.advanceAmount * ctx.factorRate };
  }

  return { missing: [PAYBACK_OR_ADVANCE_FACTOR] };
}

/**
 * Full structured calculation from optional deal context.
 */
export function computeDealMetrics(
  dealContext: DealContextMca | null | undefined
): DealCalculationResult {
  const missingFields: string[] = [];

  const paybackRes = resolveEstimatedTotalPayback(dealContext);
  if ("missing" in paybackRes) {
    missingFields.push(...paybackRes.missing);
  }

  if (!dealContext || !isPositiveNumber(dealContext.termDays)) {
    missingFields.push(TERM_DAYS);
  }

  if (
    "value" in paybackRes &&
    dealContext &&
    // termDays = full repayment window in calendar days (see file header).
    isPositiveNumber(dealContext.termDays)
  ) {
    const estimatedTotalPayback = paybackRes.value;
    const termDays = dealContext.termDays;
    const dailyPayment = estimatedTotalPayback / termDays;
    const weeklyPayment = estimatedTotalPayback / (termDays / 7);
    // dealContext.paymentFrequency — reserved; Phase 4.1 does not branch on it (see header).

    const partialMissing: string[] = [];

    const result: DealCalculationResult = {
      hasEnoughInputs: true,
      missingFields: [],
      estimatedTotalPayback,
      dailyPayment,
      weeklyPayment,
    };

    if (isPositiveNumber(dealContext.monthlyRevenue)) {
      // 21 ≈ business days per month for monthly burden (documented assumption).
      const approxMonthlyRepayment = dailyPayment * 21;
      const burden = approxMonthlyRepayment / dealContext.monthlyRevenue;
      result.repaymentBurden = burden;
      result.holdPercentage = burden * 100;
    } else {
      partialMissing.push(MONTHLY_REVENUE);
    }

    result.missingFields = [...new Set([...missingFields, ...partialMissing])];
    return result;
  }

  return {
    hasEnoughInputs: false,
    missingFields: [...new Set(missingFields)],
  };
}

/**
 * Examples (for docs / manual QA; not executed as tests here):
 *
 * Example A — payback + term + revenue:
 *   Input: { paybackAmount: 12000, termDays: 100, monthlyRevenue: 20000 }
 *   estimatedTotalPayback = 12000
 *   dailyPayment = 120
 *   weeklyPayment = 12000 / (100/7) = 840
 *   approxMonthlyRepayment = 120 * 21 = 2520
 *   repaymentBurden = 2520/20000 = 0.126
 *   holdPercentage = 12.6
 *
 * Example B — advance + factor + term:
 *   Input: { advanceAmount: 10000, factorRate: 1.2, termDays: 60, monthlyRevenue: 15000 }
 *   estimatedTotalPayback = 12000
 *   dailyPayment = 200
 *   weeklyPayment = 12000 / (60/7) ≈ 1400
 *   repaymentBurden ≈ (200*21)/15000 = 0.28
 *   holdPercentage = 28
 */
