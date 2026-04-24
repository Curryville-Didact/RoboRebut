/**
 * Parse user-friendly deal-context field input into canonical numbers.
 */

function stripAndEmpty(raw: string): string {
  return raw.trim();
}

/** Money: strips $, commas, spaces; returns finite number or undefined. */
export function normalizeMoneyInput(raw: string): number | undefined {
  const t = stripAndEmpty(raw).replace(/[$,\s]/g, "");
  if (!t) return undefined;
  const n = Number.parseFloat(t);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Percentage-style (e.g. "2.75%", "2.75"); stores as 2.75 for coach/calculator.
 */
export function normalizePercentInput(raw: string): number | undefined {
  const t = stripAndEmpty(raw).replace(/[%\s]/g, "");
  if (!t) return undefined;
  const n = Number.parseFloat(t);
  return Number.isFinite(n) ? n : undefined;
}

/** MCA factor rate (e.g. 1.28); preserves decimal precision from literal. */
export function normalizeFactorRateInput(raw: string): number | undefined {
  const t = stripAndEmpty(raw).replace(/[,\s]/g, "");
  if (!t) return undefined;
  const n = Number.parseFloat(t);
  return Number.isFinite(n) ? n : undefined;
}

/** Term counts (days, months): integer only. */
export function normalizeIntegerInput(raw: string): number | undefined {
  const t = stripAndEmpty(raw).replace(/[,\s]/g, "");
  if (!t) return undefined;
  const n = Number.parseInt(t, 10);
  return Number.isFinite(n) ? n : undefined;
}

export function formatNumberForInput(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "";
  return String(value);
}
