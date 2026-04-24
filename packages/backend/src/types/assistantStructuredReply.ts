/**
 * Persisted JSON shape for assistant coaching turns (messages.structured_reply).
 * Mirrors frontend `AssistantStructuredReply` — keep in sync manually or via shared package later.
 */

import type { CoachReplyMode } from "./coachReplyMode.js";
import type { PreCallDepth } from "./preCallDepth.js";

/** Phase 4.4 tactical persuasion angle (LIVE + precall mapping). */
export type PersuasionPattern =
  | "REFRAME"
  | "CONDITION"
  | "CONSEQUENCE"
  | "CONTROL";

/** LIVE HUD: discrete confidence (derived from existing metadata only). */
export type LiveConfidenceLevel = "HIGH" | "MEDIUM" | "LOW";

/** LIVE HUD: execution hint for the rep (derived from existing metadata only). */
export type LiveActionSignal = "PUSH" | "PROBE" | "ALIGN";

/** LIVE HUD: how safe it is to deliver the line verbatim (derived from existing metadata only). */
export type LiveDeliveryRisk = "SAFE" | "MODERATE" | "AGGRESSIVE";

/** LIVE dashboard: deterministic visibility copy (see `liveVisibility.ts`). */
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

export type StructuredRebuttal = {
  title: string;
  sayThis: string;
  support?: string | null;
  /** Phase 4.5 — optional deterministic alternates for the same scripted slot (same semantics as sayThis). */
  variants?: string[];
};

export type StructuredPatternIntel = {
  status?: string | null;
  whyThisResponse?: string | null;
  howItFits?: string | null;
  coachInsight?: string | null;
};

/** Lightweight confidence per canonical tag (sorted by score descending in API output). */
export type ObjectionTagWithScore = {
  tag: string;
  score: number;
};

/** PRE-CALL V10.2 primary artifact shape (standard vs number/deal-math). */
export type PrecallArtifactKind =
  | "v102_standard"
  | "v102_instant"
  | "v102_number"
  | "legacy";

export type AssistantStructuredReply = {
  /** Dual-mode: `live` = call script only in UI; `precall` = full coach / training panels. */
  coachReplyMode?: CoachReplyMode;
  /**
   * Pre-call speed tier (persisted for UI). Omitted on legacy rows → UI treats as deep/full.
   */
  precallDepth?: PreCallDepth;
  /** PRE-CALL V10.2: which structured contract was used (new rows). */
  precallArtifact?: PrecallArtifactKind | null;

  /** @deprecated Legacy V10.0 prep markers; still hydrated for old rows. */
  merchantMeaning?: string | null;
  pressureDiagnosis?: string | null;
  /** @deprecated Prefer `pressureDiagnosis`; kept for older stored rows. */
  pressureHierarchy?: string | null;
  reframeStrategy?: string | null;
  callReadyLine?: string | null;

  /** V10.2 STANDARD: human-readable objection classification label. */
  precallObjectionTypeLabel?: string | null;
  precallWhatTheyReallyMean?: string | null;
  precallLane1?: string | null;
  precallLane2?: string | null;
  /** PRE-CALL STANDARD: primary persuasion pattern driving Lane 1 (analytics / learning). */
  precallPrimaryPersuasionPattern?: string | null;
  /** PRE-CALL STANDARD: persuasion pattern for Lane 2 (analytics / learning). */
  lane2PersuasionPattern?: string | null;

  /** V10.2 NUMBER / deal-math. */
  precallMetric?: string | null;
  precallWhatNumberMeans?: string | null;
  precallStrategicUse?: string | null;
  precallMerchantFacingLine?: string | null;

  /** LIVE: up to three lines spoken on the call (optional; can split from rebuttals[0].sayThis). */
  liveOpeningLines?: string[];
  /** Primary objection slug (same as `primaryObjectionType` when multi-tag fields are set). */
  objectionType?: string | null;
  /** Canonical primary slug; mirrors `objectionType` for analytics. */
  primaryObjectionType?: string | null;
  /** All tags with scores, highest score first. */
  objectionTags?: ObjectionTagWithScore[];
  /** Top slice for future UI (optional; same shape as leading entries of `objectionTags`). */
  topObjectionTags?: ObjectionTagWithScore[];
  /** Optional rule-based reasons (debug / future learning). */
  objectionTagReasons?: string[];
  toneUsed?: string | null;
  patternIntel?: StructuredPatternIntel | null;
  /** Phase 4.4: tactical persuasion angle for this assistant turn (LIVE / precall). */
  primaryPersuasionPattern?: PersuasionPattern | null;
  /** Prior turn's tactical pattern (anti-repeat input); omitted when unknown. */
  lastPatternUsed?: PersuasionPattern | null;
  /** LIVE: why/how the script was chosen (deterministic; UI only). */
  liveResponseVisibility?: LiveResponseVisibility | null;
  rebuttals?: StructuredRebuttal[];
  coachNote?: string | null;
  followUp?: string | null;
};

export type AssistantMessagePresentation = {
  structuredReply?: AssistantStructuredReply | null;
};
