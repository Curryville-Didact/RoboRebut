import { getProCheckoutHref, getStarterCheckoutHref } from "@/lib/checkoutLinks";

type UsageLike = {
  used?: number;
  limit?: number;
  remaining?: number;
  blocked?: boolean;
  entitlements?: {
    advancedToneModes?: boolean;
  };
};

export type MonetizationUiState =
  | { kind: "paid_or_unlimited" }
  | {
      kind: "normal" | "nearing_limit" | "limit_reached";
      used: number;
      limit: number;
      remaining: number;
      progressPct: number;
    };

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

export function resolveMonetizationUiState(
  usage: UsageLike | null | undefined
): MonetizationUiState | null {
  if (!usage) return null;

  const limitRaw = Number(usage.limit);
  const usedRaw = Number(usage.used);
  const remainingRaw = Number(usage.remaining);
  const blocked = usage.blocked === true;

  // Unlimited plans: existing payload uses limit < 0 (and remaining -1).
  if (Number.isFinite(limitRaw) && limitRaw < 0) return { kind: "paid_or_unlimited" };

  const limit = clampInt(limitRaw, 0, 1_000_000);
  const used = clampInt(usedRaw, 0, 1_000_000);
  const remaining = clampInt(
    Number.isFinite(remainingRaw) ? remainingRaw : Math.max(0, limit - used),
    0,
    1_000_000
  );

  const progressPct =
    limit > 0 ? clampPct((used / Math.max(limit, 1)) * 100) : clampPct(blocked ? 100 : 0);

  if (blocked || used >= limit) {
    return { kind: "limit_reached", used, limit, remaining: 0, progressPct: 100 };
  }

  if (remaining <= 3) {
    return { kind: "nearing_limit", used, limit, remaining, progressPct };
  }

  return { kind: "normal", used, limit, remaining, progressPct };
}

export function resolveConversationCtaLinks(input: {
  returnTo: string;
}): {
  starterUpgradeHref: string;
  proUpgradeHref: string;
  comparePlansHref: string;
} {
  return {
    starterUpgradeHref: getStarterCheckoutHref(input.returnTo),
    proUpgradeHref: getProCheckoutHref(input.returnTo),
    comparePlansHref: "/pricing",
  };
}

