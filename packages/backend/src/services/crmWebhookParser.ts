import type { FastifyBaseLogger } from "fastify";

export type ParsedCrmCall = {
  recordingUrl: string | null;
  callerPhone: string | null;
  callerName: string | null;
  durationSeconds: number | null;
  crmCallId: string | null;
  source: string;
};

function asObjectRecord(body: unknown): Record<string, unknown> {
  return typeof body === "object" && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

export function parseCrmPayload(
  source: string,
  body: unknown,
  logger: FastifyBaseLogger
): ParsedCrmCall {
  const base: ParsedCrmCall = {
    recordingUrl: null,
    callerPhone: null,
    callerName: null,
    durationSeconds: null,
    crmCallId: null,
    source,
  };

  const recordBody = asObjectRecord(body);

  try {
    switch (source) {
      case "hubspot": {
        // HubSpot sends 3 possible payload shapes:
        //
        // Shape 1: Property change batch (array)
        // [{objectId, propertyName, propertyValue, objectType}]
        //
        // Shape 2: Engagement/timeline object
        // { engagement: { id, type }, metadata: { recordingUrl, fromNumber, durationMilliseconds } }
        //
        // Shape 3: Legacy flat object (original parser assumption)
        // { hs_call_recording_url, hs_call_from_number, hs_call_duration, objectId }

        let recordingUrl: string | null = null;
        let callerPhone: string | null = null;
        let callerName: string | null = null;
        let durationSeconds: number | null = null;
        let crmCallId: string | null = null;

        // Shape 1: Array of property change events
        if (Array.isArray(body)) {
          const events = body as Array<{
            objectId?: number | string;
            propertyName?: string;
            propertyValue?: string;
            objectType?: string;
          }>;

          const firstEvent = events[0];
          if (firstEvent?.objectId != null) {
            crmCallId = String(firstEvent.objectId);
          }

          const recordingEvent = events.find(
            (e) => e.propertyName === "hs_call_recording_url"
          );
          if (recordingEvent?.propertyValue) {
            recordingUrl = recordingEvent.propertyValue;
          }

          const phoneEvent = events.find(
            (e) => e.propertyName === "hs_call_from_number"
          );
          if (phoneEvent?.propertyValue) {
            callerPhone = phoneEvent.propertyValue;
          }

          const durationEvent = events.find(
            (e) => e.propertyName === "hs_call_duration"
          );
          if (durationEvent?.propertyValue) {
            const ms = parseInt(durationEvent.propertyValue, 10);
            if (!Number.isNaN(ms)) {
              durationSeconds = Math.round(ms / 1000);
            }
          }

          const nameEvent = events.find(
            (e) =>
              e.propertyName === "hs_call_title" ||
              e.propertyName === "hubspot_owner_id"
          );
          if (nameEvent?.propertyValue) {
            callerName = nameEvent.propertyValue;
          }
        }

        // Shape 2: Engagement/timeline object
        else if (
          typeof body === "object" &&
          body !== null &&
          !Array.isArray(body) &&
          "engagement" in body &&
          "metadata" in body
        ) {
          const eng = body as {
            engagement?: { id?: number | string; type?: string };
            metadata?: {
              recordingUrl?: string;
              fromNumber?: string;
              durationMilliseconds?: number;
              toNumber?: string;
            };
            associations?: {
              contactIds?: number[];
            };
          };

          crmCallId = eng.engagement?.id != null
            ? String(eng.engagement.id)
            : null;
          recordingUrl = eng.metadata?.recordingUrl ?? null;
          callerPhone = eng.metadata?.fromNumber ?? null;
          if (eng.metadata?.durationMilliseconds != null) {
            durationSeconds = Math.round(
              eng.metadata.durationMilliseconds / 1000
            );
          }
        }

        // Shape 3: Legacy flat object (original assumption)
        else if (typeof body === "object" && body !== null) {
          const flat = body as Record<string, unknown>;
          recordingUrl =
            (flat["hs_call_recording_url"] as string | undefined) ?? null;
          callerPhone =
            (flat["hs_call_from_number"] as string | undefined) ?? null;
          crmCallId =
            flat["objectId"] != null ? String(flat["objectId"]) : null;
          const rawDuration = flat["hs_call_duration"];
          if (typeof rawDuration === "number") {
            durationSeconds = Math.round(rawDuration / 1000);
          } else if (typeof rawDuration === "string") {
            const ms = parseInt(rawDuration, 10);
            if (!Number.isNaN(ms)) {
              durationSeconds = Math.round(ms / 1000);
            }
          }
        }

        base.recordingUrl = recordingUrl;
        base.callerPhone = callerPhone;
        base.callerName = callerName;
        base.durationSeconds = durationSeconds;
        base.crmCallId = crmCallId;
        break;
      }
      case "gohighlevel": {
        // GoHighLevel call webhook
        base.recordingUrl =
          (recordBody["recording"] as string) ??
          (recordBody["recordingUrl"] as string) ??
          null;
        base.callerPhone =
          (recordBody["from"] as string) ??
          (recordBody["phone"] as string) ??
          null;
        base.callerName = (recordBody["contactName"] as string) ?? null;
        base.durationSeconds =
          recordBody["duration"] ? Number(recordBody["duration"]) : null;
        base.crmCallId =
          (recordBody["id"] as string) ??
          (recordBody["callId"] as string) ??
          null;
        break;
      }
      case "salesforce": {
        // Salesforce outbound message (SOAP-less REST webhook via Flow/Apex)
        base.recordingUrl =
          (recordBody["RecordingUrl"] as string) ??
          (recordBody["recordingUrl"] as string) ??
          null;
        base.callerPhone =
          (recordBody["CallerId"] as string) ??
          (recordBody["callerPhone"] as string) ??
          null;
        base.durationSeconds =
          recordBody["CallDurationInSeconds"]
            ? Number(recordBody["CallDurationInSeconds"])
            : null;
        base.crmCallId =
          (recordBody["Id"] as string) ??
          (recordBody["callId"] as string) ??
          null;
        break;
      }
      case "zoho": {
        // Zoho CRM webhook
        base.recordingUrl =
          (recordBody["recording_url"] as string) ??
          (recordBody["recordingUrl"] as string) ??
          null;
        base.callerPhone =
          (recordBody["caller_id"] as string) ??
          (recordBody["phone"] as string) ??
          null;
        base.durationSeconds =
          recordBody["duration"] ? Number(recordBody["duration"]) : null;
        base.crmCallId = (recordBody["call_id"] as string) ?? null;
        break;
      }
      case "velocify": {
        // Velocify (ICE) call webhook
        base.recordingUrl =
          (recordBody["RecordingURL"] as string) ??
          (recordBody["recordingUrl"] as string) ??
          null;
        base.callerPhone =
          (recordBody["LeadPhone"] as string) ??
          (recordBody["phone"] as string) ??
          null;
        base.callerName = (recordBody["LeadName"] as string) ?? null;
        base.durationSeconds =
          recordBody["Duration"] ? Number(recordBody["Duration"]) : null;
        base.crmCallId = (recordBody["CallId"] as string) ?? null;
        break;
      }
      case "generic_webhook":
      default: {
        // Generic: try common field names
        base.recordingUrl =
          (recordBody["recording_url"] as string) ??
          (recordBody["recordingUrl"] as string) ??
          (recordBody["recording"] as string) ??
          null;
        base.callerPhone =
          (recordBody["caller_phone"] as string) ??
          (recordBody["from"] as string) ??
          (recordBody["phone"] as string) ??
          null;
        base.callerName =
          (recordBody["caller_name"] as string) ??
          (recordBody["name"] as string) ??
          null;
        base.durationSeconds =
          recordBody["duration"] ? Number(recordBody["duration"]) : null;
        base.crmCallId =
          (recordBody["call_id"] as string) ??
          (recordBody["id"] as string) ??
          null;
        break;
      }
    }
  } catch (err) {
    logger.warn({ source, err }, "crmWebhookParser: parse error");
  }

  return base;
}
