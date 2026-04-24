/**
 * In-memory burst limiter for expensive generation REST routes only.
 * ~10 requests per rolling 10s window per logical key (authenticated user id preferred).
 *
 * // NOTE: in-memory limiter is per-instance.
 * // For horizontal scaling, move to shared store (Redis) in future.
 *
 * Rolling-window pruning smooths edge timing vs strict fixed buckets (minimal jitter tolerance).
 */

import type { FastifyRequest } from "fastify";

const WINDOW_MS = 10_000;
const MAX_REQUESTS = 10;

const buckets = new Map<string, number[]>();

export type RateLimitRequestPick = Pick<FastifyRequest, "ip" | "socket" | "headers">;

export function getClientIpForRateLimit(req: RateLimitRequestPick): string {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.trim()) {
    const first = xf.split(",")[0]?.trim();
    if (first) return first;
  }
  const xri = req.headers["x-real-ip"];
  if (typeof xri === "string" && xri.trim()) return xri.trim();
  return req.socket?.remoteAddress ?? req.ip ?? "unknown";
}

/** Prefer stable user id; fallback to IP for unauthenticated attempts (same route). Prefixes prevent key collisions. */
export function resolveGenerationBurstKey(
  authenticatedUserId: string | null | undefined,
  req: RateLimitRequestPick
): string {
  const id = authenticatedUserId?.trim();
  if (id) return `u:${id}`;
  return `ip:${getClientIpForRateLimit(req)}`;
}

export function consumeGenerationBurstSlot(slotKey: string): boolean {
  const now = Date.now();
  const pruned = (buckets.get(slotKey) ?? []).filter((t) => now - t < WINDOW_MS);
  if (pruned.length >= MAX_REQUESTS) {
    buckets.set(slotKey, pruned);
    return false;
  }
  pruned.push(now);
  buckets.set(slotKey, pruned);
  return true;
}
