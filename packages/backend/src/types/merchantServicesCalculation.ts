/**
 * Phase 4.1 — Merchant services (non-lending) deal calculator output.
 */

export interface MerchantServicesCalculationResult {
  hasEnoughInputs: boolean;
  missingFields: string[];
  /** Sum of current pricing components actually supplied (rate + per-txn + fixed). */
  currentMonthlyCost?: number;
  /** Sum of proposed pricing components actually supplied. */
  proposedMonthlyCost?: number;
  /** currentMonthlyCost - proposedMonthlyCost when both sides are defined. */
  monthlyDelta?: number;
  /** effectiveRate - proposedRate (percentage points) when both exist. */
  effectiveRateDelta?: number;
}
