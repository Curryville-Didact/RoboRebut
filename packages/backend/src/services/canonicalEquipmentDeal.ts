/**
 * Canonical Equipment Leasing / Financing facts from saved deal_context.
 * Covers equipment leases and equipment loans.
 */

import { formatUsd } from "./canonicalMcaDeal.js";

export type DealTypeEquipment = "equipment_financing";

export interface DealContextEquipment {
  dealType: DealTypeEquipment;
  equipmentCost?: number;
  downPayment?: number;
  financedAmount?: number;
  monthlyPayment?: number;
  termMonths?: number;
  interestRate?: number;
  monthlyRevenue?: number;
  equipmentType?: string;
  lenderName?: string;
  leaseType?: "operating" | "capital" | "financing";
  residualValue?: number;
}

export interface CanonicalEquipmentFacts {
  equipmentCost: number | null;
  downPayment: number | null;
  financedAmount: number | null;
  monthlyPayment: number | null;
  termMonths: number | null;
  interestRate: number | null;
  monthlyRevenue: number | null;
  equipmentType: string | null;
  leaseType: string | null;
  estimatedTotalPayback: number | null;
  warnings: string[];
}

function isPositive(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

export function resolveCanonicalEquipmentFacts(
  ctx: DealContextEquipment | null | undefined
): CanonicalEquipmentFacts | null {
  if (ctx == null || typeof ctx !== "object") return null;
  if (ctx.dealType !== "equipment_financing") return null;

  const warnings: string[] = [];
  const equipmentCost = isPositive(ctx.equipmentCost)
    ? ctx.equipmentCost
    : null;
  const downPayment =
    ctx.downPayment != null &&
    Number.isFinite(ctx.downPayment) &&
    ctx.downPayment >= 0
      ? ctx.downPayment
      : null;
  const financedAmount = isPositive(ctx.financedAmount)
    ? ctx.financedAmount
    : null;
  const monthlyPayment = isPositive(ctx.monthlyPayment)
    ? ctx.monthlyPayment
    : null;
  const termMonths = isPositive(ctx.termMonths) ? ctx.termMonths : null;
  const monthlyRevenue = isPositive(ctx.monthlyRevenue)
    ? ctx.monthlyRevenue
    : null;

  if (equipmentCost == null && financedAmount == null && monthlyPayment == null)
    return null;

  const estimatedTotalPayback =
    monthlyPayment != null && termMonths != null
      ? monthlyPayment * termMonths
      : null;

  return {
    equipmentCost,
    downPayment,
    financedAmount,
    monthlyPayment,
    termMonths,
    interestRate:
      ctx.interestRate != null &&
      Number.isFinite(ctx.interestRate) &&
      ctx.interestRate >= 0
        ? ctx.interestRate
        : null,
    monthlyRevenue,
    equipmentType: ctx.equipmentType ?? null,
    leaseType: ctx.leaseType ?? null,
    estimatedTotalPayback,
    warnings,
  };
}

export function formatAuthoritativeEquipmentBlock(
  facts: CanonicalEquipmentFacts
): string {
  const lines: string[] = [];
  lines.push(
    "AUTHORITATIVE SAVED DEAL FACTS (Equipment Financing — use these numbers exactly; do not substitute or invent values.)"
  );
  if (facts.equipmentType)
    lines.push(`- Equipment type: ${facts.equipmentType}`);
  if (facts.leaseType) lines.push(`- Structure: ${facts.leaseType}`);
  if (facts.equipmentCost != null)
    lines.push(`- Equipment cost: $${formatUsd(facts.equipmentCost)}`);
  if (facts.downPayment != null)
    lines.push(`- Down payment: $${formatUsd(facts.downPayment)}`);
  if (facts.financedAmount != null)
    lines.push(`- Financed amount: $${formatUsd(facts.financedAmount)}`);
  if (facts.interestRate != null)
    lines.push(`- Interest/buy rate: ${facts.interestRate}%`);
  if (facts.termMonths != null)
    lines.push(`- Term: ${facts.termMonths} months`);
  if (facts.monthlyPayment != null)
    lines.push(`- Monthly payment: $${formatUsd(facts.monthlyPayment)}/month`);
  if (facts.estimatedTotalPayback != null)
    lines.push(
      `- Estimated total payments: $${formatUsd(facts.estimatedTotalPayback)}`
    );
  if (facts.monthlyRevenue != null)
    lines.push(
      `- Monthly revenue (context): $${formatUsd(facts.monthlyRevenue)}`
    );
  if (facts.warnings.length > 0) {
    lines.push("Reconciliation notes:");
    for (const w of facts.warnings) lines.push(`- ${w}`);
  }
  lines.push(
    "If a value is missing above, say it is not in the saved deal context — do not fabricate numbers."
  );
  return lines.join("\n");
}

export const AUTHORITATIVE_EQUIPMENT_GROUNDING = `EQUIPMENT FINANCING AUTHORITATIVE GROUNDING:
- This thread is equipment financing or leasing. Never use MCA terms.
- Use terms: equipment cost, financed amount, monthly payment, term, buy rate.
- The asset being financed is the collateral — this is key to overcoming objections.
- Cite only numbers from AUTHORITATIVE SAVED DEAL FACTS for this product.`;
