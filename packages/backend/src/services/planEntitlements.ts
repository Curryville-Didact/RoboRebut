/**
 * Centralized plan entitlements.
 * Source of truth for plan assignment remains `profiles.plan_type`.
 */

export type PlanType = "free" | "starter" | "pro";

export type PlanEntitlements = {
  monthlyResponseLimit: number;
  unlimited: boolean;
  responseVariants: number;
  priorityGeneration: boolean;
  advancedStrategies: boolean;
  advancedToneModes: boolean;
  objectionInsights: boolean;
  /** Pro-only: persisted JSON deal_context is passed to live coach (`coachChatReply`). */
  structuredDealContext: boolean;
};

const PLAN_ENTITLEMENTS: Record<PlanType, PlanEntitlements> = {
  free: {
    monthlyResponseLimit: 25,
    unlimited: false,
    responseVariants: 1,
    priorityGeneration: false,
    advancedStrategies: false,
    advancedToneModes: false,
    objectionInsights: false,
    structuredDealContext: false,
  },
  starter: {
    monthlyResponseLimit: -1,
    unlimited: true,
    responseVariants: 2,
    priorityGeneration: false,
    advancedStrategies: false,
    advancedToneModes: false,
    objectionInsights: false,
    structuredDealContext: false,
  },
  pro: {
    monthlyResponseLimit: -1,
    unlimited: true,
    responseVariants: 4,
    priorityGeneration: true,
    advancedStrategies: true,
    advancedToneModes: true,
    objectionInsights: true,
    structuredDealContext: true,
  },
};

export function getPlanEntitlements(planType: string | null | undefined): PlanEntitlements {
  const normalized = (planType ?? "free").trim().toLowerCase();
  if (normalized === "starter") return PLAN_ENTITLEMENTS.starter;
  if (normalized === "pro") return PLAN_ENTITLEMENTS.pro;
  return PLAN_ENTITLEMENTS.free;
}
