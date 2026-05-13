/**
 * conversations.ts — Phase 3.0
 * CRUD for user conversations. All routes require authentication.
 */

import type { FastifyInstance } from "fastify";
import type { ClientContext } from "../types/clientContext.js";
import type { DealContext } from "../types/dealContext.js";
import { getNormalizedUsageForUser } from "../services/freeTierUsage.js";
import { getPlanEntitlements } from "../services/planEntitlements.js";
import { generateCoachReply } from "../services/coachChatReply.js";

type ConversationRow = {
  id: string;
  user_id: string;
  title: string;
  deal_context: DealContext | null;
  call_transcript?: string | null;
  client_context?: ClientContext | null;
  created_at: string;
  updated_at: string;
};

export async function conversationRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /api/conversations
  fastify.get("/conversations", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      const { data, error } = await fastify.supabase
        .from("conversations")
        .select("*")
        .eq("user_id", request.user.id)
        .order("updated_at", { ascending: false });

      if (error) return reply.status(500).send({ error: error.message });
      return reply.send((data ?? []) as ConversationRow[]);
    },
  });

  // GET /api/conversations/:id
  fastify.get<{ Params: { id: string } }>("/conversations/:id", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      const { id } = request.params;

      const { data, error } = await fastify.supabase
        .from("conversations")
        .select("*")
        .eq("id", id)
        .eq("user_id", request.user.id)
        .maybeSingle();

      if (error) return reply.status(500).send({ error: error.message });
      if (!data) return reply.status(404).send({ error: "Conversation not found" });
      return reply.send(data as ConversationRow);
    },
  });

  // POST /api/conversations
  fastify.post<{
    Body: {
      title?: string;
      deal_context?: Record<string, unknown> | null;
      transcript?: string;
      client_context?: ClientContext | null;
    };
  }>("/conversations", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      const { title = "New Conversation" } = request.body ?? {};

      const transcript =
        typeof request.body?.transcript === "string" ? request.body.transcript.trim() : "";

      const { data, error } = await fastify.supabase
        .from("conversations")
        .insert({
          user_id: request.user.id,
          title,
          ...(transcript ? { call_transcript: transcript } : {}),
          ...(request.body?.deal_context !== undefined
            ? { deal_context: request.body.deal_context }
            : {}),
          ...(request.body?.client_context !== undefined
            ? { client_context: request.body.client_context }
            : {}),
        })
        .select()
        .single();

      if (error) return reply.status(500).send({ error: error.message });
      return reply.status(201).send(data as ConversationRow);
    },
  });

  // PATCH /api/conversations/:id — optional `title`, `deal_context`, and/or `client_context`
  fastify.patch<{
    Params: { id: string };
    Body: {
      title?: string;
      deal_context?: DealContext | null;
      client_context?: ClientContext | null;
    };
  }>("/conversations/:id", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      const { id } = request.params;
      const body = request.body ?? {};
      const hasTitleKey = Object.prototype.hasOwnProperty.call(body, "title");
      const hasDealContextKey = Object.prototype.hasOwnProperty.call(
        body,
        "deal_context"
      );
      const hasClientContextKey = Object.prototype.hasOwnProperty.call(
        body,
        "client_context"
      );

      if (!hasTitleKey && !hasDealContextKey && !hasClientContextKey) {
        return reply.status(400).send({
          error:
            "Provide title, deal_context, and/or client_context to update.",
        });
      }

      const updates: Record<string, unknown> = {};

      if (hasTitleKey) {
        const title = typeof body.title === "string" ? body.title.trim() : "";
        if (!title) {
          return reply
            .status(400)
            .send({ error: "title cannot be empty when provided." });
        }
        if (title === "New Conversation") {
          return reply.status(400).send({
            error: "Please choose a more specific title.",
          });
        }
        updates.title = title;
      }

      if (hasDealContextKey) {
        const dc = body.deal_context;
        if (dc !== null && (typeof dc !== "object" || Array.isArray(dc))) {
          return reply.status(400).send({ error: "Invalid deal_context" });
        }
        const usageRow = await getNormalizedUsageForUser(
          fastify.supabase,
          request.user.id
        );
        const planType = usageRow?.plan ?? "free";
        const entitlements = getPlanEntitlements(planType);
        if (dc !== null && !entitlements.structuredDealContext) {
          return reply.status(403).send({
            error: "Structured deal context requires a Pro plan.",
            code: "deal_context_pro_required",
          });
        }
        let serialized: unknown;
        try {
          serialized = dc === null ? null : JSON.parse(JSON.stringify(dc));
        } catch {
          return reply
            .status(400)
            .send({ error: "deal_context is not JSON-serializable" });
        }
        updates.deal_context = serialized;
      }

      if (hasClientContextKey) {
        const cc = body.client_context;
        if (cc !== null && (typeof cc !== "object" || Array.isArray(cc))) {
          return reply.status(400).send({ error: "Invalid client_context" });
        }
        let serializedCc: unknown;
        try {
          serializedCc = cc === null ? null : JSON.parse(JSON.stringify(cc));
        } catch {
          return reply
            .status(400)
            .send({ error: "client_context is not JSON-serializable" });
        }
        updates.client_context = serializedCc;
      }

      if (Object.keys(updates).length === 0) {
        return reply.status(400).send({ error: "Nothing to update." });
      }

      // Do not touch updated_at — it tracks message activity for sort order.

      const { data, error } = await fastify.supabase
        .from("conversations")
        .update(updates)
        .eq("id", id)
        .eq("user_id", request.user.id)
        .select()
        .single();

      if (error) return reply.status(500).send({ error: error.message });
      if (!data) return reply.status(404).send({ error: "Conversation not found" });
      return reply.send(data as ConversationRow);
    },
  });

  // DELETE /api/conversations/:id
  fastify.delete<{ Params: { id: string } }>("/conversations/:id", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      const { id } = request.params;

      const { error } = await fastify.supabase
        .from("conversations")
        .delete()
        .eq("id", id)
        .eq("user_id", request.user.id);

      if (error) return reply.status(500).send({ error: error.message });
      return reply.status(204).send();
    },
  });

  // PATCH /api/conversations/:id/outcome
  fastify.patch<{
    Params: { id: string };
    Body: {
      outcome: "WON" | "LOST" | "IN_PROGRESS";
      dealSize?: number;
      lostReason?: string;
    };
  }>("/conversations/:id/outcome", {
    preHandler: [fastify.authenticate],
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    handler: async (request, reply) => {
      const { id } = request.params;
      const body = request.body ?? {};
      const { outcome, dealSize, lostReason } = body;
      const userId = request.user.id;
      const requestId = (request.id as string) ?? "unknown";

      if (outcome === "WON") {
        if (!dealSize || dealSize <= 0) {
          return reply.status(400).send({
            error: "dealSize is required and must be > 0 when outcome is WON",
          });
        }
      }

      if (outcome === "LOST") {
        if (!lostReason || lostReason.trim().length === 0) {
          return reply.status(400).send({
            error: "lostReason is required when outcome is LOST",
          });
        }
      }

      const { data: existing, error: fetchError } = await fastify.supabase
        .from("conversations")
        .select("id")
        .eq("id", id)
        .eq("user_id", userId)
        .single();

      if (fetchError || !existing) {
        return reply.status(404).send({ error: "Conversation not found" });
      }

      const updates: Record<string, unknown> = { outcome };

      if (outcome === "WON") {
        updates.deal_size = dealSize;
        updates.closed_at = new Date().toISOString();
        updates.lost_reason = null;
      } else if (outcome === "LOST") {
        updates.lost_reason = lostReason!.trim();
        updates.closed_at = new Date().toISOString();
        updates.deal_size = null;
      } else {
        updates.closed_at = null;
        updates.deal_size = null;
        updates.lost_reason = null;
      }

      const { data, error } = await fastify.supabase
        .from("conversations")
        .update(updates)
        .eq("id", id)
        .eq("user_id", userId)
        .select()
        .single();

      if (error) {
        fastify.log.error({ requestId, error }, "Failed to update outcome");
        return reply.status(500).send({ error: "Failed to update outcome" });
      }

      fastify.log.info(
        { requestId, conversationId: id, outcome, userId },
        "Outcome updated"
      );

      return reply.send(data);
    },
  });

  // GET /api/conversations/analytics/close-rate
  fastify.get<{
    Querystring: { period?: "week" | "month" | "all" };
  }>("/conversations/analytics/close-rate", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      const userId = request.user.id;
      const period = request.query.period ?? "week";

      const now = new Date();
      const periodDays = period === "week" ? 7 : period === "month" ? 30 : null;
      const prevDays = periodDays ? periodDays * 2 : null;

      const buildQuery = (from: Date | null, to: Date | null) => {
        let q = fastify.supabase
          .from("conversations")
          .select("outcome, deal_size")
          .eq("user_id", userId);
        if (from) q = q.gte("created_at", from.toISOString());
        if (to) q = q.lt("created_at", to.toISOString());
        return q;
      };

      const currentFrom = periodDays
        ? new Date(now.getTime() - periodDays * 86400000)
        : null;

      const { data: rows, error } = await buildQuery(currentFrom, null);

      if (error) {
        fastify.log.error({ error }, "Failed to fetch close rate");
        return reply.status(500).send({ error: "Failed to fetch analytics" });
      }

      const calc = (items: { outcome: string; deal_size: number | null }[]) => {
        const won = items.filter((r) => r.outcome === "WON").length;
        const lost = items.filter((r) => r.outcome === "LOST").length;
        const inProgress = items.filter(
          (r) => r.outcome === "IN_PROGRESS"
        ).length;
        const closed = won + lost;
        const closeRate = closed > 0 ? (won / closed) * 100 : 0;
        const wonRows = items.filter(
          (r) => r.outcome === "WON" && r.deal_size != null
        );
        const totalDealValue = wonRows.reduce(
          (s, r) => s + (r.deal_size ?? 0),
          0
        );
        const avgDealSize =
          wonRows.length > 0 ? totalDealValue / wonRows.length : 0;
        return { won, lost, inProgress, closeRate, totalDealValue, avgDealSize };
      };

      const current = calc(rows ?? []);

      let prevCloseRate = 0;

      if (periodDays && prevDays != null && currentFrom != null) {
        const prevFrom = new Date(now.getTime() - prevDays * 86400000);
        const prevTo = currentFrom;
        const { data: prevRows } = await buildQuery(prevFrom, prevTo);
        prevCloseRate = calc(prevRows ?? []).closeRate;
      }

      return reply.send({
        period,
        totalConversations: (rows ?? []).length,
        won: current.won,
        lost: current.lost,
        inProgress: current.inProgress,
        closeRate: Math.round(current.closeRate * 10) / 10,
        totalDealValue: current.totalDealValue,
        avgDealSize: Math.round(current.avgDealSize * 100) / 100,
        prevCloseRate: Math.round(prevCloseRate * 10) / 10,
        closeRateDelta:
          Math.round((current.closeRate - prevCloseRate) * 10) / 10,
      });
    },
  });

  // GET /api/conversations/analytics/morning-brief
  fastify.get(
    "/conversations/analytics/morning-brief",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user.id;
      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString();
      const fourteenDaysAgo = new Date(now.getTime() - 14 * 86400000).toISOString();

      // ── 1. Close rate this week vs last week ──────────────────────────
      const { data: thisWeekRows } = await fastify.supabase
        .from("conversations")
        .select("outcome, deal_size, closed_at")
        .eq("user_id", userId)
        .gte("created_at", sevenDaysAgo);

      const { data: lastWeekRows } = await fastify.supabase
        .from("conversations")
        .select("outcome, deal_size, closed_at")
        .eq("user_id", userId)
        .gte("created_at", fourteenDaysAgo)
        .lt("created_at", sevenDaysAgo);

      const calcRate = (rows: { outcome: string }[]) => {
        const won = rows.filter((r) => r.outcome === "WON").length;
        const lost = rows.filter((r) => r.outcome === "LOST").length;
        const closed = won + lost;
        return {
          won,
          lost,
          total: rows.length,
          closeRate: closed > 0 ? Math.round((won / closed) * 1000) / 10 : 0,
        };
      };

      const thisWeek = calcRate(thisWeekRows ?? []);
      const lastWeek = calcRate(lastWeekRows ?? []);
      const closeRateDelta =
        Math.round((thisWeek.closeRate - lastWeek.closeRate) * 10) / 10;

      // ── 2. Win streak ─────────────────────────────────────────────────
      // Walk closed conversations newest-first, count consecutive WONs
      const { data: closedRows } = await fastify.supabase
        .from("conversations")
        .select("outcome, closed_at")
        .eq("user_id", userId)
        .in("outcome", ["WON", "LOST"])
        .order("closed_at", { ascending: false })
        .limit(50);

      let winStreak = 0;
      for (const row of closedRows ?? []) {
        if (row.outcome === "WON") {
          winStreak++;
        } else {
          break;
        }
      }

      // ── 3. Trending objection (global, last 7 days) ───────────────────
      const { data: objectionRows } = await fastify.supabase
        .from("rebuttal_events")
        .select("objection_type")
        .not("objection_type", "is", null)
        .gte("created_at", sevenDaysAgo);

      const objectionCounts: Record<string, number> = {};
      for (const row of objectionRows ?? []) {
        const t = (row.objection_type as string | null)?.trim();
        if (t) objectionCounts[t] = (objectionCounts[t] ?? 0) + 1;
      }
      const trendingObjection =
        Object.entries(objectionCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ??
        null;

      // ── 4. Rebuttal to practice (user's weakest objection type) ───────
      // Weakest = objection_type the user has encountered most but won
      // least on (highest loss rate among types with >= 2 encounters)
      const { data: userRebuttalRows } = await fastify.supabase
        .from("rebuttal_events")
        .select("objection_type, conversation_id")
        .eq("user_id", userId)
        .not("objection_type", "is", null)
        .gte("created_at", fourteenDaysAgo);

      // Map objection_type → conversation_ids
      const objTypeConvMap: Record<string, Set<string>> = {};
      for (const row of userRebuttalRows ?? []) {
        const t = (row.objection_type as string | null)?.trim();
        const cid = row.conversation_id as string | null;
        if (t && cid) {
          if (!objTypeConvMap[t]) objTypeConvMap[t] = new Set();
          objTypeConvMap[t]!.add(cid);
        }
      }

      // For each objection type, check how many linked conversations were WON
      const convOutcomeMap: Record<string, string> = {};
      for (const row of thisWeekRows ?? []) {
        const r = row as { outcome: string } & Record<string, unknown>;
        if (r["id"] && typeof r["id"] === "string") {
          convOutcomeMap[r["id"]] = r.outcome;
        }
      }

      // Fetch all user conversations (outcomes only) for the lookup
      const { data: allConvRows } = await fastify.supabase
        .from("conversations")
        .select("id, outcome")
        .eq("user_id", userId)
        .gte("created_at", fourteenDaysAgo);

      for (const row of allConvRows ?? []) {
        const r = row as { id: string; outcome: string };
        convOutcomeMap[r.id] = r.outcome;
      }

      let weakestObjection: string | null = null;
      let worstWinRate = Infinity;

      for (const [objType, convIds] of Object.entries(objTypeConvMap)) {
        if (convIds.size < 2) continue;
        const wonCount = [...convIds].filter(
          (cid) => convOutcomeMap[cid] === "WON"
        ).length;
        const winRate = wonCount / convIds.size;
        if (winRate < worstWinRate) {
          worstWinRate = winRate;
          weakestObjection = objType;
        }
      }

      // ── 5. One rebuttal tip for the weakest objection ─────────────────
      // Pull the most-used phrase for that objection type from phrase_patterns
      let practiceRebuttal: string | null = null;
      if (weakestObjection) {
        const { data: phraseRows } = await fastify.supabase
          .from("phrase_patterns")
          .select("phrase, occurrences")
          .order("occurrences", { ascending: false })
          .limit(1);
        practiceRebuttal = (phraseRows?.[0]?.phrase as string | null) ?? null;
      }

      return reply.send({
        generatedAt: now.toISOString(),
        closeRate: {
          thisWeek: thisWeek.closeRate,
          lastWeek: lastWeek.closeRate,
          delta: closeRateDelta,
          thisWeekWon: thisWeek.won,
          thisWeekTotal: thisWeek.total,
        },
        winStreak,
        trendingObjection,
        weakestObjection,
        practiceRebuttal,
      });
    }
  );

  // POST /api/conversations/analytics/precall-brief
  fastify.post<{
    Body: {
      businessName: string;
      industry: string;
      monthlyRevenue?: string;
      dealType?: string;
    };
  }>(
    "/conversations/analytics/precall-brief",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user.id;
      const {
        businessName,
        industry,
        monthlyRevenue,
        dealType = "mca",
      } = request.body ?? {};

      if (!businessName?.trim() || !industry?.trim()) {
        return reply.status(400).send({
          error: "businessName and industry are required",
        });
      }

      // Build clientContext from form input
      const clientContext: ClientContext = {
        businessName: businessName.trim(),
        industry: industry.trim(),
        ...(monthlyRevenue?.trim()
          ? { monthlyRevenueText: monthlyRevenue.trim() }
          : {}),
      };

      // Build a realistic pre-call prompt as the "user message"
      // This seeds the precall brief with enough context for the AI
      const userMessage = [
        `I'm about to call ${businessName.trim()}.`,
        `They are in the ${industry.trim()} industry.`,
        monthlyRevenue?.trim()
          ? `Their monthly revenue is approximately ${monthlyRevenue.trim()}.`
          : "",
        `I want to pitch them a ${dealType}.`,
        `What are the most likely objections I will face and how should I open this call?`,
      ]
        .filter(Boolean)
        .join(" ");

      try {
        const coachReply = await generateCoachReply({
          supabase: fastify.supabase,
          userId,
          conversationTitle: `Pre-call: ${businessName.trim()}`,
          priorMessages: [],
          userMessage,
          dealContext: null,
          clientContext,
          coachReplyMode: "precall",
          precallDepth: "deep",
          conversationId: null,
        });

        if (!coachReply.ok) {
          fastify.log.error(
            { userId, error: coachReply.error },
            "precall-brief generation failed"
          );
          return reply.status(500).send({
            error: "Failed to generate pre-call brief",
          });
        }

        return reply.send({
          ok: true,
          brief: coachReply.text,
          structuredReply: coachReply.structuredReply ?? null,
          clientContext,
          dealType,
        });
      } catch (err) {
        fastify.log.error({ err }, "precall-brief route error");
        return reply.status(500).send({
          error: "Failed to generate pre-call brief",
        });
      }
    }
  );

  // POST /api/conversations/:id/autopsy
  fastify.post<{
    Params: { id: string };
  }>(
    "/conversations/:id/autopsy",
    {
      preHandler: [fastify.authenticate],
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const { id } = request.params;
      const userId = request.user.id;

      // Verify ownership + get conversation data
      const { data: conv, error: convErr } = await fastify.supabase
        .from("conversations")
        .select("id, title, outcome, lost_reason, deal_context, client_context")
        .eq("id", id)
        .eq("user_id", userId)
        .single();

      if (convErr || !conv) {
        return reply.status(404).send({ error: "Conversation not found" });
      }

      if (conv.outcome !== "LOST") {
        return reply.status(400).send({
          error: "Autopsy only available for lost deals",
        });
      }

      const lostReason = (conv.lost_reason as string | null) ?? "unknown objection";

      // ── 1. Count how many other users lost to similar objection ──────
      // Match on rebuttal_events where objection_type fuzzy-matches lost_reason
      // Use simple keyword overlap: split lost_reason into words, match any
      const keywords = lostReason
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .split(/\s+/)
        .filter((w) => w.length > 3);

      // Get global loss count for this conversation's objection type
      // Pull rebuttal_events for this conversation to find the objection_type
      const { data: convEvents } = await fastify.supabase
        .from("rebuttal_events")
        .select("objection_type, objection_family")
        .eq("conversation_id", id)
        .not("objection_type", "is", null)
        .limit(10);

      // Most common objection_type in this conversation
      const objTypeCounts: Record<string, number> = {};
      for (const ev of convEvents ?? []) {
        const t = (ev.objection_type as string | null)?.trim();
        if (t) objTypeCounts[t] = (objTypeCounts[t] ?? 0) + 1;
      }
      const primaryObjType =
        Object.entries(objTypeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ??
        null;

      // Count global conversations marked LOST with same objection type
      let globalLossCount = 0;
      if (primaryObjType) {
        const { data: lostConvs } = await fastify.supabase
          .from("rebuttal_events")
          .select("conversation_id")
          .eq("objection_type", primaryObjType)
          .not("conversation_id", "is", null);

        const uniqueConvIds = new Set(
          (lostConvs ?? []).map((r) => r.conversation_id as string)
        );

        if (uniqueConvIds.size > 0) {
          const { data: lostMatches } = await fastify.supabase
            .from("conversations")
            .select("id")
            .eq("outcome", "LOST")
            .in("id", [...uniqueConvIds]);
          globalLossCount = (lostMatches ?? []).length;
        }
      }

      // ── 2. Pull winning rebuttals for this objection type ────────────
      // Find conversations marked WON that had this objection type,
      // pull their final_live_script examples
      const winningRebuttals: string[] = [];
      if (primaryObjType) {
        const { data: wonEvents } = await fastify.supabase
          .from("rebuttal_events")
          .select("conversation_id, final_live_script, strategy_tag")
          .eq("objection_type", primaryObjType)
          .not("final_live_script", "is", null)
          .order("created_at", { ascending: false })
          .limit(50);

        const wonEventConvIds = [
          ...new Set(
            (wonEvents ?? [])
              .map((r) => r.conversation_id as string | null)
              .filter((id): id is string => id !== null)
          ),
        ];

        if (wonEventConvIds.length > 0) {
          const { data: wonConvs } = await fastify.supabase
            .from("conversations")
            .select("id")
            .eq("outcome", "WON")
            .in("id", wonEventConvIds);

          const wonConvIdSet = new Set((wonConvs ?? []).map((c) => c.id));

          for (const ev of wonEvents ?? []) {
            if (
              wonConvIdSet.has(ev.conversation_id as string) &&
              typeof ev.final_live_script === "string" &&
              ev.final_live_script.trim().length > 20
            ) {
              winningRebuttals.push(ev.final_live_script.trim());
              if (winningRebuttals.length >= 3) break;
            }
          }
        }
      }

      // ── 3. AI coaching analysis ───────────────────────────────────────
      // Build a focused prompt about what went wrong and how to fix it
      const userMessage = [
        `A sales rep just lost a deal.`,
        `The merchant's final objection was: "${lostReason}".`,
        primaryObjType
          ? `This falls under the objection category: ${primaryObjType}.`
          : "",
        globalLossCount > 1
          ? `This exact objection has caused ${globalLossCount} other reps to lose deals.`
          : "",
        winningRebuttals.length > 0
          ? `Here are rebuttals that have worked against this objection in won deals:\n${winningRebuttals.map((r, i) => `${i + 1}. "${r}"`).join("\n")}`
          : "",
        `Analyze what likely went wrong and give the rep 2-3 specific, actionable coaching points to handle this objection better next time.`,
        `Be direct and practical. Focus on what to say differently.`,
      ]
        .filter(Boolean)
        .join(" ");

      void keywords;

      const coachReply = await generateCoachReply({
        supabase: fastify.supabase,
        userId,
        conversationTitle: conv.title as string ?? "Lost Deal",
        priorMessages: [],
        userMessage,
        dealContext: (conv.deal_context as any) ?? null,
        clientContext: (conv.client_context as any) ?? null,
        coachReplyMode: "precall",
        precallDepth: "instant",
        conversationId: null,
      });

      if (!coachReply.ok) {
        // Return partial data even if AI fails
        return reply.send({
          ok: true,
          lostReason,
          primaryObjType,
          globalLossCount,
          winningRebuttals,
          coaching: null,
        });
      }

      fastify.log.info(
        { userId, conversationId: id, primaryObjType },
        "deal_autopsy_generated"
      );

      return reply.send({
        ok: true,
        lostReason,
        primaryObjType,
        globalLossCount,
        winningRebuttals,
        coaching: coachReply.text,
      });
    }
  );
}
