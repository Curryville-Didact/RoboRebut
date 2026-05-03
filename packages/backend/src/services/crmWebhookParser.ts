import type { FastifyBaseLogger } from "fastify";

export type ParsedCrmCall = {
  recordingUrl: string | null;
  callerPhone: string | null;
  callerName: string | null;
  durationSeconds: number | null;
  crmCallId: string | null;
  source: string;
};

export function parseCrmPayload(
  source: string,
  body: Record<string, unknown>,
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

  try {
    switch (source) {
      case "hubspot": {
        // HubSpot Calling SDK webhook: propertyName/Value pairs
        const props = body as Record<string, unknown>;
        base.recordingUrl =
          (props["hs_call_recording_url"] as string) ?? null;
        base.callerPhone = (props["hs_call_from_number"] as string) ?? null;
        base.durationSeconds =
          props["hs_call_duration"]
            ? Math.round(Number(props["hs_call_duration"]) / 1000)
            : null;
        base.crmCallId = (props["objectId"] as string) ?? null;
        break;
      }
      case "gohighlevel": {
        // GoHighLevel call webhook
        base.recordingUrl =
          (body["recording"] as string) ??
          (body["recordingUrl"] as string) ??
          null;
        base.callerPhone =
          (body["from"] as string) ?? (body["phone"] as string) ?? null;
        base.callerName = (body["contactName"] as string) ?? null;
        base.durationSeconds =
          body["duration"] ? Number(body["duration"]) : null;
        base.crmCallId =
          (body["id"] as string) ?? (body["callId"] as string) ?? null;
        break;
      }
      case "salesforce": {
        // Salesforce outbound message (SOAP-less REST webhook via Flow/Apex)
        base.recordingUrl =
          (body["RecordingUrl"] as string) ??
          (body["recordingUrl"] as string) ??
          null;
        base.callerPhone =
          (body["CallerId"] as string) ?? (body["callerPhone"] as string) ?? null;
        base.durationSeconds =
          body["CallDurationInSeconds"]
            ? Number(body["CallDurationInSeconds"])
            : null;
        base.crmCallId =
          (body["Id"] as string) ?? (body["callId"] as string) ?? null;
        break;
      }
      case "zoho": {
        // Zoho CRM webhook
        base.recordingUrl =
          (body["recording_url"] as string) ??
          (body["recordingUrl"] as string) ??
          null;
        base.callerPhone =
          (body["caller_id"] as string) ?? (body["phone"] as string) ?? null;
        base.durationSeconds =
          body["duration"] ? Number(body["duration"]) : null;
        base.crmCallId = (body["call_id"] as string) ?? null;
        break;
      }
      case "velocify": {
        // Velocify (ICE) call webhook
        base.recordingUrl =
          (body["RecordingURL"] as string) ??
          (body["recordingUrl"] as string) ??
          null;
        base.callerPhone =
          (body["LeadPhone"] as string) ?? (body["phone"] as string) ?? null;
        base.callerName = (body["LeadName"] as string) ?? null;
        base.durationSeconds =
          body["Duration"] ? Number(body["Duration"]) : null;
        base.crmCallId = (body["CallId"] as string) ?? null;
        break;
      }
      case "generic_webhook":
      default: {
        // Generic: try common field names
        base.recordingUrl =
          (body["recording_url"] as string) ??
          (body["recordingUrl"] as string) ??
          (body["recording"] as string) ??
          null;
        base.callerPhone =
          (body["caller_phone"] as string) ??
          (body["from"] as string) ??
          (body["phone"] as string) ??
          null;
        base.callerName =
          (body["caller_name"] as string) ??
          (body["name"] as string) ??
          null;
        base.durationSeconds =
          body["duration"] ? Number(body["duration"]) : null;
        base.crmCallId =
          (body["call_id"] as string) ??
          (body["id"] as string) ??
          null;
        break;
      }
    }
  } catch (err) {
    logger.warn({ source, err }, "crmWebhookParser: parse error");
  }

  return base;
}
