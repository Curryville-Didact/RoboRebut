/**
 * Founder support console — read-only account inspection.
 *
 * Security:
 * - Requires normal auth (Bearer token via fastify.authenticate)
 * - Requires founder allowlist by email (NEXT_PUBLIC_FOUNDER_EMAILS fallback)
 *
 * No mutations: does not sync Polar or reset usage windows.
 */

import type { FastifyInstance } from "fastify";
import { sendApiError } from "../lib/apiErrors.js";
import { getPlanEntitlements } from "../services/planEntitlements.js";
import { findPolarCustomerIdByEmail } from "../services/polarEntitlementSync.js";

type PlanTier = "free" | "starter" | "pro" | "unknown";

function founderEmailAllowlist(): string[] {
  const raw =
    process.env.FOUNDER_EMAILS?.trim() ||
    process.env.NEXT_PUBLIC_FOUNDER_EMAILS?.trim() ||
    "";
  if (raw) {
    return raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  }
  return ["admin@getrebut.ai"];
}

function isFounderEmail(email: string | null | undefined): boolean {
  const e = (email ?? "").trim().toLowerCase();
  if (!e) return false;
  return founderEmailAllowlist().includes(e);
}

function normalizePlanTier(raw: unknown): PlanTier {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (v === "free" || v === "starter" || v === "pro") return v;
  return "unknown";
}

async function findUserByEmail(
  fastify: FastifyInstance,
  email: string
): Promise<{ id: string; email: string | null; created_at: string | null } | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;

  // Supabase admin search-by-email is not guaranteed; scan a few pages safely.
  // Founder console only: bounded work to avoid runaway.
  const perPage = 200;
  const maxPages = 10;
  for (let page = 1; page <= maxPages; page++) {
    const { data, error } = await fastify.supabase.auth.admin.listUsers({
      page,
      perPage,
    });
    if (error) return null;
    const users = (data?.users ?? []) as Array<{
      id: string;
      email?: string | null;
      created_at?: string | null;
    }>;
    const match = users.find(
      (u) => (u.email ?? "").trim().toLowerCase() === normalized
    );
    if (match) {
      return {
        id: match.id,
        email: match.email ?? null,
        created_at: match.created_at ?? null,
      };
    }
    if (users.length < perPage) break;
  }
  return null;
}

function buildSupportSummary(input: {
  planTier: PlanTier;
  entitlements: ReturnType<typeof getPlanEntitlements>;
  usage: { currentCount: number | null; blocked: boolean | null; snapshotStatus: string };
  polarCustomerId: string | null;
  mismatchFlags: string[];
  notes: string[];
}) {
  const { planTier, entitlements, usage, polarCustomerId, mismatchFlags } = input;

  const manageBillingExpected = planTier === "starter" || planTier === "pro";
  const expectedUpgradePath =
    planTier === "free"
      ? "upgrade_to_starter_or_pro"
      : planTier === "starter"
        ? "upgrade_to_pro"
        : "none";

  let headline = "Account inspection";
  let accountHealth: "healthy" | "warning" | "mismatch" = "healthy";
  if (mismatchFlags.length > 0) accountHealth = "mismatch";
  else if (usage.snapshotStatus !== "ok") accountHealth = "warning";
  else if (manageBillingExpected && !polarCustomerId) accountHealth = "warning";

  if (accountHealth === "healthy") {
    headline =
      planTier === "pro"
        ? "Healthy Pro account. Pricing should show Current Plan: Pro and Manage Billing."
        : planTier === "starter"
          ? "Healthy Starter account. Pro upgrade should be available; Manage Billing should be available."
          : "Healthy Free account. Starter/Pro upgrade CTAs should be available.";
  } else if (accountHealth === "mismatch") {
    headline = "Mismatch detected. Pricing and enforcement may be inconsistent until resolved.";
  } else {
    headline = "Warning: incomplete billing/usage signals; verify entitlement state.";
  }

  return {
    headline,
    expectedPricingState:
      planTier === "pro"
        ? "pro_active"
        : planTier === "starter"
          ? "starter_active"
          : planTier === "free"
            ? "free"
            : "unknown",
    expectedUpgradePath,
    liveModeAccess: true,
    advancedToneAccess: entitlements.advancedToneModes === true,
    structuredDealContextAccess: entitlements.structuredDealContext === true,
    manageBillingExpected,
    accountHealth,
  };
}

