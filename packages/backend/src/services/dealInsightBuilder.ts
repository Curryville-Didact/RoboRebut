/**
 * Phase 4.2 — Deal-aware, LLM-safe summary (no raw calculator dumps).
 * Never throws: failures → { hasInsight: false }.
 */

import type {
  DealContext,
  DealContextLineOfCredit,
  DealContextMca,
} from "../types/dealContext.js";
import {
  formatUsd as formatUsdCanon,
  resolveCanonicalMcaFacts,
} from "./canonicalMcaDeal.js";
import { resolveCanonicalLocFacts } from "./canonicalLocDeal.js";
import { resolveDealCalculation } from "./resolveDealCalculator.js";
import { resolveVertical } from "./verticalRouter.js";

export type DealInsightFlags = {
  highBurden?: boolean;
  strongSavings?: boolean;
  missingInputs?: boolean;
};

export type DealInsight = {
  hasInsight: boolean;
  summary?: string;
  flags?: DealInsightFlags;
};

function formatUsd(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(2);
}

function partialSummary(missing: string[]): string {
  const list = missing.length > 0 ? missing.join(", ") : "additional fields";
  return `Partial deal data detected. Missing inputs: ${list}`;
}

export function buildDealInsight(ctx: DealContext | null): DealInsight {
  const verticalResolution = resolveVertical(ctx);
  void verticalResolution;

  if (ctx == null) {
    return { hasInsight: false };
  }

  try {
    const result = resolveDealCalculation(ctx);

    if (result.dealType === "unknown") {
      return {
        hasInsight: true,
        summary: partialSummary(result.missingFields),
        flags: { missingInputs: true },
      };
    }

    if (result.dealType === "mca") {
      const r = result.result;
      if (!r.hasEnoughInputs) {
        return {
          hasInsight: true,
          summary: partialSummary(r.missingFields),
          flags: { missingInputs: true },
        };
      }

      const burden = r.repaymentBurden;
      const holdPct = r.holdPercentage;
      const ratio =
        burden ??
        (holdPct != null && Number.isFinite(holdPct) ? holdPct / 100 : undefined);

      if (ratio == null || !Number.isFinite(ratio)) {
        const daily =
          r.dailyPayment != null && Number.isFinite(r.dailyPayment)
            ? formatUsd(r.dailyPayment)
            : null;
        return {
          hasInsight: true,
          summary: daily
            ? `MCA repayment schedule implies about $${daily}/day; monthly revenue is needed to quantify cash-flow burden vs hold.`
            : `MCA deal context is present but repayment burden cannot be summarized from current inputs.`,
          flags: { missingInputs: true },
        };
      }

      const displayPct =
        holdPct != null && Number.isFinite(holdPct)
          ? holdPct.toFixed(1)
          : (ratio * 100).toFixed(1);

      let summary: string;
      let highBurden = false;
      if (ratio >= 0.25) {
        highBurden = true;
        summary = `This deal carries a high repayment burden (~${displayPct}% hold), which may strain cash flow.`;
      } else if (ratio >= 0.15) {
        summary = `This deal sits in a moderate repayment range (~${displayPct}% hold), worth validating against cash flow stability.`;
      } else {
        summary = `This deal appears relatively manageable (~${displayPct}% hold).`;
      }

      const canon = resolveCanonicalMcaFacts(ctx as DealContextMca);
      if (canon != null) {
        const parts: string[] = [`total payback $${formatUsdCanon(canon.paybackAmount)}`];
        if (canon.advanceAmount != null) {
          parts.push(`advance $${formatUsdCanon(canon.advanceAmount)}`);
        }
        if (canon.factorRate != null) {
          parts.push(`factor ${canon.factorRate}`);
        }
        if (canon.dailyPayment != null) {
          parts.push(`modeled daily ~$${formatUsdCanon(canon.dailyPayment)}`);
        }
        summary = `${summary} Saved numbers for this thread: ${parts.join("; ")}.`;
      }

      return {
        hasInsight: true,
        summary,
        flags: { highBurden },
      };
    }

    if (result.dealType === "merchant_services") {
      const r = result.result;
      if (!r.hasEnoughInputs) {
        return {
          hasInsight: true,
          summary: partialSummary(r.missingFields),
          flags: { missingInputs: true },
        };
      }

      const parts: string[] = [];

      if (
        r.monthlyDelta != null &&
        Number.isFinite(r.monthlyDelta) &&
        r.monthlyDelta !== 0
      ) {
        const d = r.monthlyDelta;
        if (d > 0) {
          parts.push(
            `Proposed structure reduces monthly cost by ~$${formatUsd(d)}.`
          );
        } else {
          parts.push(
            `Proposed structure increases monthly cost by ~$${formatUsd(Math.abs(d))}.`
          );
        }
      }

      if (r.effectiveRateDelta != null && Number.isFinite(r.effectiveRateDelta)) {
        const rd = r.effectiveRateDelta;
        if (rd > 0) {
          parts.push(`Rate improvement of ~${rd.toFixed(2)}%.`);
        } else if (rd < 0) {
          parts.push(
            `Proposed effective rate is ~${Math.abs(rd).toFixed(2)}% higher than current.`
          );
        }
      }

      if (parts.length === 0) {
        return {
          hasInsight: true,
          summary:
            "Merchant services pricing context is present; use the rep's stated rates and fees in this thread to coach on positioning.",
          flags: {},
        };
      }

      const strongSavings =
        r.monthlyDelta != null &&
        Number.isFinite(r.monthlyDelta) &&
        r.monthlyDelta > 0;

      return {
        hasInsight: true,
        summary: parts.join(" "),
        flags: { strongSavings },
      };
    }

    if (result.dealType === "business_line_of_credit") {
      const r = result.result;
      if (!r.hasEnoughInputs) {
        return {
          hasInsight: true,
          summary: partialSummary(r.missingFields),
          flags: { missingInputs: true },
        };
      }

      const ratio =
        r.monthlyBurdenRatio != null && Number.isFinite(r.monthlyBurdenRatio)
          ? r.monthlyBurdenRatio
          : r.holdPercentage != null && Number.isFinite(r.holdPercentage)
            ? r.holdPercentage / 100
            : null;

      const paySnippet =
        r.dailyPayment != null && Number.isFinite(r.dailyPayment)
          ? `about $${formatUsd(r.dailyPayment)}/day`
          : r.weeklyPayment != null && Number.isFinite(r.weeklyPayment)
            ? `about $${formatUsd(r.weeklyPayment)}/week`
            : r.monthlyPayment != null && Number.isFinite(r.monthlyPayment)
              ? `about $${formatUsd(r.monthlyPayment)}/month`
              : null;

      let paymentInsight: string | undefined;
      if (paySnippet) {
        paymentInsight = `Modeled payment pace is ${paySnippet}.`;
      }

      let burdenInsight: string | undefined;
      if (ratio != null) {
        const displayPct = (ratio * 100).toFixed(1);
        burdenInsight = `Against stated monthly revenue, burden is roughly ${displayPct}% on a monthly-equivalent basis.`;
      } else {
        burdenInsight = `Monthly revenue wasn’t available to quantify burden.`;
      }

      let paybackInsight: string | undefined;
      if (
        r.estimatedTotalPayback != null &&
        Number.isFinite(r.estimatedTotalPayback)
      ) {
        paybackInsight = `Illustrative total obligation (simple model) ~$${formatUsd(r.estimatedTotalPayback)}.`;
      }

      const structureInsight =
        "A business line of credit is not a fixed MCA advance, but draws still create real repayment pressure.";

      let decisionInsight: string | undefined;
      if (ratio != null) {
        decisionInsight =
          "Coach whether cash flow can support it comfortably.";
      } else {
        decisionInsight =
          "Keep the conversation on cash-flow fit and whether the obligation fits their runway.";
      }

      const orderedInsights: string[] = [];
      if (paymentInsight) orderedInsights.push(paymentInsight);
      if (burdenInsight) orderedInsights.push(burdenInsight);
      if (paybackInsight) orderedInsights.push(paybackInsight);
      if (structureInsight) orderedInsights.push(structureInsight);
      if (decisionInsight) orderedInsights.push(decisionInsight);

      const highBurden = ratio != null && ratio >= 0.25;

      let summary = orderedInsights.join(" ").trim();
      const canonLoc = resolveCanonicalLocFacts(ctx as DealContextLineOfCredit);
      if (canonLoc != null) {
        const parts: string[] = [];
        if (canonLoc.estimatedTotalPayback != null) {
          parts.push(
            `illustrative total $${formatUsdCanon(canonLoc.estimatedTotalPayback)} (LOC)`
          );
        }
        if (canonLoc.drawnAmount != null) {
          parts.push(`drawn $${formatUsdCanon(canonLoc.drawnAmount)}`);
        }
        if (canonLoc.interestRatePercent != null) {
          parts.push(`interest ${canonLoc.interestRatePercent}%`);
        }
        if (parts.length > 0) {
          summary = `${summary} Saved LOC numbers: ${parts.join("; ")}.`;
        }
      }

      return {
        hasInsight: true,
        summary,
        flags: { highBurden },
      };
    }
  } catch {
    return { hasInsight: false };
  }

  return { hasInsight: false };
}
