/**
 * Conversation-level deal intelligence (JSONB `deal_context`).
 *
 * Discriminated by `dealType`:
 * - `merchant_services` — requires `dealType: "merchant_services"`.
 * - MCA / advances — `dealType?: "mca"` or omitted (legacy rows default to MCA path).
 *
 * Future: `term_loan` | other products — route via `resolveDealCalculation` when calculators exist.
 */

export type PaymentFrequency = "daily" | "weekly";

export type DealRiskLevel = "low" | "medium" | "high";

export type DealTypeMca = "mca";
export type DealTypeMerchantServices = "merchant_services";
export type DealTypeLineOfCredit = "business_line_of_credit";

/** LOC cadence includes monthly; MCA remains daily | weekly only. */
export type LineOfCreditPaymentFrequency = "daily" | "weekly" | "monthly";

/** MCA / lending-oriented context (existing product model). */
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

/** Merchant services (processing) — non-lending. */
export interface DealContextMerchantServices {
  dealType: DealTypeMerchantServices;
  monthlyCardVolume?: number;
  averageTicket?: number;
  /** Processing cost as % of monthly card volume (e.g. 2.75 means 2.75%). */
  effectiveRate?: number;
  proposedRate?: number;
  perTxnFee?: number;
  proposedPerTxnFee?: number;
  monthlyFees?: number;
  proposedMonthlyFees?: number;
  chargebackRate?: number;
  riskLevel?: DealRiskLevel;
  providerName?: string;
  /** Optional underwriting / positioning context (calculator may ignore). */
  contractTermMonths?: number;
  earlyTerminationFee?: number;
}

/** Business line of credit (drawn balance + simple interest-on-drawn model). */
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
  /** Optional user-estimated payment; calculators may ignore. */
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
