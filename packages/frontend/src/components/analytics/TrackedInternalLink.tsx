"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { trackEvent, type TrackEventPayload } from "@/lib/trackEvent";

export function TrackedInternalLink({
  href,
  event,
  children,
  className,
}: {
  href: string;
  event: Omit<TrackEventPayload, "timestamp">;
  children: ReactNode;
  className?: string;
}) {
  const router = useRouter();
  return (
    <a
      href={href}
      className={className}
      onClick={(e) => {
        e.preventDefault();
        trackEvent(event);
        router.push(href);
      }}
    >
      {children}
    </a>
  );
}
