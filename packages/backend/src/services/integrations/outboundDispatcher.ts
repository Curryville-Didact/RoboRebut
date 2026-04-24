/**
 * Phase 12 — Outbound integration dispatcher (CRM-agnostic webhooks).
 *
 * Best-effort: must never throw into callers that handle core app flows.
 * No retries/workers in this phase; durable delivery logs are written.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

export type IntegrationEventType = "rebuttal.generated" | "review.submitted" | "integration.test";

export type OutboundEventPayload = Record<string, unknown>;

type EndpointRow = {
  id: string;
  user_id: string;
  is_enabled: boolean;
  provider_type: string;
  endpoint_url: string;
  signing_secret: string | null;
  auth_type: string;
  auth_config: Record<string, unknown> | null;
  event_types: string[];
};

function safeJsonPreview(payload: OutboundEventPayload): Record<string, unknown> {
  // Compact preview: never include secrets; truncate long strings.
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (typeof v === "string") {
      out[k] = v.length > 200 ? `${v.slice(0, 200)}…` : v;
    } else if (typeof v === "number" || typeof v === "boolean" || v == null) {
      out[k] = v;
    } else if (k === "metadata" && v && typeof v === "object") {
      out[k] = v;
    }
  }
  return out;
}

export function computeHmacSignature(secret: string, body: string): string {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

function isValidHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function authHeadersForEndpoint(e: EndpointRow): Record<string, string> {
  const authType = (e.auth_type ?? "none").trim();
  if (authType === "bearer") {
    const token =
      e.auth_config && typeof e.auth_config.token === "string"
        ? e.auth_config.token
        : "";
    return token ? { Authorization: `Bearer ${token}` } : {};
  }
  if (authType === "header") {
    const headerName =
      e.auth_config && typeof e.auth_config.headerName === "string"
        ? e.auth_config.headerName
        : "";
    const headerValue =
      e.auth_config && typeof e.auth_config.headerValue === "string"
        ? e.auth_config.headerValue
        : "";
    return headerName && headerValue ? { [headerName]: headerValue } : {};
  }
  return {};
}

export async function dispatchOutboundIntegrationEvent(input: {
  supabase: SupabaseClient;
  userId: string;
  eventType: IntegrationEventType;
  payload: OutboundEventPayload;
  correlationId?: string | null;
}): Promise<void> {
  const { supabase, userId, eventType, payload } = input;

  const { data, error } = await supabase
    .from("integration_endpoints")
    .select("*")
    .eq("user_id", userId)
    .eq("is_enabled", true);
  if (error) throw new Error(error.message);
  const endpoints = (data ?? []) as unknown as EndpointRow[];

  const eligible = endpoints.filter((e) => {
    if (!e.endpoint_url || !isValidHttpUrl(e.endpoint_url)) return false;
    const types = Array.isArray(e.event_types) ? e.event_types : [];
    return types.includes(eventType);
  });
  if (eligible.length === 0) return;

  const body = JSON.stringify(payload);

  await Promise.all(
    eligible.map(async (e) => {
      const t0 = Date.now();
      const preview = safeJsonPreview(payload);
      let httpStatus: number | null = null;
      let status: "delivered" | "failed" = "failed";
      let errMsg: string | null = null;
      let retryable = false;

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3500);
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "User-Agent": "roborebut-integrations/1.0",
          ...authHeadersForEndpoint(e),
        };
        if (e.signing_secret) {
          headers["X-RoboRebut-Signature"] = computeHmacSignature(e.signing_secret, body);
          headers["X-RoboRebut-Signature-Alg"] = "sha256";
        }
        const res = await fetch(e.endpoint_url, {
          method: "POST",
          headers,
          body,
          signal: controller.signal,
        });
        clearTimeout(timeout);
        httpStatus = res.status;
        status = res.ok ? "delivered" : "failed";
        retryable = !res.ok && (res.status >= 500 || res.status === 408 || res.status === 429);
        if (!res.ok) {
          errMsg = `HTTP ${res.status}`;
        }
      } catch (err) {
        errMsg = err instanceof Error ? err.message : "delivery_error";
        retryable = true;
      } finally {
        const durationMs = Date.now() - t0;
        const { error: logErr } = await supabase.from("integration_delivery_logs").insert({
          integration_endpoint_id: e.id,
          user_id: userId,
          event_type: eventType,
          delivery_status: status,
          http_status: httpStatus,
          duration_ms: durationMs,
          correlation_id: input.correlationId ?? null,
          error_message: errMsg,
          payload_preview: preview,
          retryable,
        });
        if (logErr) {
          // Best-effort: ignore logging failures.
        }
      }
    })
  );
}

export async function dispatchTestToEndpoint(input: {
  supabase: SupabaseClient;
  userId: string;
  integrationEndpointId: string;
  payload: OutboundEventPayload;
}): Promise<void> {
  const { supabase, userId } = input;
  const { data, error } = await supabase
    .from("integration_endpoints")
    .select("*")
    .eq("user_id", userId)
    .eq("id", input.integrationEndpointId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return;
  const e = data as unknown as EndpointRow;
  if (!e.endpoint_url || !isValidHttpUrl(e.endpoint_url)) return;
  const payload = input.payload;
  const body = JSON.stringify(payload);

  const t0 = Date.now();
  const preview = safeJsonPreview(payload);
  let httpStatus: number | null = null;
  let status: "delivered" | "failed" = "failed";
  let errMsg: string | null = null;
  let retryable = false;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "roborebut-integrations/1.0",
      ...authHeadersForEndpoint(e),
    };
    if (e.signing_secret) {
      headers["X-RoboRebut-Signature"] = computeHmacSignature(e.signing_secret, body);
      headers["X-RoboRebut-Signature-Alg"] = "sha256";
    }
    const res = await fetch(e.endpoint_url, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    httpStatus = res.status;
    status = res.ok ? "delivered" : "failed";
    retryable = !res.ok && (res.status >= 500 || res.status === 408 || res.status === 429);
    if (!res.ok) errMsg = `HTTP ${res.status}`;
  } catch (err) {
    errMsg = err instanceof Error ? err.message : "delivery_error";
    retryable = true;
  } finally {
    const durationMs = Date.now() - t0;
    await supabase.from("integration_delivery_logs").insert({
      integration_endpoint_id: e.id,
      user_id: userId,
      event_type: "integration.test",
      delivery_status: status,
      http_status: httpStatus,
      duration_ms: durationMs,
      correlation_id: `test_${e.id}`,
      error_message: errMsg,
      payload_preview: preview,
      retryable,
    });
  }
}

