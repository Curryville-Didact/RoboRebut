/**
 * Narrow Polar -> profile entitlement sync for paid plans.
 * Source of truth remains `profiles.plan_type`; this service only updates it.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlanType } from "./planEntitlements.js";

type PolarCustomer = {
  id: string;
  email?: string | null;
};

type PolarSubscription = {
  id: string;
  status?: string | null;
  product_id?: string | null;
  product?: {
    id?: string | null;
    name?: string | null;
  } | null;
};

type PolarListResponse<T> = {
  items?: T[];
};

const POLAR_API_BASE = process.env.POLAR_API_BASE?.trim() || "https://api.polar.sh/v1";
const POLAR_ACCESS_TOKEN = process.env.POLAR_ACCESS_TOKEN?.trim();
const POLAR_ORGANIZATION_ID = process.env.POLAR_ORGANIZATION_ID?.trim();
const POLAR_STARTER_PRODUCT_ID = process.env.POLAR_STARTER_PRODUCT_ID?.trim();
const POLAR_PRO_PRODUCT_ID = process.env.POLAR_PRO_PRODUCT_ID?.trim();

export type EntitlementSyncResult =
  | { ok: true; changed: boolean; planType: PlanType | null; reason: string }
  | { ok: false; reason: string };

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${POLAR_ACCESS_TOKEN}`,
    "Content-Type": "application/json",
  };
}

function inferPlanType(sub: PolarSubscription): Extract<PlanType, "starter" | "pro"> | null {
  const productId = sub.product_id ?? sub.product?.id ?? "";
  if (POLAR_PRO_PRODUCT_ID && productId === POLAR_PRO_PRODUCT_ID) return "pro";
  if (POLAR_STARTER_PRODUCT_ID && productId === POLAR_STARTER_PRODUCT_ID) return "starter";

  const productName = (sub.product?.name ?? "").trim().toLowerCase();
  if (productName.includes("roborebut pro") || productName === "pro") return "pro";
  if (productName.includes("roborebut starter") || productName === "starter") {
    return "starter";
  }
  return null;
}

async function listPolarCustomersByEmail(email: string): Promise<PolarCustomer[]> {
  const url = new URL(`${POLAR_API_BASE}/customers/`);
  url.searchParams.set("email", email);
  url.searchParams.set("limit", "10");
  if (POLAR_ORGANIZATION_ID) {
    url.searchParams.set("organization_id", POLAR_ORGANIZATION_ID);
  }

  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) {
    throw new Error(`Polar customers lookup failed (${res.status})`);
  }
  const data = (await res.json()) as PolarListResponse<PolarCustomer>;
  return Array.isArray(data.items) ? data.items : [];
}

async function listActivePolarSubscriptions(customerId: string): Promise<PolarSubscription[]> {
  const url = new URL(`${POLAR_API_BASE}/subscriptions/`);
  url.searchParams.set("customer_id", customerId);
  url.searchParams.set("active", "true");
  url.searchParams.set("limit", "100");
  if (POLAR_ORGANIZATION_ID) {
    url.searchParams.set("organization_id", POLAR_ORGANIZATION_ID);
  }

  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) {
    throw new Error(`Polar subscriptions lookup failed (${res.status})`);
  }
  const data = (await res.json()) as PolarListResponse<PolarSubscription>;
  return Array.isArray(data.items) ? data.items : [];
}

/**
 * Resolves the Polar `customer_id` for a Supabase user email (for customer portal, etc.).
 */
export async function findPolarCustomerIdByEmail(
  email: string | null | undefined
): Promise<string | null> {
  if (!POLAR_ACCESS_TOKEN || !email?.trim()) return null;
  const normalizedEmail = email.trim().toLowerCase();
  try {
    const customers = await listPolarCustomersByEmail(normalizedEmail);
    const customer = customers.find((c) => c.email?.trim().toLowerCase() === normalizedEmail);
    return customer?.id ?? null;
  } catch {
    return null;
  }
}

