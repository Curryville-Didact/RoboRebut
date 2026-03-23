/**
 * messages.ts — Phase 3.0
 * Messages within a conversation. All routes require authentication.
 */

import type { FastifyInstance } from "fastify";

interface MessageBody {
  role: "user" | "ai";
  content: string;
  objection_type?: string;
  strategy_used?: string;
}

export async function messageRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /api/conversations/:id/messages
  fastify.get<{ Params: { id: string } }>("/conversations/:id/messages", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      const { id } = request.params;

      const { data, error } = await fastify.supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", id)
        .eq("user_id", request.user.id)
        .order("created_at", { ascending: true });

      if (error) return reply.status(500).send({ error: error.message });
      return reply.send(data);
    },
  });

  // POST /api/conversations/:id/messages
  fastify.post<{ Params: { id: string }; Body: MessageBody }>(
    "/conversations/:id/messages",
    {
      preHandler: [fastify.authenticate],
      handler: async (request, reply) => {
        const { id } = request.params;
        const { role, content, objection_type, strategy_used } = request.body;

        if (!role || !content) {
          return reply.status(400).send({ error: "role and content are required" });
        }

        const { data, error } = await fastify.supabase
          .from("messages")
          .insert({
            conversation_id: id,
            user_id: request.user.id,
            role,
            content,
            objection_type: objection_type ?? null,
            strategy_used: strategy_used ?? null,
          })
          .select()
          .single();

        if (error) return reply.status(500).send({ error: error.message });
        return reply.status(201).send(data);
      },
    }
  );
}
