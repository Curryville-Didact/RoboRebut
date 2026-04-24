"use client";

import type { MouseEvent } from "react";
import { getProCheckoutHref } from "@/lib/checkoutLinks";
import { createClient } from "@/lib/supabase/client";
import { resolveProBillingDestination } from "@/lib/resolveProBillingDestination";
import { usePathname, useSearchParams } from "next/navigation";

type Props = {
  visible: boolean;
  title?: string;
  body?: string;
  ctaLabel?: string;
  href?: string;
  onDismiss?: () => void;
  onClick?: () => void;
  compact?: boolean;
};

/**
 * Conversion nudge — assistive only (no modal). Shown on high-intent behavior.
 */
export function UpgradeNudge({
  visible,
  title = "This is where most deals are lost",
  body = "Rebut AI is built to respond instantly when it matters.",
  ctaLabel = "Upgrade to Pro",
  href,
  onDismiss,
  onClick,
  compact = false,
}: Props) {
  if (!visible) return null;

  const pathname = usePathname();
  const searchParams = useSearchParams();
  const returnTo = `${pathname}${searchParams?.toString() ? `?${searchParams.toString()}` : ""}`;
  const resolvedHref = href ?? getProCheckoutHref(returnTo);

  if (process.env.NODE_ENV === "development") {
    // eslint-disable-next-line no-console
    console.debug("[checkout] UpgradeNudge href", { returnTo, href: resolvedHref });
  }

  async function handleCtaClick(e: MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    onClick?.();
    const supabase = createClient();
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token ?? null;
    const portalReturnUrl =
      typeof window !== "undefined"
        ? `${window.location.origin}${pathname}${searchParams?.toString() ? `?${searchParams.toString()}` : ""}`
        : resolvedHref;
    const resolved = await resolveProBillingDestination({
      accessToken: token,
      checkoutFallbackUrl: resolvedHref,
      portalReturnUrl,
    });
    if (resolved.kind === "noop") return;
    window.location.assign(resolved.url);
  }

  return (
    <div className="rounded-lg border border-emerald-500/35 bg-black/55 px-3 py-2.5 shadow-sm shadow-emerald-950/20">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs leading-relaxed text-gray-200">{title}</p>
          <p className="mt-1 text-xs leading-relaxed text-gray-400">{body}</p>
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="text-[11px] text-gray-500 transition hover:text-white"
          >
            Dismiss
          </button>
        )}
      </div>
      <a
        href={resolvedHref}
        onClick={(e) => void handleCtaClick(e)}
        className={`mt-2 inline-flex rounded-md border border-emerald-500/45 bg-emerald-600/15 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-100 transition hover:bg-emerald-600/25 ${
          compact ? "" : ""
        }`}
      >
        {ctaLabel}
      </a>
    </div>
  );
}
