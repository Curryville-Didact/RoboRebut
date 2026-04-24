/**
 * Deterministic parser for marker-based coach LLM output (no JSON).
 * Never throws — returns null when the text does not look like the contract.
 */

import type {
  AssistantStructuredReply,
  StructuredPatternIntel,
  StructuredRebuttal,
} from "../types/assistantStructuredReply.js";
import { sanitizeAssistantStructuredReply } from "./assistantStructuredNormalize.js";

/** Ordered marker names (values run until the next marker line). */
export const STRUCTURED_COACH_MARKERS = [
  "OBJECTION_TYPE",
  "TONE_USED",
  "PATTERN_STATUS",
  "WHY_THIS_RESPONSE",
  "HOW_IT_FITS",
  "COACH_INSIGHT",
  "REBUTTAL_1_TITLE",
  "REBUTTAL_1_SAY",
  "REBUTTAL_1_SUPPORT",
  "REBUTTAL_2_TITLE",
  "REBUTTAL_2_SAY",
  "REBUTTAL_2_SUPPORT",
  "COACH_NOTE",
  "FOLLOW_UP",
] as const;

export type StructuredCoachMarker = (typeof STRUCTURED_COACH_MARKERS)[number];

const KNOWN = new Set<string>(STRUCTURED_COACH_MARKERS);

/** Live fast path: primary rebuttal only (minimal generation). */
export const STRUCTURED_COACH_MARKERS_FAST = [
  "OBJECTION_TYPE",
  "TONE_USED",
  "REBUTTAL_1_TITLE",
  "REBUTTAL_1_SAY",
  "REBUTTAL_1_SUPPORT",
] as const;

const KNOWN_FAST = new Set<string>(STRUCTURED_COACH_MARKERS_FAST);

/** PRE-CALL primary pass: study prep + call-ready script (not used in LIVE). */
export const STRUCTURED_COACH_MARKERS_PRECALL_PREP = [
  "MERCHANT_MEANING",
  "PRESSURE_DIAGNOSIS",
  "REFRAME_STRATEGY",
  "CALL_READY_LINE",
] as const;

const KNOWN_PRECALL_PREP = new Set<string>(STRUCTURED_COACH_MARKERS_PRECALL_PREP);

/** PRE-CALL V10.2 standard (six markers; namespaced so continuation COACH_NOTE does not collide). */
export const STRUCTURED_COACH_MARKERS_PRECALL_V102_STANDARD = [
  "PRECALL_OBJECTION_TYPE",
  "WHAT_THEY_REALLY_MEAN",
  "LANE_1",
  "LANE_2",
  "PRECALL_COACH_NOTE",
  "PRECALL_FOLLOW_UP",
] as const;

const KNOWN_PRECALL_V102_STANDARD = new Set<string>(
  STRUCTURED_COACH_MARKERS_PRECALL_V102_STANDARD
);

/** PRE-CALL V10.2 deal-math / number path. */
export const STRUCTURED_COACH_MARKERS_PRECALL_V102_NUMBER = [
  "PRECALL_METRIC",
  "WHAT_THE_NUMBER_MEANS",
  "STRATEGIC_USE",
  "MERCHANT_FACING_LINE",
] as const;

const KNOWN_PRECALL_V102_NUMBER = new Set<string>(
  STRUCTURED_COACH_MARKERS_PRECALL_V102_NUMBER
);

/** PRE-CALL instant tier — three markers only (fast generation + parse). */
export const STRUCTURED_COACH_MARKERS_PRECALL_V102_INSTANT = [
  "PRECALL_OBJECTION_TYPE",
  "PRECALL_INSTANT_CORE",
  "PRECALL_INSTANT_CALL_READY",
] as const;

const KNOWN_PRECALL_V102_INSTANT = new Set<string>(
  STRUCTURED_COACH_MARKERS_PRECALL_V102_INSTANT
);

export type PrecallV102StandardSections = {
  objectionTypeLabel: string;
  whatTheyReallyMean: string;
  lane1: string;
  lane2: string;
  coachNote: string;
  followUp: string;
};

export type PrecallV102NumberSections = {
  metric: string;
  whatNumberMeans: string;
  strategicUse: string;
  merchantFacingLine: string;
};

