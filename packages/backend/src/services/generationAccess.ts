import type { SupabaseClient } from "@supabase/supabase-js";
import { getNormalizedUsageForUser } from "./freeTierUsage.js";
import { getPlanEntitlements, type PlanEntitlements, type PlanType } from "./planEntitlements.js";

export type GenerationAccess = {
  planType: PlanType;
  entitlements: PlanEntitlements;
};

/** Returns null when there is no valid Bearer token / user — never implies free tier anonymously. */
export async function getGenerationAccessFromAuthHeader(
  supabase: SupabaseClient,
  authHeader: string | undefined
): Promise<GenerationAccess | null> {
  const token = authHeader?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user?.id) return null;

  const usage = await getNormalizedUsageForUser(supabase, data.user.id);
  const planType = usage?.plan ?? "free";
  return { planType, entitlements: getPlanEntitlements(planType) };
}
