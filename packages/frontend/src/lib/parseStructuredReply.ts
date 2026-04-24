import type {
  AssistantStructuredReply,
  LiveActionSignal,
  LiveConfidenceLevel,
  LiveDeliveryRisk,
  LiveResponseVisibility,
  ObjectionTagWithScore,
  PersuasionPattern,
  PrecallArtifactKind,
} from "@/types/assistantStructuredReply";
import {
  parseCoachReplyMode,
  type CoachReplyMode,
} from "@/types/coachReplyMode";
import type { PreCallDepth } from "@/types/preCallDepth";

function isRecord(x: unknown): x is Record<string, unknown> {
  return x != null && typeof x === "object" && !Array.isArray(x);
}

/** Read JSON string fields; preserve `null`; omit bad / missing keys. */
function readOptionalString(
  r: Record<string, unknown>,
  key: string
): string | null | undefined {
  if (!(key in r)) return undefined;
  const v = r[key];
  if (v === null) return null;
  if (typeof v === "string") return v;
  return undefined;
}

function isPersuasionPattern(x: string): x is PersuasionPattern {
  return (
    x === "REFRAME" ||
    x === "CONDITION" ||
    x === "CONSEQUENCE" ||
    x === "CONTROL"
  );
}

function readPersuasionPattern(
  r: Record<string, unknown>,
  key: string
): PersuasionPattern | null | undefined {
  if (!(key in r)) return undefined;
  const v = r[key];
  if (v === null) return null;
  if (typeof v === "string" && isPersuasionPattern(v)) return v;
  return undefined;
}

function readLiveResponseVisibility(
  raw: unknown
): LiveResponseVisibility | null | undefined {
  if (raw === null) return null;
  if (!isRecord(raw)) return undefined;
  const intent = typeof raw.intent === "string" ? raw.intent : null;
  const objectionType =
    typeof raw.objectionType === "string" ? raw.objectionType : null;
  const visibilityReason =
    typeof raw.visibilityReason === "string" ? raw.visibilityReason : null;
  const situationLabel =
    typeof raw.situationLabel === "string" ? raw.situationLabel : null;
  if (!intent || !objectionType || !visibilityReason || !situationLabel) {
    return undefined;
  }
  const liveGeneralSubtype = readOptionalString(raw, "liveGeneralSubtype");
  const subtypeLabel = readOptionalString(raw, "subtypeLabel");
  const enforcementFamily = readOptionalString(raw, "enforcementFamily");
  let selectedPrimaryPattern: PersuasionPattern | null = null;
  if ("selectedPrimaryPattern" in raw) {
    const sp = raw.selectedPrimaryPattern;
    if (sp === null) selectedPrimaryPattern = null;
    else if (typeof sp === "string" && isPersuasionPattern(sp)) {
      selectedPrimaryPattern = sp;
    }
  }
  const cl = raw.confidenceLevel;
  const confidenceLevel: LiveConfidenceLevel =
    cl === "HIGH" || cl === "MEDIUM" || cl === "LOW" ? cl : "MEDIUM";
  const as = raw.actionSignal;
  const actionSignal: LiveActionSignal =
    as === "PUSH" || as === "PROBE" || as === "ALIGN" ? as : "PROBE";
  const dr = raw.deliveryRisk;
  const deliveryRisk: LiveDeliveryRisk =
    dr === "SAFE" || dr === "MODERATE" || dr === "AGGRESSIVE" ? dr : "MODERATE";
  return {
    intent,
    objectionType,
    liveGeneralSubtype: liveGeneralSubtype ?? null,
    selectedPrimaryPattern,
    visibilityReason,
    situationLabel,
    subtypeLabel: subtypeLabel ?? null,
    enforcementFamily: enforcementFamily ?? null,
    confidenceLevel,
    actionSignal,
    deliveryRisk,
  };
}

function readPrecallDepth(
  r: Record<string, unknown>
): PreCallDepth | undefined {
  if (!("precallDepth" in r)) return undefined;
  const v = r.precallDepth;
  if (v === "instant" || v === "deep") return v;
  return undefined;
}

function readPrecallArtifact(
  r: Record<string, unknown>
): PrecallArtifactKind | null | undefined {
  if (!("precallArtifact" in r)) return undefined;
  const v = r.precallArtifact;
  if (v === null) return null;
  if (
    v === "v102_standard" ||
    v === "v102_instant" ||
    v === "v102_number" ||
    v === "legacy"
  ) {
    return v;
  }
  return undefined;
}

function hasNonEmptyTrimmedString(
  r: Record<string, unknown>,
  keys: string[]
): boolean {
  for (const k of keys) {
    const v = r[k];
    if (typeof v === "string" && v.trim().length > 0) return true;
  }
  return false;
}

