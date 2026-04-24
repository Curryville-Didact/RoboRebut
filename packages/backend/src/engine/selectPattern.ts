import type { RebuttalPattern } from "./patterns.js";

/**
 * Map canonical objection slug / human label to pattern-selection keys.
 */
function normalizeObjectionKey(raw: string): string {
  const s = raw.trim();
  if (!s) return "";
  const lower = s.toLowerCase();

  if (
    lower === "price_cost_framing" ||
    (lower.includes("price") && lower.includes("cost")) ||
    /price\s*\/\s*cost/i.test(s)
  ) {
    return "Price / Cost Framing";
  }
  if (
    lower.includes("trust") ||
    lower.includes("skeptic") ||
    lower === "trust_skepticism"
  ) {
    return "Trust / Skepticism";
  }
  if (
    lower.includes("brush") ||
    lower.includes("send me something") ||
    lower.includes("send_something")
  ) {
    return "Send Me Something / Brush-Off";
  }
  return s;
}

export function selectPatterns(objectionType: string): RebuttalPattern[] {
  const key = normalizeObjectionKey(objectionType);
  switch (key) {
    case "Price / Cost Framing":
      return ["REFRAME_VALUE", "OPPORTUNITY_COST"];

    case "Trust / Skepticism":
      return ["MINIMIZE_RISK", "CONTROL_CHOICE"];

    case "Send Me Something / Brush-Off":
      return ["STATUS_QUO_ATTACK", "FUTURE_PAIN"];

    default:
      return ["REFRAME_VALUE", "FUTURE_PAIN"];
  }
}
