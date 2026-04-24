/**
 * Maps API enforcement results to a single upgrade / auth / retry UX model.
 * Server rules are unchanged — this is presentation + CTA routing only.
 */

export type PlanTier = "free" | "starter" | "pro" | "unknown";

export type EnforcementUxVariant =
  | "auth_required"
  | "free_limit"
  | "pro_upgrade"
  | "rate_limited"
  | "temporary_unavailable"
  | "generic";

export type EnforcementAnalyticsReason =
  | "auth_required"
  | "free_limit"
  | "pro_upgrade"
  | "rate_limited"
  | "usage_unavailable"
  | "generic";

export type EnforcementPressureLevel = "auth" | "soft" | "hard";

export type EnforcementPressureTier = "low" | "medium" | "high";

export type EnforcementUxModel = {
  variant: EnforcementUxVariant;
  title: string;
  body: string;
  /** Optional urgency line (e.g. conversation vs regenerate). */
  contextLine: string | null;
  /** Single value reinforcement above CTAs — free-limit only. */
  valueLine: string | null;
  /** For enforcement_prompt_* metadata.pressure_level */
  pressureLevel: EnforcementPressureLevel;
  /** Session escalation tier — repeated enforcement hits in-tab. */
  pressureTier: EnforcementPressureTier;
  /** Session counter passed through for analytics (same source as bump). */
  enforcementHits: number;
  /** For enforcement_prompt_* metadata.triggerType / reason */
  analyticsReason: EnforcementAnalyticsReason;
  /** CTA configuration for the modal (no hrefs here — parent supplies returnTo). */
  primary: "auth" | "free_dual_upgrade" | "pro_and_billing" | "dismiss" | "dismiss_with_team_link";
  showComparePlansLink: boolean;
  showManageBillingSecondary: boolean;
  showTeamDemoTertiary: boolean;
};

export function parseApiErrorPayload(body: unknown): {
  code: string | null;
  message: string | null;
} {
  if (!body || typeof body !== "object")
    return { code: null, message: null };
  const o = body as Record<string, unknown>;
  const code = typeof o.code === "string" ? o.code : null;
  const message = typeof o.message === "string" ? o.message : null;
  return { code, message };
}

function normalizeEnforcementHits(raw: number | undefined): number {
  if (raw === undefined) return 1;
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, 999);
}

function pressureTierFromHits(hits: number): EnforcementPressureTier {
  const h = normalizeEnforcementHits(hits);
  if (h === 1) return "low";
  if (h === 2) return "medium";
  return "high";
}

function sessionPressure(input: { enforcementHits?: number }): {
  enforcementHits: number;
  pressureTier: EnforcementPressureTier;
} {
  const enforcementHits = normalizeEnforcementHits(input.enforcementHits);
  return {
    enforcementHits,
    pressureTier: pressureTierFromHits(enforcementHits),
  };
}

function contextLineForSurface(surface: string | undefined): string | null {
  if (!surface) return null;
  if (surface === "conversation") {
    return "Don’t lose momentum on this objection.";
  }
  if (surface === "regenerate") {
    return "Generate your next variation instantly.";
  }
  return null;
}

function planDifferentiationLine(planTier: PlanTier): string {
  if (planTier === "starter") {
    return "You’re currently on Starter. Pro unlocks advanced objection handling and higher-pressure workflows.";
  }
  if (planTier === "free" || planTier === "unknown") {
    return "You’re currently on Free. Pro unlocks full system capability.";
  }
  if (planTier === "pro") {
    return "This workflow requires full Pro access on your account.";
  }
  return "You’re currently on Free. Pro unlocks full system capability.";
}

function freeLimitBody(tier: EnforcementPressureTier): string {
  switch (tier) {
    case "low":
      return "You’ve used your included responses for this period.";
    case "medium":
      return "You’ve reached your limit — upgrade now to keep this conversation moving.";
    default:
      return "You’re blocked. Upgrade now to continue without losing momentum.";
  }
}

/**
 * Central resolver: http status, machine code, and current plan tier.
 * `limitReachedLegacy` = coach path returns 200 + { error: "limit_reached" }.
 * Optional `surface` drives dynamic context copy only (conversation | regenerate).
 * `enforcementHits` — session counter from the caller (sessionStorage); omitted → low tier.
 */
