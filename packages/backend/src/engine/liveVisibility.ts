import type {
  LiveActionSignal,
  LiveConfidenceLevel,
  LiveDeliveryRisk,
  LiveResponseVisibility,
  PersuasionPattern,
} from "../types/assistantStructuredReply.js";
import {
  classifyConversationIntent,
  detectObjectionType,
  resolveLiveEnforcementFamily,
  type ConversationIntent,
  type LiveEnforcementFamily,
  type LivePatternDebugMeta,
} from "./liveResponseRefinement.js";

function patternPhrase(p: PersuasionPattern | null | undefined): string | null {
  if (!p) return null;
  switch (p) {
    case "REFRAME":
      return "Reframes decision";
    case "CONDITION":
      return "Sets decision gate";
    case "CONSEQUENCE":
      return "Surfaces cost of inaction";
    case "CONTROL":
      return "Directs next step";
    default: {
      const _e: never = p;
      return _e;
    }
  }
}

function withPatternTail(base: string, pp: string | null): string {
  return pp ? `${base} • ${pp}` : base;
}

/**
 * Deterministic operator-facing “Why” line — copy only; same inputs/branches as before.
 */
export function buildVisibilityReason(args: {
  intent: ConversationIntent;
  objectionType: string;
  liveGeneralSubtype: string | null;
  selectedPrimaryPattern: PersuasionPattern | null;
  enforcementFamily: LiveEnforcementFamily | null;
}): string {
  const { intent, objectionType, selectedPrimaryPattern, enforcementFamily } = args;
  const pp = patternPhrase(selectedPrimaryPattern);

  if (intent === "REQUEST") {
    return "Asked for info → clarify before sending";
  }
  if (intent === "HESITATION") {
    return "Unclear → pull real concern";
  }
  if (intent === "STALL") {
    return "Delay / other party → force decision criteria";
  }
  if (intent === "COMPARISON") {
    return "Has alternative → expose gap";
  }

  if (objectionType === "PRICE") {
    return withPatternTail("Price pushback → shift to cash flow", pp);
  }
  if (objectionType === "TRUST") {
    return "Skepticism → regain control";
  }
  if (objectionType === "CREDIT") {
    return withPatternTail("Credit question → weigh impact", pp);
  }
  if (objectionType === "TAX") {
    return withPatternTail("Tax question → isolate outcome", pp);
  }

  if (objectionType === "GENERAL" && enforcementFamily === "FIT_STYLE") {
    return "Fit issue → isolate break point";
  }
  if (objectionType === "GENERAL" && enforcementFamily === "BRUSH_OFF") {
    return "Brush-off → re-engage";
  }

  if (intent === "NEUTRAL") {
    return withPatternTail("General → clarify direction", pp);
  }

  return withPatternTail("Pushback → reposition decision", pp);
}

function buildSituationLabel(
  intent: ConversationIntent,
  objectionType: string,
  enforcementFamily: LiveEnforcementFamily | null
): string {
  if (
    intent === "REQUEST" ||
    intent === "HESITATION" ||
    intent === "STALL" ||
    intent === "COMPARISON"
  ) {
    return intent;
  }
  if (enforcementFamily) {
    return enforcementFamily;
  }
  if (objectionType === "PRICE" || objectionType === "TRUST" || objectionType === "TAX" || objectionType === "CREDIT") {
    return objectionType;
  }
  if (intent !== "NEUTRAL") {
    return intent;
  }
  return objectionType;
}

function deriveConfidenceLevel(
  intent: ConversationIntent,
  objectionType: string,
  enforcementFamily: LiveEnforcementFamily | null
): LiveConfidenceLevel {
  if (intent === "HESITATION" || intent === "STALL") return "LOW";

  if (enforcementFamily === "TRUST" && objectionType === "TRUST") {
    return "HIGH";
  }
  if (enforcementFamily === "PRICE" && objectionType === "PRICE") {
    return "HIGH";
  }
  if (
    intent === "REJECTION" &&
    enforcementFamily &&
    (enforcementFamily === "PRICE" ||
      enforcementFamily === "TRUST" ||
      enforcementFamily === "FIT_STYLE")
  ) {
    return "HIGH";
  }

  if (intent === "REQUEST" || intent === "COMPARISON") return "MEDIUM";
  if (enforcementFamily === "BRUSH_OFF") return "MEDIUM";
  if (enforcementFamily && intent !== "REJECTION") return "MEDIUM";

  if (intent === "NEUTRAL") return "LOW";

  return "MEDIUM";
}

