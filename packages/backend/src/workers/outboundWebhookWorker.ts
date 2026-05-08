import type Bull from "bull";
import type {
  IntegrationEventType,
  OutboundEventPayload,
} from "../services/integrations/outboundDispatcher.js";
import { dispatchOutboundIntegrationEvent } from "../services/integrations/outboundDispatcher.js";
import { outboundWebhookQueue } from "../lib/queues.js";
import { createServiceRoleSupabase } from "../lib/workerSupabase.js";

export interface OutboundWebhookJobData {
  userId: string;
  eventType: IntegrationEventType;
  payload: OutboundEventPayload;
  correlationId?: string | null;
}

outboundWebhookQueue.process(async (job: Bull.Job<OutboundWebhookJobData>) => {
  const { userId, eventType, payload, correlationId } = job.data;
  const supabase = createServiceRoleSupabase();

  await dispatchOutboundIntegrationEvent({
    supabase,
    userId,
    eventType,
    payload,
    correlationId,
  });
});

outboundWebhookQueue.on("failed", (job, err: Error) => {
  console.error(
    `[webhook-worker] job ${job?.id} failed after ${job?.attemptsMade} attempts:`,
    err?.message
  );
});

console.log("[webhook-worker] ready");