export function resolveGenerationFailureUX(input: {
  httpStatus: number;
  errorCode: string | null;
  errorMessage: string | null;
  planTier: PlanTier;
  limitReachedLegacy?: boolean;
  surface?: string;
  enforcementHits?: number;
}): EnforcementUxModel {
  const { httpStatus, errorCode, planTier, limitReachedLegacy, surface } = input;
  const sp = sessionPressure(input);

  const freeLimitCore = (): EnforcementUxModel => {
    const tier = sp.pressureTier;
    const showExtras = tier === "low";
    return {
      variant: "free_limit",
      title: "Free limit reached",
      body: freeLimitBody(tier),
      contextLine: showExtras ? contextLineForSurface(surface) : null,
      valueLine: showExtras
        ? "Stay in control of every objection, in real time."
        : null,
      pressureLevel: "hard",
      pressureTier: tier,
      enforcementHits: sp.enforcementHits,
      analyticsReason: "free_limit",
      primary: "free_dual_upgrade",
      showComparePlansLink: true,
      showManageBillingSecondary: false,
      showTeamDemoTertiary: false,
    };
  };

  if (limitReachedLegacy && planTier === "free") {
    return freeLimitCore();
  }

  const code = errorCode?.toUpperCase() ?? "";

  if (httpStatus === 401 || code === "AUTH_REQUIRED") {
    return {
      variant: "auth_required",
      title: "Sign in required",
      body: "Create an account or sign in to keep using RoboRebut.",
      contextLine: null,
      valueLine: null,
      pressureLevel: "auth",
      pressureTier: sp.pressureTier,
      enforcementHits: sp.enforcementHits,
      analyticsReason: "auth_required",
      primary: "auth",
      showComparePlansLink: false,
      showManageBillingSecondary: false,
      showTeamDemoTertiary: false,
    };
  }

  if (httpStatus === 429 || code === "RATE_LIMITED") {
    return {
      variant: "rate_limited",
      title: "Too many requests",
      body: "Slow down and try again in a moment.",
      contextLine: null,
      valueLine: null,
      pressureLevel: "soft",
      pressureTier: sp.pressureTier,
      enforcementHits: sp.enforcementHits,
      analyticsReason: "rate_limited",
      primary: "dismiss_with_team_link",
      showComparePlansLink: false,
      showManageBillingSecondary: false,
      showTeamDemoTertiary: true,
    };
  }

  if (httpStatus === 503 || code === "USAGE_UNAVAILABLE") {
    return {
      variant: "temporary_unavailable",
      title: "Unable to verify usage",
      body: "Try again shortly.",
      contextLine: null,
      valueLine: null,
      pressureLevel: "soft",
      pressureTier: sp.pressureTier,
      enforcementHits: sp.enforcementHits,
      analyticsReason: "usage_unavailable",
      primary: "dismiss",
      showComparePlansLink: false,
      showManageBillingSecondary: false,
      showTeamDemoTertiary: false,
    };
  }

  if (
    httpStatus === 403 &&
    code === "USAGE_LIMIT_REACHED" &&
    (planTier === "free" || planTier === "unknown")
  ) {
    return freeLimitCore();
  }

  if (
    httpStatus === 403 &&
    (code === "PRO_REQUIRED" || code === "STARTER_REQUIRED")
  ) {
    const main =
      "This workflow is part of RoboRebut Pro. Unlock closer-mode workflows, advanced plan support, and faster high-pressure usage.";
    const differentiation = planDifferentiationLine(planTier);
    return {
      variant: "pro_upgrade",
      title: "Upgrade to Pro",
      body: `${main}\n\n${differentiation}`,
      contextLine: null,
      valueLine: null,
      pressureLevel: "hard",
      pressureTier: sp.pressureTier,
      enforcementHits: sp.enforcementHits,
      analyticsReason: "pro_upgrade",
      primary: "pro_and_billing",
      showComparePlansLink: false,
      showManageBillingSecondary: planTier === "starter" || planTier === "pro",
      showTeamDemoTertiary: false,
    };
  }

  return {
    variant: "generic",
    title: "Something went wrong",
    body:
      input.errorMessage?.trim() ||
      "We couldn’t complete that request. Try again.",
    contextLine: null,
    valueLine: null,
    pressureLevel: "soft",
    pressureTier: sp.pressureTier,
    enforcementHits: sp.enforcementHits,
    analyticsReason: "generic",
    primary: "dismiss",
    showComparePlansLink: false,
    showManageBillingSecondary: false,
    showTeamDemoTertiary: false,
  };
}
