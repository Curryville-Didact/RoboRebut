/**
 * conversations.ts — Phase 3.0
 * CRUD for user conversations. All routes require authentication.
 */

import type { FastifyInstance } from "fastify";

export async function conversationRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /api/conversations
  fastify.get("/conversations", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      const { data, error } = await fastify.supabase
        .from("conversations")
        .select("*")
        .eq("user_id", request.user.id)
        .order("updated_at", { ascending: false });

      if (error) return reply.status(500).send({ error: error.message });
      return reply.send(data);
    },
  });

  // POST /api/conversations
  fastify.post<{ Body: { title?: string } }>("/conversations", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      const { title = "New Conversation" } = request.body ?? {};

      const { data, error } = await fastify.supabase
        .from("conversations")
        .insert({ user_id: request.user.id, title })
        .select()
        .single();

      if (error) return reply.status(500).send({ error: error.message });
      return reply.status(201).send(data);
    },
  });

  // PATCH /api/conversations/:id
  fastify.patch<{ Params: { id: string }; Body: { title: string } }>(
    "/conversations/:id",
    {
      preHandler: [fastify.authenticate],
      handler: async (request, reply) => {
        const { id } = request.params;
        const { title } = request.body;

        const { data, error } = await fastify.supabase
          .from("conversations")
          .update({ title, updated_at: new Date().toISOString() })
          .eq("id", id)
          .eq("user_id", request.user.id)
          .select()
          .single();

        if (error) return reply.status(500).send({ error: error.message });
        if (!data) return reply.status(404).send({ error: "Conversation not found" });
        return reply.send(data);
      },
    }
  );

  // DELETE /api/conversations/:id
  fastify.delete<{ Params: { id: string } }>("/conversations/:id", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      const { id } = request.params;

      const { error } = await fastify.supabase
        .from("conversations")
        .delete()
        .eq("id", id)
        .eq("user_id", request.user.id);

      if (error) return reply.status(500).send({ error: error.message });
      return reply.status(204).send();
    },
  });
}
