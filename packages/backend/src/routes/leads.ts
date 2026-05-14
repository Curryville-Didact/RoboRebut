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

      const {
        full_name: raw_full_name,
        company: raw_company,
        work_email: raw_work_email,
        phone_number: raw_phone_number,
        team_type: raw_team_type,
        team_size: raw_team_size,
        message: raw_message,
        sms_consent: raw_sms_consent,
        utm_source: raw_utm_source,
        utm_medium: raw_utm_medium,
        utm_campaign: raw_utm_campaign,
        lead_type: raw_lead_type,
        monthly_revenue: raw_monthly_revenue,
        time_in_business: raw_time_in_business,
        funding_amount: raw_funding_amount,
        industry: raw_industry,
        business_type: raw_business_type,
      } = (request.body ?? {}) as Record<string, unknown>;

      const full_name = trimStr(raw_full_name);
      const work_email = trimStr(raw_work_email);
      const phone_number = trimStr(raw_phone_number);
      const company = trimOptional(raw_company);
      const team_type = trimOptional(raw_team_type);
      const team_size = trimOptional(raw_team_size);
      let message = trimStr(raw_message);
      if (message.length > 1000) {
        message = message.slice(0, 1000);
      }
      const utm_source = trimOptional(raw_utm_source);
      const utm_medium = trimOptional(raw_utm_medium);
      const utm_campaign = trimOptional(raw_utm_campaign);
      const sms_consent = raw_sms_consent === true;
      const lead_type = trimOptional(raw_lead_type);
      const monthly_revenue = trimOptional(raw_monthly_revenue);
      const time_in_business = trimOptional(raw_time_in_business);
      const funding_amount = trimOptional(raw_funding_amount);
      const industry = trimOptional(raw_industry);
      const business_type = trimOptional(raw_business_type);

      if (!full_name || !work_email || !phone_number) {
        return reply.status(400).send({ error: "Missing required fields" });
      }

      const source =
        lead_type === "working_capital" ? "didact_capital" : "landing_page";

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
            source,
            lead_type,
            monthly_revenue,
            time_in_business,
            funding_amount,
            industry,
            business_type,
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
            lead_type: data.lead_type,
            monthly_revenue: data.monthly_revenue,
            time_in_business: data.time_in_business,
            funding_amount: data.funding_amount,
            industry: data.industry,
            business_type: data.business_type,
          }),
        }).catch((err) =>
          console.warn("[leads] GTM webhook fire-and-forget error:", err)
        );
      }

      return reply.status(201).send({ success: true, lead_id: data.id });
    }
  );
}
