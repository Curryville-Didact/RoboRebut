import type { FastifyInstance } from "fastify";
import {
  getAnalyticsSummary,
  getRecentEvents,
  trackEvent,
} from "../services/eventTracker.js";

export async function analyticsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{
    Querystring: {
      eventName?: string;
      planType?: string;
      ctaGroup?: string;
      limit?: string;
    };
  }>("/analytics/events", {
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

  fastify.get<{
    Querystring: {
      eventName?: string;
      planType?: string;
      ctaGroup?: string;
    };
  }>("/analytics/summary", {
    handler: async (request, reply) => {
      const summary = await getAnalyticsSummary({
        eventName: request.query.eventName,
        planType: request.query.planType,
        ctaGroup: request.query.ctaGroup,
      });
      return reply.send(summary);
    },
  });

  fastify.post<{ Body: unknown }>("/analytics/events", {
    handler: async (request, reply) => {
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
