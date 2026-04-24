"use client";

import type { ReactNode } from "react";
import { trackEvent, type TrackEventPayload } from "@/lib/trackEvent";

export function TrackedExternalLink({
  href,
  event,
  children,
  className,
  target = "_blank",
}: {
  href: string;
  event: Omit<TrackEventPayload, "timestamp">;
  children: ReactNode;
  className?: string;
  target?: string;
}) {
  return (
    <a
      href={href}
      target={target}
      rel="noopener noreferrer"
      className={className}
      onClick={(e) => {
        e.preventDefault();
        trackEvent(event);
        window.open(href, target, "noopener,noreferrer");
      }}
    >
      {children}
    </a>
  );
}
