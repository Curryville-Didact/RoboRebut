/**
 * Central plan / usage enforcement for API routes (server-derived; never trust client plan labels).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getNormalizedUsageForUser } from "./freeTierUsage.js";
import { consumeGenerationBurstSlot } from "./generationBurstRateLimit.js";
import {
  getPlanEntitlements,
  type PlanEntitlements,
  type PlanType,
} from "./planEntitlements.js";

export type PlanRequestContext = {
  user: { id: string };
  planType: PlanType;
  usage: Awaited<ReturnType<typeof getNormalizedUsageForUser>>;
  entitlements: PlanEntitlements;
};

export class PlanEnforcementError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: 401 | 403 | 429 | 503, code: string, message?: string) {
    super(message ?? code);
    this.statusCode = statusCode;
    this.code = code;
    this.name = "PlanEnforcementError";
  }
}

/**
 * Resolve plan from Bearer token (same token verification as legacy generation helpers).
 * Returns null if there is no valid authenticated user — callers must require auth separately.
 */
export async function resolveRequestPlanContext(
  supabase: SupabaseClient,
  authHeader: string | undefined
): Promise<PlanRequestContext | null> {
  const token = authHeader?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user?.id) return null;

  const usage = await getNormalizedUsageForUser(supabase, data.user.id);
  const planType = usage?.plan ?? "free";
  const entitlements = getPlanEntitlements(planType);

  return {
    user: { id: data.user.id },
    planType,
    usage,
    entitlements,
  };
}

/**
 * Plan context when `userId` is already verified (e.g. `fastify.authenticate`), for routes
 * that may not repeat the Bearer token on the request.
 */
export async function resolvePlanContextForUserId(
  supabase: SupabaseClient,
  userId: string
): Promise<PlanRequestContext> {
  const usage = await getNormalizedUsageForUser(supabase, userId);
  const planType = usage?.plan ?? "free";
  const entitlements = getPlanEntitlements(planType);
  return {
    user: { id: userId },
    planType,
    usage,
    entitlements,
  };
}

export function assertAuthenticated(
  context: PlanRequestContext | null
): asserts context is PlanRequestContext {
  if (context == null) {
    throw new PlanEnforcementError(401, "AUTH_REQUIRED", "Authentication required");
  }
}

/**
 * Strict usage gate for `/api/rebuttal` and `/api/regenerate` only (not `/api/messages`).
 * Fail-closed if profile/usage could not be loaded; does not re-fetch (uses context from resolve).
 */
export async function assertUsageAllowance(
  _supabase: SupabaseClient,
  context: PlanRequestContext
): Promise<void> {
  if (context.usage == null) {
    throw new PlanEnforcementError(
      503,
      "USAGE_UNAVAILABLE",
      "Unable to verify usage"
    );
  }
  const entitlements = getPlanEntitlements(context.usage.plan);
  if (entitlements.unlimited) return;
  if (context.usage.used >= entitlements.monthlyResponseLimit) {
    throw new PlanEnforcementError(
      403,
      "USAGE_LIMIT_REACHED",
      "Monthly response limit reached."
    );
  }
}

/** ~10 requests / 10s per burst key (`resolveGenerationBurstKey`); throws 429 when exceeded. */
export function assertGenerationBurstAllowance(rateLimitKey: string): void {
  if (!consumeGenerationBurstSlot(rateLimitKey)) {
    throw new PlanEnforcementError(
      429,
      "RATE_LIMITED",
      "Too many requests. Please slow down."
    );
  }
}

export { resolveGenerationBurstKey, type RateLimitRequestPick } from "./generationBurstRateLimit.js";

type HardGatedFeature = "priorityGeneration" | "advancedToneModes" | "structuredDealContext";

/**
 * Reserved for explicit hard gates on non-tone features (tone stays downgrade-only via
 * `resolveToneModeForPlan`). Phase 2: no active throws — callers use entitlements at generation time.
 */
export function assertFeatureAccess(
  context: PlanRequestContext,
  feature: HardGatedFeature
): void {
  void context;
  void feature;
}

export function isPlanEnforcementError(err: unknown): err is PlanEnforcementError {
  return err instanceof PlanEnforcementError;
}

export { incrementUsageCount } from "./freeTierUsage.js";
