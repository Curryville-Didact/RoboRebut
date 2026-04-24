/**
 * Phase 4.1 — Structured output from the lending deal calculator.
 * Pure data shape; no persistence here.
 */

export interface DealCalculationResult {
  /** True when total payback and payment schedule (daily/weekly) can be computed. */
  hasEnoughInputs: boolean;
  /** Human-readable keys describing what was missing for full or partial output. */
  missingFields: string[];
  /** Total amount to be repaid (from paybackAmount or advance × factor). */
  estimatedTotalPayback?: number;
  /**
   * Implied payment if the obligation were spread evenly across each calendar day
   * in the term: totalPayback / termDays.
   */
  dailyPayment?: number;
  /**
   * Implied payment if the obligation were spread evenly across each week of the term:
   * totalPayback / (termDays / 7). See lendingDealCalculator assumptions.
   */
  weeklyPayment?: number;
  /**
   * Approximate share of monthly revenue consumed by repayment, as a percentage.
   * repaymentBurden × 100 (dailyPayment × 21 business-day proxy / monthlyRevenue). Uncapped.
   */
  holdPercentage?: number;
  /**
   * Normalized burden: approximate monthly repayment divided by monthly revenue
   * (same numerator as hold percentage; ratio not capped). Higher = heavier burden.
   */
  repaymentBurden?: number;
}
