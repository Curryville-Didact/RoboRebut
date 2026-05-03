"use client";

import type { ReadonlyURLSearchParams } from "next/navigation";
import { getVisibleToneOptions } from "@/lib/toneOptions";
import {
  resolveConversationCtaLinks,
  resolveMonetizationUiState,
} from "@/lib/monetizationUi";
import type { UsageSnapshot } from "./conversationHelpers";
import {
  derivePlanType,
  structuredDealContextEnabledFromUsage,
} from "./conversationSession";

export function useConversationDerived(args: {
  pathname: string;
  searchParams: ReadonlyURLSearchParams | null;
  sending: boolean;
  usage: UsageSnapshot | null;
}) {
  const { pathname, searchParams, sending, usage } = args;

  const returnTo = `${pathname}${searchParams?.toString() ? `?${searchParams.toString()}` : ""}`;

  const micDisabled = sending || usage?.blocked === true;

  const monetizationUi = resolveMonetizationUiState(usage);
  const ctaLinks = resolveConversationCtaLinks({ returnTo });
  const atUsageLimit = monetizationUi?.kind === "limit_reached";
  const composerDisabled = sending || atUsageLimit;
  const toneOptions = getVisibleToneOptions(
    usage?.entitlements?.advancedToneModes === true
  );
  const isPro = usage?.entitlements?.advancedToneModes === true;
  const structuredDealContextEnabled =
    structuredDealContextEnabledFromUsage(usage ?? null);
  const planType = derivePlanType(usage);
  const isNearingLimit = monetizationUi?.kind === "nearing_limit";

  return {
    returnTo,
    micDisabled,
    monetizationUi,
    ctaLinks,
    atUsageLimit,
    composerDisabled,
    toneOptions,
    isPro,
    structuredDealContextEnabled,
    planType,
    isNearingLimit,
  };
}
