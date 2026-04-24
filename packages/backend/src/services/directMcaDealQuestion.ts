/**
 * Detects factual MCA questions answerable from saved deal_context only (no invented examples).
 */

import type { CanonicalMcaFacts } from "./canonicalMcaDeal.js";
import { formatUsd } from "./canonicalMcaDeal.js";

const PAYBACK_RE =
  /\b(?:what(?:'s|s| is|’s)\s+my\s+payback|whats\s+my\s+payback|what(?:'s|s| is|’s)\s+(?:the\s+)?(?:total\s+)?payback|how\s+much\s+do\s+i\s+pay\s+back|total\s+payback|payback\s+amount|what(?:'s|s| is|’s)\s+my\s+obligation|how\s+much\s+is\s+owed\s+back)\b/i;

const FACTOR_RE =
  /\b(?:what(?:'s|s| is|’s)\s+my\s+factor|what(?:'s|s| is|’s)\s+(?:the\s+)?factor|factor\s+rate|what(?:'s|s| is|’s)\s+the\s+multiplier)\b/i;

const DAILY_RE =
  /\b(?:what(?:'s|s| is|’s)\s+my\s+daily|daily\s+payment|what(?:'s|s| is|’s)\s+(?:the\s+)?(?:per[-\s]?day|daily)\s+(?:payment|pull|debit))\b/i;

const WEEKLY_RE =
  /\b(?:what(?:'s|s| is|’s)\s+my\s+weekly|weekly\s+payment)\b/i;

const PAYMENT_RE =
  /\b(?:what(?:'s|s| is|’s)\s+(?:the\s+)?payment|how\s+much\s+is\s+(?:each\s+)?payment|what(?:'s|s| is|’s)\s+my\s+payment)\b/i;

const TERM_RE =
  /\b(?:how\s+long\s+is\s+(?:the\s+)?(?:payoff|term|repayment)|what(?:'s|s| is|’s)\s+(?:the\s+)?term|how\s+many\s+days\s+(?:is|for)\s+(?:the\s+)?(?:payoff|term))\b/i;

function normalizeQ(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

/**
 * Whether the user is asking for a factual metric from saved deal context (MCA).
 */
export function isDirectMcaDealQuestion(text: string): boolean {
  const t = normalizeQ(text).toLowerCase();
  if (t.length < 6) return false;
  return (
    PAYBACK_RE.test(t) ||
    FACTOR_RE.test(t) ||
    DAILY_RE.test(t) ||
    WEEKLY_RE.test(t) ||
    PAYMENT_RE.test(t) ||
    TERM_RE.test(t)
  );
}

const COACH_TAIL =
  "Want a one-liner you can use with the merchant on these numbers?";

/**
 * Deterministic answer from canonical facts only. Returns null if the question cannot be answered safely.
 */
export function tryAnswerDirectMcaQuestion(
  userMessage: string,
  facts: CanonicalMcaFacts
): string | null {
  const t = normalizeQ(userMessage).toLowerCase();

  if (PAYBACK_RE.test(t)) {
    return `Your total payback on this saved deal is **$${formatUsd(facts.paybackAmount)}** (derived from the advance and factor in your deal context). ${COACH_TAIL}`;
  }

  if (FACTOR_RE.test(t)) {
    if (facts.factorRate == null) {
      return `The saved deal context doesn’t include enough to state a factor (need advance and payback, or advance and factor). ${COACH_TAIL}`;
    }
    return `Your factor on this saved deal is **${facts.factorRate}** (total payback ÷ advance). ${COACH_TAIL}`;
  }

  if (DAILY_RE.test(t)) {
    if (facts.dailyPayment == null) {
      return `The saved deal context doesn’t include a term in days, so I can’t derive a modeled daily payment. Total payback is **$${formatUsd(facts.paybackAmount)}**. ${COACH_TAIL}`;
    }
    return `Modeled equal daily payment (total payback ÷ term days) is **$${formatUsd(facts.dailyPayment)}/day** on this saved deal. ${COACH_TAIL}`;
  }

  if (WEEKLY_RE.test(t)) {
    if (facts.weeklyPayment == null) {
      return `The saved deal context doesn’t include a term in days, so I can’t derive a modeled weekly payment. Total payback is **$${formatUsd(facts.paybackAmount)}**. ${COACH_TAIL}`;
    }
    return `Modeled equal weekly payment is **$${formatUsd(facts.weeklyPayment)}/week** on this saved deal. ${COACH_TAIL}`;
  }

  if (PAYMENT_RE.test(t)) {
    if (facts.dailyPayment != null && facts.paymentFrequency === "daily") {
      return `On this saved deal (daily frequency), modeled payment is **$${formatUsd(facts.dailyPayment)}/day**; total payback is **$${formatUsd(facts.paybackAmount)}**. ${COACH_TAIL}`;
    }
    if (facts.weeklyPayment != null && facts.paymentFrequency === "weekly") {
      return `On this saved deal (weekly frequency), modeled payment is **$${formatUsd(facts.weeklyPayment)}/week**; total payback is **$${formatUsd(facts.paybackAmount)}**. ${COACH_TAIL}`;
    }
    if (facts.dailyPayment != null) {
      return `Modeled daily payment is **$${formatUsd(facts.dailyPayment)}/day**; total payback **$${formatUsd(facts.paybackAmount)}**. ${COACH_TAIL}`;
    }
    if (facts.weeklyPayment != null) {
      return `Modeled weekly payment is **$${formatUsd(facts.weeklyPayment)}/week**; total payback **$${formatUsd(facts.paybackAmount)}**. ${COACH_TAIL}`;
    }
    return `Total payback on this saved deal is **$${formatUsd(facts.paybackAmount)}**. Add term days in deal context to derive a modeled per-period payment. ${COACH_TAIL}`;
  }

  if (TERM_RE.test(t)) {
    if (facts.termDays == null) {
      return `The saved deal context doesn’t include a repayment term in days. ${COACH_TAIL}`;
    }
    return `The saved term is **${facts.termDays} calendar days**. Total payback is **$${formatUsd(facts.paybackAmount)}**. ${COACH_TAIL}`;
  }

  return null;
}
