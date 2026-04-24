import type { ReactNode } from "react";
import { RebutBrandLogo } from "@/components/brand/RebutBrandLogo";
import { TrackedExternalLink } from "@/components/analytics/TrackedLink";

export type PlanCardProps = {
  title: string;
  price: string;
  priceMode?: "public" | "custom";
  subtitle?: string;
  badge?: string;
  brand?: "starter" | "pro";
  positioning: string;
  bullets: string[];
  driver: string;
  reinforcement?: string;
  cta: string;
  ctaSubtext: string;
  href: string;
  /** When set, replaces the default checkout external link (e.g. Starter→Pro portal routing). */
  ctaAs?: ReactNode;
  emphasized?: boolean;
};

export function PlanCard({
  title,
  price,
  priceMode = "public",
  subtitle,
  badge,
  brand,
  positioning,
  bullets,
  driver,
  reinforcement,
  cta,
  ctaSubtext,
  href,
  ctaAs,
  emphasized = false,
}: PlanCardProps) {
  const isCustomPricing = priceMode === "custom";

  return (
    <div
      className={`flex h-full flex-col rounded-2xl border p-6 ${
        emphasized
          ? "border-emerald-500/45 bg-emerald-950/25 shadow-[0_0_40px_rgba(16,185,129,0.08)]"
          : "border-white/12 bg-white/[0.03]"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          {brand ? (
            <div className="mt-0.5 shrink-0 opacity-[0.92]">
              <RebutBrandLogo variant={brand} className="h-11 w-11" />
            </div>
          ) : null}
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-semibold text-white">{title}</h2>
            {isCustomPricing ? (
              <div className="mt-3 rounded-xl border border-white/10 bg-black/25 px-3 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-400/80">
                  Enterprise
                </p>
                <p className="mt-1 text-2xl font-semibold tracking-tight text-white sm:text-[1.65rem]">
                  {price}
                </p>
                {subtitle && (
                  <p className="mt-2 text-sm leading-snug text-gray-400">{subtitle}</p>
                )}
              </div>
            ) : (
              <>
                <p className="mt-2 text-3xl font-bold text-white">{price}</p>
                {subtitle && <p className="mt-1 text-sm text-gray-500">{subtitle}</p>}
              </>
            )}
          </div>
        </div>
        {badge && (
          <span className="rounded-full border border-emerald-500/50 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-200">
            {badge}
          </span>
        )}
      </div>

      <p className="mt-4 text-sm font-medium text-gray-200">{positioning}</p>

      <ul className="mt-4 space-y-2 text-sm text-gray-300">
        {bullets.map((bullet) => (
          <li key={bullet} className="flex gap-2">
            <span className="text-emerald-500">✓</span>
            <span>{bullet}</span>
          </li>
        ))}
      </ul>

      <div className="mt-5 rounded-xl border border-white/10 bg-black/30 p-3">
        <p className="text-sm font-medium text-white">{driver}</p>
        {reinforcement && <p className="mt-2 text-sm text-gray-400">{reinforcement}</p>}
      </div>

      {ctaAs ?? (
        <TrackedExternalLink
          href={href}
          event={{
            eventName:
              title === "Starter"
                ? "pricing_starter_click"
                : title === "Pro"
                  ? "pricing_pro_click"
                  : "pricing_team_demo_click",
            planType:
              title === "Starter"
                ? "starter"
                : title === "Pro"
                  ? "pro"
                  : "team",
            surface: "pricing",
            ctaLabel: cta,
            metadata: { route: "/pricing" },
          }}
          className={`mt-6 inline-flex items-center justify-center rounded-lg border px-4 py-3 text-sm font-semibold transition ${
            emphasized
              ? "border-emerald-500/60 bg-emerald-600/25 text-emerald-50 hover:bg-emerald-600/35"
              : "border-white/20 bg-white/8 text-white hover:bg-white/12"
          }`}
        >
          {cta}
        </TrackedExternalLink>
      )}
      <p className="mt-2 text-center text-xs text-gray-500">{ctaSubtext}</p>
    </div>
  );
}
