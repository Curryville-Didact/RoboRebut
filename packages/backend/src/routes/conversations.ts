/**
 * conversations.ts — Phase 3.0
 * CRUD for user conversations. All routes require authentication.
 */

import type { FastifyInstance } from "fastify";
import type { ClientContext } from "../types/clientContext.js";
import type { DealContext } from "../types/dealContext.js";
import { getNormalizedUsageForUser } from "../services/freeTierUsage.js";
import { getPlanEntitlements } from "../services/planEntitlements.js";

type ConversationRow = {
  id: string;
  user_id: string;
  title: string;
  deal_context: DealContext | null;
  call_transcript?: string | null;
  client_context?: ClientContext | null;
  created_at: string;
  updated_at: string;
};

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
      return reply.send((data ?? []) as ConversationRow[]);
    },
  });

  // GET /api/conversations/:id
  fastify.get<{ Params: { id: string } }>("/conversations/:id", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      const { id } = request.params;

      const { data, error } = await fastify.supabase
        .from("conversations")
        .select("*")
        .eq("id", id)
        .eq("user_id", request.user.id)
        .maybeSingle();

      if (error) return reply.status(500).send({ error: error.message });
      if (!data) return reply.status(404).send({ error: "Conversation not found" });
      return reply.send(data as ConversationRow);
    },
  });

  // POST /api/conversations
  fastify.post<{
    Body: {
      title?: string;
      deal_context?: Record<string, unknown> | null;
      transcript?: string;
      client_context?: ClientContext | null;
    };
  }>("/conversations", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      const { title = "New Conversation" } = request.body ?? {};

      const transcript =
        typeof request.body?.transcript === "string" ? request.body.transcript.trim() : "";

      const { data, error } = await fastify.supabase
        .from("conversations")
        .insert({
          user_id: request.user.id,
          title,
          ...(transcript ? { call_transcript: transcript } : {}),
          ...(request.body?.deal_context !== undefined
            ? { deal_context: request.body.deal_context }
            : {}),
          ...(request.body?.client_context !== undefined
            ? { client_context: request.body.client_context }
            : {}),
        })
        .select()
        .single();

      if (error) return reply.status(500).send({ error: error.message });
      return reply.status(201).send(data as ConversationRow);
    },
  });

  // PATCH /api/conversations/:id — optional `title`, `deal_context`, and/or `client_context`
  fastify.patch<{
    Params: { id: string };
    Body: {
      title?: string;
      deal_context?: DealContext | null;
      client_context?: ClientContext | null;
    };
  }>("/conversations/:id", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      const { id } = request.params;
      const body = request.body ?? {};
      const hasTitleKey = Object.prototype.hasOwnProperty.call(body, "title");
      const hasDealContextKey = Object.prototype.hasOwnProperty.call(
        body,
        "deal_context"
      );
      const hasClientContextKey = Object.prototype.hasOwnProperty.call(
        body,
        "client_context"
      );

      if (!hasTitleKey && !hasDealContextKey && !hasClientContextKey) {
        return reply.status(400).send({
          error:
            "Provide title, deal_context, and/or client_context to update.",
        });
      }

      const updates: Record<string, unknown> = {};

      if (hasTitleKey) {
        const title = typeof body.title === "string" ? body.title.trim() : "";
        if (!title) {
          return reply
            .status(400)
            .send({ error: "title cannot be empty when provided." });
        }
        if (title === "New Conversation") {
          return reply.status(400).send({
            error: "Please choose a more specific title.",
          });
        }
        updates.title = title;
      }

      if (hasDealContextKey) {
        const dc = body.deal_context;
        if (dc !== null && (typeof dc !== "object" || Array.isArray(dc))) {
          return reply.status(400).send({ error: "Invalid deal_context" });
        }
        const usageRow = await getNormalizedUsageForUser(
          fastify.supabase,
          request.user.id
        );
        const planType = usageRow?.plan ?? "free";
        const entitlements = getPlanEntitlements(planType);
        if (dc !== null && !entitlements.structuredDealContext) {
          return reply.status(403).send({
            error: "Structured deal context requires a Pro plan.",
            code: "deal_context_pro_required",
          });
        }
        let serialized: unknown;
        try {
          serialized = dc === null ? null : JSON.parse(JSON.stringify(dc));
        } catch {
          return reply
            .status(400)
            .send({ error: "deal_context is not JSON-serializable" });
        }
        updates.deal_context = serialized;
      }

      if (hasClientContextKey) {
        const cc = body.client_context;
        if (cc !== null && (typeof cc !== "object" || Array.isArray(cc))) {
          return reply.status(400).send({ error: "Invalid client_context" });
        }
        let serializedCc: unknown;
        try {
          serializedCc = cc === null ? null : JSON.parse(JSON.stringify(cc));
        } catch {
          return reply
            .status(400)
            .send({ error: "client_context is not JSON-serializable" });
        }
        updates.client_context = serializedCc;
      }

      if (Object.keys(updates).length === 0) {
        return reply.status(400).send({ error: "Nothing to update." });
      }

      // Do not touch updated_at — it tracks message activity for sort order.

      const { data, error } = await fastify.supabase
        .from("conversations")
        .update(updates)
        .eq("id", id)
        .eq("user_id", request.user.id)
        .select()
        .single();

      if (error) return reply.status(500).send({ error: error.message });
      if (!data) return reply.status(404).send({ error: "Conversation not found" });
      return reply.send(data as ConversationRow);
    },
  });

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