/** Background enrichment: alternate + coaching blocks (follows fast path output). */
export const STRUCTURED_COACH_MARKERS_CONTINUATION = [
  "PATTERN_STATUS",
  "WHY_THIS_RESPONSE",
  "HOW_IT_FITS",
  "COACH_INSIGHT",
  "REBUTTAL_2_TITLE",
  "REBUTTAL_2_SAY",
  "REBUTTAL_2_SUPPORT",
  "COACH_NOTE",
  "FOLLOW_UP",
] as const;

const KNOWN_CONTINUATION = new Set<string>(
  STRUCTURED_COACH_MARKERS_CONTINUATION
);

export type ParsedStructuredCoachOutput = {
  objectionType?: string | null;
  toneUsed?: string | null;
  patternIntel?: {
    status?: string | null;
    whyThisResponse?: string | null;
    howItFits?: string | null;
    coachInsight?: string | null;
  } | null;
  rebuttals?: Array<{
    title: string;
    sayThis: string;
    support?: string | null;
  }>;
  coachNote?: string | null;
  followUp?: string | null;
};

function stripCommonWrappers(raw: string): string {
  let t = raw.replace(/\r\n/g, "\n").trim();
  if (t.startsWith("```")) {
    t = t
      .replace(/^```[a-zA-Z0-9_-]*\s*\n?/, "")
      .replace(/\n?```\s*$/u, "")
      .trim();
  }
  return t;
}

/** A line that is exactly `[UPPER_SNAKE]` for a known marker. */
const MARKER_LINE = /^\[([A-Z0-9_]+)\]\s*$/;

function splitIntoMarkerMapWithKnown(
  text: string,
  known: Set<string>,
  orderedNames: readonly string[]
): Map<string, string> {
  const lines = text.split("\n");
  let currentKey: string | null = null;
  const linesByKey = new Map<string, string[]>();

  for (const line of lines) {
    const m = line.match(MARKER_LINE);
    if (m) {
      const name = m[1] ?? "";
      if (!known.has(name)) {
        if (currentKey) {
          const arr = linesByKey.get(currentKey);
          if (arr) arr.push(line);
        }
        continue;
      }
      currentKey = name;
      if (!linesByKey.has(currentKey)) linesByKey.set(currentKey, []);
      continue;
    }
    if (currentKey) {
      const arr = linesByKey.get(currentKey);
      if (arr) arr.push(line);
    }
  }

  const out = new Map<string, string>();
  for (const name of orderedNames) {
    if (!linesByKey.has(name)) continue;
    const arr = linesByKey.get(name) ?? [];
    out.set(name, arr.join("\n").trim());
  }
  return out;
}

function splitIntoMarkerMap(text: string): Map<string, string> {
  return splitIntoMarkerMapWithKnown(text, KNOWN, STRUCTURED_COACH_MARKERS);
}

function emptyToNull(s: string | undefined): string | null {
  if (s == null) return null;
  const t = s.trim();
  return t.length === 0 ? null : t;
}

function buildRebuttals(map: Map<string, string>): StructuredRebuttal[] {
  const out: StructuredRebuttal[] = [];

  const pushPair = (
    titleKey: string,
    sayKey: string,
    supportKey: string,
    index: number
  ) => {
    const title = emptyToNull(map.get(titleKey) ?? "") ?? "";
    const sayThis = emptyToNull(map.get(sayKey) ?? "") ?? "";
    const support = emptyToNull(map.get(supportKey) ?? "");
    if (!title && !sayThis) return;
    out.push({
      title: title || `Rebuttal ${index}`,
      sayThis,
      support,
    });
  };

  pushPair(
    "REBUTTAL_1_TITLE",
    "REBUTTAL_1_SAY",
    "REBUTTAL_1_SUPPORT",
    1
  );
  pushPair(
    "REBUTTAL_2_TITLE",
    "REBUTTAL_2_SAY",
    "REBUTTAL_2_SUPPORT",
    2
  );

  return out;
}

