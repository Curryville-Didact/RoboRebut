/**
 * Business line of credit — deterministic metrics from optional `DealContextLineOfCredit`.
 *
 * ## Assumptions (explicit)
 *
 * 1. **Financed balance** — `drawnAmount` is the amount outstanding / drawn; all payment math uses it.
 * 2. **estimatedTotalPayback** — One-shot illustrative total: `drawnAmount * (1 + interestRate/100)` where
 *    `interestRate` is percentage points on the drawn balance (e.g. 6 means 6%), plus `originationFee`
 *    when present (non-negative). Not amortized APR; not compound interest over time.
 * 3. **maintenanceFee** — Omitted from `estimatedTotalPayback` (recurring fee; not folded into this
 *    simple total-payback stub; see product if that should change).
 * 4. **Payment schedule** — Evenly splits `estimatedTotalPayback` across periods:
 *    - `daily`: `termDays` calendar days → `dailyPayment = estimatedTotalPayback / termDays`.
 *    - `weekly`: same term in days → `weeklyPayment = estimatedTotalPayback / (termDays / 7)` fractional weeks.
 *    - `monthly`: `termMonths` → `monthlyPayment = estimatedTotalPayback / termMonths`.
 * 5. **Monthly equivalent (for burden)** — If only `dailyPayment` is set: `dailyPayment * 21` (weekdays/month,
 *    same proxy as MCA lending calculator). If only `weeklyPayment`: `weeklyPayment * (52/12)`.
 *    If `monthlyPayment` is set, use it directly.
 * 6. **monthlyBurdenRatio** — `monthlyEquivalentPayment / monthlyRevenue` when revenue is a positive finite number.
 * 7. **holdPercentage** — `monthlyBurdenRatio * 100` (uncapped), only when burden is computable.
 */

import type { DealContextLineOfCredit } from "../types/dealContext.js";

export interface LineOfCreditCalculationResult {
  hasEnoughInputs: boolean;
  missingFields: string[];
  estimatedTotalPayback?: number;
  dailyPayment?: number;
  weeklyPayment?: number;
  monthlyPayment?: number;
  monthlyBurdenRatio?: number;
  holdPercentage?: number;
}

function isPositiveNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

function nonNegativeOrigination(n: unknown): number {
  if (typeof n === "number" && Number.isFinite(n) && n >= 0) return n;
  return 0;
}

function monthlyEquivalentPayment(
  r: Pick<
    LineOfCreditCalculationResult,
    "dailyPayment" | "weeklyPayment" | "monthlyPayment"
  >
): number | undefined {
  if (r.monthlyPayment != null && Number.isFinite(r.monthlyPayment)) {
    return r.monthlyPayment;
  }
  if (r.dailyPayment != null && Number.isFinite(r.dailyPayment)) {
    return r.dailyPayment * 21;
  }
  if (r.weeklyPayment != null && Number.isFinite(r.weeklyPayment)) {
    return r.weeklyPayment * (52 / 12);
  }
  return undefined;
}

function applyBurden(
  ctx: DealContextLineOfCredit,
  out: LineOfCreditCalculationResult
): LineOfCreditCalculationResult {
  const meq = monthlyEquivalentPayment(out);
  if (meq != null && isPositiveNumber(ctx.monthlyRevenue)) {
    const monthlyBurdenRatio = meq / ctx.monthlyRevenue;
    return {
      ...out,
      monthlyBurdenRatio,
      holdPercentage: monthlyBurdenRatio * 100,
    };
  }
  return out;
}

function isValidInterestRate(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0;
}

export function computeLineOfCreditMetrics(
  ctx: DealContextLineOfCredit | null | undefined
): LineOfCreditCalculationResult {
  const missing: string[] = [];

  if (ctx == null || typeof ctx !== "object") {
    return { hasEnoughInputs: false, missingFields: ["drawnAmount"] };
  }

  if (!isPositiveNumber(ctx.drawnAmount)) {
    missing.push("drawnAmount");
  }
  if (!isValidInterestRate(ctx.interestRate)) {
    missing.push("interestRate");
  }

  if (!isPositiveNumber(ctx.drawnAmount) || !isValidInterestRate(ctx.interestRate)) {
    return { hasEnoughInputs: false, missingFields: [...new Set(missing)] };
  }

  const drawnAmount = ctx.drawnAmount;
  const interestRate = ctx.interestRate;
  const origination = nonNegativeOrigination(ctx.originationFee);
  const estimatedTotalPayback = drawnAmount * (1 + interestRate / 100) + origination;

  const freq = ctx.paymentFrequency;
  if (freq !== "daily" && freq !== "weekly" && freq !== "monthly") {
    return {
      hasEnoughInputs: false,
      missingFields: [...new Set([...missing, "paymentFrequency"])],
      estimatedTotalPayback,
    };
  }

  if (freq === "daily") {
    if (!isPositiveNumber(ctx.termDays)) {
      return {
        hasEnoughInputs: false,
        missingFields: [...new Set([...missing, "termDays"])],
        estimatedTotalPayback,
      };
    }
    const dailyPayment = estimatedTotalPayback / ctx.termDays;
    return applyBurden(ctx, {
      hasEnoughInputs: true,
      missingFields: [],
      estimatedTotalPayback,
      dailyPayment,
    });
  }

  if (freq === "weekly") {
    if (!isPositiveNumber(ctx.termDays)) {
      return {
        hasEnoughInputs: false,
        missingFields: [...new Set([...missing, "termDays"])],
        estimatedTotalPayback,
      };
    }
    const weeklyPayment = estimatedTotalPayback / (ctx.termDays / 7);
    return applyBurden(ctx, {
      hasEnoughInputs: true,
      missingFields: [],
      estimatedTotalPayback,
      weeklyPayment,
    });
  }

  // monthly
  if (!isPositiveNumber(ctx.termMonths)) {
    return {
      hasEnoughInputs: false,
      missingFields: [...new Set([...missing, "termMonths"])],
      estimatedTotalPayback,
    };
  }
  const monthlyPayment = estimatedTotalPayback / ctx.termMonths;
  return applyBurden(ctx, {
    hasEnoughInputs: true,
    missingFields: [],
    estimatedTotalPayback,
    monthlyPayment,
  });
}
