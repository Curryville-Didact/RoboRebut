/**
 * Phase 12 — Integrations management + inbound trigger.
 */

import type { FastifyInstance } from "fastify";
import { sendApiError } from "../lib/apiErrors.js";
import {
  asOptionalTrimmedString,
  asStringArray,
  requireOneOf,
} from "../lib/validation.js";
import {
  dispatchTestToEndpoint,
} from "../services/integrations/outboundDispatcher.js";
import { generateRebuttals } from "../services/responseGenerator.js";
import { formatResponse } from "../services/responseFormatter.js";
import { resolveToneModeForPlan } from "../services/toneAccess.js";
import {
  assertUsageAllowance,
  incrementUsageCount,
  isPlanEnforcementError,
  resolvePlanContextForUserId,
} from "../services/planEnforcement.js";

const PROVIDERS = [
  "generic_webhook",
  "hubspot",
  "salesforce",
  "ghl",
  "zoho",
  "velocify",
] as const;

const AUTH_TYPES = ["none", "bearer", "header"] as const;

const EVENT_TYPES = ["rebuttal.generated", "review.submitted"] as const;

function isValidHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function redactEndpointRow(row: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...row };
  if ("signing_secret" in copy) copy.signing_secret = null;
  if ("auth_config" in copy && copy.auth_config && typeof copy.auth_config === "object") {
    const ac = copy.auth_config as Record<string, unknown>;
    const redacted: Record<string, unknown> = { ...ac };
    if ("token" in redacted) redacted.token = null;
    if ("headerValue" in redacted) redacted.headerValue = null;
    copy.auth_config = redacted;
  }
  return copy;
}