function hasMinimalSignal(map: Map<string, string>): boolean {
  const g = (k: string) => map.get(k)?.trim() ?? "";
  if (g("OBJECTION_TYPE").length > 0) return true;
  if (g("REBUTTAL_1_SAY").length > 0) return true;
  if (g("REBUTTAL_2_SAY").length > 0) return true;
  if (g("COACH_NOTE").length > 0) return true;
  if (g("FOLLOW_UP").length > 0) return true;
  if (g("WHY_THIS_RESPONSE").length > 0 || g("HOW_IT_FITS").length > 0) return true;
  if (g("COACH_INSIGHT").length > 0) return true;
  return false;
}

/**
 * Strict validation for marker-based coach output: required markers exactly once,
 * correct order, no unknown marker tokens, no leading prose, minimal signal for parse.
 */
export function validateMarkerFormat(raw: string): boolean {
  const text = stripCommonWrappers(raw);
  const lines = text.split("\n");
  let seenFirstMarker = false;
  const seq: string[] = [];

  for (const line of lines) {
    const m = line.match(MARKER_LINE);
    if (m) {
      const name = m[1] ?? "";
      if (!KNOWN.has(name)) {
        return false;
      }
      seq.push(name);
      seenFirstMarker = true;
      continue;
    }
    if (!seenFirstMarker && line.trim() !== "") {
      return false;
    }
  }

  if (seq.length !== STRUCTURED_COACH_MARKERS.length) {
    return false;
  }
  for (let i = 0; i < seq.length; i++) {
    if (seq[i] !== STRUCTURED_COACH_MARKERS[i]) {
      return false;
    }
  }

  const map = splitIntoMarkerMap(text);
  return hasMinimalSignal(map);
}

function hasMinimalSignalFast(map: Map<string, string>): boolean {
  const g = (k: string) => map.get(k)?.trim() ?? "";
  return g("OBJECTION_TYPE").length > 0 || g("REBUTTAL_1_SAY").length > 0;
}

/**
 * Fast live path: exactly {@link STRUCTURED_COACH_MARKERS_FAST}, in order, primary rebuttal only.
 */
export function validateMarkerFormatFast(raw: string): boolean {
  const text = stripCommonWrappers(raw);
  const lines = text.split("\n");
  let seenFirstMarker = false;
  const seq: string[] = [];

  for (const line of lines) {
    const m = line.match(MARKER_LINE);
    if (m) {
      const name = m[1] ?? "";
      if (!KNOWN_FAST.has(name)) {
        return false;
      }
      seq.push(name);
      seenFirstMarker = true;
      continue;
    }
    if (!seenFirstMarker && line.trim() !== "") {
      return false;
    }
  }

  if (seq.length !== STRUCTURED_COACH_MARKERS_FAST.length) {
    return false;
  }
  for (let i = 0; i < seq.length; i++) {
    if (seq[i] !== STRUCTURED_COACH_MARKERS_FAST[i]) {
      return false;
    }
  }

  const map = splitIntoMarkerMapWithKnown(
    text,
    KNOWN_FAST,
    STRUCTURED_COACH_MARKERS_FAST
  );
  return hasMinimalSignalFast(map);
}

function hasMinimalSignalContinuation(map: Map<string, string>): boolean {
  const g = (k: string) => map.get(k)?.trim() ?? "";
  if (g("REBUTTAL_2_SAY").length > 0) return true;
  if (g("COACH_NOTE").length > 0 || g("FOLLOW_UP").length > 0) return true;
  if (
    g("PATTERN_STATUS").length > 0 ||
    g("WHY_THIS_RESPONSE").length > 0 ||
    g("HOW_IT_FITS").length > 0 ||
    g("COACH_INSIGHT").length > 0
  ) {
    return true;
  }
  return false;
}

/**
 * Background enrichment: continuation markers only, in order.
 */
export function validateMarkerFormatContinuation(raw: string): boolean {
  const text = stripCommonWrappers(raw);
  const lines = text.split("\n");
  let seenFirstMarker = false;
  const seq: string[] = [];

  for (const line of lines) {
    const m = line.match(MARKER_LINE);
    if (m) {
      const name = m[1] ?? "";
      if (!KNOWN_CONTINUATION.has(name)) {
        return false;
      }
      seq.push(name);
      seenFirstMarker = true;
      continue;
    }
    if (!seenFirstMarker && line.trim() !== "") {
      return false;
    }
  }

  if (seq.length !== STRUCTURED_COACH_MARKERS_CONTINUATION.length) {
    return false;
  }
  for (let i = 0; i < seq.length; i++) {
    if (seq[i] !== STRUCTURED_COACH_MARKERS_CONTINUATION[i]) {
      return false;
    }
  }

  const map = splitIntoMarkerMapWithKnown(
    text,
    KNOWN_CONTINUATION,
    STRUCTURED_COACH_MARKERS_CONTINUATION
  );
  return hasMinimalSignalContinuation(map);
}

