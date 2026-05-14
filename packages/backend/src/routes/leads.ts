import type { FastifyInstance } from "fastify";

function trimStr(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  return String(v).trim();
}

function trimOptional(v: unknown): string | null {
  const s = trimStr(v);
  return s === "" ? null : s;
}

export async function leadsRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/api/leads",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      if (!app.supabase) {
        return reply.status(503).send({ error: "Lead capture unavailable" });
      }

      const body = request.body as Record<string, unknown>;

      const full_name = trimStr(body.full_name);
      const work_email = trimStr(body.work_email);
      const phone_number = trimStr(body.phone_number);
      const company = trimOptional(body.company);
      const team_type = trimOptional(body.team_type);
      const team_size = trimOptional(body.team_size);
      let message = trimStr(body.message);
      if (message.length > 1000) {
        message = message.slice(0, 1000);
      }
      const utm_source = trimOptional(body.utm_source);
      const utm_medium = trimOptional(body.utm_medium);
      const utm_campaign = trimOptional(body.utm_campaign);
      const sms_consent = body.sms_consent === true;

      if (!full_name || !work_email || !phone_number) {
        return reply.status(400).send({ error: "Missing required fields" });
      }

      const { data, error } = await app.supabase
        .from("leads")
        .insert([
          {
            full_name,
            company,
            work_email,
            phone_number,
            team_type,
            team_size,
            message: message === "" ? null : message,
            sms_consent,
            utm_source,
            utm_medium,
            utm_campaign,
            source: "landing_page",
          },
        ])
        .select()
        .single();

      if (error) {
        console.error("Lead insert error:", error);
        return reply.status(500).send({ error: "Failed to save lead" });
      }

      const webhookUrl = process.env.GTM_AGENT_WEBHOOK_URL?.trim();
      if (webhookUrl) {
        void fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lead_id: data.id,
            full_name: data.full_name,
            company: data.company,
            work_email: data.work_email,
            phone_number: data.phone_number,
            team_type: data.team_type,
            team_size: data.team_size,
            message: data.message,
            source: data.source,
            utm_campaign: data.utm_campaign,
            utm_source: data.utm_source,
            utm_medium: data.utm_medium,
            created_at: data.created_at,
          }),
        }).catch((err) =>
          console.warn("[leads] GTM webhook fire-and-forget error:", err)
        );
      }

      return reply.status(201).send({ success: true, lead_id: data.id });
    }
  );
}
