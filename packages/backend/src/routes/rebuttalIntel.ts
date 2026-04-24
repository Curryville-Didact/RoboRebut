/**
 * rebuttalIntel.ts — Phase 7 offline intelligence layer (capture + review + analytics).
 *
 * Rules:
 * - Must not affect Live generation/selection behavior.
 * - Capture is passive + fail-open: any errors must not break the core experience.
 */

import type { FastifyInstance } from "fastify";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendApiError } from "../lib/apiErrors.js";
import {
  asIntInRange,
  asOptionalTrimmedString,
  asStringArray,
  requireOneOf,
} from "../lib/validation.js";
import { dispatchOutboundIntegrationEvent } from "../services/integrations/outboundDispatcher.js";

type RhetoricalType = "diagnostic" | "reframe" | "threshold" | "unknown";

function inferRhetoricalType(line: string | null | undefined): RhetoricalType {
  const t = (line ?? "").trim();
  if (!t) return "unknown";
  const lower = t.toLowerCase();
  if (
    lower.startsWith("what has to change") ||
    lower.startsWith("what changes by when") ||
    lower.startsWith("what has to be true") ||
    lower.startsWith("what would have to")
  ) {
    return "threshold";
  }
  if (
    lower.startsWith("where does it break") ||
    lower.startsWith("what specifically") ||
    lower.startsWith("what are they going to focus on") ||
    lower.startsWith("what are they actually going to zero in on") ||
    lower.startsWith("does this fail on") ||
    lower.startsWith("does it break on") ||
    lower.startsWith("is it the daily hit")
  ) {
    return "diagnostic";
  }
  if (
    lower.startsWith("then the issue isn't") ||
    lower.startsWith("then let’s call it what it is") ||
    lower.startsWith("then trust isn't") ||
    lower.startsWith("fair enough—") ||
    lower.startsWith("fair—") ||
    lower.startsWith("then timing is")
  ) {
    return "reframe";
  }
  return "unknown";
}

function clampLimit(v: unknown, fallback: number, max: number): number {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n)) return fallback;
  const i = Math.floor(n);
  if (i <= 0) return fallback;
  return Math.min(i, max);
}