/** Result of relaxed fast-path parsing (never throws). */
export type FastStructuredParseResult =
  | { parsed: true; structured: AssistantStructuredReply }
  | { parsed: false; primary: string };

function extractOpeningBody(text: string): string | null {
  const lines = text.split("\n");
  const idx = lines.findIndex((l) => l.trim().startsWith("[OPENING]"));
  if (idx < 0) return null;
  const openLine = lines[idx]?.trim() ?? "";
  const sameLine = openLine.match(/^\[OPENING\]\s*(.+)$/);
  if (sameLine?.[1]?.trim()) {
    return sameLine[1].trim();
  }
  const body: string[] = [];
  for (let i = idx + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (/^\[[A-Z0-9_]+\]\s*$/.test(line.trim())) {
      break;
    }
    body.push(line);
  }
  const content = body.join("\n").trim();
  return content.length > 0 ? content : null;
}

/**
 * Extract body for a single known marker block (line is `[MARKER]` or `[MARKER] tail`).
 * Stops at the next standalone `[ALLCAPS]` marker line.
 */
export function extractMarkerSectionBody(raw: string, marker: string): string | null {
  const text = stripCommonWrappers(raw);
  const safe = marker.replace(/[^A-Z0-9_]/g, "");
  if (safe.length === 0) return null;
  const lines = text.split("\n");
  const tag = `[${safe}]`;
  const idx = lines.findIndex((l) => {
    const t = l.trim();
    return t === tag || t.startsWith(`${tag} `);
  });
  if (idx < 0) return null;
  const openLine = lines[idx]?.trim() ?? "";
  const sameLine = openLine.match(new RegExp(`^\\[${safe}\\]\\s*(.+)$`));
  if (sameLine?.[1]?.trim()) {
    return sameLine[1].trim();
  }
  const body: string[] = [];
  for (let i = idx + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (/^\[[A-Z0-9_]+\]\s*$/.test(line.trim())) {
      break;
    }
    body.push(line);
  }
  const content = body.join("\n").trim();
  return content.length > 0 ? content : null;
}

/** PRECALL V10.1 — canonical four-section bodies for validation (markers required). */
export type PrecallPrimarySections = {
  meaning: string;
  pressure: string;
  reframe: string;
  callReady: string;
};

/**
 * Extract MERCHANT_MEANING, PRESSURE_DIAGNOSIS (or legacy HIERARCHY), REFRAME_STRATEGY, CALL_READY_LINE.
 * Returns null if any section body is missing after trim.
 */
export function extractPrecallPrimarySections(
  raw: string
): PrecallPrimarySections | null {
  const meaning =
    extractMarkerSectionBody(raw, "MERCHANT_MEANING")?.trim() ?? "";
  const pressure =
    extractMarkerSectionBody(raw, "PRESSURE_DIAGNOSIS")?.trim() ||
    extractMarkerSectionBody(raw, "PRESSURE_HIERARCHY")?.trim() ||
    "";
  const reframe =
    extractMarkerSectionBody(raw, "REFRAME_STRATEGY")?.trim() ?? "";
  const callReady =
    extractMarkerSectionBody(raw, "CALL_READY_LINE")?.trim() ?? "";
  if (!meaning || !pressure || !reframe || !callReady) return null;
  return { meaning, pressure, reframe, callReady };
}

