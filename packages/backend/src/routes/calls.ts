import type { FastifyInstance } from "fastify";
import { transcribeCallAudio } from "../services/callTranscription.js";

export async function callsRoutes(app: FastifyInstance) {
  // POST /api/calls/transcribe
  // Accepts multipart audio upload, returns transcript + detected objections
  app.post("/calls/transcribe", async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    const token = authHeader.slice(7);

    const supabase = app.supabase;
    if (!supabase) {
      return reply.status(503).send({ error: "Auth not configured" });
    }

    const { data: authData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !authData.user) {
      return reply.status(401).send({ error: "Invalid token" });
    }

    const data = await (
      request as typeof request & {
        file: () => Promise<{
          filename: string;
          mimetype: string;
          file: AsyncIterable<Buffer | Uint8Array | string>;
        }>;
      }
    ).file();

    if (!data) {
      return reply.status(400).send({ error: "No audio file provided." });
    }

    const filename = data.filename;
    const mimeType = data.mimetype;
    const chunks: Buffer[] = [];
    for await (const chunk of data.file) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const audioBuffer = Buffer.concat(chunks);

    try {
      const result = await transcribeCallAudio(audioBuffer, filename, mimeType);
      return reply.send({
        ok: true,
        transcript: result.transcript,
        detectedObjections: result.detectedObjections,
        detectedVertical: result.detectedVertical,
        detectedIndustry: result.industry,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Transcription failed.";
      return reply.status(500).send({ ok: false, error: message });
    }
  });
}
