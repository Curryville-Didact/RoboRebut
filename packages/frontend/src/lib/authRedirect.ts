/**
 * Parse NEXT_PUBLIC_SITE_URL into an origin. Invalid values must not throw — a bad URL here
 * breaks `new URL(path, base)` in auth helpers and can surface as a 500 on auth-related routes.
 */
function configuredSiteOrigin(): string | null {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!configured) return null;
  try {
    const withProto = configured.includes("://") ? configured : `https://${configured}`;
    return new URL(withProto).origin;
  } catch {
    return null;
  }
}

export function getAppOrigin(): string {
  const fromEnv = configuredSiteOrigin();
  if (fromEnv) return fromEnv;

  if (typeof window !== "undefined" && window.location.origin) {
    return window.location.origin;
  }

  return "http://localhost:3000";
}

export function getAuthCallbackURL(options?: { flow?: "recovery" }): string {
  let url: URL;
  try {
    url = new URL("/auth/callback", getAppOrigin());
  } catch {
    url = new URL("/auth/callback", "http://localhost:3000");
  }
  if (options?.flow === "recovery") {
    url.searchParams.set("flow", "recovery");
  }
  return url.toString();
}
