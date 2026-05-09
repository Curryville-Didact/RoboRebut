import type { FastifyInstance } from "fastify";
import { transcriptionQueue } from "../lib/queues.js";
import type { TranscriptionJobData } from "../workers/transcriptionWorker.js";

export async function callsRoutes(app: FastifyInstance) {
  // POST /api/calls/transcribe
  // Accepts multipart audio upload, enqueues transcription; poll GET transcription-status for result.
  app.post(
    "/calls/transcribe",
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
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
        const { data: profile } = await app.supabase
          .from("profiles")
          .select("email, full_name")
          .eq("id", request.user.id)
          .single();

        const p = profile as {
          email?: string | null;
          full_name?: string | null;
        } | null;
        const userEmail = p?.email ?? "";
        const userName = p?.full_name ?? "";

        const job = await transcriptionQueue.add({
          audioBase64: audioBuffer.toString("base64"),
          filename,
          mimeType,
          userId: request.user.id,
          userEmail,
          userName,
        } satisfies TranscriptionJobData);

        return reply.code(202).send({
          ok: true,
          message: "Transcription queued successfully",
          jobId: job.id,
          status: "processing",
          statusUrl: `/api/calls/transcription-status/${job.id}`,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Transcription failed.";
        return reply.status(500).send({ ok: false, error: message });
      }
    }
  );

  // GET /api/calls/transcription-status/:jobId — poll Bull job until completed
  app.get<{ Params: { jobId: string } }>(
    "/calls/transcription-status/:jobId",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { jobId } = request.params;
      const job = await transcriptionQueue.getJob(jobId);
      if (!job) {
        return reply.status(404).send({ error: "Job not found" });
      }

      const state = await job.getState();
      const progress = typeof job.progress === "function" ? job.progress() : 0;

      return reply.send({
        jobId: job.id,
        state,
        progress,
        result:
          state === "completed" ? (job.returnvalue ?? null) : null,
      });
    }
  );
}
