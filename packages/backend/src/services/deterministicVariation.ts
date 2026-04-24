/**
 * Phase 4.5 — Deterministic Variation Layer (DVL).
 * Selects among optional `rebuttals[0].variants` using a stable hash — no randomness.
 * Invoked only after pattern selection (caller responsibility).
 */

import type { AssistantStructuredReply } from "../types/assistantStructuredReply.js";

function trimUsable(s: unknown): string {
  if (s == null) return "";
  const t = String(s).trim();
  return /\S/.test(t) ? t : "";
}

export function getDeterministicVariantIndex(input: {
  conversationId: string;
  patternKey: string;
  callReadySignature?: string | null;
  repetitionCount?: number;
  variantCount: number;
}): number {
  const vc = Math.max(1, Math.floor(input.variantCount));
  const key = `${input.conversationId}|${input.patternKey}|${input.callReadySignature ?? "none"}|${input.repetitionCount ?? 0}`;
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) >>> 0;
  }
  return h % vc;
}

/** Extract parse-time variant pool when present (≥2 usable strings). */
/**
 * Count of prior assistant turns whose persisted pattern key equals the current selection.
 * Used so variant sequencing advances only when the same pattern repeats (Phase 4.5).
 */
export function patternRepeatCountForPatternKey(
  priorMessages: ReadonlyArray<{
    role: string;
    patternKey?: string | null;
  }>,
  currentPatternKey: string | null | undefined
): number {
  const pk =
    typeof currentPatternKey === "string" ? currentPatternKey.trim() : "";
  if (!pk) return 0;
  return priorMessages.filter(
    (m) => m.role === "ai" && m.patternKey === pk
  ).length;
}

export function extractPhase45VariantPool(
  sr: AssistantStructuredReply | null | undefined
): string[] | undefined {
  const raw = sr?.rebuttals?.[0]?.variants;
  if (!Array.isArray(raw) || raw.length < 2) return undefined;
  const usable = raw.map((x) => trimUsable(x)).filter(Boolean);
  if (usable.length < 2) return undefined;
  return usable;
}

export function applyDeterministicPhrasingVariationLayer(input: {
  structuredReply: AssistantStructuredReply;
  conversationId: string | null | undefined;
  patternKey: string | null | undefined;
  callReadySignature: string | null | undefined;
  /** Pattern-local repeat index (prior AI rows with same patternKey only). */
  patternRepeatCount: number;
  /** From LLM parse before downstream layers strip `variants` (e.g. live refinement). */
  variantStringsOverride?: string[] | null | undefined;
}): {
  structuredReply: AssistantStructuredReply;
  applied: boolean;
  variantIndex: number | null;
} {
  const sr = input.structuredReply;
  const reb = sr.rebuttals?.[0];
  if (!reb) {
    return { structuredReply: sr, applied: false, variantIndex: null };
  }

  let pool: string[] | undefined;
  if (input.variantStringsOverride != null) {
    const fromOverride = input.variantStringsOverride.map((x) => trimUsable(x)).filter(Boolean);
    pool = fromOverride.length >= 2 ? fromOverride : extractPhase45VariantPool(sr);
  } else {
    pool = extractPhase45VariantPool(sr);
  }

  if (!pool || pool.length < 2) {
    return { structuredReply: sr, applied: false, variantIndex: null };
  }

  const cid = String(input.conversationId ?? "").trim() || "unknown";
  const pk = String(input.patternKey ?? "").trim() || "unknown";
  const idx = getDeterministicVariantIndex({
    conversationId: cid,
    patternKey: pk,
    callReadySignature: input.callReadySignature ?? null,
    repetitionCount: input.patternRepeatCount,
    variantCount: pool.length,
  });
  const chosen = pool[idx] ?? pool[0]!;
  if (chosen === trimUsable(reb.sayThis)) {
    return { structuredReply: sr, applied: false, variantIndex: null };
  }

  const nextRebuttals = [...(sr.rebuttals ?? [])];
  nextRebuttals[0] = { ...reb, sayThis: chosen };
  return {
    structuredReply: { ...sr, rebuttals: nextRebuttals },
    applied: true,
    variantIndex: idx,
  };
}
