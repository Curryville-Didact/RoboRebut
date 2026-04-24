/**
 * Dispatcher: select MCA vs merchant services (vs unsupported) calculator by deal_context.
 *
 * Does not call AI. Safe for future deal types: unknown `dealType` → explicit insufficient result.
 */

import type { DealContext } from "../types/dealContext.js";
import {
  isLineOfCreditContext,
  isMerchantServicesContext,
  isMcaContext,
} from "../types/dealContext.js";
import type { DealCalculationResult } from "../types/dealCalculation.js";
import type { MerchantServicesCalculationResult } from "../types/merchantServicesCalculation.js";
import { computeDealMetrics } from "./lendingDealCalculator.js";
import {
  computeLineOfCreditMetrics,
  type LineOfCreditCalculationResult,
} from "./lineOfCreditCalculator.js";
import { computeMerchantServicesMetrics } from "./merchantServicesCalculator.js";

export type ResolvedDealCalculation =
  | { dealType: "mca"; result: DealCalculationResult }
  | {
      dealType: "merchant_services";
      result: MerchantServicesCalculationResult;
    }
  | {
      dealType: "business_line_of_credit";
      result: LineOfCreditCalculationResult;
    }
  | {
      dealType: "unknown";
      hasEnoughInputs: false;
      missingFields: string[];
    };

/**
 * Routes:
 * - `dealType === "merchant_services"` → merchant services calculator.
 * - `dealType === "mca"` or omitted → MCA / lending calculator (legacy JSON).
 * - `dealType === "business_line_of_credit"` → LOC calculator.
 * - Any other `dealType` → unknown (e.g. future products not yet implemented).
 */
export function resolveDealCalculation(
  dealContext: DealContext | null | undefined
): ResolvedDealCalculation {
  if (dealContext == null) {
    return {
      dealType: "unknown",
      hasEnoughInputs: false,
      missingFields: ["deal_context"],
    };
  }

  if (isMerchantServicesContext(dealContext)) {
    return {
      dealType: "merchant_services",
      result: computeMerchantServicesMetrics(dealContext),
    };
  }

  if (isMcaContext(dealContext)) {
    return { dealType: "mca", result: computeDealMetrics(dealContext) };
  }

  if (isLineOfCreditContext(dealContext)) {
    const result = computeLineOfCreditMetrics(dealContext);
    console.log("LOC RESULT:", result);
    return {
      dealType: "business_line_of_credit",
      result,
    };
  }

  const dt = (dealContext as Record<string, unknown>).dealType;
  const label =
    typeof dt === "string" ? `unsupported dealType: ${dt}` : "unsupported dealType";

  return {
    dealType: "unknown",
    hasEnoughInputs: false,
    missingFields: [label],
  };
}
