/**
 * Conversation-level deal intelligence (`deal_context` JSONB).
 * Mirrors backend discriminated union.
 */

export type PaymentFrequency = "daily" | "weekly";

export type DealRiskLevel = "low" | "medium" | "high";

export type DealTypeMca = "mca";
export type DealTypeMerchantServices = "merchant_services";
export type DealTypeLineOfCredit = "business_line_of_credit";

export type LineOfCreditPaymentFrequency = "daily" | "weekly" | "monthly";

export interface DealContextMca {
  dealType?: DealTypeMca;
  monthlyRevenue?: number;
  advanceAmount?: number;
  paybackAmount?: number;
  paymentFrequency?: PaymentFrequency;
  termDays?: number;
  lenderName?: string;
  factorRate?: number;
}

export interface DealContextMerchantServices {
  dealType: DealTypeMerchantServices;
  /** Canonical: monthly card / processing volume ($). */
  monthlyCardVolume?: number;
  averageTicket?: number;
  effectiveRate?: number;
  proposedRate?: number;
  perTxnFee?: number;
  proposedPerTxnFee?: number;
  monthlyFees?: number;
  proposedMonthlyFees?: number;
  chargebackRate?: number;
  riskLevel?: DealRiskLevel;
  providerName?: string;
  contractTermMonths?: number;
  earlyTerminationFee?: number;
}

export interface DealContextLineOfCredit {
  dealType: DealTypeLineOfCredit;
  creditLimit?: number;
  drawnAmount?: number;
  interestRate?: number;
  paymentFrequency?: LineOfCreditPaymentFrequency;
  termDays?: number;
  termMonths?: number;
  monthlyRevenue?: number;
  originationFee?: number;
  maintenanceFee?: number;
  estimatedPayment?: number;
}

export type DealContext =
  | DealContextMca
  | DealContextMerchantServices
  | DealContextLineOfCredit;

export function isMerchantServicesContext(
  value: unknown
): value is DealContextMerchantServices {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>).dealType === "merchant_services"
  );
}

export function isMcaContext(value: unknown): value is DealContextMca {
  if (value == null || typeof value !== "object") return false;
  const t = (value as Record<string, unknown>).dealType;
  return t === "mca" || t === undefined;
}

export function isLineOfCreditContext(
  value: unknown
): value is DealContextLineOfCredit {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>).dealType === "business_line_of_credit"
  );
}

export function hasDealContextValues(
  value: DealContext | null | undefined
): boolean {
  if (!value) return false;
  return Object.entries(value as Record<string, unknown>).some(
    ([k, v]) => k !== "dealType" && v !== undefined && v !== null
  );
}

/**
 * Placeholder for future UI — not used in product surfaces yet.
 */
export function getDealSummaryPreview(
  context: DealContext | null | undefined
): string {
  if (!context) return "No deal context";
  if (isMerchantServicesContext(context)) {
    if (context.providerName) return `Merchant services (${context.providerName})`;
    return "Merchant services deal context";
  }
  if (isLineOfCreditContext(context)) {
    return "Line of credit deal context";
  }
  if (isMcaContext(context) && context.lenderName) {
    return `Deal context (${context.lenderName})`;
  }
  return "Deal context ready";
}

/**
 * Phase 4.1 — mirrors backend `DealCalculationResult` for future UI/API use.
 * Burden uses dailyPayment × 21 business days / monthlyRevenue; holdPercentage = repaymentBurden × 100 (uncapped).
 */
export interface DealCalculationResult {
  hasEnoughInputs: boolean;
  missingFields: string[];
  estimatedTotalPayback?: number;
  dailyPayment?: number;
  weeklyPayment?: number;
  holdPercentage?: number;
  repaymentBurden?: number;
}

/** Phase 4.1 — mirrors backend merchant services calculator output. */
export interface MerchantServicesCalculationResult {
  hasEnoughInputs: boolean;
  missingFields: string[];
  currentMonthlyCost?: number;
  proposedMonthlyCost?: number;
  monthlyDelta?: number;
  effectiveRateDelta?: number;
}

/** Mirrors backend LOC calculator output for typed consumers. */
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

export type ResolvedDealCalculation =
  | { dealType: "mca"; result: DealCalculationResult }
  | { dealType: "merchant_services"; result: MerchantServicesCalculationResult }
  | {
      dealType: "business_line_of_credit";
      result: LineOfCreditCalculationResult;
    }
  | { dealType: "unknown"; hasEnoughInputs: false; missingFields: string[] };
