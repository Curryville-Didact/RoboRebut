"use client";

import Link from "next/link";
import { useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { getStarterCheckoutHref } from "@/lib/checkoutLinks";
import { getProCheckoutHref } from "@/lib/checkoutLinks";
import { navigateProBillingSameTab } from "@/lib/resolveProBillingDestination";
import { MONETIZATION_LINKS } from "@/lib/monetizationLinks";
import type { EnforcementUxModel } from "@/lib/generationEnforcementUx";
import { openManageBillingPortal } from "@/lib/openManageBillingPortal";
import { trackEvent } from "@/lib/trackEvent";

type Props = {
  open: boolean;
  onClose: () => void;
  model: EnforcementUxModel | null;
  surface: string;
  planType: string | null;
  conversationId: string | null;
  httpStatus: number;
  errorCode: string | null;
  returnTo: string;
};

export function EnforcementPromptModal({
  open,
  onClose,
  model,
  surface,
  planType,
  conversationId,
  httpStatus,
  errorCode,
  returnTo,
}: Props) {
  const baseMeta = useCallback(
    (m: EnforcementUxModel) => ({
      reason: m.analyticsReason,
      http_status: httpStatus,
      error_code: errorCode,
      surface,
      pressure_level: m.pressureLevel,
      pressure_tier: m.pressureTier,
      enforcement_hits: m.enforcementHits,
    }),
    [surface, httpStatus, errorCode]
  );

  const fireClick = useCallback(
    (ctaRole: "primary" | "secondary" | "tertiary", ctaLabel: string, m: EnforcementUxModel) => {
      trackEvent({
        eventName:
          ctaRole === "primary"
            ? "enforcement_prompt_primary_clicked"
            : ctaRole === "secondary"
              ? "enforcement_prompt_secondary_clicked"
              : "enforcement_prompt_secondary_clicked",
        triggerType: m.analyticsReason,
        planType,
        conversationId,
        surface,
        ctaLabel,
        metadata: {
          ...baseMeta(m),
        },
      });
    },
    [planType, conversationId, surface, baseMeta]
  );

  const runProCheckout = useCallback(async () => {
    await navigateProBillingSameTab({
      getAccessToken: async () =>
        (await createClient().auth.getSession()).data.session?.access_token ??
        null,
      checkoutFallbackUrl: getProCheckoutHref(returnTo),
      portalReturnUrl:
        typeof window !== "undefined"
          ? `${window.location.origin}${window.location.pathname}${window.location.search}`
          : getProCheckoutHref(returnTo),
    });
  }, [returnTo]);

  const handleProUpgrade = useCallback(
    async (opts: {
      analyticsRole: "primary" | "secondary";
      ctaLabel: string;
      m: EnforcementUxModel;
    }) => {
      fireClick(opts.analyticsRole, opts.ctaLabel, opts.m);
      await runProCheckout();
    },
    [fireClick, runProCheckout]
  );

  const goStarterCheckout = useCallback(
    (m: EnforcementUxModel, analyticsRole: "primary" | "secondary") => {
      fireClick(analyticsRole, "Continue with Starter", m);
      window.location.assign(getStarterCheckoutHref(returnTo));
    },
    [fireClick, returnTo]
  );

  if (!open || !model) return null;

  const active = model;
  const freeEscalationPanel =
    active.primary === "free_dual_upgrade" ? active.pressureTier : null;
  function dismiss(reason: "close_button" | "backdrop" | "ok") {
    trackEvent({
      eventName: "enforcement_prompt_dismissed",
      triggerType: active.analyticsReason,
      planType,
      conversationId,
      surface,
      metadata: {
        ...baseMeta(active),
        dismiss_reason: reason,
      },
    });
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 px-4 py-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby="enforcement-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) dismiss("backdrop");
      }}
    >
      <div
        className={[
          "relative w-full max-w-md rounded-2xl border bg-zinc-950 p-6 shadow-xl",
          freeEscalationPanel === "medium"
            ? "border-amber-400/35 shadow-amber-950/35 ring-1 ring-amber-500/30"
            : freeEscalationPanel === "high"
              ? "border-emerald-400/40 shadow-emerald-950/40 ring-1 ring-emerald-500/35"
              : "border-white/12 shadow-black/40",
        ].join(" ")}
      >
        <button
          type="button"
          onClick={() => dismiss("close_button")}
          className="absolute right-4 top-4 text-gray-500 transition hover:text-white"
          aria-label="Close"
        >
          ✕
        </button>

        <h2
          id="enforcement-modal-title"
          className="pr-8 text-lg font-semibold text-white"
        >
          {active.title}
        </h2>
        <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-gray-300">
          {active.body}
        </p>
        {active.contextLine ? (
          <p className="mt-3 text-sm text-gray-400">{active.contextLine}</p>
        ) : null}
        {active.valueLine ? (
          <p className="mt-5 text-sm font-medium text-emerald-100/90">
            {active.valueLine}
          </p>
        ) : null}

        <div className="mt-6 flex flex-col gap-2">
          {active.primary === "auth" && (
            <>
              <Link
                href="/login"
                onClick={() => fireClick("primary", "Sign in", active)}
                className="inline-flex justify-center rounded-lg border border-emerald-500/50 bg-emerald-600/25 px-4 py-2.5 text-sm font-semibold text-emerald-50 transition hover:bg-emerald-600/35"
              >
                Sign in
              </Link>
              <Link
                href="/signup"
                onClick={() =>
                  fireClick("secondary", "Create free account", active)
                }
                className="inline-flex justify-center rounded-lg border border-white/15 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-white/10"
              >
                Create free account
              </Link>
            </>
          )}

          {active.primary === "free_dual_upgrade" && active.pressureTier === "low" && (
            <>
              <button
                type="button"
                onClick={() => goStarterCheckout(active, "primary")}
                className="inline-flex justify-center rounded-lg border border-emerald-500/50 bg-emerald-600/25 px-4 py-2.5 text-sm font-semibold text-emerald-50 transition hover:bg-emerald-600/35"
              >
                Continue with Starter
              </button>
              <button
                type="button"
                onClick={() =>
                  void handleProUpgrade({
                    analyticsRole: "secondary",
                    ctaLabel: "Upgrade to Pro",
                    m: active,
                  })
                }
                className="inline-flex justify-center rounded-lg border border-white/20 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-white/10"
              >
                Upgrade to Pro
              </button>
              {active.showComparePlansLink && (
                <Link
                  href="/pricing"
                  onClick={() => fireClick("tertiary", "Compare plans", active)}
                  className="text-center text-xs text-gray-500 underline transition hover:text-gray-300"
                >
                  Compare plans
                </Link>
              )}
            </>
          )}

          {active.primary === "free_dual_upgrade" && active.pressureTier === "medium" && (
            <>
              <button
                type="button"
                onClick={() => goStarterCheckout(active, "primary")}
                className="inline-flex justify-center rounded-lg border border-emerald-500/60 bg-emerald-600/35 px-4 py-2.5 text-sm font-semibold text-emerald-50 shadow-md shadow-emerald-950/30 ring-1 ring-emerald-500/30 transition hover:bg-emerald-600/45"
              >
                Continue with Starter
              </button>
              <button
                type="button"
                onClick={() =>
                  void handleProUpgrade({
                    analyticsRole: "secondary",
                    ctaLabel: "Unlock Pro",
                    m: active,
                  })
                }
                className="inline-flex justify-center rounded-lg border border-white/25 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-white/10"
              >
                Unlock Pro
              </button>
              {active.showComparePlansLink && (
                <Link
                  href="/pricing"
                  onClick={() => fireClick("tertiary", "Compare plans", active)}
                  className="text-center text-xs text-gray-500 underline transition hover:text-gray-300"
                >
                  Compare plans
                </Link>
              )}
            </>
          )}

          {active.primary === "free_dual_upgrade" && active.pressureTier === "high" && (
            <>
              <button
                type="button"
                onClick={() =>
                  void handleProUpgrade({
                    analyticsRole: "primary",
                    ctaLabel: "Unlock Pro",
                    m: active,
                  })
                }
                className="animate-rr-enforcement-primary-pulse-once inline-flex justify-center rounded-lg border border-emerald-400/55 bg-emerald-600/35 px-4 py-2.5 text-sm font-semibold text-emerald-50 transition hover:bg-emerald-600/45"
              >
                Unlock Pro
              </button>
              <button
                type="button"
                onClick={() => goStarterCheckout(active, "secondary")}
                className="inline-flex justify-center rounded-lg border border-white/12 bg-white/[0.06] px-4 py-2.5 text-sm font-medium text-gray-300 transition hover:bg-white/10"
              >
                Continue with Starter
              </button>
              {active.showComparePlansLink && (
                <Link
                  href="/pricing"
                  onClick={() => fireClick("tertiary", "Compare plans", active)}
                  className="text-center text-xs text-gray-500 underline transition hover:text-gray-300"
                >
                  Compare plans
                </Link>
              )}
            </>
          )}

          {active.primary === "pro_and_billing" && (
            <>
              <button
                type="button"
                onClick={() =>
                  void handleProUpgrade({
                    analyticsRole: "primary",
                    ctaLabel: "Unlock Pro",
                    m: active,
                  })
                }
                className="inline-flex justify-center rounded-lg border border-emerald-500/50 bg-emerald-600/25 px-4 py-2.5 text-sm font-semibold text-emerald-50 transition hover:bg-emerald-600/35"
              >
                Unlock Pro
              </button>
              {active.showManageBillingSecondary && (
                <button
                  type="button"
                  onClick={() => {
                    fireClick("secondary", "Manage billing", active);
                    void openManageBillingPortal();
                  }}
                  className="inline-flex justify-center rounded-lg border border-white/15 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-white/10"
                >
                  Manage billing
                </button>
              )}
            </>
          )}

          {active.primary === "dismiss" && (
            <button
              type="button"
              onClick={() => dismiss("ok")}
              className="inline-flex justify-center rounded-lg border border-white/20 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-white/10"
            >
              OK
            </button>
          )}

          {active.primary === "dismiss_with_team_link" && (
            <>
              <button
                type="button"
                onClick={() => dismiss("ok")}
                className="inline-flex justify-center rounded-lg border border-white/20 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-white/10"
              >
                OK
              </button>
              {active.showTeamDemoTertiary && (
                <a
                  href={MONETIZATION_LINKS.teamDemo}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => fireClick("tertiary", "Team demo", active)}
                  className="text-center text-xs text-gray-500 underline transition hover:text-gray-300"
                >
                  Need more throughput for your team? Book Team Demo
                </a>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
