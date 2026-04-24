/**
 * Free-tier usage snapshot + profile-backed plan resolution.
 *
 * Phase 5.1: User-facing `usage.used` / meter counts match Phase 5.0 monetization enforcement:
 * both use persisted `pattern_intelligence_events` row count per user (all-time, same query as
 * `coachChatReply` → `evaluateMonetization`). Plan still comes from `profiles.plan_type`;
 * `profiles.usage_count` remains for legacy increment/reset paths but does not power the meter.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getPlanEntitlements,
  type PlanEntitlements,
  type PlanType,
} from "./planEntitlements.js";

const USAGE_RESET_DAYS = Number(process.env.USAGE_RESET_DAYS ?? "30");

type UsageRow = {
  plan_type: string | null;
  usage_count: number | null;
  usage_reset_at: string | null;
};

function nextResetIso(now: Date): string {
  const reset = new Date(now);
  reset.setDate(reset.getDate() + USAGE_RESET_DAYS);
  return reset.toISOString();
}

/**
 * Reads profile usage, applies the same reset window as coach replies, returns current counts.
 */
export async function getNormalizedUsageForUser(
  supabase: SupabaseClient,
  userId: string
): Promise<{ plan: PlanType; used: number } | null> {
  const { data: rawData, error } = await supabase
    .from("profiles")
    .select("plan_type, usage_count, usage_reset_at")
    .eq("id", userId)
    .maybeSingle();
  const data = rawData as UsageRow | null;

  if (error) {
    console.warn(
      `[freeTierUsage] read failed for ${userId}: ${error.message}`
    );
    return null;
  }

  const now = new Date();
  const resetAt = data?.usage_reset_at ? new Date(data.usage_reset_at) : null;
  const resetExpired =
    !resetAt || Number.isNaN(resetAt.getTime()) || now > resetAt;

  let usageCount = data?.usage_count ?? 0;
  if (resetExpired) {
    usageCount = 0;
    await supabase
      .from("profiles")
      .update({
        usage_count: 0,
        usage_reset_at: nextResetIso(now),
      })
      .eq("id", userId);
  }

  const rawPlan = (data?.plan_type ?? "free").toLowerCase();
  const plan: PlanType =
    rawPlan === "starter" || rawPlan === "pro" ? rawPlan : "free";
  return { plan, used: usageCount };
}

export type FreeTierUsageSnapshot = {
  used: number;
  limit: number;
  remaining: number;
  blocked: boolean;
  entitlements: Pick<
    PlanEntitlements,
    | "responseVariants"
    | "priorityGeneration"
    | "advancedStrategies"
    | "advancedToneModes"
    | "objectionInsights"
    | "structuredDealContext"
  >;
};

/**
 * Same persisted usage signal as Phase 5.0 `evaluateMonetization` (all-time rows per user).
 * Must stay identical to the count query in `coachChatReply`.
 */
export async function countPatternIntelligenceEventsForUser(
  supabase: SupabaseClient,
  userId: string
): Promise<number> {
  try {
    const { count } = await supabase
      .from("pattern_intelligence_events")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId);
    return count ?? 0;
  } catch {
    return 0;
  }
}

export async function getFreeTierUsageSnapshot(
  supabase: SupabaseClient,
  userId: string
): Promise<FreeTierUsageSnapshot | null> {
  const row = await getNormalizedUsageForUser(supabase, userId);
  if (!row) return null;

  const used = await countPatternIntelligenceEventsForUser(supabase, userId);
  const entitlements = getPlanEntitlements(row.plan);
  if (entitlements.unlimited) {
    return {
      used,
      limit: entitlements.monthlyResponseLimit,
      remaining: -1,
      blocked: false,
      entitlements: {
        responseVariants: entitlements.responseVariants,
        priorityGeneration: entitlements.priorityGeneration,
        advancedStrategies: entitlements.advancedStrategies,
        advancedToneModes: entitlements.advancedToneModes,
        objectionInsights: entitlements.objectionInsights,
        structuredDealContext: entitlements.structuredDealContext,
      },
    };
  }

  const blocked = used >= entitlements.monthlyResponseLimit;
  const remaining = Math.max(0, entitlements.monthlyResponseLimit - used);
  return {
    used,
    limit: entitlements.monthlyResponseLimit,
    remaining,
    blocked,
    entitlements: {
      responseVariants: entitlements.responseVariants,
      priorityGeneration: entitlements.priorityGeneration,
      advancedStrategies: entitlements.advancedStrategies,
      advancedToneModes: entitlements.advancedToneModes,
      objectionInsights: entitlements.objectionInsights,
      structuredDealContext: entitlements.structuredDealContext,
    },
  };
}

/** Pre-flight gate for generateCoachReply (fail-open if profile read fails). */
export async function checkFreeTierBlocked(
  supabase: SupabaseClient,
  userId: string
): Promise<{ blocked: boolean }> {
  const row = await getNormalizedUsageForUser(supabase, userId);
  if (!row) return { blocked: false };
  const entitlements = getPlanEntitlements(row.plan);
  if (entitlements.unlimited) return { blocked: false };
  const used = await countPatternIntelligenceEventsForUser(supabase, userId);
  return { blocked: used >= entitlements.monthlyResponseLimit };
}

export async function incrementUsageCount(
  supabase: SupabaseClient,
  userId: string
): Promise<void> {
  const { data: rawData, error } = await supabase
    .from("profiles")
    .select("usage_count")
    .eq("id", userId)
    .maybeSingle();
  const data = rawData as { usage_count: number | null } | null;

  if (error) {
    console.warn(
      `[freeTierUsage] increment read failed for ${userId}: ${error.message}`
    );
    return;
  }

  const nextCount = (data?.usage_count ?? 0) + 1;
  const { error: updateErr } = await supabase
    .from("profiles")
    .update({ usage_count: nextCount })
    .eq("id", userId);

  if (updateErr) {
    console.warn(
      `[freeTierUsage] increment update failed for ${userId}: ${updateErr.message}`
    );
  }
}
