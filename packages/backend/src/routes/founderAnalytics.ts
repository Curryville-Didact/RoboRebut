/**
 * Founder internal analytics — read-only pattern intelligence summary.
 *
 * Security:
 * - Requires normal auth (Bearer token via fastify.authenticate)
 * - Requires founder allowlist by email (FOUNDER_EMAILS or NEXT_PUBLIC_FOUNDER_EMAILS)
 */
import type { FastifyInstance } from "fastify";
import { sendApiError } from "../lib/apiErrors.js";
import { buildAnalyticsIntelligenceSummary } from "../services/analyticsIntelligence.js";

function founderEmailAllowlist(): string[] {
  const raw =
    process.env.FOUNDER_EMAILS?.trim() ||
    process.env.NEXT_PUBLIC_FOUNDER_EMAILS?.trim() ||
    "";
  if (raw) {
    return raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  }
  return ["admin@getrebut.ai"];
}

function isFounderEmail(email: string | null | undefined): boolean {
  const e = (email ?? "").trim().toLowerCase();
  if (!e) return false;
  return founderEmailAllowlist().includes(e);
}

export async function founderAnalyticsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{
    Querystring: { limit?: string; conversationId?: string };
  }>("/founder/analytics/pattern-intelligence", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      const callerEmail = request.user.email ?? null;
      if (!isFounderEmail(callerEmail)) {
        return sendApiError(reply, {
          status: 403,
          code: "FORBIDDEN",
          message: "Forbidden",
        });
      }

      const limitRaw = typeof request.query.limit === "string" ? request.query.limit.trim() : "";
      const limit = limitRaw ? Number(limitRaw) : undefined;
      const conversationId =
        typeof request.query.conversationId === "string"
          ? request.query.conversationId.trim()
          : null;

      const summary = await buildAnalyticsIntelligenceSummary(fastify.supabase, {
        limit: typeof limit === "number" && Number.isFinite(limit) ? limit : undefined,
        conversationId,
      });
      return reply.send(summary);
    },
  });
}

