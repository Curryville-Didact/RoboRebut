import type { FastifyInstance } from "fastify";
import {
  getAnalyticsSummary,
  getRecentEvents,
  trackEvent,
} from "../services/eventTracker.js";

// Simple in-memory rate limiter for the open POST endpoint
const ipHitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 30;        // max 30 events
const RATE_WINDOW_MS = 60_000; // per 60 seconds per IP

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = ipHitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    ipHitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  if (entry.count >= RATE_LIMIT) return true;
  entry.count++;
  return false;
}

// Clean up old entries every 5 minutes so memory doesn't grow forever
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of ipHitMap.entries()) {
    if (now > entry.resetAt) ipHitMap.delete(ip);
  }
}, 300_000);

export async function analyticsRoutes(fastify: FastifyInstance): Promise<void> {

  // GET /analytics/events — founder only, requires Bearer auth
  fastify.get<{
    Querystring: {
      eventName?: string;
      planType?: string;
      ctaGroup?: string;
      limit?: string;
    };
  }>("/analytics/events", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      const limit =
        typeof request.query.limit === "string"
          ? Number(request.query.limit)
          : undefined;
      const events = await getRecentEvents({
        eventName: request.query.eventName,
        planType: request.query.planType,
        ctaGroup: request.query.ctaGroup,
        limit,
      });
      return reply.send(events);
    },
  });

  // GET /analytics/summary — founder only, requires Bearer auth
  fastify.get<{
    Querystring: {
      eventName?: string;
      planType?: string;
      ctaGroup?: string;
    };
  }>("/analytics/summary", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      const summary = await getAnalyticsSummary({
        eventName: request.query.eventName,
        planType: request.query.planType,
        ctaGroup: request.query.ctaGroup,
      });
      return reply.send(summary);
    },
  });

  // POST /analytics/events — open (no auth, browser fire-and-forget)
  // Protected by IP rate limit: 30 events per IP per 60 seconds
  fastify.post<{ Body: unknown }>("/analytics/events", {
    handler: async (request, reply) => {
      const ip =
        (request.headers["x-forwarded-for"] as string)?.split(",")[0].trim() ??
        request.ip ??
        "unknown";

      if (isRateLimited(ip)) {
        return reply.status(429).send({ ok: false, error: "rate_limited" });
      }

      try {
        trackEvent(fastify.log, request.body, {
          supabase: fastify.supabase ?? undefined,
        });
      } catch (err) {
        fastify.log.warn({ err }, "analytics event handling failed");
      }

      return reply.status(202).send({ ok: true });
    },
  });
}