export function extractPrecallV102StandardSections(
  raw: string
): PrecallV102StandardSections | null {
  const objectionTypeLabel =
    extractMarkerSectionBody(raw, "PRECALL_OBJECTION_TYPE")?.trim() ?? "";
  const whatTheyReallyMean =
    extractMarkerSectionBody(raw, "WHAT_THEY_REALLY_MEAN")?.trim() ?? "";
  const lane1 = extractMarkerSectionBody(raw, "LANE_1")?.trim() ?? "";
  const lane2 = extractMarkerSectionBody(raw, "LANE_2")?.trim() ?? "";
  const coachNote =
    extractMarkerSectionBody(raw, "PRECALL_COACH_NOTE")?.trim() ?? "";
  const followUp =
    extractMarkerSectionBody(raw, "PRECALL_FOLLOW_UP")?.trim() ?? "";
  if (
    !objectionTypeLabel ||
    !whatTheyReallyMean ||
    !lane1 ||
    !lane2 ||
    !coachNote ||
    !followUp
  ) {
    return null;
  }
  return {
    objectionTypeLabel,
    whatTheyReallyMean,
    lane1,
    lane2,
    coachNote,
    followUp,
  };
}

export function extractPrecallV102NumberSections(
  raw: string
): PrecallV102NumberSections | null {
  const metric =
    extractMarkerSectionBody(raw, "PRECALL_METRIC")?.trim() ?? "";
  const whatNumberMeans =
    extractMarkerSectionBody(raw, "WHAT_THE_NUMBER_MEANS")?.trim() ?? "";
  const strategicUse =
    extractMarkerSectionBody(raw, "STRATEGIC_USE")?.trim() ?? "";
  const merchantFacingLine =
    extractMarkerSectionBody(raw, "MERCHANT_FACING_LINE")?.trim() ?? "";
  if (!metric || !whatNumberMeans || !strategicUse || !merchantFacingLine) {
    return null;
  }
  return {
    metric,
    whatNumberMeans,
    strategicUse,
    merchantFacingLine,
  };
}

function hasMinimalPrecallV102Standard(map: Map<string, string>): boolean {
  for (const k of STRUCTURED_COACH_MARKERS_PRECALL_V102_STANDARD) {
    if (!(map.get(k)?.trim() ?? "")) return false;
  }
  return true;
}

function hasMinimalPrecallV102Number(map: Map<string, string>): boolean {
  for (const k of STRUCTURED_COACH_MARKERS_PRECALL_V102_NUMBER) {
    if (!(map.get(k)?.trim() ?? "")) return false;
  }
  return true;
}

function hasMinimalPrecallV102Instant(map: Map<string, string>): boolean {
  for (const k of STRUCTURED_COACH_MARKERS_PRECALL_V102_INSTANT) {
    if (!(map.get(k)?.trim() ?? "")) return false;
  }
  return true;
}

function pressureDiagnosisFromPrecallMap(
  map: Map<string, string>,
  text: string
): string {
  const d = map.get("PRESSURE_DIAGNOSIS")?.trim() ?? "";
  if (d.length > 0) return d;
  return extractMarkerSectionBody(text, "PRESSURE_HIERARCHY")?.trim() ?? "";
}

function hasMinimalSignalPrecallPrep(map: Map<string, string>, text: string): boolean {
  const g = (k: string) => map.get(k)?.trim() ?? "";
  const pd = pressureDiagnosisFromPrecallMap(map, text);
  return (
    g("MERCHANT_MEANING").length > 0 &&
    pd.length > 0 &&
    g("REFRAME_STRATEGY").length > 0 &&
    g("CALL_READY_LINE").length > 0
  );
}

/**
 * Relaxed fast-path parse: [OPENING] block, legacy 5-marker block, or unparsed primary text.
 * Never throws — on failure returns `{ parsed: false, primary }` with stripped raw output.
 */
