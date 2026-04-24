import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlanEntitlements } from "./planEntitlements.js";
import { getNormalizedUsageForUser } from "./freeTierUsage.js";
import { getPlanEntitlements, type PlanType } from "./planEntitlements.js";

export const STANDARD_TONE_MODES = [
  "consultative",
  "assertive",
  "friendly",
  "urgent",
  "analytical",
] as const;

export const ADVANCED_TONE_MODES = [
  "closer",
  "pressure",
  "analytical_breakdown",
] as const;

export const ALL_TONE_MODES = [
  ...STANDARD_TONE_MODES,
  ...ADVANCED_TONE_MODES,
] as const;

export type ToneMode = (typeof ALL_TONE_MODES)[number];

export type ResolvedToneMode = {
  tone: ToneMode | undefined;
  downgraded: boolean;
  acceptedAdvanced: boolean;
  requested: string | undefined;
  planType: PlanType;
};

const STANDARD_TONE_SET = new Set<string>(STANDARD_TONE_MODES);
const ADVANCED_TONE_SET = new Set<string>(ADVANCED_TONE_MODES);
const DEFAULT_STANDARD_TONE: ToneMode = "consultative";

export function normalizeToneMode(value: string | null | undefined): ToneMode | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  return ALL_TONE_MODES.find((tone) => tone === normalized);
}

export function resolveToneModeForPlan(
  requestedTone: string | null | undefined,
  planType: PlanType | string | null | undefined
): ResolvedToneMode {
  const normalizedRequested = requestedTone?.trim().toLowerCase();
  const normalizedTone = normalizeToneMode(requestedTone);
  const normalizedPlan = normalizePlanType(planType);
  const entitlements = getPlanEntitlements(normalizedPlan);

  if (!normalizedRequested) {
    return {
      tone: undefined,
      downgraded: false,
      acceptedAdvanced: false,
      requested: undefined,
      planType: normalizedPlan,
    };
  }

  if (!normalizedTone) {
    return {
      tone: undefined,
      downgraded: false,
      acceptedAdvanced: false,
      requested: normalizedRequested,
      planType: normalizedPlan,
    };
  }

  if (STANDARD_TONE_SET.has(normalizedTone)) {
    return {
      tone: normalizedTone,
      downgraded: false,
      acceptedAdvanced: false,
      requested: normalizedRequested,
      planType: normalizedPlan,
    };
  }

  if (ADVANCED_TONE_SET.has(normalizedTone) && entitlements.advancedToneModes) {
    return {
      tone: normalizedTone,
      downgraded: false,
      acceptedAdvanced: true,
      requested: normalizedRequested,
      planType: normalizedPlan,
    };
  }

  return {
    tone: DEFAULT_STANDARD_TONE,
    downgraded: true,
    acceptedAdvanced: false,
    requested: normalizedRequested,
    planType: normalizedPlan,
  };
}

export function getAllowedToneModes(
  entitlements: Pick<PlanEntitlements, "advancedToneModes">
): ToneMode[] {
  return entitlements.advancedToneModes
    ? [...ALL_TONE_MODES]
    : [...STANDARD_TONE_MODES];
}

export function toneModePromptInstruction(tone: ToneMode): string {
  switch (tone) {
    case "consultative":
      return "Use a consultative tone: calm, practical, low-friction, and discovery-oriented.";
    case "assertive":
      return "Use an assertive tone: direct, confident, and clear without sounding reckless.";
    case "friendly":
      return "Use a friendly tone: warm, approachable, and conversational while staying useful.";
    case "urgent":
      return "Use an urgent tone: concise, time-aware, and momentum-building without panic.";
    case "analytical":
      return "Use an analytical tone: structured, logical, and evidence-oriented.";
    case "closer":
      return "Use a closer tone: decisive, deal-moving, and high-conviction with a strong bias toward next-step commitment.";
    case "pressure":
      return "Use a pressure tone: urgent, concise, and action-driving while remaining coherent and controlled.";
    case "analytical_breakdown":
      return "Use an analytical_breakdown tone: break the objection into clear steps, logic, and tradeoffs before delivering the rebuttal.";
    default: {
      const _x: never = tone;
      return _x;
    }
  }
}

export async function getPlanTypeFromAuthHeader(
  supabase: SupabaseClient,
  authHeader: string | undefined
): Promise<PlanType> {
  const token = authHeader?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return "free";

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user?.id) return "free";

  const usage = await getNormalizedUsageForUser(supabase, data.user.id);
  return usage?.plan ?? "free";
}

function normalizePlanType(planType: PlanType | string | null | undefined): PlanType {
  const normalized = (planType ?? "free").trim().toLowerCase();
  if (normalized === "starter") return "starter";
  if (normalized === "pro") return "pro";
  return "free";
}
