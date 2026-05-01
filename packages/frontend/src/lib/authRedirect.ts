/**
 * Canonical production origin for auth redirects when context is not clearly
 * local development (avoids localhost leaking into Supabase email links when
 * NEXT_PUBLIC_SITE_URL is mis-set).
 */
export const PRODUCTION_APP_ORIGIN = "https://app.getrebut.ai";

function isLocalDevOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

function isProductionAppHost(hostname: string): boolean {
  return hostname === "app.getrebut.ai";
}

/**
 * Supabase `emailRedirectTo` / `redirectTo` (signUp, forgot password).
 * — Browser on localhost: use current origin + `/auth/callback`.
 * — Browser elsewhere: force production callback URL.
 * — Server / no window: production (these calls run in the browser today).
 */
export function getAuthCallbackURL(options?: { flow?: "recovery" }): string {
  let base: string;
  if (typeof window !== "undefined") {
    const origin = window.location.origin;
    base = isLocalDevOrigin(origin) ? origin : PRODUCTION_APP_ORIGIN;
  } else {
    base = PRODUCTION_APP_ORIGIN;
  }

  let url: URL;
  try {
    url = new URL("/auth/callback", base);
  } catch {
    url = new URL("/auth/callback", PRODUCTION_APP_ORIGIN);
  }
  if (options?.flow === "recovery") {
    url.searchParams.set("flow", "recovery");
  }
  return url.toString();
}

/**
 * Route Handler redirects: use request origin only for local dev or app.getrebut.ai;
 * otherwise default to production (no localhost on prod confirmation links).
 */
export function getRedirectOriginFromRequest(requestUrl: string): string {
  let origin: string;
  try {
    origin = new URL(requestUrl).origin;
  } catch {
    return PRODUCTION_APP_ORIGIN;
  }
  if (isLocalDevOrigin(origin)) return origin;
  try {
    const host = new URL(requestUrl).hostname;
    if (isProductionAppHost(host)) return origin;
  } catch {
    /* fall through */
  }
  return PRODUCTION_APP_ORIGIN;
}