export function parseFastStructuredCoachOutput(
  raw: string
): FastStructuredParseResult {
  const text = stripCommonWrappers(raw);

  if (
    text.includes("[PRECALL_INSTANT_CORE]") &&
    text.includes("[PRECALL_INSTANT_CALL_READY]") &&
    text.includes("[PRECALL_OBJECTION_TYPE]")
  ) {
    const map = splitIntoMarkerMapWithKnown(
      text,
      KNOWN_PRECALL_V102_INSTANT,
      STRUCTURED_COACH_MARKERS_PRECALL_V102_INSTANT
    );
    if (hasMinimalPrecallV102Instant(map)) {
      const g = (k: string) => emptyToNull(map.get(k) ?? "");
      const precallObjectionTypeLabel = g("PRECALL_OBJECTION_TYPE") ?? "";
      const precallWhatTheyReallyMean = g("PRECALL_INSTANT_CORE") ?? "";
      const callReady = g("PRECALL_INSTANT_CALL_READY") ?? "";
      const base: AssistantStructuredReply = {
        precallArtifact: "v102_instant",
        objectionType: null,
        toneUsed: null,
        patternIntel: null,
        precallObjectionTypeLabel,
        precallWhatTheyReallyMean,
        precallLane1: null,
        precallLane2: null,
        coachNote: null,
        followUp: null,
        callReadyLine: callReady || null,
        rebuttals: callReady
          ? [
              {
                title: "Call-ready line",
                sayThis: callReady,
                support: null,
              },
            ]
          : [],
      };
      return { parsed: true, structured: sanitizeAssistantStructuredReply(base) };
    }
  }

  if (
    text.includes("[PRECALL_METRIC]") &&
    text.includes("[MERCHANT_FACING_LINE]")
  ) {
    const map = splitIntoMarkerMapWithKnown(
      text,
      KNOWN_PRECALL_V102_NUMBER,
      STRUCTURED_COACH_MARKERS_PRECALL_V102_NUMBER
    );
    if (hasMinimalPrecallV102Number(map)) {
      const g = (k: string) => emptyToNull(map.get(k) ?? "");
      const precallMetric = g("PRECALL_METRIC") ?? "";
      const precallWhatNumberMeans = g("WHAT_THE_NUMBER_MEANS") ?? "";
      const precallStrategicUse = g("STRATEGIC_USE") ?? "";
      const precallMerchantFacingLine = g("MERCHANT_FACING_LINE") ?? "";
      const base: AssistantStructuredReply = {
        precallArtifact: "v102_number",
        objectionType: null,
        toneUsed: null,
        patternIntel: null,
        precallMetric,
        precallWhatNumberMeans,
        precallStrategicUse,
        precallMerchantFacingLine,
        rebuttals: [
          {
            title: "Merchant-facing line",
            sayThis: precallMerchantFacingLine,
            support: null,
          },
        ],
        coachNote: null,
        followUp: null,
      };
      return { parsed: true, structured: sanitizeAssistantStructuredReply(base) };
    }
  }

  if (
    text.includes("[PRECALL_OBJECTION_TYPE]") &&
    text.includes("[PRECALL_FOLLOW_UP]")
  ) {
    const map = splitIntoMarkerMapWithKnown(
      text,
      KNOWN_PRECALL_V102_STANDARD,
      STRUCTURED_COACH_MARKERS_PRECALL_V102_STANDARD
    );
    if (hasMinimalPrecallV102Standard(map)) {
      const g = (k: string) => emptyToNull(map.get(k) ?? "");
      const precallObjectionTypeLabel = g("PRECALL_OBJECTION_TYPE") ?? "";
      const precallWhatTheyReallyMean = g("WHAT_THEY_REALLY_MEAN") ?? "";
      const precallLane1 = g("LANE_1") ?? "";
      const precallLane2 = g("LANE_2") ?? "";
      const coachNote = g("PRECALL_COACH_NOTE") ?? "";
      const followUp = g("PRECALL_FOLLOW_UP") ?? "";
      const callReadyPrimary = (precallLane1 || precallLane2).trim();
      const base: AssistantStructuredReply = {
        precallArtifact: "v102_standard",
        objectionType: null,
        toneUsed: null,
        patternIntel: null,
        precallObjectionTypeLabel,
        precallWhatTheyReallyMean,
        precallLane1,
        precallLane2,
        coachNote,
        followUp,
        callReadyLine: callReadyPrimary || null,
        rebuttals: callReadyPrimary
          ? [
              {
                title: "Call-ready line",
                sayThis: callReadyPrimary,
                support: null,
              },
            ]
          : [],
      };
      return { parsed: true, structured: sanitizeAssistantStructuredReply(base) };
    }
  }

  if (
    text.includes("[MERCHANT_MEANING]") &&
    text.includes("[CALL_READY_LINE]") &&
    (text.includes("[PRESSURE_DIAGNOSIS]") ||
      text.includes("[PRESSURE_HIERARCHY]"))
  ) {
    const map = splitIntoMarkerMapWithKnown(
      text,
      KNOWN_PRECALL_PREP,
      STRUCTURED_COACH_MARKERS_PRECALL_PREP
    );
    if (hasMinimalSignalPrecallPrep(map, text)) {
      const g = (k: string) => emptyToNull(map.get(k) ?? "");
      const merchantMeaning = g("MERCHANT_MEANING") ?? "";
      const pressureDiagnosis = pressureDiagnosisFromPrecallMap(map, text);
      const reframeStrategy = g("REFRAME_STRATEGY") ?? "";
      const callReadyLine = g("CALL_READY_LINE") ?? "";
      const base: AssistantStructuredReply = {
        precallArtifact: "legacy",
        objectionType: null,
        toneUsed: null,
        patternIntel: null,
        merchantMeaning,
        pressureDiagnosis,
        reframeStrategy,
        callReadyLine,
        rebuttals: [
          {
            title: "Call-ready line",
            sayThis: callReadyLine,
            support: null,
          },
        ],
        coachNote: null,
        followUp: null,
      };
      return { parsed: true, structured: sanitizeAssistantStructuredReply(base) };
    }
  }

  if (text.includes("[OBJECTION_TYPE]") && text.includes("[TONE_USED]")) {
    const map = splitIntoMarkerMapWithKnown(
      text,
      KNOWN_FAST,
      STRUCTURED_COACH_MARKERS_FAST
    );
    if (map.has("OBJECTION_TYPE") && map.has("TONE_USED")) {
      if (hasMinimalSignalFast(map)) {
        const g = (k: string) => emptyToNull(map.get(k) ?? "");
        const title = g("REBUTTAL_1_TITLE") ?? "";
        const sayThis = g("REBUTTAL_1_SAY") ?? "";
        const support = g("REBUTTAL_1_SUPPORT");
        const rebuttals: StructuredRebuttal[] = [];
        if (title || sayThis) {
          rebuttals.push({
            title: title || "Rebuttal 1",
            sayThis,
            support,
          });
        }

        const base: AssistantStructuredReply = {
          objectionType: g("OBJECTION_TYPE"),
          toneUsed: g("TONE_USED"),
          patternIntel: null,
          rebuttals,
          coachNote: null,
          followUp: null,
        };

        return { parsed: true, structured: sanitizeAssistantStructuredReply(base) };
      }
    }
  }

  const openingBody = extractOpeningBody(text);
  if (openingBody != null) {
    return {
      parsed: true,
      structured: sanitizeAssistantStructuredReply({
        objectionType: null,
        toneUsed: null,
        patternIntel: null,
        rebuttals: [
          { title: "Opening", sayThis: openingBody, support: null },
        ],
        coachNote: null,
        followUp: null,
      }),
    };
  }

  return { parsed: false, primary: text };
}

