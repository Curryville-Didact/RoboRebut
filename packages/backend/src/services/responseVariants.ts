import type { SupabaseClient } from "@supabase/supabase-js";
import { getNormalizedUsageForUser } from "./freeTierUsage.js";
import { getPlanEntitlements } from "./planEntitlements.js";

export function getResponseVariantCountForPlan(
  planType: string | null | undefined
): number {
  return getPlanEntitlements(planType).responseVariants;
}

export async function getResponseVariantCountFromAuthHeader(
  supabase: SupabaseClient,
  authHeader: string | undefined
): Promise<number> {
  const token = authHeader?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return getResponseVariantCountForPlan("free");

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user?.id) return getResponseVariantCountForPlan("free");

  const usage = await getNormalizedUsageForUser(supabase, data.user.id);
  return getResponseVariantCountForPlan(usage?.plan ?? "free");
}
