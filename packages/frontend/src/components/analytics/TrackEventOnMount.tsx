"use client";

import { useEffect } from "react";
import { trackEvent, type TrackEventPayload } from "@/lib/trackEvent";

export function TrackEventOnMount({
  eventName,
  planType,
  surface,
  metadata,
  /** When set with `pricing_page_view`, adds metadata.entry_source from the current URL (avoids useSearchParams on /pricing). */
  pricingEntrySourceClassification,
}: {
  eventName: TrackEventPayload["eventName"];
  planType?: string | null;
  surface?: string | null;
  metadata?: Record<string, unknown>;
  pricingEntrySourceClassification?: boolean;
}) {
  useEffect(() => {
    const pathname = window.location.pathname;
    const base: Record<string, unknown> = { route: pathname, ...(metadata ?? {}) };
    if (pricingEntrySourceClassification && eventName === "pricing_page_view") {
      try {
        const checkout = new URLSearchParams(window.location.search).get("checkout");
        base.entry_source =
          checkout === "canceled" ? "checkout_return" : "direct";
      } catch {
        base.entry_source = "direct";
      }
    }
    trackEvent({
      eventName,
      planType: planType ?? null,
      surface: surface ?? "pricing",
      metadata: base,
    });
    // mount-only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

