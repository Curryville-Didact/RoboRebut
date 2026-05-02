/**
 * Vertical Router — single source of truth for product vertical detection.
 * Given a raw deal_context object, returns the vertical name, authoritative
 * facts block, and grounding instructions for the coach prompt.
 *
 * Supported verticals:
 *   mca | business_line_of_credit | merchant_services |
 *   sba_loan | term_loan | equipment_financing | invoice_factoring
 */

import {
  isMcaContext,
  isLineOfCreditContext,
  isMerchantServicesContext,
} from "../types/dealContext.js";
import {
  resolveCanonicalMcaFacts,
  formatAuthoritativeMcaBlock,
} from "./canonicalMcaDeal.js";
import {
  resolveCanonicalLocFacts,
  formatAuthoritativeLocBlock,
  AUTHORITATIVE_LOC_GROUNDING,
} from "./canonicalLocDeal.js";
import {
  resolveCanonicalSbaFacts,
  formatAuthoritativeSbaBlock,
  AUTHORITATIVE_SBA_GROUNDING,
  type DealContextSba,
} from "./canonicalSbaDeal.js";
import {
  resolveCanonicalTermLoanFacts,
  formatAuthoritativeTermLoanBlock,
  AUTHORITATIVE_TERM_LOAN_GROUNDING,
  type DealContextTermLoan,
} from "./canonicalTermLoanDeal.js";
import {
  resolveCanonicalEquipmentFacts,
  formatAuthoritativeEquipmentBlock,
  AUTHORITATIVE_EQUIPMENT_GROUNDING,
  type DealContextEquipment,
} from "./canonicalEquipmentDeal.js";
import {
  resolveCanonicalFactoringFacts,
  formatAuthoritativeFactoringBlock,
  AUTHORITATIVE_FACTORING_GROUNDING,
  type DealContextFactoring,
} from "./canonicalFactoringDeal.js";

export type SupportedVertical =
  | "mca"
  | "business_line_of_credit"
  | "merchant_services"
  | "sba_loan"
  | "term_loan"
  | "equipment_financing"
  | "invoice_factoring"
  | "general";

export interface VerticalResolution {
  vertical: SupportedVertical;
  /** Authoritative facts block to inject into coach prompt. Null if no deal context saved. */
  factsBlock: string | null;
  /** Grounding instructions telling the AI which product language to use. */
  grounding: string | null;
  /** Human-readable label for UI display. */
  label: string;
}

const VERTICAL_LABELS: Record<SupportedVertical, string> = {
  mca: "Merchant Cash Advance",
  business_line_of_credit: "Business Line of Credit",
  merchant_services: "Merchant Services",
  sba_loan: "SBA Loan",
  term_loan: "Term Loan",
  equipment_financing: "Equipment Financing",
  invoice_factoring: "Invoice Factoring",
  general: "General",
};

const MCA_GROUNDING = `MCA AUTHORITATIVE GROUNDING:
- This thread is a Merchant Cash Advance. Use terms: advance, factor rate, payback amount, daily/weekly payment.
- Never use loan terminology (interest rate, APR, monthly payment) unless specifically asked.
- Cite only numbers from AUTHORITATIVE SAVED DEAL FACTS for this product.`;

const MERCHANT_SERVICES_GROUNDING = `MERCHANT SERVICES AUTHORITATIVE GROUNDING:
- This thread is merchant services / payment processing. Never use lending terms.
- Use terms: processing rate, effective rate, per-transaction fee, monthly volume, chargeback rate.
- The value proposition is savings on processing costs vs the current processor.
- Cite only numbers from AUTHORITATIVE SAVED DEAL FACTS for this product.`;

/**
 * Detect vertical from dealType discriminant first, then fall back to
 * existing type guard functions for legacy/untagged contexts.
 */
