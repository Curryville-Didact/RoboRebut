import type { AssistantStructuredReply } from "../types/assistantStructuredReply.js";
import type { CoachReplyMode } from "../types/coachReplyMode.js";
import type { PreCallDepth } from "../types/preCallDepth.js";

function normalizeLiveDisplayText(text: string): string {
  return text
    .replace(/[\r\n]+/g, " ")
    .replace(
      /But that's not the real decision\s+what matters is/gi,
      "But that's not the real decision — what matters is"
    )
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Split primary script into up to 3 speakable lines for live UI / storage. */
export function splitLiveOpeningLines(primary: string): string[] {
  const t = primary.trim();
  if (!t) return [];
  const byNl = t
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (byNl.length >= 2) return byNl.slice(0, 3);
  const byDash = t
    .split(/\s*[—–]\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (byDash.length >= 3) return byDash.slice(0, 3);
  if (byDash.length === 2) return byDash;
  const bySentence = t
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (bySentence.length >= 3) return bySentence.slice(0, 3);
  return [t];
}

/** Strip coach / training fields; keep only live script shape for persistence + UI. */
export function toLivePersistedStructured(
  primaryText: string,
  patternCarry?: Pick<
    AssistantStructuredReply,
    "primaryPersuasionPattern" | "lastPatternUsed"
  > | null
): AssistantStructuredReply {
  // LIVE canonical: one clean spoken script (no newline-fragment rendering).
  // Keep the payload stable by storing a single normalized string; UI should treat it as one block.
  const sayThis = normalizeLiveDisplayText(primaryText.trim());
  return {
    coachReplyMode: "live",
    liveOpeningLines: undefined,
    rebuttals: [{ title: "Opening", sayThis: sayThis || primaryText.trim() }],
    toneUsed: null,
    patternIntel: null,
    coachNote: null,
    followUp: null,
    objectionType: null,
    primaryObjectionType: null,
    objectionTags: undefined,
    topObjectionTags: undefined,
    objectionTagReasons: undefined,
    primaryPersuasionPattern: patternCarry?.primaryPersuasionPattern ?? null,
    lastPatternUsed: patternCarry?.lastPatternUsed ?? null,
  };
}

export function tagPrecallStructured(
  sr: AssistantStructuredReply,
  precallDepth?: PreCallDepth
): AssistantStructuredReply {
  return {
    ...sr,
    coachReplyMode: "precall",
    ...(precallDepth != null ? { precallDepth } : {}),
  };
}

export type ModeApplySuccessInput = {
  mode: CoachReplyMode;
  text: string;
  structuredReply: AssistantStructuredReply;
  /** Pre-call only: instant vs deep (drives UI + optional prompt tier). */
  precallDepth?: PreCallDepth;
  patternInsights?: unknown;
  explanation?: string | null;
  deferredEnrichment?: unknown;
};

export function applyCoachReplyModeToSuccessPayload(
  input: ModeApplySuccessInput
): {
  text: string;
  structuredReply: AssistantStructuredReply;
  patternInsights?: unknown;
  explanation?: string | null;
  deferredEnrichment?: unknown;
} {
  if (input.mode === "precall") {
    return {
      text: input.text,
      structuredReply: tagPrecallStructured(
        input.structuredReply,
        input.precallDepth
      ),
      patternInsights: input.patternInsights,
      explanation: input.explanation,
      deferredEnrichment: input.deferredEnrichment,
    };
  }
  const sr = toLivePersistedStructured(input.text, {
    primaryPersuasionPattern: input.structuredReply.primaryPersuasionPattern,
    lastPatternUsed: input.structuredReply.lastPatternUsed,
  });
  const outText = (sr.rebuttals?.[0]?.sayThis ?? input.text).trim();
  return {
    text: outText || input.text.trim(),
    structuredReply: sr,
    patternInsights: undefined,
    explanation: undefined,
    deferredEnrichment: undefined,
  };
}
