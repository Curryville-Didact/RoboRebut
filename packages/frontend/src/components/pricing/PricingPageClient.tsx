"use client";

import { useEffect, useState } from "react";
import { TrackEventOnMount } from "@/components/analytics/TrackEventOnMount";
import { TrackedExternalLink } from "@/components/analytics/TrackedLink";
import { TrackedInternalLink } from "@/components/analytics/TrackedInternalLink";
import { SmartProCheckoutLink } from "@/components/billing/SmartProCheckoutLink";
import { PricingCanceledNotice } from "@/components/pricing/PricingCanceledNotice";
import { PlanCard } from "@/components/pricing/PlanCard";
import { MONETIZATION_LINKS } from "@/lib/monetizationLinks";
import { getProCheckoutHref } from "@/lib/checkoutLinks";
import { getStarterCheckoutHref } from "@/lib/checkoutLinks";
import { API_URL } from "@/lib/env";
import { createClient } from "@/lib/supabase/client";
import { derivePlanTier, fetchUsageSnapshot } from "@/lib/usageBilling";

type PlanTier = "free" | "starter" | "pro";

function CtaPlaceholder() {
  return (
    <div
      className="mt-6 flex h-[46px] w-full items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-xs text-gray-500"
      aria-busy="true"
    >
      Checking your plan…
    </div>
  );
}

function FooterCtaPlaceholder() {
  return (
    <div className="inline-flex h-[46px] min-w-[168px] items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] px-4 text-xs text-gray-500">
      Checking plan…
    </div>
  );
}

function CurrentPlanCta({ emphasized }: { emphasized?: boolean }) {
  return (
    <div
      className={`mt-6 inline-flex w-full cursor-default items-center justify-center rounded-lg border px-4 py-3 text-sm font-semibold ${
        emphasized
          ? "border-emerald-500/60 bg-emerald-950/40 text-emerald-100"
          : "border-white/20 bg-white/[0.06] text-emerald-100/90"
      }`}
      role="status"
    >
      Current Plan
    </div>
  );
}

function StarterUnavailableOnProCard() {
  return (
    <div className="mt-6 rounded-lg border border-white/15 bg-black/35 px-4 py-3 text-center" role="status">
      <p className="text-sm font-medium text-gray-300">Already included in Pro</p>
      <p className="mt-1 text-xs text-gray-500">Starter is below your current tier.</p>
    </div>
  );
}

function ManageBillingButton() {
  const [busy, setBusy] = useState(false);

  async function openPortal() {
    if (busy) return;
    setBusy(true);
    try {
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        setBusy(false);
        return;
      }
      const returnUrl =
        typeof window !== "undefined" ? `${window.location.origin}/pricing` : "";
      const res = await fetch(`${API_URL}/api/billing/customer-portal/session`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ return_url: returnUrl }),
      });
      if (!res.ok) {
        console.error("[pricing] customer portal session failed", await res.text());
        setBusy(false);
        return;
      }
      const body = (await res.json()) as { url?: string };
      if (body.url) window.location.assign(body.url);
      else setBusy(false);
    } catch (err) {
      console.error("[pricing] manage billing", err);
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void openPortal()}
      disabled={busy}
      className="rounded-lg border border-white/20 bg-white/8 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/12 disabled:opacity-60"
    >
      {busy ? "Opening…" : "Manage Billing"}
    </button>
  );
}

function CurrentPlanBadge({ tier }: { tier: PlanTier }) {
  const label =
    tier === "free"
      ? "Current plan: Free"
      : tier === "starter"
        ? "Current plan: Starter"
        : "Current plan: Pro";
  return (
    <span className="rounded-full border border-white/15 bg-white/[0.06] px-3 py-1 text-xs font-medium text-gray-300">
      {label}
    </span>
  );
}

