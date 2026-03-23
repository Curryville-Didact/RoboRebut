/**
 * savedResponses.ts — Phase 3.0
 * User's saved rebuttal library. All routes require authentication.
 */

import type { FastifyInstance } from "fastify";

interface SavedResponseBody {
  label: string;
  content: string;
  category?: string;
}

export async function savedResponseRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /api/saved-responses
  fastify.get("/saved-responses", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      const { data, error } = await fastify.supabase
        .from("saved_responses")
        .select("*")
        .eq("user_id", request.user.id)
        .order("created_at", { ascending: false });

      if (error) return reply.status(500).send({ error: error.message });
      return reply.send(data);
    },
  });

  // POST /api/saved-responses
  fastify.post<{ Body: SavedResponseBody }>("/saved-responses", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      const { label, content, category } = request.body;

      if (!label || !content) {
        return reply.status(400).send({ error: "label and content are required" });
      }

      const { data, error } = await fastify.supabase
        .from("saved_responses")
        .insert({
          user_id: request.user.id,
          label,
          content,
          category: category ?? null,
        })
        .select()
        .single();

      if (error) return reply.status(500).send({ error: error.message });
      return reply.status(201).send(data);
    },
  });

  // DELETE /api/saved-responses/:id
  fastify.delete<{ Params: { id: string } }>("/saved-responses/:id", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      const { id } = request.params;

      const { error } = await fastify.supabase
        .from("saved_responses")
        .delete()
        .eq("id", id)
        .eq("user_id", request.user.id);

      if (error) return reply.status(500).send({ error: error.message });
      return reply.status(204).send();
    },
  });
}