/**
 * Defensive parse for `messages.structured_reply` JSONB.
 * Returns null if shape is unusable — caller should fall back to legacy blob rendering.
 */
export function parseStructuredReplySafe(
  raw: unknown
): AssistantStructuredReply | null {
  if (raw == null) return null;
  if (!isRecord(raw)) return null;

  const rebuttals: NonNullable<AssistantStructuredReply["rebuttals"]> = [];
  const rebuttalsIn = raw.rebuttals;
  if (Array.isArray(rebuttalsIn)) {
    for (const item of rebuttalsIn) {
      if (!isRecord(item)) continue;
      const title = item.title;
      const sayThis = item.sayThis;
      if (typeof title !== "string" || typeof sayThis !== "string") continue;
      const support = item.support;
      rebuttals.push({
        title,
        sayThis,
        support:
          support == null
            ? null
            : typeof support === "string"
              ? support
              : null,
      });
    }
  }

  let patternIntel: AssistantStructuredReply["patternIntel"] = null;
  const piRaw = raw.patternIntel;
  if (piRaw != null && isRecord(piRaw)) {
    patternIntel = {
      status:
        typeof piRaw.status === "string"
          ? piRaw.status
          : piRaw.status === null
            ? null
            : null,
      whyThisResponse:
        typeof piRaw.whyThisResponse === "string"
          ? piRaw.whyThisResponse
          : null,
      howItFits:
        typeof piRaw.howItFits === "string" ? piRaw.howItFits : null,
      coachInsight:
        typeof piRaw.coachInsight === "string" ? piRaw.coachInsight : null,
    };
  }

  const coachNote = readOptionalString(raw, "coachNote");
  const followUp = readOptionalString(raw, "followUp");

  const primaryObjectionType = readOptionalString(raw, "primaryObjectionType");

  let objectionTags: ObjectionTagWithScore[] | undefined;
  let topObjectionTags: ObjectionTagWithScore[] | undefined;
  if (Array.isArray(raw.objectionTags)) {
    objectionTags = [];
    for (const t of raw.objectionTags) {
      if (typeof t === "string") {
        objectionTags.push({ tag: t, score: 1 });
      } else if (isRecord(t) && typeof t.tag === "string") {
        const sc = t.score;
        const score =
          typeof sc === "number" && Number.isFinite(sc) ? sc : 1;
        objectionTags.push({ tag: t.tag, score });
      }
    }
    if (objectionTags.length === 0) objectionTags = undefined;
  }
  if (Array.isArray(raw.topObjectionTags)) {
    topObjectionTags = [];
    for (const t of raw.topObjectionTags) {
      if (typeof t === "string") {
        topObjectionTags.push({ tag: t, score: 1 });
      } else if (isRecord(t) && typeof t.tag === "string") {
        const sc = t.score;
        const score =
          typeof sc === "number" && Number.isFinite(sc) ? sc : 1;
        topObjectionTags.push({ tag: t.tag, score });
      }
    }
    if (topObjectionTags.length === 0) topObjectionTags = undefined;
  }

  const objectionTagReasons = Array.isArray(raw.objectionTagReasons)
    ? raw.objectionTagReasons.filter((x): x is string => typeof x === "string")
    : undefined;

  let coachReplyMode: CoachReplyMode | undefined;
  if ("coachReplyMode" in raw && raw.coachReplyMode != null) {
    coachReplyMode = parseCoachReplyMode(raw.coachReplyMode);
  }

  let liveOpeningLines: string[] | undefined;
  if (Array.isArray(raw.liveOpeningLines)) {
    liveOpeningLines = raw.liveOpeningLines.filter(
      (x): x is string => typeof x === "string" && x.trim().length > 0
    );
    if (liveOpeningLines.length === 0) liveOpeningLines = undefined;
  }

  const precallArtifact = readPrecallArtifact(raw);
  const precallDepth = readPrecallDepth(raw);

  const merchantMeaning = readOptionalString(raw, "merchantMeaning");
  const pressureDiagnosis = readOptionalString(raw, "pressureDiagnosis");
  const pressureHierarchy = readOptionalString(raw, "pressureHierarchy");
  const reframeStrategy = readOptionalString(raw, "reframeStrategy");
  const callReadyLine = readOptionalString(raw, "callReadyLine");

  const precallObjectionTypeLabel = readOptionalString(
    raw,
    "precallObjectionTypeLabel"
  );
  const precallWhatTheyReallyMean = readOptionalString(
    raw,
    "precallWhatTheyReallyMean"
  );
  const precallLane1 = readOptionalString(raw, "precallLane1");
  const precallLane2 = readOptionalString(raw, "precallLane2");
  const precallMetric = readOptionalString(raw, "precallMetric");
  const precallWhatNumberMeans = readOptionalString(
    raw,
    "precallWhatNumberMeans"
  );
  const precallStrategicUse = readOptionalString(raw, "precallStrategicUse");
  const precallMerchantFacingLine = readOptionalString(
    raw,
    "precallMerchantFacingLine"
  );

  const primaryPersuasionPattern = readPersuasionPattern(
    raw,
    "primaryPersuasionPattern"
  );
  const lastPatternUsed = readPersuasionPattern(raw, "lastPatternUsed");

  let liveResponseVisibility: LiveResponseVisibility | null | undefined;
  if ("liveResponseVisibility" in raw) {
    const lv = readLiveResponseVisibility(raw.liveResponseVisibility);
    if (lv === null) liveResponseVisibility = null;
    else if (lv) liveResponseVisibility = lv;
    else liveResponseVisibility = undefined;
  }

  const out: AssistantStructuredReply = {
    ...(coachReplyMode != null ? { coachReplyMode } : {}),
    ...(liveOpeningLines != null ? { liveOpeningLines } : {}),
    ...(precallDepth !== undefined ? { precallDepth } : {}),
    ...(precallArtifact !== undefined ? { precallArtifact } : {}),
    ...(merchantMeaning !== undefined ? { merchantMeaning } : {}),
    ...(pressureDiagnosis !== undefined ? { pressureDiagnosis } : {}),
    ...(pressureHierarchy !== undefined ? { pressureHierarchy } : {}),
    ...(reframeStrategy !== undefined ? { reframeStrategy } : {}),
    ...(callReadyLine !== undefined ? { callReadyLine } : {}),
    ...(precallObjectionTypeLabel !== undefined
      ? { precallObjectionTypeLabel }
      : {}),
    ...(precallWhatTheyReallyMean !== undefined
      ? { precallWhatTheyReallyMean }
      : {}),
    ...(precallLane1 !== undefined ? { precallLane1 } : {}),
    ...(precallLane2 !== undefined ? { precallLane2 } : {}),
    ...(precallMetric !== undefined ? { precallMetric } : {}),
    ...(precallWhatNumberMeans !== undefined
      ? { precallWhatNumberMeans }
      : {}),
    ...(precallStrategicUse !== undefined ? { precallStrategicUse } : {}),
    ...(precallMerchantFacingLine !== undefined
      ? { precallMerchantFacingLine }
      : {}),
    objectionType:
      typeof raw.objectionType === "string"
        ? raw.objectionType
        : raw.objectionType === null
          ? null
          : null,
    primaryObjectionType,
    objectionTags,
    topObjectionTags,
    objectionTagReasons:
      objectionTagReasons && objectionTagReasons.length > 0
        ? objectionTagReasons
        : undefined,
    toneUsed:
      typeof raw.toneUsed === "string"
        ? raw.toneUsed
        : raw.toneUsed === null
          ? null
          : null,
    patternIntel,
    ...(primaryPersuasionPattern !== undefined
      ? { primaryPersuasionPattern }
      : {}),
    ...(lastPatternUsed !== undefined ? { lastPatternUsed } : {}),
    ...(liveResponseVisibility !== undefined
      ? { liveResponseVisibility }
      : {}),
    rebuttals: rebuttals.length > 0 ? rebuttals : undefined,
    coachNote,
    followUp,
  };

  const hasPatternText =
    patternIntel &&
    (patternIntel.status ||
      patternIntel.whyThisResponse ||
      patternIntel.howItFits ||
      patternIntel.coachInsight);

  const hasTagMeta =
    (objectionTags != null && objectionTags.length > 0) ||
    (topObjectionTags != null && topObjectionTags.length > 0) ||
    (typeof raw.primaryObjectionType === "string" &&
      raw.primaryObjectionType.length > 0);

  const hasPrecallPayload = hasNonEmptyTrimmedString(raw, [
    "merchantMeaning",
    "pressureDiagnosis",
    "pressureHierarchy",
    "reframeStrategy",
    "callReadyLine",
    "precallObjectionTypeLabel",
    "precallWhatTheyReallyMean",
    "precallLane1",
    "precallLane2",
    "precallMetric",
    "precallWhatNumberMeans",
    "precallStrategicUse",
    "precallMerchantFacingLine",
  ]);

  const hasPrecallArtifactKind =
    precallArtifact === "v102_standard" ||
    precallArtifact === "v102_instant" ||
    precallArtifact === "v102_number" ||
    precallArtifact === "legacy";

  const hasContent =
    coachReplyMode === "live" ||
    rebuttals.length > 0 ||
    (coachNote != null && coachNote.length > 0) ||
    (followUp != null && followUp.length > 0) ||
    !!hasPatternText ||
    hasTagMeta ||
    hasPrecallPayload ||
    hasPrecallArtifactKind;

  if (!hasContent) return null;

  return out;
}