/** @deprecated Prefer {@link parseFastStructuredCoachOutput} for full result. */
export function parseFastStructuredCoachOutputToAssistantReply(
  raw: string
): AssistantStructuredReply | null {
  const r = parseFastStructuredCoachOutput(raw);
  return r.parsed ? r.structured : null;
}

/** Parse continuation marker block for merge with fast-path reply. */
export function parseContinuationStructuredCoachOutput(
  raw: string
): Omit<AssistantStructuredReply, "objectionType" | "toneUsed"> | null {
  const text = stripCommonWrappers(raw);
  if (!text.includes("[PATTERN_STATUS]")) {
    return null;
  }
  const map = splitIntoMarkerMapWithKnown(
    text,
    KNOWN_CONTINUATION,
    STRUCTURED_COACH_MARKERS_CONTINUATION
  );
  if (!hasMinimalSignalContinuation(map)) {
    return null;
  }

  const g = (k: string) => emptyToNull(map.get(k) ?? "");
  const status = g("PATTERN_STATUS");
  const why = g("WHY_THIS_RESPONSE");
  const how = g("HOW_IT_FITS");
  const insight = g("COACH_INSIGHT");
  let patternIntel: StructuredPatternIntel | null = null;
  if (status || why || how || insight) {
    patternIntel = {
      status,
      whyThisResponse: why,
      howItFits: how,
      coachInsight: insight,
    };
  }

  const r2Title = g("REBUTTAL_2_TITLE") ?? "";
  const r2Say = g("REBUTTAL_2_SAY") ?? "";
  const r2Sup = g("REBUTTAL_2_SUPPORT");
  const extraRebuttals: StructuredRebuttal[] = [];
  if (r2Title || r2Say) {
    extraRebuttals.push({
      title: r2Title || "Rebuttal 2",
      sayThis: r2Say,
      support: r2Sup,
    });
  }

  return {
    patternIntel,
    rebuttals: extraRebuttals,
    coachNote: g("COACH_NOTE"),
    followUp: g("FOLLOW_UP"),
  };
}

