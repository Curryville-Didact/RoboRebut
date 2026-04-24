/**
 * Phase 8 — Admin/offline intelligence endpoints (protected, read-only to Live).
 *
 * Scope:
 * - Manual rebuild trigger
 * - Snapshot/summary reads for inspection
 *
 * Security:
 * - Requires normal auth (Bearer token) and allowlist via INTELLIGENCE_ADMIN_ALLOWLIST.
 * - Endpoints are under /api/admin/intelligence/*
 */

import type { FastifyInstance } from "fastify";
import { rebuildOfflineIntelligenceForUser } from "../services/intelligence/offlineIntelligence.js";
import { buildLatestInsightsForUser } from "../services/intelligence/intelligenceSummary.js";
import { sendApiError } from "../lib/apiErrors.js";

function isAllowedAdmin(userId: string): boolean {
  const raw = process.env.INTELLIGENCE_ADMIN_ALLOWLIST ?? "";
  const allow = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allow.length === 0) return false;
  return allow.includes(userId);
}

export async function adminIntelligenceRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post<{
    Body: { window_days?: number };
  }>("/admin/intelligence/rebuild", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      const userId = request.user.id;
      if (!isAllowedAdmin(userId)) {
        return sendApiError(reply, {
          status: 403,
          code: "FORBIDDEN",
          message: "Forbidden",
        });
      }
      const windowDaysRaw = request.body?.window_days;
      const windowDays =
        typeof windowDaysRaw === "number" && Number.isFinite(windowDaysRaw)
          ? Math.max(7, Math.min(365, Math.floor(windowDaysRaw)))
          : 90;
      const result = await rebuildOfflineIntelligenceForUser({
        supabase: fastify.supabase,
        userId,
        windowDays,
      });
      return reply.send({ ok: true, ...result, windowDays });
    },
  });

  fastify.get("/admin/intelligence/summary", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      const userId = request.user.id;
      if (!isAllowedAdmin(userId)) {
        return sendApiError(reply, {
          status: 403,
          code: "FORBIDDEN",
          message: "Forbidden",
        });
      }

      const { data: run, error: runErr } = await fastify.supabase
        .from("intelligence_run_logs")
        .select("*")
        .eq("user_id", userId)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (runErr) return reply.status(500).send({ error: runErr.message });
      if (!run) return reply.send({ ok: true, latestRun: null });

      const runId = String((run as { id?: unknown }).id ?? "");
      const { data: snaps, error: snErr } = await fastify.supabase
        .from("variant_intelligence_snapshots")
        .select("*")
        .eq("user_id", userId)
        .eq("run_id", runId)
        .limit(5000);
      if (snErr) return reply.status(500).send({ error: snErr.message });

      const rows = (snaps ?? []) as Record<string, unknown>[];
      const byReco = new Map<string, number>();
      const underReviewReasonCount = new Map<string, number>();
      for (const r of rows) {
        const k =
          typeof r.recommendation_type === "string" ? r.recommendation_type : "unknown";
        byReco.set(k, (byReco.get(k) ?? 0) + 1);
        const meta = r.metadata;
        if (meta && typeof meta === "object" && "underReviewReasons" in meta) {
          const reasons = (meta as { underReviewReasons?: unknown }).underReviewReasons;
          if (Array.isArray(reasons)) {
            for (const reason of reasons) {
              if (typeof reason === "string" && reason.trim()) {
                underReviewReasonCount.set(
                  reason,
                  (underReviewReasonCount.get(reason) ?? 0) + 1
                );
              }
            }
          }
        }
      }

      const { data: registryRows, error: regErr } = await fastify.supabase
        .from("variant_inventory_registry_snapshots")
        .select("id")
        .eq("user_id", userId)
        .eq("run_id", runId);
      if (regErr) return reply.status(500).send({ error: regErr.message });

      const topN = (type: string, n: number) =>
        rows
          .filter((r) => r.recommendation_type === type)
          .slice()
          .sort((a, b) => Number(b.usage_count ?? 0) - Number(a.usage_count ?? 0))
          .slice(0, n);

      return reply.send({
        ok: true,
        latestRun: run,
        min_sample_threshold:
          run && typeof (run as { metadata?: unknown }).metadata === "object"
            ? (run as { metadata?: { minSampleThreshold?: unknown } }).metadata
                ?.minSampleThreshold ?? null
            : null,
        registry: {
          variantsLoaded: (registryRows ?? []).length,
          unusedDetected: rows.filter((r) => Number(r.usage_count ?? 0) === 0).length,
        },
        strategy_tag: {
          presentCount:
            run && typeof (run as { metadata?: unknown }).metadata === "object"
              ? (run as { metadata?: { strategyTagPresentCount?: unknown } }).metadata
                  ?.strategyTagPresentCount ?? null
              : null,
        },
        countsByRecommendationType: Object.fromEntries(byReco.entries()),
        underReviewReasonBreakdown: Object.fromEntries(underReviewReasonCount.entries()),
        topPerformers: topN("top_performer", 10),
        underperformers: topN("underperforming", 10),
        needsRevision: topN("needs_revision", 10),
        underutilized: topN("underutilized", 10),
      });
    },
  });

  fastify.get("/admin/intelligence/insights", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      const userId = request.user.id;
      if (!isAllowedAdmin(userId)) {
        return sendApiError(reply, {
          status: 403,
          code: "FORBIDDEN",
          message: "Forbidden",
        });
      }
      const insights = await buildLatestInsightsForUser({
        supabase: fastify.supabase,
        userId,
      });
      if (!insights) return reply.send({ ok: true, insights: null });
      return reply.send({ ok: true, ...insights });
    },
  });

  fastify.get<{
    Querystring: { run_id?: string; limit?: string };
  }>("/admin/intelligence/snapshots", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      const userId = request.user.id;
      if (!isAllowedAdmin(userId)) {
        return sendApiError(reply, {
          status: 403,
          code: "FORBIDDEN",
          message: "Forbidden",
        });
      }

      const limitRaw = request.query?.limit ?? "200";
      const limitNum = Math.max(1, Math.min(2000, Number(limitRaw) || 200));

      let runId = request.query?.run_id?.trim() ?? "";
      if (!runId) {
        const { data: run, error } = await fastify.supabase
          .from("intelligence_run_logs")
          .select("id")
          .eq("user_id", userId)
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) return reply.status(500).send({ error: error.message });
        runId = run ? String((run as { id?: unknown }).id ?? "") : "";
      }
      if (!runId) return reply.send({ ok: true, run_id: null, items: [] });

      const { data, error } = await fastify.supabase
        .from("variant_intelligence_snapshots")
        .select("*")
        .eq("user_id", userId)
        .eq("run_id", runId)
        .order("usage_count", { ascending: false })
        .limit(limitNum);
      if (error) return reply.status(500).send({ error: error.message });
      return reply.send({ ok: true, run_id: runId, items: data ?? [] });
    },
  });
}

