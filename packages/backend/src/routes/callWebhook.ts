/**
 * Inbound CRM webhook receiver — POST /api/calls/webhook/:source
 * Broker sets this URL in their CRM. We download the recording,
 * transcribe via Whisper, extract objections, create a conversation.
 */

import type { FastifyInstance } from "fastify";
import { sendApiError } from "../lib/apiErrors.js";
import { parseCrmPayload } from "../services/crmWebhookParser.js";
import { transcribeCallAudio } from "../services/callTranscription.js";

const VALID_SOURCES = [
  "generic_webhook",
  "hubspot",
  "salesforce",
  "gohighlevel",
  "zoho",
  "velocify",
] as const;

type ValidSource = (typeof VALID_SOURCES)[number];

function isValidSource(s: string): s is ValidSource {
  return (VALID_SOURCES as readonly string[]).includes(s);
}

function mimeForExtension(ext: string): string {
  switch (ext) {
    case "wav":
      return "audio/wav";
    case "webm":
      return "audio/webm";
    case "m4a":
      return "audio/mp4";
    case "mp4":
      return "audio/mp4";
    default:
      return "audio/mpeg";
  }
}

export async function callWebhookRoutes(
  fastify: FastifyInstance
): Promise<void> {
  // POST /api/calls/webhook/:source?userId=<broker_user_id>
  fastify.post<{
    Params: { source: string };
    Querystring: { userId?: string };
    Body: Record<string, unknown>;
  }>("/calls/webhook/:source", async (req, reply) => {
    const source = req.params.source;
    const userId = req.query.userId?.trim();

    if (!fastify.supabase) {
      return sendApiError(reply, {
        status: 503,
        code: "INTERNAL_ERROR",
        message: "Database not configured",
      });
    }

    if (!userId) {
      return sendApiError(reply, {
        status: 400,
        code: "INVALID_REQUEST",
        message: "userId query param is required",
      });
    }

    if (!isValidSource(source)) {
      return sendApiError(reply, {
        status: 400,
        code: "INVALID_REQUEST",
        message: `source must be one of: ${VALID_SOURCES.join(", ")}`,
      });
    }

    // Verify the userId maps to a real user
    const { data: userRow, error: userErr } = await fastify.supabase
      .from("profiles")
      .select("id")
      .eq("id", userId)
      .maybeSingle();

    if (userErr || !userRow) {
      return sendApiError(reply, {
        status: 404,
        code: "NOT_FOUND",
        message: "No broker account found for this webhook URL",
      });
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const parsed = parseCrmPayload(source, body, req.log);

    if (!parsed.recordingUrl) {
      return sendApiError(reply, {
        status: 400,
        code: "INVALID_REQUEST",
        message: "Payload did not include a usable recording URL",
      });
    }

    let recordingUrl: URL;
    try {
      recordingUrl = new URL(parsed.recordingUrl);
      if (recordingUrl.protocol !== "http:" && recordingUrl.protocol !== "https:") {
        throw new Error("invalid protocol");
      }
    } catch {
      return sendApiError(reply, {
        status: 400,
        code: "INVALID_REQUEST",
        message: "recording URL is not a valid http(s) URL",
      });
    }

    let audioBuffer: Buffer;
    try {
      const audioRes = await fetch(recordingUrl.toString());
      if (!audioRes.ok) {
        return sendApiError(reply, {
          status: 502,
          code: "INTERNAL_ERROR",
          message: `Could not download recording (HTTP ${audioRes.status})`,
        });
      }
      const arrayBuf = await audioRes.arrayBuffer();
      audioBuffer = Buffer.from(arrayBuf);
    } catch (err) {
      req.log.warn({ err }, "callWebhook: fetch recording failed");
      return sendApiError(reply, {
        status: 502,
        code: "INTERNAL_ERROR",
        message: "Could not download recording",
      });
    }

    const pathLower = recordingUrl.pathname.toLowerCase();
    const extMatch = pathLower.match(/\.([a-z0-9]+)(?:\?|$)/);
    const ext = extMatch?.[1] ?? "mp3";
    const filename = `recording.${ext}`;
    const mimeType = mimeForExtension(ext);

    let transcription;
    try {
      transcription = await transcribeCallAudio(audioBuffer, filename, mimeType);
    } catch (err) {
      req.log.warn({ err }, "callWebhook: transcription failed");
      return sendApiError(reply, {
        status: 500,
        code: "INTERNAL_ERROR",
        message: err instanceof Error ? err.message : "Transcription failed",
      });
    }

    const t = transcription.transcript.trim();
    const titleBase =
      t.length > 0 ? t.slice(0, 80) + (t.length > 80 ? "…" : "") : "Imported call";

    const { data: conv, error: convErr } = await fastify.supabase
      .from("conversations")
      .insert({
        user_id: userId,
        title: titleBase || "Imported call",
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (convErr || !conv) {
      return sendApiError(reply, {
        status: 500,
        code: "INTERNAL_ERROR",
        message: convErr?.message ?? "Failed to create conversation",
      });
    }

    const convRow = conv as { id: string };

    const { error: msgErr } = await fastify.supabase.from("messages").insert({
      conversation_id: convRow.id,
      user_id: userId,
      role: "user",
      content: t.length > 0 ? t : "(empty transcript)",
    });

    if (msgErr) {
      req.log.warn({ msgErr }, "callWebhook: failed to insert transcript message");
    }

    return reply.status(201).send({
      ok: true,
      conversationId: convRow.id,
      transcript: transcription.transcript,
      detectedObjections: transcription.detectedObjections,
      detectedVertical: transcription.detectedVertical,
      parsed,
    });
  });
}