export async function syncPolarEntitlementForUser(input: {
  supabase: SupabaseClient;
  userId: string;
  email: string | null | undefined;
  logger?: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void };
}): Promise<EntitlementSyncResult> {
  const { supabase, userId, email } = input;
  const logger = input.logger ?? console;

  if (!POLAR_ACCESS_TOKEN) {
    logger.warn("[polarSync] skipped: POLAR_ACCESS_TOKEN not configured");
    return { ok: false, reason: "polar_not_configured" };
  }

  const normalizedEmail = email?.trim().toLowerCase();
  if (!normalizedEmail) {
    logger.warn({ userId }, "[polarSync] skipped: user email missing");
    return { ok: false, reason: "missing_email" };
  }

  try {
    logger.info({ userId, email: normalizedEmail }, "[polarSync] SYNC START");

    const customers = await listPolarCustomersByEmail(normalizedEmail);
    const customer = customers.find((c) => c.email?.trim().toLowerCase() === normalizedEmail);
    if (!customer) {
      logger.info({ userId, email: normalizedEmail }, "[polarSync] no Polar customer match");
      return { ok: true, changed: false, planType: null, reason: "customer_not_found" };
    }

    logger.info(
      { userId, email: normalizedEmail, customerId: customer.id },
      "[polarSync] matched Polar customer"
    );
    const subscriptions = await listActivePolarSubscriptions(customer.id);
    logger.info(
      { userId, customerId: customer.id, subscriptionCount: subscriptions.length },
      "[polarSync] subscriptions found"
    );
    for (const sub of subscriptions) {
      logger.info(
        {
          userId,
          subscriptionId: sub.id,
          productId: sub.product_id ?? sub.product?.id ?? null,
          productName: sub.product?.name ?? null,
          status: sub.status ?? null,
        },
        "[polarSync] subscription detail"
      );
    }

    let nextPlan: Extract<PlanType, "starter" | "pro"> | null = null;
    for (const sub of subscriptions) {
      const mapped = inferPlanType(sub);
      if (mapped === "pro") {
        nextPlan = "pro";
        break;
      }
      if (mapped === "starter") nextPlan = "starter";
    }

    if (!nextPlan) {
      logger.info({ userId, customerId: customer.id }, "[polarSync] no active starter/pro subscription");
      return { ok: true, changed: false, planType: null, reason: "no_matching_subscription" };
    }

    const { data: currentRaw, error: currentErr } = await supabase
      .from("profiles")
      .select("plan_type")
      .eq("id", userId)
      .maybeSingle();
    const current = currentRaw as { plan_type?: string | null } | null;
    if (currentErr) {
      logger.warn({ userId, message: currentErr.message }, "[polarSync] failed reading current plan");
      return { ok: false, reason: "profile_read_failed" };
    }

    const currentPlan = (current?.plan_type ?? "free").toLowerCase();
    logger.info(
      { userId, previousPlanType: currentPlan, chosenPlan: nextPlan },
      "[polarSync] chosen plan"
    );
    if (currentPlan === nextPlan) {
      logger.info({ userId, planType: nextPlan }, "[polarSync] entitlement already current");
      return { ok: true, changed: false, planType: nextPlan, reason: "already_current" };
    }

    const { error: updateErr } = await supabase
      .from("profiles")
      .update({ plan_type: nextPlan })
      .eq("id", userId);
    if (updateErr) {
      logger.warn({ userId, message: updateErr.message }, "[polarSync] entitlement update failed");
      return { ok: false, reason: "profile_update_failed" };
    }

    logger.info(
      { userId, previousPlanType: currentPlan, updatedPlanType: nextPlan },
      "[polarSync] updated plan_type"
    );
    return { ok: true, changed: true, planType: nextPlan, reason: "updated" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn({ userId, message }, "[polarSync] sync failed");
    return { ok: false, reason: "polar_sync_failed" };
  }
}
