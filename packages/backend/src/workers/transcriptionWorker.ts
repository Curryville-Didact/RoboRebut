import type Bull from "bull";
import { createServiceRoleSupabase } from "../lib/workerSupabase.js";
import { transcriptionQueue } from "../lib/queues.js";
import { syncContactToCRMs } from "../services/crmSync.js";
import { transcribeCallAudio } from "../services/callTranscription.js";

const workerSupabase = createServiceRoleSupabase();

/** Serialized audio for Redis/Bull job payloads. */
export interface TranscriptionJobData {
  audioBase64: string;
  filename: string;
  mimeType: string;
  userId: string;
  userEmail: string;
  userName: string;
}

transcriptionQueue.process(async (job: Bull.Job<TranscriptionJobData>) => {
  const { audioBase64, filename, mimeType, userId, userEmail, userName } =
    job.data;

  try {
    const audioBuffer = Buffer.from(audioBase64, "base64");
    const result = await transcribeCallAudio(audioBuffer, filename, mimeType);

    syncContactToCRMs(workerSupabase, userId, userEmail, userName).catch((err) =>
      console.warn("[transcription-worker] crmSync fire-and-forget error", err)
    );

    return result;
  } catch (err) {
    console.error(`[transcription-worker] job ${job.id} failed:`, err);
    throw err;
  }
});

transcriptionQueue.on("failed", (job, err: Error) => {
  console.error(
    `[transcription-worker] job ${job?.id} failed after ${job?.attemptsMade} attempts:`,
    err?.message
  );
});

console.log("[transcription-worker] ready");
