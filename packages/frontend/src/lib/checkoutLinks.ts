import { API_URL } from "@/lib/env";

/**
 * Checkout entrypoints hit the backend, which creates a Polar **checkout session** via
 * `POST https://api.polar.sh/v1/checkouts/` with `success_url`, `return_url`, and catalog
 * product UUIDs. Static `buy.polar.sh/polar_cl_…` URLs do **not** honor app-supplied
 * success/return query params — those fields must be sent on session creation (see Polar API).
 *
 * Backend route: GET `/api/billing/checkout/redirect?plan=starter|pro`
 * → 302 → Polar-hosted `checkout.url` with back button → `return_url`, success → `success_url`.
 * Starter → Pro upgrades use POST `/api/billing/customer-portal/session` (see `resolveProBillingDestination`).
 *
 * `_returnTo` remains for backward-compatible call sites; redirects are fixed server-side.
 */
export function getProCheckoutHref(_returnTo?: string | null): string {
  void _returnTo;
  return `${API_URL}/api/billing/checkout/redirect?plan=pro`;
}

export function getStarterCheckoutHref(_returnTo?: string | null): string {
  void _returnTo;
  return `${API_URL}/api/billing/checkout/redirect?plan=starter`;
}