/**
 * Merge fast-path + continuation into one persisted shape (same schema as full single-pass).
 */
export function mergeFastAndContinuationStructuredReply(
  fast: AssistantStructuredReply,
  cont: NonNullable<ReturnType<typeof parseContinuationStructuredCoachOutput>>
): AssistantStructuredReply {
  const r1 = fast.rebuttals ?? [];
  const r2 = cont.rebuttals ?? [];
  const rebuttals = [...r1, ...r2];

  let patternIntel = fast.patternIntel ?? null;
  const cp = cont.patternIntel;
  if (cp) {
    patternIntel = {
      status: cp.status ?? patternIntel?.status ?? null,
      whyThisResponse: cp.whyThisResponse ?? patternIntel?.whyThisResponse ?? null,
      howItFits: cp.howItFits ?? patternIntel?.howItFits ?? null,
      coachInsight: cp.coachInsight ?? patternIntel?.coachInsight ?? null,
    };
  }

  const coachNotePrimary = fast.coachNote?.trim();
  const followPrimary = fast.followUp?.trim();

  return sanitizeAssistantStructuredReply({
    ...fast,
    patternIntel,
    rebuttals,
    coachNote:
      coachNotePrimary && coachNotePrimary.length > 0
        ? fast.coachNote ?? null
        : cont.coachNote ?? fast.coachNote ?? null,
    followUp:
      followPrimary && followPrimary.length > 0
        ? fast.followUp ?? null
        : cont.followUp ?? fast.followUp ?? null,
  });
}

function parsedMapToAssistantReply(
  map: Map<string, string>
): AssistantStructuredReply {
  const g = (k: string) => emptyToNull(map.get(k) ?? "");

  const rebuttals = buildRebuttals(map);

  const status = g("PATTERN_STATUS");
  const why = g("WHY_THIS_RESPONSE");
  const how = g("HOW_IT_FITS");
  const insight = g("COACH_INSIGHT");
  let patternIntel: StructuredPatternIntel | null = null;
  if (status || why || how || insight) {
    patternIntel = {
      status,
      whyThisResponse: why,
      howItFits: how,
      coachInsight: insight,
    };
  }

  const base: AssistantStructuredReply = {
    objectionType: g("OBJECTION_TYPE"),
    toneUsed: g("TONE_USED"),
    patternIntel,
    rebuttals: rebuttals.length > 0 ? rebuttals : [],
    coachNote: g("COACH_NOTE"),
    followUp: g("FOLLOW_UP"),
  };

  return sanitizeAssistantStructuredReply(base);
}

/**
 * Same markers as {@link parseStructuredCoachOutput}, returns persisted JSON shape.
 */
export function parseStructuredCoachOutputToAssistantReply(
  raw: string
): AssistantStructuredReply | null {
  const text = stripCommonWrappers(raw);
  if (!text.includes("[OBJECTION_TYPE]") || !text.includes("[TONE_USED]")) {
    return null;
  }
  const map = splitIntoMarkerMap(text);
  if (!map.has("OBJECTION_TYPE") || !map.has("TONE_USED")) {
    return null;
  }
  if (!hasMinimalSignal(map)) {
    return null;
  }
  return parsedMapToAssistantReply(map);
}

/**
 * Parse raw LLM text into structured fields. Returns null if the output does not
 * follow the marker contract closely enough (caller uses legacy heuristics).
 */
export function parseStructuredCoachOutput(
  raw: string
): ParsedStructuredCoachOutput | null {
  const r = parseStructuredCoachOutputToAssistantReply(raw);
  if (r == null) return null;
  return {
    objectionType: r.objectionType ?? null,
    toneUsed: r.toneUsed ?? null,
    patternIntel: r.patternIntel ?? null,
    rebuttals: r.rebuttals,
    coachNote: r.coachNote ?? null,
    followUp: r.followUp ?? null,
  };
}
