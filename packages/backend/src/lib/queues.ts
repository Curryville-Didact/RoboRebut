import Bull from "bull";

const redisUrl = process.env.REDIS_URL?.trim();
if (!redisUrl) {
  throw new Error("REDIS_URL is required for job queues");
}

const queueOptions = {
  redis: redisUrl,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential" as const, delay: 2000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
};

export const transcriptionQueue = new Bull("transcription", queueOptions);
export const outboundWebhookQueue = new Bull("outbound-webhooks", queueOptions);
