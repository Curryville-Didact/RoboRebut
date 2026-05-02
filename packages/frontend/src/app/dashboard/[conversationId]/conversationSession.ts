import { createClient } from "@/lib/supabase/client";
import { API_URL } from "@/lib/env";
import type { BillingSyncEntitlementResponse, UsageSnapshot } from "./conversationHelpers";

export const SESSION_MAX_ATTEMPTS = 5;
export const SESSION_RETRY_DELAY_MS = 200;
export const SESSION_VARIANTS_SEEN_PREFIX = "upgrade_nudge_seen_variants_";
export const USE_WS_LIVE = true;

export function getDismissKey(type: "tone" | "variants" | "post_gen"): string {
  return `upgrade_nudge_dismissed_${type}`;
}

export function readDismissed(type: "tone" | "variants" | "post_gen"): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(getDismissKey(type)) === "true";
}

export function writeDismissed(type: "tone" | "variants" | "post_gen"): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(getDismissKey(type), "true");
}

export function hasSeenVariantNudgeThisSession(conversationId: string): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.sessionStorage.getItem(
      `${SESSION_VARIANTS_SEEN_PREFIX}${conversationId}`
    ) === "true"
  );
}

export function markVariantNudgeSeenThisSession(conversationId: string): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(
    `${SESSION_VARIANTS_SEEN_PREFIX}${conversationId}`,
    "true"
  );
}

export function derivePlanType(usage: UsageSnapshot | null): "free" | "starter" | "pro" {
  if (usage?.entitlements?.advancedToneModes) return "pro";
  if (usage?.limit === -1) return "starter";
  return "free";
}

export const RR_ENFORCEMENT_HITS_KEY = "rr_enforcement_hits";

/** Increments session enforcement counter; safe default → 1 (low tier) if storage unavailable. */
export function bumpEnforcementHits(): number {
  try {
    const raw = sessionStorage.getItem(RR_ENFORCEMENT_HITS_KEY);
    const prev = Number(raw ?? 0);
    const base = Number.isFinite(prev) ? prev : 0;
    const next = base + 1;
    sessionStorage.setItem(RR_ENFORCEMENT_HITS_KEY, String(next));
    return next;
  } catch {
    return 1;
  }
}

export function resetEnforcementHits(): void {
  try {
    sessionStorage.removeItem(RR_ENFORCEMENT_HITS_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Single source of truth for DealContextPanel (must match backend Pro gate when payload is complete).
 * Some usage snapshots omit `structuredDealContext` after refresh or message round-trip; Pro is then
 * inferred from `advancedToneModes` only when the flag is absent (not when explicitly false).
 */
export function structuredDealContextEnabledFromUsage(
  usage: UsageSnapshot | null
): boolean {
  const e = usage?.entitlements;
  if (!e) return false;
  if (e.structuredDealContext === true) return true;
  if (e.structuredDealContext === false) return false;
  return e.advancedToneModes === true;
}

export async function waitForSessionAccessToken(): Promise<string | null> {
  const supabase = createClient();
  for (let attempt = 1; attempt <= SESSION_MAX_ATTEMPTS; attempt++) {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token ?? null;
    if (token) return token;
    if (attempt < SESSION_MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, SESSION_RETRY_DELAY_MS));
    }
  }
  return null;
}

export async function syncEntitlement(token: string): Promise<UsageSnapshot | null> {
  try {
    const res = await fetch(`${API_URL}/api/billing/sync-entitlement`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = (await res.json()) as BillingSyncEntitlementResponse;
    if (body.status === "unauthenticated") return null;
    if (body.status === "billing_not_configured") return body.usage ?? null;
    if (body.status === "provider_not_ready") return body.usage ?? null;
    if (!res.ok || body.status === "error" || body.status === "profile_not_found") {
      return body.usage ?? null;
    }
    return body.usage ?? null;
  } catch {
    return null;
  }
}