function detectVertical(dealContext: unknown): SupportedVertical {
  if (!dealContext || typeof dealContext !== "object") return "general";
  const dc = dealContext as Record<string, unknown>;
  const dt = dc.dealType;

  if (dt === "sba_loan") return "sba_loan";
  if (dt === "term_loan") return "term_loan";
  if (dt === "equipment_financing") return "equipment_financing";
  if (dt === "invoice_factoring") return "invoice_factoring";
  if (dt === "merchant_services") return "merchant_services";
  if (dt === "business_line_of_credit") return "business_line_of_credit";
  if (dt === "mca") return "mca";

  // Legacy fallback — use existing type guards
  if (isMerchantServicesContext(dealContext)) return "merchant_services";
  if (isLineOfCreditContext(dealContext)) return "business_line_of_credit";
  if (isMcaContext(dealContext)) return "mca";

  return "general";
}

/**
 * Main entry point. Pass the raw deal_context value from the conversation.
 * Returns vertical, facts block for prompt injection, and grounding rules.
 */
export function resolveVertical(dealContext: unknown): VerticalResolution {
  const vertical = detectVertical(dealContext);

  switch (vertical) {
    case "mca": {
      const facts = resolveCanonicalMcaFacts(dealContext as any);
      return {
        vertical,
        label: VERTICAL_LABELS.mca,
        factsBlock: facts ? formatAuthoritativeMcaBlock(facts) : null,
        grounding: MCA_GROUNDING,
      };
    }
    case "business_line_of_credit": {
      const facts = resolveCanonicalLocFacts(dealContext as any);
      return {
        vertical,
        label: VERTICAL_LABELS.business_line_of_credit,
        factsBlock: facts ? formatAuthoritativeLocBlock(facts) : null,
        grounding: AUTHORITATIVE_LOC_GROUNDING,
      };
    }
    case "merchant_services": {
      return {
        vertical,
        label: VERTICAL_LABELS.merchant_services,
        factsBlock: null, // merchant services uses existing dealInsightBuilder
        grounding: MERCHANT_SERVICES_GROUNDING,
      };
    }
    case "sba_loan": {
      const facts = resolveCanonicalSbaFacts(dealContext as DealContextSba);
      return {
        vertical,
        label: VERTICAL_LABELS.sba_loan,
        factsBlock: facts ? formatAuthoritativeSbaBlock(facts) : null,
        grounding: AUTHORITATIVE_SBA_GROUNDING,
      };
    }
    case "term_loan": {
      const facts = resolveCanonicalTermLoanFacts(
        dealContext as DealContextTermLoan
      );
      return {
        vertical,
        label: VERTICAL_LABELS.term_loan,
        factsBlock: facts ? formatAuthoritativeTermLoanBlock(facts) : null,
        grounding: AUTHORITATIVE_TERM_LOAN_GROUNDING,
      };
    }
    case "equipment_financing": {
      const facts = resolveCanonicalEquipmentFacts(
        dealContext as DealContextEquipment
      );
      return {
        vertical,
        label: VERTICAL_LABELS.equipment_financing,
        factsBlock: facts ? formatAuthoritativeEquipmentBlock(facts) : null,
        grounding: AUTHORITATIVE_EQUIPMENT_GROUNDING,
      };
    }
    case "invoice_factoring": {
      const facts = resolveCanonicalFactoringFacts(
        dealContext as DealContextFactoring
      );
      return {
        vertical,
        label: VERTICAL_LABELS.invoice_factoring,
        factsBlock: facts ? formatAuthoritativeFactoringBlock(facts) : null,
        grounding: AUTHORITATIVE_FACTORING_GROUNDING,
      };
    }
    default:
      return {
        vertical: "general",
        label: VERTICAL_LABELS.general,
        factsBlock: null,
        grounding: null,
      };
  }
}

/**
 * Quick vertical label lookup — use for UI display and cache keys.
 */
export function getVerticalLabel(dealContext: unknown): string {
  return VERTICAL_LABELS[detectVertical(dealContext)];
}

/**
 * Returns true if this vertical has a canonical facts implementation.
 */
export function verticalHasCanonicalFacts(vertical: SupportedVertical): boolean {
  return vertical !== "general" && vertical !== "merchant_services";
}