export function PricingPageClient() {
  const [planTier, setPlanTier] = useState<PlanTier | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token ?? null;
      if (!token) {
        if (!cancelled) setPlanTier("free");
        return;
      }
      const usage = await fetchUsageSnapshot(token);
      if (cancelled) return;
      setPlanTier(derivePlanTier(usage));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loading = planTier === null;

  const starterCardCta = loading
    ? <CtaPlaceholder />
    : planTier === "free"
      ? undefined
      : planTier === "starter"
        ? <CurrentPlanCta />
        : <StarterUnavailableOnProCard />;

  const proCardCta = loading
    ? <CtaPlaceholder />
    : planTier === "free"
      ? (
          <SmartProCheckoutLink
            portalReturnUrl={
              typeof window !== "undefined" ? `${window.location.origin}/pricing` : undefined
            }
            event={{
              eventName: "pricing_pro_click",
              planType: "pro",
              surface: "pricing",
              ctaLabel: "Start Pro Plan",
              metadata: { route: "/pricing" },
            }}
            className="mt-6 inline-flex w-full items-center justify-center rounded-lg border border-emerald-500/60 bg-emerald-600/25 px-4 py-3 text-sm font-semibold text-emerald-50 transition hover:bg-emerald-600/35"
          >
            Start Pro Plan
          </SmartProCheckoutLink>
        )
      : planTier === "starter"
        ? (
            <SmartProCheckoutLink
              portalReturnUrl={
                typeof window !== "undefined" ? `${window.location.origin}/pricing` : undefined
              }
              event={{
                eventName: "pricing_pro_click",
                planType: "pro",
                surface: "pricing",
                ctaLabel: "Upgrade to Pro",
                metadata: { route: "/pricing" },
              }}
              className="mt-6 inline-flex w-full items-center justify-center rounded-lg border border-emerald-500/60 bg-emerald-600/25 px-4 py-3 text-sm font-semibold text-emerald-50 transition hover:bg-emerald-600/35"
            >
              Upgrade to Pro
            </SmartProCheckoutLink>
          )
        : <CurrentPlanCta emphasized />;

  return (
    <div className="min-h-screen bg-black px-4 py-12 text-white">
      <div className="mx-auto max-w-6xl space-y-16">
        <TrackEventOnMount
          eventName="pricing_page_view"
          surface="pricing"
          pricingEntrySourceClassification
        />
        <PricingCanceledNotice />
        <div className="flex flex-wrap items-center justify-between gap-4">
          <a href="/" className="text-sm text-gray-500 underline hover:text-white">
            ← Back
          </a>
          <div className="flex flex-wrap items-center justify-end gap-3">
            {!loading && planTier !== "free" ? <ManageBillingButton /> : null}
            <div className="text-xs uppercase tracking-[0.18em] text-gray-500">
              RoboRebut Pricing
            </div>
          </div>
        </div>

        <section className="text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-400/80">
            Live Objection Handling
          </p>
          <h1 className="mx-auto mt-4 max-w-4xl text-4xl font-bold tracking-tight sm:text-5xl">
            Close the deal while the objection is happening.
          </h1>
          <p className="mx-auto mt-4 max-w-3xl text-base text-gray-300 sm:text-lg">
            RoboRebut gives you the exact words to say in real time — so you stop hesitating and
            start closing.
          </p>
          <p className="mt-4 text-sm text-emerald-200/85">
            Built for working capital brokers, merchant service reps, and high-volume sales teams.
          </p>
          <p className="mt-2 text-sm text-gray-500">
            You’ve already seen how it works. Now choose how you want to use it.
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            {loading ? (
              <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-gray-500">
                Checking your plan…
              </span>
            ) : (
              <CurrentPlanBadge tier={planTier} />
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-amber-500/30 bg-amber-950/10 px-5 py-4 text-center">
          <h2 className="text-lg font-semibold text-amber-100">
            The objection does not wait for you to think.
          </h2>
          <p className="mt-2 text-sm text-gray-300">
            When the prospect pushes back, hesitation costs more than software.
          </p>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-3 text-center">
          <p className="text-sm text-gray-400">
            Need to get back? Checkout back controls may return to the demo flow. Your browser back
            button will return you here.
          </p>
        </section>

        <section className="grid gap-6 lg:grid-cols-3">
          <PlanCard
            title="Starter"
            brand="starter"
            price="$49.99/month"
            positioning="For reps getting consistent on objections"
            bullets={[
              "Use RoboRebut during real sales conversations",
              "Structured responses for common objections",
              "Build confidence without second-guessing",
            ]}
            driver="Stop freezing when the prospect pushes back."
            cta="Start Starter Plan"
            ctaSubtext="Use it on your next call in minutes"
            href={getStarterCheckoutHref("/pricing")}
            ctaAs={starterCardCta}
          />

          <PlanCard
            title="Pro"
            brand="pro"
            price="$97/month"
            badge="Most Popular"
            positioning="For closers who deal with objections daily"
            bullets={[
              "Faster, sharper responses under pressure",
              "Multiple rebuttal angles per objection",
              "Built for live call usage — not practice",
            ]}
            driver="This is where deals are either won or lost — in the moment."
            reinforcement="RoboRebut responds instantly when it matters most."
            cta="Start Pro Plan"
            ctaSubtext="Built for real conversations, not theory"
            href={getProCheckoutHref("/pricing")}
            ctaAs={proCardCta}
            emphasized
          />

          <PlanCard
            title="Teams"
            price="Custom pricing"
            priceMode="custom"
            subtitle="Custom rollout for sales teams"
            positioning="Higher-touch rollout for teams that need consistency at scale."
            bullets={[
              "Standardize objection handling across reps",
              "Shared workflows and coaching consistency",
              "Team rollout support and implementation guidance",
              "Best for offices and multi-rep sales teams",
            ]}
            driver="Your team shouldn’t “figure it out” mid-call."
            reinforcement="We scope rollout, training, and ongoing alignment with how your office sells."
            cta="Book Team Demo"
            ctaSubtext="Talk to sales — we’ll align on scope and next steps"
            href={MONETIZATION_LINKS.teamDemo}
          />
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-400/70">
              Live Call Moment
            </p>
            <h2 className="mt-3 text-2xl font-semibold text-white">
              Use this on the next objection you hear.
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-gray-300">
              RoboRebut is built for the exact moment the prospect pushes back — not after the
              call, not in training, not later.
            </p>

            <div className="mt-6 rounded-2xl border border-emerald-500/25 bg-black/50 p-4">
              <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.18em] text-emerald-400/70">
                    Live Call Moment
                  </p>
                  <p className="mt-1 text-sm font-medium text-white">
                    Merchant says: &quot;The payment feels too heavy right now.&quot;
                  </p>
                </div>
                <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-200">
                  Use This On Call
                </span>
              </div>
              <div className="mt-4 space-y-3">
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <p className="text-xs text-gray-500">Pattern Intelligence</p>
                  <p className="mt-2 text-sm text-gray-200">
                    Reframes cost into manageable terms and redirects with a control question.
                  </p>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <p className="text-xs text-gray-500">Response</p>
                  <p className="mt-2 text-sm leading-relaxed text-white">
                    If the structure keeps cash moving and revenue stable, the payment should feel
                    like leverage, not drag. What matters more right now: keeping cash flexible or
                    staying stuck without a move?
                  </p>
                </div>
                <p className="text-xs text-gray-500">Built for real objections, not theory.</p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-emerald-500/25 bg-emerald-950/15 p-6">
            <h2 className="text-2xl font-semibold text-white">One saved deal pays for this many times over.</h2>
            <p className="mt-3 text-sm leading-relaxed text-gray-300">
              RoboRebut is not another software expense. It is a live-call objection handling tool
              built to help reps stop losing momentum when the prospect pushes back.
            </p>
            <ul className="mt-5 space-y-3 text-sm text-gray-200">
              <li className="flex gap-2">
                <span className="text-emerald-400">•</span>
                Save one deal and the subscription can pay for itself fast
              </li>
              <li className="flex gap-2">
                <span className="text-emerald-400">•</span>
                Sharper responses increase consistency under pressure
              </li>
              <li className="flex gap-2">
                <span className="text-emerald-400">•</span>
                The cost of hesitation is usually higher than the monthly plan
              </li>
            </ul>
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
          <h2 className="text-3xl font-semibold text-white">
            Most reps don’t lose deals because of the offer.
          </h2>
          <p className="mx-auto mt-4 max-w-3xl text-base leading-relaxed text-gray-300">
            They lose them because they hesitate when the objection hits.
          </p>
          <p className="mx-auto mt-3 max-w-3xl text-base leading-relaxed text-gray-300">
            RoboRebut removes that hesitation — and replaces it with clarity in real time.
          </p>
        </section>

        <section className="rounded-2xl border border-white/10 bg-black/35 p-6">
          <h2 className="text-xl font-semibold text-white">If you’re:</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-gray-300">
              <p className="font-medium text-white">learning to handle objections</p>
              <p className="mt-2 text-emerald-300">Starter</p>
            </div>
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/15 p-4 text-sm text-gray-300">
              <p className="font-medium text-white">actively closing deals daily</p>
              <p className="mt-2 text-emerald-300">Pro</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-gray-300">
              <p className="font-medium text-white">running a team</p>
              <p className="mt-2 text-emerald-300">Teams</p>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-emerald-500/25 bg-gradient-to-b from-emerald-950/20 to-black p-8 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-400/70">
            Built for the moment deals stall
          </p>
          <h2 className="mt-3 text-3xl font-semibold text-white">
            You don’t need more leads.
            <br />
            You need better responses.
          </h2>
          <p className="mx-auto mt-4 max-w-3xl text-base leading-relaxed text-gray-300">
            The next deal you lose won’t be because of pricing. It’ll be because of what you said —
            or didn’t say — in that moment.
          </p>
          <p className="mt-4 text-lg font-medium text-emerald-200">RoboRebut fixes that.</p>

          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            {loading ? (
              <FooterCtaPlaceholder />
            ) : planTier === "free" ? (
              <TrackedExternalLink
                href={getStarterCheckoutHref("/pricing")}
                event={{
                  eventName: "pricing_starter_click",
                  planType: "starter",
                  surface: "pricing",
                  ctaLabel: "Start Starter Plan",
                  metadata: { route: "/pricing", section: "footer_cta" },
                }}
                className="inline-flex rounded-lg border border-white/20 bg-white/10 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/15"
              >
                Start Starter Plan
              </TrackedExternalLink>
            ) : planTier === "starter" ? (
              <span className="inline-flex cursor-default rounded-lg border border-emerald-500/40 bg-emerald-950/30 px-4 py-3 text-sm font-semibold text-emerald-100/95">
                Current Plan
              </span>
            ) : (
              <span
                className="inline-flex max-w-xs cursor-default rounded-lg border border-white/15 bg-white/[0.05] px-4 py-3 text-center text-sm font-medium text-gray-400"
                role="status"
              >
                Already on Pro
              </span>
            )}

            {loading ? (
              <FooterCtaPlaceholder />
            ) : planTier === "free" ? (
              <SmartProCheckoutLink
                portalReturnUrl={
                  typeof window !== "undefined" ? `${window.location.origin}/pricing` : undefined
                }
                event={{
                  eventName: "pricing_pro_click",
                  planType: "pro",
                  surface: "pricing",
                  ctaLabel: "Start Pro Plan",
                  metadata: { route: "/pricing", section: "footer_cta" },
                }}
                className="inline-flex rounded-lg border border-emerald-500/50 bg-emerald-600/25 px-4 py-3 text-sm font-semibold text-emerald-50 transition hover:bg-emerald-600/35"
              >
                Start Pro Plan
              </SmartProCheckoutLink>
            ) : planTier === "starter" ? (
              <SmartProCheckoutLink
                portalReturnUrl={
                  typeof window !== "undefined" ? `${window.location.origin}/pricing` : undefined
                }
                event={{
                  eventName: "pricing_pro_click",
                  planType: "pro",
                  surface: "pricing",
                  ctaLabel: "Upgrade to Pro",
                  metadata: { route: "/pricing", section: "footer_cta" },
                }}
                className="inline-flex rounded-lg border border-emerald-500/50 bg-emerald-600/25 px-4 py-3 text-sm font-semibold text-emerald-50 transition hover:bg-emerald-600/35"
              >
                Upgrade to Pro
              </SmartProCheckoutLink>
            ) : (
              <span className="inline-flex cursor-default rounded-lg border border-emerald-500/45 bg-emerald-950/35 px-4 py-3 text-sm font-semibold text-emerald-100">
                Current Plan
              </span>
            )}

            <TrackedExternalLink
              href={MONETIZATION_LINKS.teamDemo}
              event={{
                eventName: "pricing_team_demo_click",
                planType: "team",
                surface: "pricing",
                ctaLabel: "Book Team Demo",
                metadata: { route: "/pricing", section: "footer_cta" },
              }}
              className="inline-flex rounded-lg border border-white/20 px-4 py-3 text-sm font-semibold text-gray-200 transition hover:bg-white/10"
            >
              Book Team Demo
            </TrackedExternalLink>
          </div>

          <p className="mt-4 text-sm text-amber-200/90">Use it on your next call. Not next week.</p>
          <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <TrackedInternalLink
              href="/login"
              className="text-sm text-gray-500 underline hover:text-gray-300"
              event={{
                eventName: "pricing_signin_click",
                planType: null,
                surface: "pricing",
                ctaLabel: "Sign in",
                metadata: { route: "/pricing" },
              }}
            >
              Already have an account? Sign in
            </TrackedInternalLink>
            <a
              href="mailto:sales@getrebut.ai"
              className="text-sm text-emerald-400 underline hover:text-emerald-300"
            >
              sales@getrebut.ai
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}
