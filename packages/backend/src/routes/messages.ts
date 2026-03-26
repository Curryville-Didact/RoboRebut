/**
 * messages.ts — conversation thread messages + send (user + AI reply).
 */

import type { FastifyInstance } from "fastify";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateCoachReply } from "../services/coachChatReply.js";

/**
 * Derive a short, readable conversation title from the first user message.
 * Strategy: take the first 6 words, strip trailing punctuation, cap at 50 chars.
 * No AI call — deterministic, fast, always succeeds.
 */
function deriveTitle(message: string): string {
  const words = message.trim().split(/\s+/).slice(0, 6).join(" ");
  const capped = words.length > 50 ? words.slice(0, 50) : words;
  // Strip trailing punctuation that looks bad as a title
  return capped.replace(/[.,!?;:]+$/, "").trim() || "Conversation";
}

type MessageRow = {
  id: string;
  conversation_id: string;
  user_id: string;
  role: string;
  content: string;
  objection_type: string | null;
  strategy_used: string | null;
  created_at: string;
};

async function getOwnedConversation(
  supabase: SupabaseClient,
  conversationId: string,
  userId: string
): Promise<{ id: string; title: string } | null> {
  const { data, error } = await supabase
    .from("conversations")
    .select("id, title")
    .eq("id", conversationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}

export async function messageRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /api/messages — send user message, generate AI reply, persist both
  fastify.post<{
    Body: { conversation_id?: string; content?: string };
  }>("/messages", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      const conversationId = request.body?.conversation_id?.trim();
      const content = request.body?.content?.trim();

      if (!conversationId) {
        return reply.status(400).send({ error: "conversation_id is required" });
      }
      if (!content) {
        return reply.status(400).send({ error: "content is required" });
      }

      const userId = request.user.id;
      const supabase = fastify.supabase;

      const conv = await getOwnedConversation(supabase, conversationId, userId);
      if (!conv) {
        return reply.status(404).send({ error: "Conversation not found" });
      }

      const { data: priorRows, error: priorErr } = await supabase
        .from("messages")
        .select("role, content")
        .eq("conversation_id", conversationId)
        .eq("user_id", userId)
        .order("created_at", { ascending: true });

      if (priorErr) {
        return reply.status(500).send({ error: priorErr.message });
      }

      const priorMessages = (priorRows ?? []).map((r) => ({
        role: r.role === "ai" ? ("ai" as const) : ("user" as const),
        content: String(r.content ?? ""),
      }));

      const { data: userRow, error: userInsErr } = await supabase
        .from("messages")
        .insert({
          conversation_id: conversationId,
          user_id: userId,
          role: "user",
          content,
        })
        .select()
        .single();

      if (userInsErr || !userRow) {
        return reply.status(500).send({
          error: userInsErr?.message ?? "Failed to save user message",
        });
      }

      const assistantText = await generateCoachReply({
        conversationTitle: conv.title ?? "Conversation",
        priorMessages,
        userMessage: content,
      });

      const { data: aiRow, error: aiInsErr } = await supabase
        .from("messages")
        .insert({
          conversation_id: conversationId,
          user_id: userId,
          role: "ai",
          content: assistantText,
        })
        .select()
        .single();

      if (aiInsErr || !aiRow) {
        return reply.status(500).send({
          error: aiInsErr?.message ?? "Failed to save assistant message",
        });
      }

      // Auto-title: fire only on the first message, only if title is still
      // the default. Derived deterministically from message content — no AI
      // call, no extra round-trip. Merged into the updated_at update.
      const isFirstMessage = priorMessages.length === 0;
      const needsAutoTitle = isFirstMessage && conv.title === "New Conversation";
      const autoTitle = needsAutoTitle ? deriveTitle(content) : null;

      const conversationUpdate: Record<string, string> = {
        updated_at: new Date().toISOString(),
      };
      if (autoTitle) conversationUpdate.title = autoTitle;

      await supabase
        .from("conversations")
        .update(conversationUpdate)
        .eq("id", conversationId)
        .eq("user_id", userId);

      return reply.status(201).send({
        userMessage: userRow as MessageRow,
        assistantMessage: aiRow as MessageRow,
        // Include updated title so the frontend can update without a refetch
        updatedTitle: autoTitle ?? null,
      });
    },
  });

  // GET /api/conversations/:id/messages — list messages (oldest first), ownership enforced
  fastify.get<{ Params: { id: string } }>("/conversations/:id/messages", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      const { id } = request.params;
      const userId = request.user.id;

      const conv = await getOwnedConversation(fastify.supabase, id, userId);
      if (!conv) {
        return reply.status(404).send({ error: "Conversation not found" });
      }

      const { data, error } = await fastify.supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", id)
        .eq("user_id", userId)
        .order("created_at", { ascending: true });

      if (error) return reply.status(500).send({ error: error.message });
      return reply.send(data ?? []);
    },
  });

  // Legacy: POST /api/conversations/:id/messages (single message, no AI)
  fastify.post<{
    Params: { id: string };
    Body: { role?: string; content?: string };
  }>("/conversations/:id/messages", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      const { id } = request.params;
      const { role, content } = request.body ?? {};

      if (!role || !content) {
        return reply.status(400).send({ error: "role and content are required" });
      }
      if (role !== "user" && role !== "ai") {
        return reply.status(400).send({ error: "role must be user or ai" });
      }

      const conv = await getOwnedConversation(
        fastify.supabase,
        id,
        request.user.id
      );
      if (!conv) {
        return reply.status(404).send({ error: "Conversation not found" });
      }

      const { data, error } = await fastify.supabase
        .from("messages")
        .insert({
          conversation_id: id,
          user_id: request.user.id,
          role,
          content,
        })
        .select()
        .single();

      if (error) return reply.status(500).send({ error: error.message });
      return reply.status(201).send(data);
    },
  });
}
