/**
 * Phase 4.4 — tactical persuasion patterns for LIVE deterministic layer + precall mapping.
 * No model calls; deterministic selection only.
 */

import type {
  AssistantStructuredReply,
  PersuasionPattern,
} from "../types/assistantStructuredReply.js";

export type { PersuasionPattern };

export interface PatternSelectionResult {
  primaryPattern: PersuasionPattern;
  candidatePatterns?: PersuasionPattern[];
}

export type PatternedVariant = {
  lines: string[];
  primaryPattern: PersuasionPattern;
};

export type PatternContext = {
  lastPatternUsed?: PersuasionPattern | null;
  /**
   * When `lastPatternUsed` is absent, anti-repeat uses `getInitialPatternSeed(patternSeedInput)` as the
   * effective prior (same filter rules as a real prior). Does not persist — only `lastPatternUsed` is stored.
   */
  patternSeedInput?: string | null;
};

export type PatternSelectionMeta = {
  candidateVariantCount: number;
  effectivePoolCount: number;
  antiRepeatFilterApplied: boolean;
  selectedPattern: PersuasionPattern;
  lastPatternUsed: PersuasionPattern | null;
};

const PATTERN_SET = new Set<PersuasionPattern>([
  "REFRAME",
  "CONDITION",
  "CONSEQUENCE",
  "CONTROL",
]);

export function isPersuasionPattern(v: string): v is PersuasionPattern {
  return PATTERN_SET.has(v as PersuasionPattern);
}

/** Short helper for variant tables. */
export function pv(
  lines: string[],
  primaryPattern: PersuasionPattern
): PatternedVariant {
  return { lines, primaryPattern };
}

/**
 * Default tactical "prior" for anti-repeat when no assistant turn exists yet.
 * Keys are objection/subtype labels (case-insensitive). Unknown keys fall back to REFRAME.
 */
export function getInitialPatternSeed(input: string): PersuasionPattern {
  const k = input.trim().toUpperCase();
  if (k === "PRICE") return "CONSEQUENCE";
  if (k === "TRUST") return "CONDITION";
  if (k === "TIME_DELAY") return "CONTROL";
  if (k === "GENERAL" || k === "GENERAL_UNMATCHED") return "REFRAME";
  return "REFRAME";
}

/** Deterministic pattern cycle for LIVE variation sequencing. */
export function nextPatternInSequence(p: PersuasionPattern): PersuasionPattern {
  switch (p) {
    case "REFRAME":
      return "CONDITION";
    case "CONDITION":
      return "CONSEQUENCE";
    case "CONSEQUENCE":
      return "CONTROL";
    case "CONTROL":
      return "REFRAME";
    default: {
      const _exhaustive: never = p;
      return _exhaustive;
    }
  }
}

/**
 * Deterministic index: hash(userMessage + subtype) % count.
 * Same objection text + subtype + pool length → same index.
 */
export function liveGeneralVariationIndex(
  userMessage: string,
  subtype: string,
  variationCount: number
): number {
  if (variationCount <= 1) return 0;
  const key = `${userMessage.trim()}\0${subtype}`;
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % variationCount;
}

export function choosePatternedVariant(
  userMessage: string,
  subtype: string,
  variants: PatternedVariant[],
  ctx: PatternContext
): { variant: PatternedVariant; meta: PatternSelectionMeta } {
  const candidateVariantCount = variants.length;
  const rawLast = ctx.lastPatternUsed ?? null;
  const seedInput = ctx.patternSeedInput?.trim();
  const effectiveLast =
    rawLast ??
    (seedInput ? getInitialPatternSeed(seedInput) : null);
  // If we have a real prior pattern, try to advance the pattern deterministically
  // (REFRAME → CONDITION → CONSEQUENCE → CONTROL → REFRAME), while still respecting
  // the anti-repeat safeguard and existing fallbacks.
  const preferredNext =
    rawLast != null ? nextPatternInSequence(rawLast) : null;
  const preferredPool =
    preferredNext != null
      ? variants.filter((v) => v.primaryPattern === preferredNext)
      : [];

  const antiRepeatPool =
    effectiveLast != null
      ? variants.filter((v) => v.primaryPattern !== effectiveLast)
      : variants;

  const pool =
    rawLast != null && preferredPool.length > 0
      ? preferredPool
      : antiRepeatPool;

  const effectivePool = pool.length > 0 ? pool : variants;
  const index = liveGeneralVariationIndex(
    userMessage,
    subtype,
    effectivePool.length
  );
  const variant = effectivePool[index]!;
  const antiRepeatFilterApplied =
    effectiveLast != null && effectivePool.length > 0 && effectivePool.length < variants.length;
  return {
    variant,
    meta: {
      candidateVariantCount,
      effectivePoolCount: effectivePool.length,
      antiRepeatFilterApplied,
      selectedPattern: variant.primaryPattern,
      lastPatternUsed: rawLast,
    },
  };
}

/**
 * Scan prior thread messages (newest assistant first by walking from end).
 * Uses structured primaryPersuasionPattern only — no text regex.
 */
export function getLastAssistantPatternFromConversation(
  priorMessages: ReadonlyArray<{
    role: string;
    structuredReply?: unknown;
  }>
): PersuasionPattern | null {
  for (let i = priorMessages.length - 1; i >= 0; i--) {
    const m = priorMessages[i]!;
    if (m.role !== "ai" && m.role !== "assistant") continue;
    const raw = m.structuredReply;
    if (!raw || typeof raw !== "object") continue;
    const sr = raw as Record<string, unknown>;
    const p = sr.primaryPersuasionPattern;
    if (typeof p === "string" && isPersuasionPattern(p)) return p;
  }
  return null;
}

/** Map precall lane pattern keys (REFRAME_VALUE, …) to tactical PersuasionPattern. */
export function mapPrecallLaneKeyToTactical(
  laneKey: string | null | undefined
): PersuasionPattern | null {
  if (!laneKey?.trim()) return null;
  const k = laneKey.trim().toUpperCase();
  if (k.includes("REFRAME")) return "REFRAME";
  if (k.includes("OPPORTUNITY") || k.includes("FUTURE") || k.includes("STATUS_QUO"))
    return "CONSEQUENCE";
  if (k.includes("CONTROL")) return "CONTROL";
  if (k.includes("MINIMIZE") || k.includes("RISK")) return "CONDITION";
  return "CONTROL";
}

export function attachPrecallPrimaryTacticalPattern(
  sr: AssistantStructuredReply
): AssistantStructuredReply {
  if (sr.precallArtifact !== "v102_standard") return sr;
  const lane = sr.precallPrimaryPersuasionPattern?.trim();
  const tactical = mapPrecallLaneKeyToTactical(lane);
  if (!tactical) return sr;
  return { ...sr, primaryPersuasionPattern: tactical };
}
