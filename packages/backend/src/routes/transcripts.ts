import type { FastifyInstance } from "fastify";
import { sendApiError } from "../lib/apiErrors.js";

export async function transcriptsRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /api/transcripts/line — authenticated
  fastify.post<{
    Body: {
      conversation_id?: string;
      text?: string;
      deal_type?: string;
      vertical?: string;
      session_id?: string;
    };
  }>("/transcripts/line", { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const userId = req.user.id;
    const body = req.body ?? {};

    const conversationId =
      typeof body.conversation_id === "string" ? body.conversation_id.trim() : "";
    const text = typeof body.text === "string" ? body.text.trim() : "";

    if (!conversationId || !text) {
      return sendApiError(reply, {
        status: 400,
        code: "INVALID_REQUEST",
        message: "conversation_id and text are required",
      });
    }

    // Validate conversation belongs to user.
    const { data: conv, error: convErr } = await fastify.supabase
      .from("conversations")
      .select("id")
      .eq("id", conversationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (convErr) {
      return sendApiError(reply, {
        status: 500,
        code: "INTERNAL_ERROR",
        message: "Failed to validate conversation",
      });
    }
    if (!conv) {
      return sendApiError(reply, {
        status: 404,
        code: "NOT_FOUND",
        message: "Conversation not found",
      });
    }

    const dealType = typeof body.deal_type === "string" ? body.deal_type.trim() : "";
    const vertical = typeof body.vertical === "string" ? body.vertical.trim() : "";
    const sessionId =
      typeof body.session_id === "string" ? body.session_id.trim() : "";

    const { error: insErr } = await fastify.supabase.from("call_transcripts").insert({
      user_id: userId,
      conversation_id: conversationId,
      text,
      ...(dealType ? { deal_type: dealType } : {}),
      ...(vertical ? { vertical } : {}),
      ...(sessionId ? { session_id: sessionId } : {}),
    });
    if (insErr) {
      return sendApiError(reply, {
        status: 500,
        code: "INTERNAL_ERROR",
        message: "Failed to save transcript line",
      });
    }

    return reply.send({ ok: true });
  });
}

