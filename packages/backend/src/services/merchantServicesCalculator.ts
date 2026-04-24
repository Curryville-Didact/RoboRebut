/**
 * Phase 4.1 — Merchant services (non-lending) deal calculator.
 *
 * Deterministic cost comparison from optional `DealContextMerchantServices`.
 * NOT wired into AI. No lending/MCA math here.
 *
 * ## Assumptions (explicit)
 *
 * 1. **monthlyCardVolume** — Total card volume processed in one month ($); required gate for any output.
 * 2. **effectiveRate / proposedRate** — Percentage of **monthly card volume** charged as the
 *    discount/processing component for that side (e.g. 2.75 ⇒ 2.75% of volume). Not APR.
 * 3. **Per-transaction fees** — When `averageTicket` and a per-txn fee exist, estimated monthly
 *    txn count = `monthlyCardVolume / averageTicket` (uniform ticket assumption; not mix-of-MIDs).
 * 4. **Fixed fees** — `monthlyFees` / `proposedMonthlyFees` are flat monthly charges ($).
 * 5. **chargebackRate / riskLevel / providerName** — Carried on context for future use; not used in costs in Phase 4.1.
 *
 * ## Outputs
 * - **currentMonthlyCost** — Sum of current-side components that are actually present (rate + per-txn + fixed).
 * - **proposedMonthlyCost** — Same for proposed side.
 * - **monthlyDelta** — `currentMonthlyCost - proposedMonthlyCost` only when **both** totals were computed
 *   (each side had at least one pricing dimension after volume).
 * - **effectiveRateDelta** — `effectiveRate - proposedRate` when both rates exist.
 */

import type { DealContextMerchantServices } from "../types/dealContext.js";
import type { MerchantServicesCalculationResult } from "../types/merchantServicesCalculation.js";

const VOL = "monthlyCardVolume";
const PRICING =
  "at least one pricing input (effectiveRate, perTxnFee+averageTicket, monthlyFees, proposedRate, proposedPerTxnFee+averageTicket, or proposedMonthlyFees)";

function isPositiveNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

/** Rate as % of volume: ratePct e.g. 2.75 → 2.75% of volume. */
function ratePortion(volume: number, ratePct: number | undefined): number {
  if (ratePct == null || !Number.isFinite(ratePct)) return 0;
  return volume * (ratePct / 100);
}

/**
 * Per-txn cost: (volume / avgTicket) * fee when both defined and avgTicket > 0.
 * (uniform ticket count assumption)
 */
function perTxnPortion(
  volume: number,
  averageTicket: number | undefined,
  feePerTxn: number | undefined
): number {
  if (
    averageTicket == null ||
    feePerTxn == null ||
    !Number.isFinite(feePerTxn) ||
    !isPositiveNumber(averageTicket)
  ) {
    return 0;
  }
  const txCount = volume / averageTicket;
  return txCount * feePerTxn;
}

function fixedPortion(fixed: number | undefined): number {
  if (fixed == null || !Number.isFinite(fixed)) return 0;
  return fixed;
}

function hasCurrentPricing(ctx: DealContextMerchantServices): boolean {
  return (
    ctx.effectiveRate != null ||
    (ctx.perTxnFee != null && ctx.averageTicket != null) ||
    ctx.monthlyFees != null
  );
}

function hasProposedPricing(ctx: DealContextMerchantServices): boolean {
  return (
    ctx.proposedRate != null ||
    (ctx.proposedPerTxnFee != null && ctx.averageTicket != null) ||
    ctx.proposedMonthlyFees != null
  );
}

export function computeMerchantServicesMetrics(
  ctx: DealContextMerchantServices | null | undefined
): MerchantServicesCalculationResult {
  const missingFields: string[] = [];

  if (!ctx || typeof ctx !== "object") {
    return {
      hasEnoughInputs: false,
      missingFields: [VOL, PRICING],
    };
  }

  if (!isPositiveNumber(ctx.monthlyCardVolume)) {
    missingFields.push(VOL);
  }

  const hasCurr = hasCurrentPricing(ctx);
  const hasProp = hasProposedPricing(ctx);
  if (!hasCurr && !hasProp) {
    missingFields.push(PRICING);
  }

  const volume = ctx.monthlyCardVolume;
  if (!isPositiveNumber(volume) || (!hasCurr && !hasProp)) {
    return {
      hasEnoughInputs: false,
      missingFields: [...new Set(missingFields)],
    };
  }

  const currentMonthlyCost =
    ratePortion(volume, ctx.effectiveRate) +
    perTxnPortion(volume, ctx.averageTicket, ctx.perTxnFee) +
    fixedPortion(ctx.monthlyFees);

  const proposedMonthlyCost =
    ratePortion(volume, ctx.proposedRate) +
    perTxnPortion(volume, ctx.averageTicket, ctx.proposedPerTxnFee) +
    fixedPortion(ctx.proposedMonthlyFees);

  const result: MerchantServicesCalculationResult = {
    hasEnoughInputs: true,
    missingFields: [],
    currentMonthlyCost: hasCurr ? currentMonthlyCost : undefined,
    proposedMonthlyCost: hasProp ? proposedMonthlyCost : undefined,
  };

  if (
    result.currentMonthlyCost !== undefined &&
    result.proposedMonthlyCost !== undefined
  ) {
    result.monthlyDelta =
      result.currentMonthlyCost - result.proposedMonthlyCost;
  }

  if (
    ctx.effectiveRate != null &&
    ctx.proposedRate != null &&
    Number.isFinite(ctx.effectiveRate) &&
    Number.isFinite(ctx.proposedRate)
  ) {
    result.effectiveRateDelta = ctx.effectiveRate - ctx.proposedRate;
  }

  return result;
}

/**
 * Example:
 *   Input: {
 *     dealType: "merchant_services",
 *     monthlyCardVolume: 100_000,
 *     effectiveRate: 2.9,
 *     proposedRate: 2.4,
 *     averageTicket: 50,
 *     perTxnFee: 0.1,
 *     proposedPerTxnFee: 0.08,
 *     monthlyFees: 25,
 *     proposedMonthlyFees: 0,
 *   }
 *   rate current = 2900, txn current = (100000/50)*0.1 = 200, fixed = 25 → currentMonthlyCost = 3125
 *   proposed rate = 2400, txn proposed = 160, fixed = 0 → proposedMonthlyCost = 2560
 *   monthlyDelta = 565
 *   effectiveRateDelta = 0.5
 */
