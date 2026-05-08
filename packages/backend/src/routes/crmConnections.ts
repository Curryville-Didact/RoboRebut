import type { FastifyInstance } from "fastify";
import { sendApiError } from "../lib/apiErrors.js";
import { generateWebhookSecret } from "../services/webhookSigning.js";

type CrmType = "hubspot" | "gohighlevel" | "salesforce" | "zoho" | "velocify";

type CrmConnectionRow = {
  id: string;
  crm_type: CrmType;
  is_active: boolean;
  created_at: string;
};

export default async function crmConnections(app: FastifyInstance): Promise<void> {
  // GET /api/crm/connections
  app.get("/crm/connections", {
    preHandler: [app.authenticate],
    handler: async (request, reply) => {
      const { data, error } = await app.supabase
        .from("crm_connections")
        .select("id, crm_type, is_active, created_at")
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

  // POST /api/crm/connections
  app.post<{ Body: { crm_type: string; api_key: string } }>("/crm/connections", {
    preHandler: [app.authenticate],
    handler: async (request, reply) => {
      const crm_type = (request.body?.crm_type ?? "").trim();
      const api_key = (request.body?.api_key ?? "").trim();
      if (!crm_type) {
        return sendApiError(reply, {
          status: 400,
          code: "INVALID_REQUEST",
          message: "crm_type is required",
        });
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

