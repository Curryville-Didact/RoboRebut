import { API_URL } from "@/lib/env";

/** Mirrors the usage payload from `POST /api/billing/sync-entitlement` (see conversation page). */
export type UsageSnapshot = {
  used: number;
  limit: number;
  remaining: number;
  blocked: boolean;
  entitlements?: {
    responseVariants?: number;
    priorityGeneration?: boolean;
    advancedStrategies?: boolean;
    advancedToneModes?: boolean;
    structuredDealContext?: boolean;
  };
};

type BillingSyncEntitlementResponse = {
  ok: boolean;
  status: string;
  usage?: UsageSnapshot;
};

export function derivePlanTier(usage: UsageSnapshot | null): "free" | "starter" | "pro" {
  if (usage?.entitlements?.advancedToneModes) return "pro";
  if (usage?.limit === -1) return "starter";
  return "free";
}

/**
 * After Polar redirect, confirm entitlement sync has caught up (bounded client checks only).
 */
export function planReflectsPostCheckoutSuccess(
  usage: UsageSnapshot | null,
  upgrade: "starter_success" | "pro_success"
): boolean {
  const tier = derivePlanTier(usage);
  if (tier === "free") return false;
  if (upgrade === "starter_success") return tier === "starter" || tier === "pro";
  return tier === "pro";
}

/** For UI copy only: Starter/Pro when billing snapshot supports it; otherwise neutral messaging. */
export type PlanMessagingTier = "starter" | "pro" | "unknown";

export function planMessagingFromUsage(usage: UsageSnapshot | null): PlanMessagingTier {
  if (usage == null) return "unknown";
  const tier = derivePlanTier(usage);
  if (tier === "starter") return "starter";
  if (tier === "pro") return "pro";
  return "unknown";
}

export async function fetchUsageSnapshot(token: string): Promise<UsageSnapshot | null> {
  try {
    const res = await fetch(`${API_URL}/api/billing/sync-entitlement`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as BillingSyncEntitlementResponse;
    return body.usage ?? null;
  } catch {
    return null;
  }
}
