import type Bull from "bull";
import { transcriptionQueue } from "../lib/queues.js";
import { transcribeCallAudio } from "../services/callTranscription.js";

/** Serialized audio for Redis/Bull job payloads. */
export interface TranscriptionJobData {
  audioBase64: string;
  filename: string;
  mimeType: string;
}

transcriptionQueue.process(async (job: Bull.Job<TranscriptionJobData>) => {
  const { audioBase64, filename, mimeType } = job.data;

  try {
    const audioBuffer = Buffer.from(audioBase64, "base64");
    const result = await transcribeCallAudio(audioBuffer, filename, mimeType);
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
