import type { FastifyInstance } from "fastify";
import { transcriptionQueue } from "../lib/queues.js";
import type { TranscriptionJobData } from "../workers/transcriptionWorker.js";
import { syncContactToCRMs } from "../services/crmSync.js";

export async function callsRoutes(app: FastifyInstance) {
  // POST /api/calls/transcribe
  // Accepts multipart audio upload, returns transcript + detected objections
  app.post(
    "/calls/transcribe",
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const userId = request.user.id;

      const { data: profile } = await app.supabase
        .from("users")
        .select("email, full_name")
        .eq("id", userId)
        .single();

      const userEmail = profile?.email ?? "";
      const userName = profile?.full_name ?? "";

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
        const job = await transcriptionQueue.add({
          audioBase64: audioBuffer.toString("base64"),
          filename,
          mimeType,
        } satisfies TranscriptionJobData);
        const result = await job.finished();

        // fire-and-forget CRM sync — never blocks response
        syncContactToCRMs(app.supabase, userId, userEmail, userName).catch((err) =>
          console.warn("[calls] crmSync fire-and-forget error", err)
        );

        return reply.send({
          ok: true,
          transcript: result.transcript,
          detectedObjections: result.detectedObjections,
          detectedVertical: result.detectedVertical,
          detectedIndustry: result.industry,
          businessName: result.businessName,
          monthlyRevenue: result.monthlyRevenue,
          painPoints: result.painPoints,
          statedObjections: result.statedObjections,
          trustFlags: result.trustFlags,
          urgency: result.urgency,
          decisionMaker: result.decisionMaker,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Transcription failed.";
        return reply.status(500).send({ ok: false, error: message });
      }
    }
  );
}