function deriveActionSignal(
  intent: ConversationIntent,
  enforcementFamily: LiveEnforcementFamily | null
): LiveActionSignal {
  if (enforcementFamily === "PRICE" || enforcementFamily === "TRUST") {
    return "PUSH";
  }
  if (intent === "HESITATION" || intent === "STALL") {
    return "PROBE";
  }
  if (enforcementFamily === "FIT_STYLE") {
    return "PROBE";
  }
  if (intent === "REQUEST" || intent === "COMPARISON") {
    return "ALIGN";
  }
  if (enforcementFamily === "BRUSH_OFF") {
    return "ALIGN";
  }
  return "PROBE";
}

function deriveDeliveryRisk(
  intent: ConversationIntent,
  enforcementFamily: LiveEnforcementFamily | null,
  actionSignal: LiveActionSignal
): LiveDeliveryRisk {
  if (
    intent === "REQUEST" ||
    intent === "COMPARISON" ||
    enforcementFamily === "BRUSH_OFF"
  ) {
    return "SAFE";
  }
  if (
    intent === "HESITATION" ||
    intent === "STALL" ||
    enforcementFamily === "FIT_STYLE"
  ) {
    return "MODERATE";
  }
  if (
    (enforcementFamily === "PRICE" || enforcementFamily === "TRUST") &&
    actionSignal === "PUSH"
  ) {
    return "AGGRESSIVE";
  }
  return "MODERATE";
}

/** Engine subtype row when it adds information beyond situation (e.g. PRICE_DEFAULT, NO_BRUSH). */
function buildSubtypeLabel(
  situationLabel: string,
  liveGeneralSubtype: string | null,
  enforcementFamily: LiveEnforcementFamily | null
): string | null {
  if (!liveGeneralSubtype?.trim()) return null;
  const s = liveGeneralSubtype.trim();
  if (s === situationLabel) return null;
  if (enforcementFamily && s === String(enforcementFamily)) return null;
  return s;
}

export function buildLiveResponseVisibility(
  meta: LivePatternDebugMeta,
  userMessage: string
): LiveResponseVisibility {
  const intent = classifyConversationIntent(userMessage);
  const objectionType =
    meta.objectionType ?? detectObjectionType(userMessage);
  const liveGeneralSubtype = meta.liveGeneralSubtype ?? null;
  const selectedPrimaryPattern =
    meta.chosenVariantPrimaryPattern ?? meta.selectedPattern ?? null;
  const enforcementFamily = resolveLiveEnforcementFamily(
    objectionType,
    userMessage,
    liveGeneralSubtype
  );
  const situationLabel = buildSituationLabel(
    intent,
    objectionType,
    enforcementFamily
  );
  const visibilityReason = buildVisibilityReason({
    intent,
    objectionType,
    liveGeneralSubtype,
    selectedPrimaryPattern,
    enforcementFamily,
  });
  const subtypeLabel = buildSubtypeLabel(
    situationLabel,
    liveGeneralSubtype,
    enforcementFamily
  );

  const confidenceLevel = deriveConfidenceLevel(
    intent,
    objectionType,
    enforcementFamily
  );
  const actionSignal = deriveActionSignal(intent, enforcementFamily);
  const deliveryRisk = deriveDeliveryRisk(intent, enforcementFamily, actionSignal);

  const out: LiveResponseVisibility = {
    intent,
    objectionType,
    liveGeneralSubtype,
    selectedPrimaryPattern,
    visibilityReason,
    situationLabel,
    subtypeLabel,
    enforcementFamily,
    confidenceLevel,
    actionSignal,
    deliveryRisk,
  };
  return out;
}