export async function integrationsRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /api/integrations
  fastify.get("/integrations", { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const userId = req.user.id;
    const { data, error } = await fastify.supabase
      .from("integration_endpoints")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) {
      return sendApiError(reply, { status: 500, code: "INTERNAL_ERROR", message: "Failed to load integrations" });
    }
    return reply.send({ ok: true, items: (data ?? []).map((r) => redactEndpointRow(r as any)) });
  });

  // POST /api/integrations
  fastify.post<{
    Body: {
      provider_type?: string;
      endpoint_url?: string;
      is_enabled?: boolean;
      event_types?: string[];
      signing_secret?: string | null;
      auth_type?: string;
      auth_config?: Record<string, unknown> | null;
      metadata?: Record<string, unknown> | null;
    };
  }>("/integrations", { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const userId = req.user.id;
    const body = req.body ?? {};

    const provider = requireOneOf(body.provider_type, PROVIDERS);
    if (!provider) {
      return sendApiError(reply, { status: 400, code: "INVALID_REQUEST", message: `provider_type must be one of: ${PROVIDERS.join(", ")}` });
    }
    const url = asOptionalTrimmedString(body.endpoint_url, 500);
    if (!url || !isValidHttpUrl(url)) {
      return sendApiError(reply, { status: 400, code: "INVALID_REQUEST", message: "endpoint_url must be a valid http(s) URL" });
    }

    const authType = requireOneOf(body.auth_type ?? "none", AUTH_TYPES);
    if (!authType) {
      return sendApiError(reply, { status: 400, code: "INVALID_REQUEST", message: `auth_type must be one of: ${AUTH_TYPES.join(", ")}` });
    }

    const eventTypes = body.event_types ? asStringArray(body.event_types, 10, 64) : [];
    if (body.event_types != null && eventTypes == null) {
      return sendApiError(reply, { status: 400, code: "INVALID_REQUEST", message: "event_types must be an array of strings" });
    }
    const normalizedEventTypes = (eventTypes ?? []).filter((t) => (EVENT_TYPES as readonly string[]).includes(t));
    if (normalizedEventTypes.length === 0) {
      return sendApiError(reply, { status: 400, code: "INVALID_REQUEST", message: `event_types must include one of: ${EVENT_TYPES.join(", ")}` });
    }

    const signingSecret = asOptionalTrimmedString(body.signing_secret, 200);
    const { data, error } = await fastify.supabase
      .from("integration_endpoints")
      .insert({
        user_id: userId,
        provider_type: provider,
        endpoint_url: url,
        is_enabled: body.is_enabled !== false,
        event_types: normalizedEventTypes,
        signing_secret: signingSecret,
        auth_type: authType,
        auth_config: body.auth_config ?? null,
        metadata: body.metadata ?? null,
        updated_at: new Date().toISOString(),
      })
      .select("*")
      .single();
    if (error || !data) {
      return sendApiError(reply, { status: 500, code: "INTERNAL_ERROR", message: "Failed to create integration" });
    }
    req.log.info({ userId, integrationId: data.id, provider }, "integration_created");
    return reply.send({ ok: true, item: redactEndpointRow(data as any) });
  });

  // PATCH /api/integrations/:id
  fastify.patch<{
    Params: { id: string };
    Body: {
      is_enabled?: boolean;
      endpoint_url?: string;
      event_types?: string[];
      signing_secret?: string | null;
      auth_type?: string;
      auth_config?: Record<string, unknown> | null;
      metadata?: Record<string, unknown> | null;
    };
  }>("/integrations/:id", { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const userId = req.user.id;
    const id = req.params.id;
    const body = req.body ?? {};

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.is_enabled != null) patch.is_enabled = !!body.is_enabled;

    if (body.endpoint_url != null) {
      const url = asOptionalTrimmedString(body.endpoint_url, 500);
      if (!url || !isValidHttpUrl(url)) {
        return sendApiError(reply, { status: 400, code: "INVALID_REQUEST", message: "endpoint_url must be a valid http(s) URL" });
      }
      patch.endpoint_url = url;
    }

    if (body.event_types != null) {
      const eventTypes = asStringArray(body.event_types, 10, 64);
      if (!eventTypes) {
        return sendApiError(reply, { status: 400, code: "INVALID_REQUEST", message: "event_types must be an array of strings" });
      }
      const normalized = eventTypes.filter((t) => (EVENT_TYPES as readonly string[]).includes(t));
      if (normalized.length === 0) {
        return sendApiError(reply, { status: 400, code: "INVALID_REQUEST", message: `event_types must include one of: ${EVENT_TYPES.join(", ")}` });
      }
      patch.event_types = normalized;
    }

    if (body.signing_secret !== undefined) {
      patch.signing_secret = asOptionalTrimmedString(body.signing_secret, 200);
    }

    if (body.auth_type != null) {
      const authType = requireOneOf(body.auth_type, AUTH_TYPES);
      if (!authType) {
        return sendApiError(reply, { status: 400, code: "INVALID_REQUEST", message: `auth_type must be one of: ${AUTH_TYPES.join(", ")}` });
      }
      patch.auth_type = authType;
    }

    if (body.auth_config !== undefined) patch.auth_config = body.auth_config ?? null;
    if (body.metadata !== undefined) patch.metadata = body.metadata ?? null;

    const { data, error } = await fastify.supabase
      .from("integration_endpoints")
      .update(patch)
      .eq("id", id)
      .eq("user_id", userId)
      .select("*")
      .maybeSingle();
    if (error) {
      return sendApiError(reply, { status: 500, code: "INTERNAL_ERROR", message: "Failed to update integration" });
    }
    if (!data) {
      return sendApiError(reply, { status: 404, code: "NOT_FOUND", message: "Integration not found" });
    }
    req.log.info({ userId, integrationId: id }, "integration_updated");
    return reply.send({ ok: true, item: redactEndpointRow(data as any) });
  });

  // POST /api/integrations/:id/test
  fastify.post<{ Params: { id: string } }>("/integrations/:id/test", { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const userId = req.user.id;
    const id = req.params.id;
    const { data, error } = await fastify.supabase
      .from("integration_endpoints")
      .select("*")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) return sendApiError(reply, { status: 500, code: "INTERNAL_ERROR", message: "Failed to load integration" });
    if (!data) return sendApiError(reply, { status: 404, code: "NOT_FOUND", message: "Integration not found" });

    // Deterministic test payload.
    const payload = {
      event: "integration.test",
      timestamp: new Date().toISOString(),
      user_id: userId,
      integration_endpoint_id: id,
      metadata: { source: "roborebut" },
    };

    try {
      await dispatchTestToEndpoint({
        supabase: fastify.supabase,
        userId,
        integrationEndpointId: id,
        payload,
      });
    } catch { /* ignore */ }
    req.log.info({ userId, integrationId: id }, "integration_test_sent");
    return reply.send({ ok: true });
  });

  // GET /api/integrations/:id/logs
  fastify.get<{ Params: { id: string } }>("/integrations/:id/logs", { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const userId = req.user.id;
    const id = req.params.id;
    const { data: logs, error } = await fastify.supabase
      .from("integration_delivery_logs")
      .select("*")
      .eq("user_id", userId)
      .eq("integration_endpoint_id", id)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) return sendApiError(reply, { status: 500, code: "INTERNAL_ERROR", message: "Failed to load logs" });
    return reply.send({ ok: true, items: logs ?? [] });
  });

  // POST /api/integrations/rebuttal-trigger (authenticated)
  fastify.post<{
    Body: { objection?: string; tone_override?: string; category?: string };
  }>("/integrations/rebuttal-trigger", { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const userId = req.user.id;
    const objection = asOptionalTrimmedString(req.body?.objection, 1500);
    if (!objection) {
      return sendApiError(reply, { status: 400, code: "INVALID_REQUEST", message: "objection must be a non-empty string" });
    }

    // Reuse existing rebuttal generator path (same service as /api/rebuttal), no Live changes.
    const access = await resolvePlanContextForUserId(fastify.supabase, userId);
    try {
      await assertUsageAllowance(fastify.supabase, access);
    } catch (err) {
      if (isPlanEnforcementError(err)) {
        return reply.status(err.statusCode).send({ code: err.code, message: err.message });
      }
      throw err;
    }
    const { planType, entitlements } = access;
    const resolvedTone = resolveToneModeForPlan(req.body?.tone_override, planType);
    const payload = {
      raw_input: objection,
      category: req.body?.category ?? "other",
      intent: undefined,
      emotional_tone: undefined,
      urgency: undefined,
      confidence: undefined,
      signals: undefined,
      tone_override: resolvedTone.tone,
    };

    const variantCount = entitlements.responseVariants;
    const out = await generateRebuttals(payload as any, {
      variantCount,
      priorityGeneration: entitlements.priorityGeneration,
      planType,
    });
    await incrementUsageCount(fastify.supabase, userId);
    const formatted = formatResponse(out as any, payload as any, {
      mode: "suggestion",
      variantCount,
    });
    req.log.info({ userId, route: "/integrations/rebuttal-trigger" }, "integration_trigger_ok");
    return reply.send({ ok: true, formatted });
  });
}

