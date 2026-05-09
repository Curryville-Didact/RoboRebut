import type { FastifyInstance } from "fastify";
import { sendApiError } from "../lib/apiErrors.js";
import { generateWebhookSecret } from "../services/webhookSigning.js";

type CrmType = "hubspot" | "gohighlevel" | "salesforce" | "zoho" | "velocify";

type CrmConnectionRow = {
  id: string;
  crm_type: CrmType;
  is_active: boolean;
  created_at: string;
  instance_url?: string | null;
  dc_region?: string | null;
};

export default async function crmConnections(app: FastifyInstance): Promise<void> {
  // GET /api/crm/connections
  app.get("/crm/connections", {
    preHandler: [app.authenticate],
    handler: async (request, reply) => {
      const { data, error } = await app.supabase
        .from("crm_connections")
        .select("id, crm_type, is_active, created_at, instance_url, dc_region")
        .eq("user_id", request.user.id)
        .order("created_at", { ascending: false });

      if (error) {
        return sendApiError(reply, {
          status: 500,
          code: "INTERNAL_ERROR",
          message: "Failed to load CRM connections",
        });
      }

      return reply.send({ ok: true, items: (data ?? []) as CrmConnectionRow[] });
    },
  });

  // POST /api/crm/connections/test
  app.post<{ Body: { crmType?: string; crm_type?: string; apiKey?: string; api_key?: string } }>(
    "/crm/connections/test",
    {
      preHandler: [app.authenticate],
      handler: async (request, reply) => {
        const rawType = (request.body?.crmType ?? request.body?.crm_type ?? "").trim().toLowerCase();
        let apiKey = (request.body?.apiKey ?? request.body?.api_key ?? "").trim();

        const finish = (valid: boolean, message: string) =>
          reply.send({ valid, message });

        if (!rawType) {
          return finish(false, "crmType is required");
        }

        if (rawType === "velocify") {
          return finish(true, "Velocify uses webhook-only — no key validation available");
        }

        if (!apiKey && app.supabase) {
          const { data: row } = await app.supabase
            .from("crm_connections")
            .select("api_key")
            .eq("user_id", request.user.id)
            .eq("crm_type", rawType)
            .maybeSingle();
          apiKey = (row as { api_key?: string } | null)?.api_key?.trim() ?? "";
        }

        if (!apiKey) {
          return finish(false, "apiKey is required");
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        try {
          let res: Response;
          if (rawType === "hubspot") {
            res = await fetch("https://api.hubapi.com/crm/v3/objects/contacts?limit=1", {
              method: "GET",
              headers: { Authorization: `Bearer ${apiKey}` },
              signal: controller.signal,
            });
          } else if (rawType === "gohighlevel") {
            res = await fetch("https://rest.gohighlevel.com/v1/contacts/?limit=1", {
              method: "GET",
              headers: { Authorization: `Bearer ${apiKey}` },
              signal: controller.signal,
            });
          } else if (rawType === "salesforce") {
            res = await fetch("https://login.salesforce.com/services/oauth2/userinfo", {
              method: "GET",
              headers: { Authorization: `Bearer ${apiKey}` },
              signal: controller.signal,
            });
          } else if (rawType === "zoho") {
            res = await fetch("https://www.zohoapis.com/crm/v2/org", {
              method: "GET",
              headers: { Authorization: `Zoho-oauthtoken ${apiKey}` },
              signal: controller.signal,
            });
          } else {
            clearTimeout(timeout);
            return finish(false, `Unsupported CRM type: ${rawType}`);
          }

          clearTimeout(timeout);

          if (res.status === 401 || res.status === 403) {
            return finish(false, "Invalid API key");
          }
          if (res.status >= 400) {
            return finish(false, `CRM API error: ${res.status}`);
          }
          return finish(true, "Credentials look valid");
        } catch (e: unknown) {
          clearTimeout(timeout);
          const name = e instanceof Error ? e.name : "";
          const msg = e instanceof Error ? e.message : String(e);
          if (name === "AbortError" || msg.includes("aborted")) {
            return finish(false, "Could not reach CRM API");
          }
          return finish(false, "Could not reach CRM API");
        }
      },
    }
  );

  // POST /api/crm/connections
  app.post<{
    Body: {
      crm_type: string;
      api_key: string;
      instance_url?: string | null;
      dc_region?: string | null;
    };
  }>("/crm/connections", {
    preHandler: [app.authenticate],
    handler: async (request, reply) => {
      const crm_type = (request.body?.crm_type ?? "").trim();
      let api_key = (request.body?.api_key ?? "").trim();
      const instance_url =
        request.body?.instance_url === undefined || request.body?.instance_url === null
          ? null
          : String(request.body.instance_url).trim() || null;
      const dc_region =
        request.body?.dc_region === undefined || request.body?.dc_region === null
          ? null
          : String(request.body.dc_region).trim().toLowerCase() || null;
      if (!crm_type) {
        return sendApiError(reply, {
          status: 400,
          code: "INVALID_REQUEST",
          message: "crm_type is required",
        });
      }

      if (!api_key && app.supabase) {
        const { data: existingRow } = await app.supabase
          .from("crm_connections")
          .select("api_key")
          .eq("user_id", request.user.id)
          .eq("crm_type", crm_type)
          .maybeSingle();
        api_key = (existingRow as { api_key?: string } | null)?.api_key?.trim() ?? "";
      }

      if (!api_key) {
        return sendApiError(reply, {
          status: 400,
          code: "INVALID_REQUEST",
          message: "api_key is required",
        });
      }

      const { error } = await app.supabase.from("crm_connections").upsert(
        {
          user_id: request.user.id,
          crm_type,
          api_key,
          is_active: true,
          instance_url,
          dc_region,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,crm_type" }
      );

      if (error) {
        return sendApiError(reply, {
          status: 500,
          code: "INTERNAL_ERROR",
          message: "Failed to save CRM connection",
        });
      }

      return reply.send({ ok: true });
    },
  });

  // DELETE /api/crm/connections/:crm_type
  app.delete<{ Params: { crm_type: string } }>("/crm/connections/:crm_type", {
    preHandler: [app.authenticate],
    handler: async (request, reply) => {
      const crm_type = (request.params?.crm_type ?? "").trim();
      if (!crm_type) {
        return sendApiError(reply, {
          status: 400,
          code: "INVALID_REQUEST",
          message: "crm_type param is required",
        });
      }

      const { error } = await app.supabase
        .from("crm_connections")
        .delete()
        .eq("user_id", request.user.id)
        .eq("crm_type", crm_type);

      if (error) {
        return sendApiError(reply, {
          status: 500,
          code: "INTERNAL_ERROR",
          message: "Failed to delete CRM connection",
        });
      }

      return reply.send({ ok: true });
    },
  });

  // POST /api/crm/webhook-secret/rotate
  app.post("/crm/webhook-secret/rotate", {
    preHandler: [app.authenticate],
    handler: async (request, reply) => {
      const userId = request.user.id;
      const secret = generateWebhookSecret();
      await app.prisma.profile.upsert({
        where: { id: userId },
        create: { id: userId, webhookSecret: secret },
        update: { webhookSecret: secret },
      });
      return reply.send({ secret, rotatedAt: new Date().toISOString() });
    },
  });

  // GET /api/crm/webhook-secret
  app.get("/crm/webhook-secret", {
    preHandler: [app.authenticate],
    handler: async (request, reply) => {
      const userId = request.user.id;
      const profile = await app.prisma.profile.findUnique({
        where: { id: userId },
        select: { webhookSecret: true },
      });
      const apiBase = process.env.API_URL?.trim().replace(/\/$/, "") ?? "";
      const webhookUrl = `${apiBase}/api/calls/webhook/:source?userId=${userId}`;
      return reply.send({
        webhookUrl,
        hasSecret: Boolean(profile?.webhookSecret?.trim()),
      });
    },
  });
}

