/** Mirror of backend `AssistantStructuredReply` — keep in sync with `packages/backend/src/types/assistantStructuredReply.ts`. */

import type { CoachReplyMode } from "./coachReplyMode";
import type { PreCallDepth } from "./preCallDepth";

export type StructuredRebuttal = {
  title: string;
  sayThis: string;
  support?: string | null;
};

export type StructuredPatternIntel = {
  status?: string | null;
  whyThisResponse?: string | null;
  howItFits?: string | null;
  coachInsight?: string | null;
};

export type ObjectionTagWithScore = {
  tag: string;
  score: number;
};

export type PrecallArtifactKind =
  | "v102_standard"
  | "v102_instant"
  | "v102_number"
  | "legacy";

export type PersuasionPattern =
  | "REFRAME"
  | "CONDITION"
  | "CONSEQUENCE"
  | "CONTROL";

export type LiveConfidenceLevel = "HIGH" | "MEDIUM" | "LOW";

export type LiveActionSignal = "PUSH" | "PROBE" | "ALIGN";

export type LiveDeliveryRisk = "SAFE" | "MODERATE" | "AGGRESSIVE";

export type LiveResponseVisibility = {
  intent: string;
  objectionType: string;
  liveGeneralSubtype: string | null;
  selectedPrimaryPattern: PersuasionPattern | null;
  visibilityReason: string;
  situationLabel: string;
  subtypeLabel: string | null;
  enforcementFamily: string | null;
  confidenceLevel: LiveConfidenceLevel;
  actionSignal: LiveActionSignal;
  deliveryRisk: LiveDeliveryRisk;
};

export type AssistantStructuredReply = {
  coachReplyMode?: CoachReplyMode;
  /** Pre-call tier; missing on legacy messages (UI = deep/full). */
  precallDepth?: PreCallDepth;
  precallArtifact?: PrecallArtifactKind | null;
  merchantMeaning?: string | null;
  pressureDiagnosis?: string | null;
  pressureHierarchy?: string | null;
  reframeStrategy?: string | null;
  callReadyLine?: string | null;
  precallObjectionTypeLabel?: string | null;
  precallWhatTheyReallyMean?: string | null;
  precallLane1?: string | null;
  precallLane2?: string | null;
  precallMetric?: string | null;
  precallWhatNumberMeans?: string | null;
  precallStrategicUse?: string | null;
  precallMerchantFacingLine?: string | null;
  liveOpeningLines?: string[];
  objectionType?: string | null;
  primaryObjectionType?: string | null;
  objectionTags?: ObjectionTagWithScore[];
  topObjectionTags?: ObjectionTagWithScore[];
  objectionTagReasons?: string[];
  toneUsed?: string | null;
  patternIntel?: StructuredPatternIntel | null;
  primaryPersuasionPattern?: PersuasionPattern | null;
  lastPatternUsed?: PersuasionPattern | null;
  liveResponseVisibility?: LiveResponseVisibility | null;
  rebuttals?: StructuredRebuttal[];
  coachNote?: string | null;
  followUp?: string | null;
};