export async function founderSupportRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{
    Querystring: { email?: string; userId?: string };
  }>("/founder/support/account", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      const callerEmail = request.user.email ?? null;
      if (!isFounderEmail(callerEmail)) {
        return sendApiError(reply, {
          status: 403,
          code: "FORBIDDEN",
          message: "Forbidden",
        });
      }

      const emailQ = typeof request.query.email === "string" ? request.query.email.trim() : "";
      const userIdQ = typeof request.query.userId === "string" ? request.query.userId.trim() : "";
      if (!emailQ && !userIdQ) {
        return sendApiError(reply, {
          status: 400,
          code: "INVALID_REQUEST",
          message: "Provide email or userId.",
        });
      }

      let target:
        | { id: string; email: string | null; created_at: string | null }
        | null = null;
      const notes: string[] = [];
      const mismatchFlags: string[] = [];

      if (userIdQ) {
        const { data, error } = await fastify.supabase.auth.admin.getUserById(userIdQ);
        if (error || !data.user) {
          return sendApiError(reply, {
            status: 404,
            code: "NOT_FOUND",
            message: "User not found.",
          });
        }
        target = {
          id: data.user.id,
          email: data.user.email ?? null,
          created_at: (data.user as { created_at?: string | null }).created_at ?? null,
        };
      } else if (emailQ) {
        target = await findUserByEmail(fastify, emailQ);
        if (!target) {
          return sendApiError(reply, {
            status: 404,
            code: "NOT_FOUND",
            message: "User not found.",
          });
        }
      }

      const userId = target!.id;
      const email = target!.email;

      // Profile plan_type + usage_count are canonical for plan + usage enforcement.
      const { data: profileRaw, error: profileErr } = await fastify.supabase
        .from("profiles")
        .select("plan_type, usage_count, usage_reset_at")
        .eq("id", userId)
        .maybeSingle();

      if (profileErr) {
        notes.push(`Profile read failed: ${profileErr.message}`);
      }

      const profile = (profileRaw ?? null) as
        | { plan_type?: string | null; usage_count?: number | null; usage_reset_at?: string | null }
        | null;

      const profilePlanTypeRaw = profile?.plan_type ?? null;
      const resolvedPlanTier = normalizePlanTier(profilePlanTypeRaw);
      if (resolvedPlanTier === "unknown") mismatchFlags.push("PROFILE_PLAN_UNKNOWN");

      const entitlements = getPlanEntitlements(
        resolvedPlanTier === "unknown" ? "free" : resolvedPlanTier
      );

      if (resolvedPlanTier === "free" && entitlements.unlimited) {
        mismatchFlags.push("FREE_WITH_UNLIMITED_USAGE");
      }

      const currentCount =
        typeof profile?.usage_count === "number" && Number.isFinite(profile.usage_count)
          ? Math.max(0, Math.floor(profile.usage_count))
          : null;
      const limit = entitlements.monthlyResponseLimit;
      const blocked =
        currentCount == null ? null : entitlements.unlimited ? false : currentCount >= Math.max(limit, 0);

      const snapshotStatus =
        profile == null ? "profile_missing" : currentCount == null ? "usage_unknown" : "ok";
      if (snapshotStatus !== "ok") mismatchFlags.push("USAGE_SNAPSHOT_UNAVAILABLE");

      const polarCustomerId = await findPolarCustomerIdByEmail(email);
      const paidStateSummary =
        resolvedPlanTier === "pro"
          ? "paid_pro"
          : resolvedPlanTier === "starter"
            ? "paid_starter"
            : resolvedPlanTier === "free"
              ? "free"
              : "unknown";
      const billingStateUnknown = resolvedPlanTier === "unknown";
      if (billingStateUnknown) mismatchFlags.push("BILLING_STATE_UNKNOWN");

      if ((resolvedPlanTier === "starter" || resolvedPlanTier === "pro") && !polarCustomerId) {
        mismatchFlags.push("PAID_WITHOUT_POLAR_REFERENCE");
      }

      if (mismatchFlags.length > 0) mismatchFlags.push("PRICING_UI_MAY_BE_INCONSISTENT");

      const supportSummary = buildSupportSummary({
        planTier: resolvedPlanTier,
        entitlements,
        usage: { currentCount, blocked, snapshotStatus },
        polarCustomerId,
        mismatchFlags: mismatchFlags.filter((f, i, a) => a.indexOf(f) === i),
        notes,
      });

      return reply.send({
        identity: {
          userId,
          email,
          createdAt: target!.created_at,
          profilePlanType: profilePlanTypeRaw,
        },
        billing: {
          resolvedPlanTier,
          polarCustomerId,
          paidStateSummary,
          lastSyncSummary: null,
        },
        entitlements: {
          monthlyResponseLimit: entitlements.monthlyResponseLimit,
          isUnlimited: entitlements.unlimited,
          responseVariants: entitlements.responseVariants,
          priorityGeneration: entitlements.priorityGeneration,
          advancedToneModes: entitlements.advancedToneModes,
          structuredDealContext: entitlements.structuredDealContext,
          advancedStrategies: entitlements.advancedStrategies,
          objectionInsights: entitlements.objectionInsights,
        },
        usage: {
          currentCount,
          limit,
          blocked,
          snapshotStatus,
        },
        diagnostics: {
          mismatchFlags: mismatchFlags.filter((f, i, a) => a.indexOf(f) === i),
          recentSignals: null,
          notes: [
            ...notes,
            "Recent enforcement signals are not available in this panel (no safe query surface).",
          ],
        },
        supportSummary,
      });
    },
  });
}

