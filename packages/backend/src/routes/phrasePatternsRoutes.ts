import type { FastifyInstance } from "fastify";
import { sendApiError } from "../lib/apiErrors.js";

export async function phrasePatternsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    "/phrase-patterns",
    { preHandler: [fastify.authenticate] },
    async (_req, reply) => {
      const { data, error } = await fastify.supabase
        .from("phrase_patterns")
        .select("phrase, deal_type, vertical, occurrences, conversation_count, last_seen_at")
        .order("occurrences", { ascending: false })
        .order("conversation_count", { ascending: false })
        .limit(100);

      if (error) {
        return sendApiError(reply, {
          status: 500,
          code: "INTERNAL_ERROR",
          message: "Failed to load phrase patterns",
        });
      }

      return reply.send({ patterns: data ?? [] });
    }
  );
}
