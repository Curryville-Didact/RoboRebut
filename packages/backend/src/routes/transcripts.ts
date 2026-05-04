import type { FastifyInstance } from "fastify";
import { sendApiError } from "../lib/apiErrors.js";

export async function transcriptsRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /api/transcripts/:conversationId — list stored lines (authenticated, owned conversation)
  fastify.get<{ Params: { conversationId: string } }>(
    "/transcripts/:conversationId",
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const userId = req.user.id;
      const conversationId =
        typeof req.params.conversationId === "string"
          ? req.params.conversationId.trim()
          : "";

      if (!conversationId) {
        return sendApiError(reply, {
          status: 400,
          code: "INVALID_REQUEST",
          message: "conversationId is required",
        });
      }

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

      const { data: rows, error: qErr } = await fastify.supabase
        .from("call_transcripts")
        .select("text, timestamp, session_id")
        .eq("conversation_id", conversationId)
        .eq("user_id", userId)
        .order("timestamp", { ascending: true });

      if (qErr) {
        return sendApiError(reply, {
          status: 500,
          code: "INTERNAL_ERROR",
          message: "Failed to load transcript",
        });
      }

      const lines = (rows ?? []).map((r) => {
        const row = r as {
          text?: string;
          timestamp?: string;
          session_id?: string | null;
        };
        return {
          text: typeof row.text === "string" ? row.text : "",
          timestamp:
            typeof row.timestamp === "string"
              ? row.timestamp
              : row.timestamp != null
                ? String(row.timestamp)
                : "",
          session_id:
            typeof row.session_id === "string" && row.session_id.length > 0
              ? row.session_id
              : null,
        };
      });

      return reply.send({ lines });
    }
  );

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

