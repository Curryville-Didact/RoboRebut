import type { FastifyInstance } from "fastify";
import { sendApiError } from "../lib/apiErrors.js";

type SyncContactBody = {
  userId: string;
  email: string;
  name: string;
  phone?: string;
};

type SyncDealBody = {
  contactId: string;
  dealName: string;
  amount?: number;
  stage?: string;
};

function getHubSpotAuthHeader(): string | null {
  const token = process.env.HUBSPOT_API_KEY?.trim();
  if (!token) return null;
  return `Bearer ${token}`;
}

async function readHubSpotJsonSafe(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export default async function hubspotRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/crm/hubspot/sync-contact
  app.post<{ Body: SyncContactBody }>(
    "/crm/hubspot/sync-contact",
    {
      preHandler: [app.authenticate],
      handler: async (request, reply) => {
      const auth = getHubSpotAuthHeader();
      if (!auth) {
        return sendApiError(reply, {
          status: 500,
          code: "INTERNAL_ERROR",
          message: "HUBSPOT_API_KEY not configured",
        });
      }

      const body = request.body ?? ({} as SyncContactBody);
      const email = (body.email ?? "").trim();
      const name = (body.name ?? "").trim();
      const phone = typeof body.phone === "string" ? body.phone.trim() : "";

      if (!body.userId || typeof body.userId !== "string") {
        return sendApiError(reply, {
          status: 400,
          code: "INVALID_REQUEST",
          message: "userId is required",
        });
      }
      if (!email) {
        return sendApiError(reply, {
          status: 400,
          code: "INVALID_REQUEST",
          message: "email is required",
        });
      }
      if (!name) {
        return sendApiError(reply, {
          status: 400,
          code: "INVALID_REQUEST",
          message: "name is required",
        });
      }

      const parts = name.split(/\s+/).filter(Boolean);
      const firstname = parts[0] ?? name;
      const lastname = parts.slice(1).join(" ") || undefined;

      const hubspotRes = await fetch("https://api.hubapi.com/crm/v3/objects/contacts/upsert", {
        method: "POST",
        headers: {
          Authorization: auth,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          idProperty: "email",
          properties: {
            email,
            firstname,
            ...(lastname ? { lastname } : {}),
            ...(phone ? { phone } : {}),
            // Useful for debugging / attribution in HubSpot.
            // Avoid custom properties here since they may not exist in all portals.
            lifecyclestage: "lead",
          },
        }),
      });

      const data = await readHubSpotJsonSafe(hubspotRes);
      if (!hubspotRes.ok) {
        app.log.warn(
          { status: hubspotRes.status, data, userId: request.user.id },
          "[hubspot] sync-contact failed"
        );
        return sendApiError(reply, {
          status: 502,
          code: "INTERNAL_ERROR",
          message: "HubSpot contact upsert failed",
          details: { status: hubspotRes.status, data: data as any },
        });
      }

      return reply.send({ ok: true, hubspot: data });
      },
    }
  );

  // POST /api/crm/hubspot/sync-deal
  app.post<{ Body: SyncDealBody }>(
    "/crm/hubspot/sync-deal",
    {
      preHandler: [app.authenticate],
      handler: async (request, reply) => {
      const auth = getHubSpotAuthHeader();
      if (!auth) {
        return sendApiError(reply, {
          status: 500,
          code: "INTERNAL_ERROR",
          message: "HUBSPOT_API_KEY not configured",
        });
      }

      const body = request.body ?? ({} as SyncDealBody);
      const contactId = (body.contactId ?? "").trim();
      const dealName = (body.dealName ?? "").trim();
      const stage = (body.stage ?? "").trim() || "appointmentscheduled";

      if (!contactId) {
        return sendApiError(reply, {
          status: 400,
          code: "INVALID_REQUEST",
          message: "contactId is required",
        });
      }
      if (!dealName) {
        return sendApiError(reply, {
          status: 400,
          code: "INVALID_REQUEST",
          message: "dealName is required",
        });
      }

      const amount =
        typeof body.amount === "number" && Number.isFinite(body.amount) ? body.amount : undefined;

      const createDealRes = await fetch("https://api.hubapi.com/crm/v3/objects/deals", {
        method: "POST",
        headers: {
          Authorization: auth,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          properties: {
            dealname: dealName,
            dealstage: stage,
            ...(amount != null ? { amount: String(amount) } : {}),
          },
        }),
      });

      const dealData = await readHubSpotJsonSafe(createDealRes);
      if (!createDealRes.ok) {
        app.log.warn(
          { status: createDealRes.status, dealData, userId: request.user.id },
          "[hubspot] sync-deal create failed"
        );
        return sendApiError(reply, {
          status: 502,
          code: "INTERNAL_ERROR",
          message: "HubSpot deal create failed",
          details: { status: createDealRes.status, data: dealData as any },
        });
      }

      const dealId =
        dealData && typeof dealData === "object" && "id" in dealData
          ? String((dealData as any).id)
          : null;

      if (!dealId) {
        return sendApiError(reply, {
          status: 502,
          code: "INTERNAL_ERROR",
          message: "HubSpot deal create returned no id",
          details: { data: dealData as any },
        });
      }

      const assocRes = await fetch(
        `https://api.hubapi.com/crm/v3/objects/deals/${encodeURIComponent(dealId)}/associations/contacts/${encodeURIComponent(
          contactId
        )}/deal_to_contact`,
        {
          method: "PUT",
          headers: { Authorization: auth },
        }
      );

      const assocData = await readHubSpotJsonSafe(assocRes);
      if (!assocRes.ok) {
        app.log.warn(
          { status: assocRes.status, assocData, userId: request.user.id, dealId, contactId },
          "[hubspot] sync-deal association failed"
        );
        return sendApiError(reply, {
          status: 502,
          code: "INTERNAL_ERROR",
          message: "HubSpot deal association failed",
          details: { status: assocRes.status, data: assocData as any },
        });
      }

      return reply.send({ ok: true, deal: dealData, association: assocData });
      },
    }
  );

  // GET /api/crm/hubspot/contact/:email
  app.get<{ Params: { email: string } }>(
    "/crm/hubspot/contact/:email",
    {
      preHandler: [app.authenticate],
      handler: async (request, reply) => {
      const auth = getHubSpotAuthHeader();
      if (!auth) {
        return sendApiError(reply, {
          status: 500,
          code: "INTERNAL_ERROR",
          message: "HUBSPOT_API_KEY not configured",
        });
      }

      const email = (request.params?.email ?? "").trim();
      if (!email) {
        return sendApiError(reply, {
          status: 400,
          code: "INVALID_REQUEST",
          message: "email param is required",
        });
      }

      // HubSpot search endpoint is POST; this route remains GET for our API.
      const searchRes = await fetch("https://api.hubapi.com/crm/v3/objects/contacts/search", {
        method: "POST",
        headers: {
          Authorization: auth,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          filterGroups: [
            {
              filters: [
                {
                  propertyName: "email",
                  operator: "EQ",
                  value: email,
                },
              ],
            },
          ],
          limit: 1,
        }),
      });

      const searchData = await readHubSpotJsonSafe(searchRes);
      if (!searchRes.ok) {
        app.log.warn(
          { status: searchRes.status, searchData, userId: request.user.id },
          "[hubspot] contact search failed"
        );
        return sendApiError(reply, {
          status: 502,
          code: "INTERNAL_ERROR",
          message: "HubSpot contact search failed",
          details: { status: searchRes.status, data: searchData as any },
        });
      }

      return reply.send({ ok: true, hubspot: searchData });
      },
    }
  );
}

