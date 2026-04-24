"use client";

import { API_URL } from "@/lib/env";

export type ProBillingResolution =
  | { kind: "checkout"; url: string }
  | { kind: "portal"; url: string }
  | { kind: "noop"; reason: "already_pro" };

type SyncEntitlementBody = {
  ok: boolean;
  status: string;
  planType?: string | null;
};

const DBG = process.env.NODE_ENV === "development";

/**
 * Resolves where a logged-in user should go for Pro acquisition:
 * - **free** (or unknown): new Polar checkout
 * - **starter**: Polar **customer portal** (plan change / upgrade) — avoids duplicate-subscription checkout validation errors
 * - **pro**: no redirect
 */
export async function resolveProBillingDestination(input: {
  accessToken: string | null;
  checkoutFallbackUrl: string;
  /** Absolute URL for Polar portal back button (`return_url`). */
  portalReturnUrl: string;
}): Promise<ProBillingResolution> {
  const { accessToken, checkoutFallbackUrl, portalReturnUrl } = input;

  try {
    if (!accessToken) {
      if (DBG) console.log("[ProBilling] decision: checkout — no Supabase session token");
      return { kind: "checkout", url: checkoutFallbackUrl };
    }

    let syncRes: Response;
    try {
      syncRes = await fetch(`${API_URL}/api/billing/sync-entitlement`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } catch (err) {
      console.error("[ProBilling] sync-entitlement fetch failed (network/CORS):", err);
      return { kind: "checkout", url: checkoutFallbackUrl };
    }

    const syncRaw = await syncRes.text();
    if (!syncRes.ok) {
      if (DBG) {
        console.warn("[ProBilling] sync HTTP error:", syncRes.status, syncRaw.slice(0, 400));
      }
      console.log("[ProBilling] decision: checkout — sync-entitlement HTTP not OK");
      return { kind: "checkout", url: checkoutFallbackUrl };
    }

    let syncBody: SyncEntitlementBody;
    try {
      syncBody = JSON.parse(syncRaw) as SyncEntitlementBody;
    } catch (err) {
      console.error("[ProBilling] sync-entitlement JSON parse failed:", err);
      return { kind: "checkout", url: checkoutFallbackUrl };
    }

    const pt = (syncBody.planType ?? "").toLowerCase();
    if (DBG) {
      console.log("[ProBilling] user plan_type:", syncBody.planType ?? "(null)");
      console.log("[ProBilling] sync HTTP:", syncRes.status, "body.ok:", syncBody.ok, "status:", syncBody.status);
    }

    if (pt === "pro") {
      if (DBG) console.log("[ProBilling] decision: noop — already Pro");
      return { kind: "noop", reason: "already_pro" };
    }
    if (pt !== "starter") {
      if (DBG) console.log('[ProBilling] decision: checkout — plan is not "starter":', pt || "(empty)");
      return { kind: "checkout", url: checkoutFallbackUrl };
    }

    let portalRes: Response;
    try {
      portalRes = await fetch(`${API_URL}/api/billing/customer-portal/session`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ return_url: portalReturnUrl }),
      });
    } catch (err) {
      console.error("[ProBilling] customer-portal/session fetch failed (network/CORS):", err);
      return { kind: "checkout", url: checkoutFallbackUrl };
    }

    const portalRaw = await portalRes.text();
    if (!portalRes.ok) {
      if (DBG) {
        console.warn(
          "[ProBilling] portal POST failed HTTP",
          portalRes.status,
          "— falling back to checkout. Body:",
          portalRaw.slice(0, 500)
        );
      }
      console.log("[ProBilling] decision: checkout — portal session failed or rejected");
      return { kind: "checkout", url: checkoutFallbackUrl };
    }

    let portalJson: { url?: string };
    try {
      portalJson = JSON.parse(portalRaw) as { url?: string };
    } catch (err) {
      console.error("[ProBilling] portal response JSON parse failed:", err);
      return { kind: "checkout", url: checkoutFallbackUrl };
    }

    if (!portalJson.url) {
      if (DBG) console.warn("[ProBilling] portal JSON missing url — checkout fallback");
      return { kind: "checkout", url: checkoutFallbackUrl };
    }

    if (DBG) {
      console.log("[ProBilling] decision: portal — POST /api/billing/customer-portal/session OK");
      console.log("[ProBilling] resolved destination:", portalJson.url);
    }
    return { kind: "portal", url: portalJson.url };
  } catch (err) {
    console.error("[ProBilling] unexpected error:", err);
    return { kind: "checkout", url: checkoutFallbackUrl };
  }
}

/** Same-tab navigation for Pro acquisition (avoids Safari popup blocking after async session fetch). */
export async function navigateProBillingSameTab(input: {
  getAccessToken: () => Promise<string | null>;
  checkoutFallbackUrl: string;
  portalReturnUrl: string;
}): Promise<ProBillingResolution> {
  const token = await input.getAccessToken();
  const resolved = await resolveProBillingDestination({
    accessToken: token,
    checkoutFallbackUrl: input.checkoutFallbackUrl,
    portalReturnUrl: input.portalReturnUrl,
  });
  if (resolved.kind === "noop") return resolved;
  window.location.assign(resolved.url);
  return resolved;
}
