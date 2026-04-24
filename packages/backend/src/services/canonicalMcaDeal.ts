/**
 * Canonical MCA facts derived from saved deal_context (single source of truth for coach prompts).
 * Reconciles advanceAmount × factorRate ↔ paybackAmount and surfaces inconsistencies.
 */

import type { DealContextMca, PaymentFrequency } from "../types/dealContext.js";

const REL_EPS = 0.005; // 0.5% relative tolerance for money reconciliation
const ABS_EPS = 1; // $1 absolute floor

function isPositive(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

export type CanonicalMcaFacts = {
  advanceAmount: number | null;
  factorRate: number | null;
  /** Resolved total repayment (authoritative for coaching). */
  paybackAmount: number;
  termDays: number | null;
  monthlyRevenue: number | null;
  paymentFrequency: PaymentFrequency | null;
  dailyPayment: number | null;
  weeklyPayment: number | null;
  reconciledFrom: "advance_x_factor" | "payback_div_advance" | "payback_only";
  warnings: string[];
};

function roughlyEqual(a: number, b: number): boolean {
  const tol = Math.max(ABS_EPS, REL_EPS * Math.max(Math.abs(a), Math.abs(b)));
  return Math.abs(a - b) <= tol;
}

/**
 * Returns null if deal_context cannot be interpreted as MCA or lacks minimum payback resolution.
 */
export function resolveCanonicalMcaFacts(
  ctx: DealContextMca | null | undefined
): CanonicalMcaFacts | null {
  if (ctx == null || typeof ctx !== "object") return null;

  const warnings: string[] = [];
  const advance = isPositive(ctx.advanceAmount) ? ctx.advanceAmount : null;
  const factorRaw = isPositive(ctx.factorRate) ? ctx.factorRate : null;
  const paybackDirect = isPositive(ctx.paybackAmount) ? ctx.paybackAmount : null;
  const termDays = isPositive(ctx.termDays) ? ctx.termDays : null;
  const monthlyRevenue = isPositive(ctx.monthlyRevenue) ? ctx.monthlyRevenue : null;
  const paymentFrequency: PaymentFrequency | null =
    ctx.paymentFrequency === "daily" || ctx.paymentFrequency === "weekly"
      ? ctx.paymentFrequency
      : null;

  let paybackAmount: number;
  let factorRate: number | null = factorRaw;
  let reconciledFrom: CanonicalMcaFacts["reconciledFrom"];

  const derivedFromAdvanceFactor =
    advance != null && factorRaw != null ? advance * factorRaw : null;

  /** Prefer advance × factor when both exist (matches lendingDealCalculator authority). */
  if (derivedFromAdvanceFactor != null) {
    if (paybackDirect != null && !roughlyEqual(paybackDirect, derivedFromAdvanceFactor)) {
      warnings.push(
        "Stored paybackAmount disagrees with advanceAmount × factorRate; using advance × factor as authoritative payback."
      );
    }
    paybackAmount = derivedFromAdvanceFactor;
    reconciledFrom = "advance_x_factor";
  } else if (paybackDirect != null && advance != null && factorRaw == null) {
    paybackAmount = paybackDirect;
    factorRate = paybackDirect / advance;
    reconciledFrom = "payback_div_advance";
  } else if (paybackDirect != null) {
    paybackAmount = paybackDirect;
    reconciledFrom = "payback_only";
  } else {
    return null;
  }

  let dailyPayment: number | null = null;
  let weeklyPayment: number | null = null;
  if (termDays != null) {
    dailyPayment = paybackAmount / termDays;
    weeklyPayment = paybackAmount / (termDays / 7);
  }

  return {
    advanceAmount: advance,
    factorRate,
    paybackAmount,
    termDays,
    monthlyRevenue,
    paymentFrequency,
    dailyPayment,
    weeklyPayment,
    reconciledFrom,
    warnings,
  };
}

export function formatUsd(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded)
    ? rounded.toLocaleString("en-US")
    : rounded.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
}

export function formatAuthoritativeMcaBlock(facts: CanonicalMcaFacts): string {
  const lines: string[] = [];
  lines.push(
    "AUTHORITATIVE SAVED DEAL FACTS (MCA — use these numbers exactly; do not substitute, invent, or round to different dollar amounts):"
  );
  if (facts.advanceAmount != null) {
    lines.push(`- Advance (funded amount): $${formatUsd(facts.advanceAmount)}`);
  }
  if (facts.factorRate != null) {
    lines.push(`- Factor (total payback ÷ advance): ${facts.factorRate}`);
  }
  lines.push(`- Total payback (amount to repay): $${formatUsd(facts.paybackAmount)}`);
  if (facts.termDays != null) {
    lines.push(`- Term in calendar days: ${facts.termDays}`);
  }
  if (facts.dailyPayment != null) {
    lines.push(
      `- Modeled equal daily payment (total payback ÷ term days): $${formatUsd(facts.dailyPayment)}/day`
    );
  }
  if (facts.weeklyPayment != null) {
    lines.push(
      `- Modeled equal weekly payment (total payback ÷ (term days / 7)): $${formatUsd(facts.weeklyPayment)}/week`
    );
  }
  if (facts.monthlyRevenue != null) {
    lines.push(`- Monthly revenue (for burden context): $${formatUsd(facts.monthlyRevenue)}`);
  }
  if (facts.paymentFrequency != null) {
    lines.push(`- Stated payment frequency (merchant-facing): ${facts.paymentFrequency}`);
  }
  if (facts.warnings.length > 0) {
    lines.push("Reconciliation notes:");
    for (const w of facts.warnings) lines.push(`- ${w}`);
  }
  lines.push(
    "If a value is missing above, say it is not in the saved deal context — do not fabricate numbers."
  );
  return lines.join("\n");
}
