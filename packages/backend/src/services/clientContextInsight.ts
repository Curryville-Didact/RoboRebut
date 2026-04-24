import type { ClientContext } from "../types/clientContext.js";

/**
 * Deterministic, grounded block for system prompts — only operator-entered strings.
 * Returns empty string when nothing meaningful is present.
 */
export function buildClientContextInsight(
  raw: ClientContext | null | undefined
): string {
  if (!raw || typeof raw !== "object") return "";

  const lines: string[] = [];
  const push = (label: string, v: unknown) => {
    if (v === undefined || v === null) return;
    if (typeof v === "boolean") {
      lines.push(`${label}: ${v ? "yes" : "no"}`);
      return;
    }
    const s = String(v).replace(/\s+/g, " ").trim();
    if (s.length > 0) lines.push(`${label}: ${s}`);
  };

  push("Business", raw.businessName);
  push("Industry", raw.industry);
  push("Current provider", raw.currentProvider);
  push("Monthly revenue (as stated)", raw.monthlyRevenueText);
  push("Pain points", raw.painPoints);
  push("Decision-maker", raw.decisionMaker);
  push("Partner involved", raw.partnerInvolved);
  push("Urgency / timeline", raw.urgencyTimeline);
  push("Trust / skepticism flags", raw.trustFlags);
  push("Stated objections (known)", raw.statedObjections);
  push("Notes", raw.notes);

  if (lines.length === 0) return "";

  return `[CLIENT CONTEXT — facts below were entered by the operator for this conversation only. Use them to improve specificity and realism. Do not invent additional biographical or financial facts. Do not override structured deal math, canonical deal blocks, or objection classification rules.]\n${lines.join("\n")}`;
}

/**
 * Instant pre-call: minimal token footprint — key facts only, single line when possible.
 */
export function buildClientContextInsightCompressed(
  raw: ClientContext | null | undefined
): string {
  if (!raw || typeof raw !== "object") return "";

  const parts: string[] = [];
  const push = (label: string, v: unknown) => {
    if (v === undefined || v === null) return;
    const s =
      typeof v === "boolean"
        ? v
          ? "yes"
          : "no"
        : String(v).replace(/\s+/g, " ").trim();
    if (s.length === 0) return;
    const short = s.length > 90 ? `${s.slice(0, 87)}…` : s;
    parts.push(`${label}: ${short}`);
  };

  push("Biz", raw.businessName);
  push("Industry", raw.industry);
  push("Rev", raw.monthlyRevenueText);
  push("Pain", raw.painPoints);
  push("DM", raw.decisionMaker);
  push("Trust", raw.trustFlags);
  push("Said-no-to", raw.statedObjections);

  if (parts.length === 0) return "";

  return `[CLIENT CONTEXT — instant; operator facts only]\n${parts.join(" | ")}`;
}
