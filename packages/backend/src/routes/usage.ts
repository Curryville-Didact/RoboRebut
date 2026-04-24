/**
 * Phase 5.3 — Expose current free-tier usage for dashboard meters (GET only).
 */

import type { FastifyInstance } from "fastify";
import { getFreeTierUsageSnapshot } from "../services/freeTierUsage.js";

export async function usageRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/usage", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      const userId = request.user.id;
      const snap = await getFreeTierUsageSnapshot(fastify.supabase, userId);
      if (!snap) {
        return reply
          .status(503)
          .send({ error: "Could not read usage. Try again." });
      }
      return reply.send(snap);
    },
  });
}
