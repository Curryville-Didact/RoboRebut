"use client";

import type { ReactNode } from "react";
import { trackEvent, type TrackEventPayload } from "@/lib/trackEvent";
import { getProCheckoutHref } from "@/lib/checkoutLinks";
import { createClient } from "@/lib/supabase/client";

type Props = {
  children: ReactNode;
  className?: string;
  /** Polar portal `return_url` (absolute). Defaults to current origin + path. */
  portalReturnUrl?: string;
  event: Omit<TrackEventPayload, "timestamp">;
};

/**
 * Pro CTA: anonymous users → checkout session; Starter subscribers → Polar customer portal (upgrade);
 * Pro → no-op. Same-tab navigation (no `window.open`) so Safari does not block popups after async work.
 */
export function SmartProCheckoutLink({
  children,
  className,
  portalReturnUrl: portalReturnUrlProp,
  event,
}: Props) {
  const checkoutHref = getProCheckoutHref();

  return (
    <a
      href={checkoutHref}
      className={className}
      onClick={async (e) => {
        e.preventDefault();
        if (process.env.NODE_ENV === "development") {
          console.log("Pro CTA clicked");
        }
        trackEvent(event);
        try {
          const { resolveProBillingDestination } = await import("@/lib/resolveProBillingDestination");
          const supabase = createClient();
          const { data } = await supabase.auth.getSession();
          const token = data.session?.access_token ?? null;
          const portalReturn =
            portalReturnUrlProp ??
            (typeof window !== "undefined" ? `${window.location.origin}${window.location.pathname}` : "");
          const resolved = await resolveProBillingDestination({
            accessToken: token,
            checkoutFallbackUrl: checkoutHref,
            portalReturnUrl: portalReturn || checkoutHref,
          });
          if (process.env.NODE_ENV === "development") {
            console.log("resolved destination:", resolved.kind === "noop" ? "noop" : resolved.url);
          }
          if (resolved.kind === "noop") return;
          window.location.assign(resolved.url);
        } catch (err) {
          console.error("[ProCTA] error — falling back to checkout URL", err);
          window.location.assign(checkoutHref);
        }
      }}
    >
      {children}
    </a>
  );
}
