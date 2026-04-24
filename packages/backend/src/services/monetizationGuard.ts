export type PlanType = "free" | "starter" | "pro";

export type MonetizationDecision = {
  allow: boolean; // hard gate: if false → block request
  reason: "ok" | "limit_reached"; // deterministic reason

  degrade: {
    maxCandidates: number; // slice AFTER pipeline only
    disableAdvancedTones: boolean; // reserved (no-op for now)
    disableDeepMode: boolean; // reserved (no-op for now)
  };
};

import { getPlanEntitlements } from "./planEntitlements.js";

function maxTurnsForPlan(planType: PlanType): number {
  const entitlements = getPlanEntitlements(planType);
  if (entitlements.unlimited) return Number.POSITIVE_INFINITY;
  // `monthlyResponseLimit` is the existing plan source of truth used for UI meter/banners.
  // Treat any non-positive value as "no turns" (fail-closed).
  const limit = Math.floor(Number(entitlements.monthlyResponseLimit));
  return Number.isFinite(limit) ? Math.max(0, limit) : 0;
}

const PLAN_LIMITS: Record<
  PlanType,
  {
    maxCandidates: number;
    advancedTones: boolean;
    deepMode: boolean;
  }
> = {
  free: {
    maxCandidates: 1,
    advancedTones: false,
    deepMode: false,
  },
  starter: {
    maxCandidates: 2,
    advancedTones: true,
    deepMode: false,
  },
  pro: {
    maxCandidates: 3,
    advancedTones: true,
    deepMode: true,
  },
};

export function evaluateMonetization(input: {
  userId: string;
  planType: PlanType;
  usageCount: number;
}): MonetizationDecision {
  const limits = PLAN_LIMITS[input.planType];
  const maxTurns = maxTurnsForPlan(input.planType);

  if (input.usageCount >= maxTurns) {
    return {
      allow: false,
      reason: "limit_reached",
      degrade: {
        maxCandidates: 0,
        disableAdvancedTones: true,
        disableDeepMode: true,
      },
    };
  }

  return {
    allow: true,
    reason: "ok",
    degrade: {
      maxCandidates: limits.maxCandidates,
      disableAdvancedTones: !limits.advancedTones,
      disableDeepMode: !limits.deepMode,
    },
  };
}

