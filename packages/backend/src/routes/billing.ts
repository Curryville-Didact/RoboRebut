import type { FastifyInstance, FastifyRequest } from "fastify";
import { getFreeTierUsageSnapshot, getNormalizedUsageForUser } from "../services/freeTierUsage.js";
import { findPolarCustomerIdByEmail, syncPolarEntitlementForUser } from "../services/polarEntitlementSync.js";
import { getPlanEntitlements, type PlanType } from "../services/planEntitlements.js";

function isUuidV4Like(value: string): boolean {
  const v = value.trim();
  // Polar IDs here are UUIDs. Accept UUID v1–v5 format (don't over-constrain to v4 only).
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function polarApiV1Base(): string {
  return process.env.POLAR_API_BASE?.trim().replace(/\/$/, "") || "https://api.polar.sh/v1";
}

function polarCheckoutCreateUrl(): string {
  return `${polarApiV1Base()}/checkouts/`;
}

function polarCustomerSessionsCreateUrl(): string {
  return `${polarApiV1Base()}/customer-sessions/`;
}

/** Safe, dev-oriented hints for Polar JSON errors (never echoes secrets). */
function summarizePolarApiError(status: number, detail: string): string {
  const trimmed = detail.trim();
  try {
    const parsed = JSON.parse(trimmed) as {
      error?: string;
      error_description?: string;
      detail?: unknown;
    };
    if (Array.isArray(parsed.detail)) {
      const msgs = parsed.detail
        .map((d: { msg?: string }) => (typeof d?.msg === "string" ? d.msg : null))
        .filter((m): m is string => Boolean(m))
        .slice(0, 5);
      if (msgs.length) {
        return `Polar request failed (${status}): ${msgs.join("; ")}`;
      }
    }
    const code = typeof parsed.error === "string" ? parsed.error : "";
    const desc = typeof parsed.error_description === "string" ? parsed.error_description : "";
    if (code === "insufficient_scope") {
      return "Polar failed: token needs required OAuth scope (e.g. checkouts:write or customer_sessions:write).";
    }
    if (code && desc) return `Polar failed: ${code} — ${desc}`;
    if (code) return `Polar failed: ${code}`;
  } catch {
    /* not JSON */
  }
  if (trimmed.length > 0 && trimmed.length < 400) {
    return `Polar request failed (${status}): ${trimmed}`;
  }
  return `Polar request failed (${status}).`;
}

/**
 * Absolute app origin for Polar success/return redirects. Prefer Referer from the pricing/dashboard
 * tab so localhost vs 127.0.0.1 matches the user's actual UI; fall back to FRONTEND_URL.
 */
function resolveAppBaseUrl(request: FastifyRequest): string {
  const configured = process.env.FRONTEND_URL?.trim().replace(/\/$/, "");
  const referer = request.headers.referer;
  if (referer) {
    try {
      const ref = new URL(referer);
      if (configured) {
        try {
          const cfg = new URL(configured.startsWith("http") ? configured : `https://${configured}`);
          if (ref.origin === cfg.origin) return configured;
        } catch {
          /* ignore malformed FRONTEND_URL */
        }
      }
      if (ref.hostname === "localhost" || ref.hostname === "127.0.0.1") {
        return ref.origin;
      }
    } catch {
      /* ignore bad referer */
    }
  }
  return configured || "http://localhost:3000";
}

export type BillingSyncEntitlementResponse = {
  ok: boolean;
  status:
    | "synced"
    | "no_change"
    | "unauthenticated"
    | "billing_not_configured"
    | "profile_not_found"
    | "provider_not_ready"
    | "error";
  planType?: PlanType | null;
  entitlements?: Record<string, unknown>;
  usage?: Awaited<ReturnType<typeof getFreeTierUsageSnapshot>>;
  message?: string;
};

function mapSyncResultToStatus(sync: Awaited<ReturnType<typeof syncPolarEntitlementForUser>>): BillingSyncEntitlementResponse["status"] {
  if (sync.ok && sync.changed) return "synced";
  if (sync.ok && sync.reason === "already_current") return "no_change";
  if (sync.ok) return "provider_not_ready";
  if (sync.reason === "polar_not_configured") return "billing_not_configured";
  if (sync.reason === "profile_read_failed" || sync.reason === "profile_update_failed") {
    return "profile_not_found";
  }
  return "error";
}

export async function billingRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * Creates a Polar checkout session via API (success_url / return_url only apply here — not via
   * query params on static buy.polar.sh product links). Redirects to Polar-hosted checkout URL.
   */
  fastify.get<{ Querystring: { plan?: string } }>("/billing/checkout/redirect", async (request, reply) => {
    const plan = request.query.plan;
    if (plan !== "starter" && plan !== "pro") {
      return reply.status(400).type("text/plain").send("Invalid plan");
    }

    const token = process.env.POLAR_ACCESS_TOKEN?.trim();
    const productId =
      plan === "starter"
        ? process.env.POLAR_STARTER_PRODUCT_ID?.trim()
        : process.env.POLAR_PRO_PRODUCT_ID?.trim();

    if (!token || !productId) {
      fastify.log.warn({ plan, hasToken: Boolean(token), hasProductId: Boolean(productId) }, "[polarCheckout] not configured");
      return reply.status(503).type("text/plain").send("Checkout is not configured (Polar token or product id).");
    }
    if (!isUuidV4Like(productId)) {
      fastify.log.warn({ plan }, "[polarCheckout] invalid Polar product UUID");
      // Fail fast: do not call Polar with malformed UUIDs (prevents opaque Polar 422 pages).
      return reply
        .status(503)
        .type("text/plain")
        .send(
          plan === "starter"
            ? "Checkout is misconfigured: POLAR_STARTER_PRODUCT_ID must be a valid UUID."
            : "Checkout is misconfigured: POLAR_PRO_PRODUCT_ID must be a valid UUID."
        );
    }

    const base = resolveAppBaseUrl(request);
    const success_url = `${base}/conversations?upgrade=${plan}_success`;
    const return_url = `${base}/pricing?checkout=canceled`;

    const checkoutUrlPolar = polarCheckoutCreateUrl();
    const payloadForLog = {
      products: [productId],
      success_url,
      return_url,
      polarEndpoint: checkoutUrlPolar,
    };

    let polarRes: Response;
    try {
      polarRes = await fetch(checkoutUrlPolar, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          products: [productId],
          success_url,
          return_url,
        }),
      });
    } catch (err) {
      fastify.log.error({ err }, "[polarCheckout] fetch failed");
      return reply.status(502).type("text/plain").send("Could not reach Polar checkout API.");
    }

    if (!polarRes.ok) {
      const detail = await polarRes.text();
      fastify.log.error(
        {
          status: polarRes.status,
          plan,
          polarBody: detail.slice(0, 4000),
          requestPayload: payloadForLog,
        },
        "[polarCheckout] Polar API error"
      );
      const hint =
        process.env.NODE_ENV !== "production"
          ? summarizePolarApiError(polarRes.status, detail)
          : `Polar checkout failed (${polarRes.status}).`;
      return reply.status(502).type("text/plain").send(hint);
    }

    const data = (await polarRes.json()) as { url?: string };
    const checkoutUrl = data.url;
    if (!checkoutUrl) {
      fastify.log.error({ data }, "[polarCheckout] missing url in response");
      return reply.status(502).type("text/plain").send("Invalid Polar checkout response.");
    }

    fastify.log.info({ plan, success_url, return_url }, "[polarCheckout] redirect to Polar");
    return reply.redirect(checkoutUrl);
  });

  /**
   * Starter → Pro: Polar rejects a second paid checkout for many existing subscribers.
   * Create a **customer portal** session so they can change plan (upgrade) in Polar.
   * Requires Organization Access Token scope `customer_sessions:write`.
   */
  fastify.post<{
    Body: { return_url?: string };
  }>("/billing/customer-portal/session", async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return reply.status(401).send({ error: "unauthenticated", message: "Missing or invalid Authorization header." });
    }
    if (!fastify.supabase) {
      return reply.status(503).send({ error: "server_misconfigured", message: "Auth is not configured on the backend." });
    }

    const token = authHeader.slice(7);
    const { data: userData, error: userErr } = await fastify.supabase.auth.getUser(token);
    if (userErr || !userData.user?.email) {
      return reply.status(401).send({
        error: "unauthenticated",
        message: userErr?.message ?? "Invalid or expired token.",
      });
    }

    const userId = userData.user.id;
    const email = userData.user.email;
    const usage = await getNormalizedUsageForUser(fastify.supabase, userId);
    const plan = usage?.plan ?? "free";
    /** Polar customer portal (manage subscription, upgrade/downgrade) — available to paid Starter and Pro. */
    if (plan !== "starter" && plan !== "pro") {
      return reply.status(400).send({
        error: "billing_portal_requires_paid_plan",
        message: "Manage billing is available for Starter and Pro subscribers.",
      });
    }

    const polarToken = process.env.POLAR_ACCESS_TOKEN?.trim();
    if (!polarToken) {
      return reply.status(503).send({ error: "billing_not_configured", message: "Polar is not configured." });
    }

    const return_url = typeof request.body?.return_url === "string" ? request.body.return_url.trim() : "";
    if (!return_url.startsWith("http://") && !return_url.startsWith("https://")) {
      return reply.status(400).send({
        error: "invalid_return_url",
        message: "return_url must be an absolute http(s) URL.",
      });
    }

    const customerId = await findPolarCustomerIdByEmail(email);
    if (!customerId) {
      fastify.log.warn({ userId }, "[polarPortal] no Polar customer for Starter profile — client may fall back to checkout");
      return reply.status(404).send({
        error: "polar_customer_not_found",
        message: "No Polar billing customer matched this account yet.",
      });
    }

    const polarUrl = polarCustomerSessionsCreateUrl();
    let polarRes: Response;
    try {
      polarRes = await fetch(polarUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${polarToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          customer_id: customerId,
          return_url,
        }),
      });
    } catch (err) {
      fastify.log.error({ err }, "[polarPortal] fetch failed");
      return reply.status(502).send({ error: "polar_unreachable", message: "Could not reach Polar API." });
    }

    const detail = await polarRes.text();
    if (!polarRes.ok) {
      fastify.log.error(
        { status: polarRes.status, polarBody: detail.slice(0, 4000), userId, customerId },
        "[polarPortal] Polar API error"
      );
      const message =
        process.env.NODE_ENV !== "production"
          ? summarizePolarApiError(polarRes.status, detail)
          : `Polar portal session failed (${polarRes.status}).`;
      return reply.status(502).send({ error: "polar_portal_failed", message });
    }

    let session: { customer_portal_url?: string };
    try {
      session = JSON.parse(detail) as { customer_portal_url?: string };
    } catch {
      fastify.log.error({ detail: detail.slice(0, 500) }, "[polarPortal] invalid JSON from Polar");
      return reply.status(502).send({ error: "invalid_polar_response", message: "Invalid Polar response." });
    }
    if (!session.customer_portal_url) {
      fastify.log.error({ session }, "[polarPortal] missing customer_portal_url");
      return reply.status(502).send({ error: "invalid_polar_response", message: "Polar response missing portal URL." });
    }

    fastify.log.info({ userId, customerId }, "[polarPortal] session created");
    return reply.send({ url: session.customer_portal_url });
  });

  fastify.post("/billing/sync-entitlement", {
    handler: async (request, reply) => {
      const authHeader = request.headers.authorization;
      const hasBillingConfig = Boolean(process.env.POLAR_ACCESS_TOKEN?.trim());
      fastify.log.info(
        {
          path: request.url,
          method: request.method,
          hasAuthHeader: Boolean(authHeader),
          hasBillingConfig,
        },
        "[billingSync] request received"
      );

      if (!authHeader?.startsWith("Bearer ")) {
        const response: BillingSyncEntitlementResponse = {
          ok: false,
          status: "unauthenticated",
          message: "Missing or invalid Authorization header.",
        };
        fastify.log.info({ status: response.status }, "[billingSync] request resolved");
        return reply.send(response);
      }

      if (!fastify.supabase) {
        const response: BillingSyncEntitlementResponse = {
          ok: false,
          status: "unauthenticated",
          message: "Auth is not configured on the backend.",
        };
        fastify.log.warn({ status: response.status }, "[billingSync] supabase client unavailable");
        return reply.send(response);
      }

      const token = authHeader.slice(7);
      const { data, error } = await fastify.supabase.auth.getUser(token);
      if (error || !data.user) {
        const response: BillingSyncEntitlementResponse = {
          ok: false,
          status: "unauthenticated",
          message: error?.message ?? "Invalid or expired token.",
        };
        fastify.log.warn(
          { status: response.status, message: response.message },
          "[billingSync] auth rejected"
        );
        return reply.send(response);
      }

      const userId = data.user.id;
      const email = data.user.email ?? null;
      fastify.log.info({ userId, email }, "[billingSync] authenticated request");

      const sync = await syncPolarEntitlementForUser({
        supabase: fastify.supabase,
        userId,
        email,
        logger: fastify.log,
      });

      const normalizedUsage = await getNormalizedUsageForUser(fastify.supabase, userId);
      const usage = await getFreeTierUsageSnapshot(fastify.supabase, userId);
      const syncedPlanType = sync.ok ? sync.planType ?? null : null;
      const planType = normalizedUsage?.plan ?? syncedPlanType;
      const entitlements = planType ? getPlanEntitlements(planType) : undefined;
      const status = mapSyncResultToStatus(sync);

      const response: BillingSyncEntitlementResponse = {
        ok: sync.ok,
        status,
        planType,
        ...(entitlements ? { entitlements } : {}),
        ...(usage != null ? { usage } : {}),
        message: sync.reason,
      };

      if (usage == null) {
        response.ok = false;
        response.status = "profile_not_found";
        response.message = "Usage/profile record not found for authenticated user.";
      }

      fastify.log.info(
        {
          userId,
          status: response.status,
          planType: response.planType ?? null,
          hasUsage: Boolean(response.usage),
          entitlements: response.entitlements ?? null,
        },
        "[billingSync] request resolved"
      );

      return reply.send(response);
    },
  });
}
