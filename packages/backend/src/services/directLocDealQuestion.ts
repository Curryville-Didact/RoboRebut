/**
 * Direct factual answers for Business LOC from saved deal_context (no MCA framing).
 */

import type { CanonicalLocFacts } from "./canonicalLocDeal.js";
import { formatUsd } from "./canonicalMcaDeal.js";
import { isDirectMcaDealQuestion } from "./directMcaDealQuestion.js";

const PAYBACK_RE =
  /\b(?:what(?:'s|s| is|’s)\s+my\s+payback|whats\s+my\s+payback|what(?:'s|s| is|’s)\s+(?:the\s+)?(?:total\s+)?payback|how\s+much\s+do\s+i\s+pay\s+back|total\s+payback|payback\s+amount|what(?:'s|s| is|’s)\s+my\s+obligation|how\s+much\s+is\s+owed\s+back)\b/i;

const FACTOR_RE =
  /\b(?:what(?:'s|s| is|’s)\s+my\s+factor|what(?:'s|s| is|’s)\s+(?:the\s+)?factor|factor\s+rate|what(?:'s|s| is|’s)\s+the\s+multiplier)\b/i;

const DAILY_RE =
  /\b(?:what(?:'s|s| is|’s)\s+my\s+daily|daily\s+payment|what(?:'s|s| is|’s)\s+(?:the\s+)?(?:per[-\s]?day|daily)\s+(?:payment|pull|debit))\b/i;

const WEEKLY_RE =
  /\b(?:what(?:'s|s| is|’s)\s+my\s+weekly|weekly\s+payment)\b/i;

const MONTHLY_PAY_RE =
  /\b(?:what(?:'s|s| is|’s)\s+my\s+monthly|monthly\s+payment)\b/i;

const PAYMENT_RE =
  /\b(?:what(?:'s|s| is|’s)\s+(?:the\s+)?payment|how\s+much\s+is\s+(?:each\s+)?payment|what(?:'s|s| is|’s)\s+my\s+payment)\b/i;

const TERM_RE =
  /\b(?:how\s+long\s+is\s+(?:the\s+)?(?:payoff|term|repayment)|what(?:'s|s| is|’s)\s+(?:the\s+)?term|how\s+many\s+days\s+(?:is|for)\s+(?:the\s+)?(?:payoff|term))\b/i;

const INTEREST_RE =
  /\b(?:what(?:'s|s| is|’s)\s+my\s+interest|interest\s+rate|what(?:'s|s| is|’s)\s+the\s+(?:interest\s+)?rate|what(?:'s|s| is|’s)\s+the\s+apr)\b/i;

const TOTAL_COST_RE =
  /\b(?:total\s+cost|what(?:'s|s| is|’s)\s+(?:the\s+)?total\s+cost|how\s+much\s+will\s+it\s+cost\s+total)\b/i;

function normalizeQ(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

/** Same intent patterns as MCA factual questions — answers differ for LOC. */
export function isDirectLocDealQuestion(text: string): boolean {
  const t = normalizeQ(text).toLowerCase();
  if (t.length < 6) return false;
  return (
    isDirectMcaDealQuestion(text) ||
    INTEREST_RE.test(t) ||
    TOTAL_COST_RE.test(t) ||
    MONTHLY_PAY_RE.test(t)
  );
}

const COACH_TAIL =
  "Want a one-liner you can use with the merchant on these numbers?";

/**
 * Display / persistence slug for thread header when answering direct LOC financial questions.
 * Maps to user-facing labels in the frontend (see objectionDisplay.ts).
 */
export function locDirectObjectionCategorySlug(userMessage: string): string {
  const t = normalizeQ(userMessage).toLowerCase();
  if (
    FACTOR_RE.test(t) ||
    INTEREST_RE.test(t) ||
    PAYBACK_RE.test(t) ||
    TOTAL_COST_RE.test(t)
  ) {
    return "pricing_repayment_clarity";
  }
  if (
    PAYMENT_RE.test(t) ||
    MONTHLY_PAY_RE.test(t) ||
    DAILY_RE.test(t) ||
    WEEKLY_RE.test(t)
  ) {
    return "loc_payment_clarity";
  }
  if (TERM_RE.test(t)) {
    return "deal_clarity";
  }
  return "deal_clarity";
}

export function tryAnswerDirectLocQuestion(
  userMessage: string,
  facts: CanonicalLocFacts
): string | null {
  const t = normalizeQ(userMessage).toLowerCase();

  if (FACTOR_RE.test(t)) {
    if (facts.interestRatePercent != null) {
      return `A line of credit doesn’t use an MCA-style factor. Based on your saved LOC inputs, the interest rate on the drawn balance is **${facts.interestRatePercent}%**. ${COACH_TAIL}`;
    }
    return `LOCs don’t use a “factor” like an MCA — use the **interest rate on draws** from your saved deal context${facts.interestRatePercent != null ? ` (${facts.interestRatePercent}%)` : ""}. ${facts.interestRatePercent == null ? "Interest rate isn’t saved yet." : ""} ${COACH_TAIL}`;
  }

  if (INTEREST_RE.test(t)) {
    if (facts.interestRatePercent == null) {
      return `Interest rate isn’t in your saved deal context. ${COACH_TAIL}`;
    }
    return `Based on your saved LOC inputs, the interest rate on the drawn balance is **${facts.interestRatePercent}%**. ${COACH_TAIL}`;
  }

  if (PAYBACK_RE.test(t) || TOTAL_COST_RE.test(t)) {
    if (facts.estimatedTotalPayback != null) {
      const label = TOTAL_COST_RE.test(t)
        ? "Estimated total cost"
        : "Estimated total repayment";
      return `**${label}** (based on your saved LOC inputs — drawn balance + interest on the draw, not MCA factor payback): **$${formatUsd(facts.estimatedTotalPayback)}**. ${COACH_TAIL}`;
    }
    return `I can’t estimate a total yet from your saved context — add **drawn balance** and **interest rate** at minimum. ${COACH_TAIL}`;
  }

  if (PAYMENT_RE.test(t) || MONTHLY_PAY_RE.test(t)) {
    if (facts.estimatedPaymentOverride != null) {
      return `Based on your saved LOC inputs, your **estimated payment** is **$${formatUsd(facts.estimatedPaymentOverride)}** (as you entered). ${COACH_TAIL}`;
    }
    if (facts.monthlyPayment != null && facts.paymentFrequency === "monthly") {
      const total =
        facts.estimatedTotalPayback != null
          ? ` **Estimated total repayment:** $${formatUsd(facts.estimatedTotalPayback)}.`
          : "";
      return `Based on your saved LOC inputs, **estimated payment** is **$${formatUsd(facts.monthlyPayment)}/month**.${total} ${COACH_TAIL}`;
    }
    if (facts.monthlyPayment != null) {
      return `Based on your saved LOC inputs, **estimated payment** (monthly equivalent) is **$${formatUsd(facts.monthlyPayment)}/month**. ${COACH_TAIL}`;
    }
    if (facts.dailyPayment != null && facts.paymentFrequency === "daily") {
      return `Based on your saved LOC inputs, **estimated payment** is **$${formatUsd(facts.dailyPayment)}/day**. ${COACH_TAIL}`;
    }
    if (facts.weeklyPayment != null && facts.paymentFrequency === "weekly") {
      return `Based on your saved LOC inputs, **estimated payment** is **$${formatUsd(facts.weeklyPayment)}/week**. ${COACH_TAIL}`;
    }
    if (facts.dailyPayment != null) {
      return `Based on your saved LOC inputs, **estimated payment** is **$${formatUsd(facts.dailyPayment)}/day**. ${COACH_TAIL}`;
    }
    if (facts.weeklyPayment != null) {
      return `Based on your saved LOC inputs, **estimated payment** is **$${formatUsd(facts.weeklyPayment)}/week**. ${COACH_TAIL}`;
    }
    return `Payment isn’t fully derivable yet — check **payment frequency**, **term**, and **drawn balance** in your saved context. ${COACH_TAIL}`;
  }

  if (DAILY_RE.test(t)) {
    if (facts.dailyPayment == null) {
      return `Daily **estimated payment** isn’t available yet — add **term** and schedule fields to your saved context. ${COACH_TAIL}`;
    }
    return `Based on your saved LOC inputs, **estimated payment** is **$${formatUsd(facts.dailyPayment)}/day**. ${COACH_TAIL}`;
  }

  if (WEEKLY_RE.test(t)) {
    if (facts.weeklyPayment == null) {
      return `Weekly **estimated payment** isn’t available from your saved context yet. ${COACH_TAIL}`;
    }
    return `Based on your saved LOC inputs, **estimated payment** is **$${formatUsd(facts.weeklyPayment)}/week**. ${COACH_TAIL}`;
  }

  if (TERM_RE.test(t)) {
    if (facts.paymentFrequency === "monthly" && facts.termMonths != null) {
      return `Based on your saved LOC inputs, the term for monthly payments is **${facts.termMonths} months**. ${COACH_TAIL}`;
    }
    if (facts.termDays != null) {
      return `Based on your saved LOC inputs, the term is **${facts.termDays} calendar days** (daily/weekly schedule). ${COACH_TAIL}`;
    }
    return `Term isn’t in your saved context yet (days for daily/weekly, or months for monthly). ${COACH_TAIL}`;
  }

  return null;
}