async function mustOwnEvent(
  supabase: SupabaseClient,
  eventId: string,
  userId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("rebuttal_events")
    .select("id")
    .eq("id", eventId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return !!data;
}

export async function rebuttalIntelRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /api/rebuttal-events — capture (best-effort on caller side)
  fastify.post<{
    Body: {
      conversation_id?: string | null;
      source_mode?: string;
      source_surface?: string | null;
      merchant_message?: string | null;
      final_live_script?: string | null;
      objection_family?: string | null;
      objection_type?: string | null;
      strategy_tag?: string | null;
      tone_mode?: string | null;
      delivery_mode?: string | null;
      confidence_score?: number | null;
      selected_variant_text?: string | null;
      rhetorical_type?: string | null;
      situation_label?: string | null;
      deal_type?: string | null;
      business_name?: string | null;
      industry?: string | null;
      rep_label?: string | null;
      conversation_title?: string | null;
      created_at?: string | null;
    };
  }>("/rebuttal-events", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      const t0 = Date.now();
      const userId = request.user.id;
      const supabase = fastify.supabase;

      const body = request.body ?? {};
      const sourceMode = requireOneOf(body.source_mode, [
        "live",
        "precall_instant",
        "precall_deep",
      ] as const);
      if (!sourceMode) {
        request.log.warn({ userId, route: "/rebuttal-events", why: "bad_source_mode" });
        return sendApiError(reply, {
          status: 400,
          code: "INVALID_REQUEST",
          message: "source_mode must be one of: live, precall_instant, precall_deep",
        });
      }

      const finalLive = asOptionalTrimmedString(body.final_live_script, 2000);
      const rhetorical =
        (typeof body.rhetorical_type === "string" && body.rhetorical_type.trim()) ||
        inferRhetoricalType(finalLive);

      const { data, error } = await supabase
        .from("rebuttal_events")
        .insert({
          user_id: userId,
          conversation_id: body.conversation_id ?? null,
          source_mode: sourceMode,
          source_surface: asOptionalTrimmedString(body.source_surface, 64),
          merchant_message: asOptionalTrimmedString(body.merchant_message, 2000),
          final_live_script: finalLive,
          objection_family: asOptionalTrimmedString(body.objection_family, 64),
          objection_type: asOptionalTrimmedString(body.objection_type, 64),
          strategy_tag: asOptionalTrimmedString(body.strategy_tag, 128),
          tone_mode: asOptionalTrimmedString(body.tone_mode, 64),
          delivery_mode: asOptionalTrimmedString(body.delivery_mode, 64),
          confidence_score:
            typeof body.confidence_score === "number" && Number.isFinite(body.confidence_score)
              ? Math.max(0, Math.min(1, body.confidence_score))
              : null,
          selected_variant_text: asOptionalTrimmedString(body.selected_variant_text, 2000),
          rhetorical_type: rhetorical,
          situation_label: asOptionalTrimmedString(body.situation_label, 64),
          deal_type: asOptionalTrimmedString(body.deal_type, 64),
          business_name: asOptionalTrimmedString(body.business_name, 128),
          industry: asOptionalTrimmedString(body.industry, 128),
          rep_label: asOptionalTrimmedString(body.rep_label, 64),
          conversation_title: asOptionalTrimmedString(body.conversation_title, 128),
          ...(body.created_at ? { created_at: body.created_at } : {}),
        })
        .select("id, created_at")
        .single();

      if (error || !data) {
        request.log.error(
          { userId, route: "/rebuttal-events", ms: Date.now() - t0, err: error?.message },
          "capture_insert_failed"
        );
        return sendApiError(reply, {
          status: 500,
          code: "INTERNAL_ERROR",
          message: "Failed to capture rebuttal event",
        });
      }
      request.log.info({ userId, route: "/rebuttal-events", ms: Date.now() - t0 }, "capture_ok");

      // Best-effort outbound integration dispatch (must not affect capture success).
      void dispatchOutboundIntegrationEvent({
        supabase,
        userId,
        eventType: "rebuttal.generated",
        payload: {
          event: "rebuttal.generated",
          timestamp: new Date().toISOString(),
          workspace_id: null,
          user_id: userId,
          conversation_id: body.conversation_id ?? null,
          rebuttal_event_id: data.id,
          objection_text: (asOptionalTrimmedString(body.merchant_message, 500) ?? null),
          primary_response: (finalLive ?? "").slice(0, 800),
          strategy_tag: asOptionalTrimmedString(body.strategy_tag, 128),
          rhetorical_type: rhetorical,
          confidence_score:
            typeof body.confidence_score === "number" && Number.isFinite(body.confidence_score)
              ? Math.max(0, Math.min(1, body.confidence_score))
              : null,
          metadata: { mode: sourceMode, source: "roborebut" },
        },
        correlationId: String(data.id),
      }).catch((e) => {
        request.log.warn({ userId, err: e instanceof Error ? e.message : String(e) }, "integration_dispatch_failed");
      });

      return reply.send({ ok: true, id: data.id, created_at: data.created_at });
    },
  });

  // GET /api/rebuttal-events — list with filters (newest first)
  fastify.get<{
    Querystring: {
      limit?: string;
      cursor?: string;
      source_mode?: string;
      objection_family?: string;
      tone_mode?: string;
      rhetorical_type?: string;
      review_status?: "reviewed" | "unreviewed";
      review_disposition?: string;
    };
  }>("/rebuttal-events", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      const userId = request.user.id;
      const supabase = fastify.supabase;
      const q = request.query ?? {};
      const limit = clampLimit(q.limit, 50, 200);
      const cursor = typeof q.cursor === "string" ? q.cursor : null;

      if (q.review_status && q.review_status !== "reviewed" && q.review_status !== "unreviewed") {
        return sendApiError(reply, {
          status: 400,
          code: "INVALID_REQUEST",
          message: "review_status must be reviewed or unreviewed",
        });
      }

      let query = supabase
        .from("rebuttal_events")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (cursor) query = query.lt("created_at", cursor);
      if (q.source_mode) query = query.eq("source_mode", q.source_mode);
      if (q.objection_family) query = query.eq("objection_family", q.objection_family);
      if (q.tone_mode) query = query.eq("tone_mode", q.tone_mode);
      if (q.rhetorical_type) query = query.eq("rhetorical_type", q.rhetorical_type);

      const { data: events, error } = await query;
      if (error) return reply.status(500).send({ error: error.message });

      const rows = events ?? [];
      const ids = rows.map((r) => String((r as { id?: unknown }).id ?? "")).filter(Boolean);

      const { data: reviews, error: revErr } = ids.length
        ? await supabase
            .from("rebuttal_reviews")
            .select("*")
            .eq("user_id", userId)
            .in("rebuttal_event_id", ids)
        : { data: [], error: null };
      if (revErr) return reply.status(500).send({ error: revErr.message });

      const byEventId = new Map<string, Record<string, unknown>>();
      for (const r of reviews ?? []) {
        const eid = String((r as { rebuttal_event_id?: unknown }).rebuttal_event_id ?? "");
        if (eid) byEventId.set(eid, r as Record<string, unknown>);
      }

      const combined = rows.map((e) => {
        const eid = String((e as { id?: unknown }).id ?? "");
        return { ...(e as Record<string, unknown>), review: byEventId.get(eid) ?? null };
      });

      const filtered =
        q.review_status === "reviewed"
          ? combined.filter((r) => r.review != null)
          : q.review_status === "unreviewed"
            ? combined.filter((r) => r.review == null)
            : combined;

      const filtered2 =
        q.review_disposition && q.review_disposition.trim()
          ? filtered.filter((r) => {
              const disp =
                r.review && typeof (r.review as { disposition?: unknown }).disposition === "string"
                  ? ((r.review as { disposition: string }).disposition as string)
                  : "";
              return disp === q.review_disposition;
            })
          : filtered;

      const nextCursor =
        filtered2.length > 0
          ? String((filtered2[filtered2.length - 1] as { created_at?: unknown }).created_at ?? "")
          : null;

      return reply.send({ items: filtered2, nextCursor });
    },
  });

  // POST /api/rebuttal-reviews — upsert review for an event
  fastify.post<{
    Body: {
      rebuttal_event_id?: string;
      rating?: number;
      outcome_tag?: string | null;
      disposition?: string | null;
      structured_tags?: string[] | null;
      notes?: string | null;
      clear?: boolean;
    };
  }>("/rebuttal-reviews", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      const t0 = Date.now();
      const userId = request.user.id;
      const supabase = fastify.supabase;
      const body = request.body ?? {};

      const eventId = (body.rebuttal_event_id ?? "").trim();
      if (!eventId) {
        return sendApiError(reply, {
          status: 400,
          code: "INVALID_REQUEST",
          message: "rebuttal_event_id is required",
        });
      }

      // Clear/skip: delete review row if it exists (safe no-op if missing).
      if (body.clear === true) {
        const owns = await mustOwnEvent(supabase, eventId, userId);
        if (!owns) {
          return sendApiError(reply, {
            status: 404,
            code: "NOT_FOUND",
            message: "Event not found",
          });
        }
        const { error } = await supabase
          .from("rebuttal_reviews")
          .delete()
          .eq("user_id", userId)
          .eq("rebuttal_event_id", eventId);
        if (error) {
          request.log.error({ userId, route: "/rebuttal-reviews", err: error.message }, "review_clear_failed");
          return sendApiError(reply, {
            status: 500,
            code: "INTERNAL_ERROR",
            message: "Failed to clear review",
          });
        }
        return reply.send({ ok: true, cleared: true });
      }

      const rating = asIntInRange(body.rating, 1, 5);
      if (rating == null) {
        return sendApiError(reply, {
          status: 400,
          code: "INVALID_REQUEST",
          message: "rating must be an integer 1..5",
        });
      }

      const owns = await mustOwnEvent(supabase, eventId, userId);
      if (!owns) {
        return sendApiError(reply, {
          status: 404,
          code: "NOT_FOUND",
          message: "Event not found",
        });
      }

      const disposition = body.disposition
        ? requireOneOf(body.disposition, ["strong", "weak", "missed", "cleared"] as const)
        : null;
      if (body.disposition != null && disposition == null) {
        return sendApiError(reply, {
          status: 400,
          code: "INVALID_REQUEST",
          message: "disposition must be one of: strong, weak, missed, cleared",
        });
      }

      const structuredTags = body.structured_tags
        ? asStringArray(body.structured_tags, 25, 32)
        : null;
      if (body.structured_tags != null && structuredTags == null) {
        return sendApiError(reply, {
          status: 400,
          code: "INVALID_REQUEST",
          message: "structured_tags must be an array of strings",
        });
      }

      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from("rebuttal_reviews")
        .upsert(
          {
            user_id: userId,
            rebuttal_event_id: eventId,
            rating,
            outcome_tag: body.outcome_tag ?? null,
            disposition,
            structured_tags: structuredTags,
            notes: body.notes ?? null,
            reviewed_at: now,
            updated_at: now,
          },
          { onConflict: "user_id,rebuttal_event_id" }
        )
        .select("*")
        .single();

      if (error || !data) {
        request.log.error(
          { userId, route: "/rebuttal-reviews", ms: Date.now() - t0, err: error?.message },
          "review_upsert_failed"
        );
        return sendApiError(reply, {
          status: 500,
          code: "INTERNAL_ERROR",
          message: "Failed to save review",
        });
      }
      request.log.info({ userId, route: "/rebuttal-reviews", ms: Date.now() - t0 }, "review_ok");

      // Best-effort outbound integration dispatch.
      void dispatchOutboundIntegrationEvent({
        supabase,
        userId,
        eventType: "review.submitted",
        payload: {
          event: "review.submitted",
          timestamp: new Date().toISOString(),
          workspace_id: null,
          user_id: userId,
          conversation_id: null,
          rebuttal_event_id: eventId,
          disposition,
          rating,
          structured_tags: structuredTags ?? [],
          notes_present: !!(body.notes && typeof body.notes === "string" && body.notes.trim()),
          metadata: { source: "roborebut" },
        },
        correlationId: eventId,
      }).catch((e) => {
        request.log.warn({ userId, err: e instanceof Error ? e.message : String(e) }, "integration_dispatch_failed");
      });

      return reply.send({ ok: true, review: data });
    },
  });

  // GET /api/rebuttal-events/analytics — simple aggregates (scoped to user)
  fastify.get<{
    Querystring: { days?: string };
  }>("/rebuttal-events/analytics", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      const userId = request.user.id;
      const supabase = fastify.supabase;
      const days = clampLimit(request.query?.days, 30, 365);
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

      const { data: events, error } = await supabase
        .from("rebuttal_events")
        .select(
          "id, created_at, merchant_message, final_live_script, objection_family, tone_mode, rhetorical_type"
        )
        .eq("user_id", userId)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(5000);
      if (error) return reply.status(500).send({ error: error.message });

      const rows = events ?? [];
      const ids = rows.map((r) => String((r as { id?: unknown }).id ?? "")).filter(Boolean);
      const { data: reviews, error: revErr } = ids.length
        ? await supabase
            .from("rebuttal_reviews")
            .select("rebuttal_event_id, rating, outcome_tag")
            .eq("user_id", userId)
            .in("rebuttal_event_id", ids)
        : { data: [], error: null };
      if (revErr) return reply.status(500).send({ error: revErr.message });

      const byEventId = new Map<string, { rating: number; outcome_tag: string | null }>();
      for (const r of reviews ?? []) {
        const eid = String((r as { rebuttal_event_id?: unknown }).rebuttal_event_id ?? "");
        const rating = Number((r as { rating?: unknown }).rating ?? NaN);
        if (eid && Number.isFinite(rating)) {
          byEventId.set(eid, {
            rating,
            outcome_tag:
              typeof (r as { outcome_tag?: unknown }).outcome_tag === "string"
                ? ((r as { outcome_tag: string }).outcome_tag as string)
                : null,
          });
        }
      }

      const totalCaptured = rows.length;
      let totalReviewed = 0;
      let ratingSum = 0;
      let ratingCount = 0;

      const familyCount = new Map<string, number>();
      const toneCount = new Map<string, number>();
      const rhetoricalCount = new Map<string, number>();
      const outcomeCount = new Map<string, number>();
      const merchantCount = new Map<string, number>();
      const dailyCount = new Map<string, number>();

      const familyRatingAgg = new Map<
        string,
        { count: number; ratingSum: number; ratingCount: number; weak: number; repetitive: number; missed_context: number }
      >();

      for (const e of rows) {
        const rec = e as Record<string, unknown>;
        const id = String(rec.id ?? "");
        const createdAt = String(rec.created_at ?? "");
        const day = createdAt.slice(0, 10);
        if (day) dailyCount.set(day, (dailyCount.get(day) ?? 0) + 1);

        const fam = typeof rec.objection_family === "string" ? rec.objection_family : "unknown";
        familyCount.set(fam, (familyCount.get(fam) ?? 0) + 1);

        const tone = typeof rec.tone_mode === "string" ? rec.tone_mode : "unknown";
        toneCount.set(tone, (toneCount.get(tone) ?? 0) + 1);

        const rt = typeof rec.rhetorical_type === "string" ? rec.rhetorical_type : "unknown";
        rhetoricalCount.set(rt, (rhetoricalCount.get(rt) ?? 0) + 1);

        const mm =
          typeof rec.merchant_message === "string" && rec.merchant_message.trim()
            ? rec.merchant_message.trim()
            : "";
        if (mm) merchantCount.set(mm, (merchantCount.get(mm) ?? 0) + 1);

        const rev = byEventId.get(id) ?? null;
        if (rev) {
          totalReviewed += 1;
          ratingSum += rev.rating;
          ratingCount += 1;
          if (rev.outcome_tag) {
            outcomeCount.set(rev.outcome_tag, (outcomeCount.get(rev.outcome_tag) ?? 0) + 1);
          }
          const agg = familyRatingAgg.get(fam) ?? {
            count: 0,
            ratingSum: 0,
            ratingCount: 0,
            weak: 0,
            repetitive: 0,
            missed_context: 0,
          };
          agg.count += 1;
          agg.ratingSum += rev.rating;
          agg.ratingCount += 1;
          if (rev.outcome_tag === "weak") agg.weak += 1;
          if (rev.outcome_tag === "repetitive") agg.repetitive += 1;
          if (rev.outcome_tag === "missed_context") agg.missed_context += 1;
          familyRatingAgg.set(fam, agg);
        }
      }

      const mostCommon = (m: Map<string, number>): string | null => {
        let best: { k: string; v: number } | null = null;
        for (const [k, v] of m.entries()) {
          if (!best || v > best.v) best = { k, v };
        }
        return best?.k ?? null;
      };

      const coveragePct =
        totalCaptured > 0 ? Math.round((totalReviewed / totalCaptured) * 1000) / 10 : 0;
      const avgRating = ratingCount > 0 ? Math.round((ratingSum / ratingCount) * 100) / 100 : null;

      const topN = (m: Map<string, number>, n: number) =>
        [...m.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, n)
          .map(([k, v]) => ({ key: k, count: v }));

      const daily = [...dailyCount.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([day, count]) => ({ day, count }));

      const familyBreakdown = [...familyRatingAgg.entries()]
        .map(([family, agg]) => ({
          family,
          count: agg.count,
          avgRating: agg.ratingCount > 0 ? agg.ratingSum / agg.ratingCount : null,
          weakPct: agg.count > 0 ? agg.weak / agg.count : 0,
          repetitivePct: agg.count > 0 ? agg.repetitive / agg.count : 0,
          missedContextPct: agg.count > 0 ? agg.missed_context / agg.count : 0,
        }))
        .sort((a, b) => b.count - a.count);

      return reply.send({
        windowDays: days,
        cards: {
          totalCaptured,
          totalReviewed,
          coveragePct,
          avgRating,
          mostCommonFamily: mostCommon(familyCount),
          mostCommonRhetoricalType: mostCommon(rhetoricalCount),
        },
        series: {
          daily,
          objectionFamily: topN(familyCount, 50),
          tone: topN(toneCount, 50),
          rhetoricalType: topN(rhetoricalCount, 50),
          outcomeTag: topN(outcomeCount, 50),
          topMerchantObjections: topN(merchantCount, 25),
        },
        breakdown: {
          families: familyBreakdown,
        },
      });
    },
  });
}

