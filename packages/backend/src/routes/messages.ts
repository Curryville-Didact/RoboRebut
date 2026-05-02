/**
 * messages.ts — PRODUCTION REST entry for in-app conversation threads.
 *
 * Live AI: `POST /api/messages` → `generateCoachReply` (`services/coachChatReply.ts`).
 * Pattern ranking / Phase 4.4 hooks run inside `coachChatReply` before the LLM call.
 *
 * Assistant rows persist `content` (legacy blob) and optional `structured_reply` (JSON) for UI.
 */

import type { FastifyInstance } from "fastify";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeConversation } from "../lib/normalizeConversation.js";
import { normalizeMessage } from "../lib/normalizeMessage.js";
import {
  COACH_REPLY_FALLBACK_TEXT,
  generateCoachReply,
  runCoachReplyEnrichmentJob,
} from "../services/coachChatReply.js";
import {
  eventFromPayload,
  logPatternAnalyticsEvent,
} from "../services/patternAnalytics.js";
import { recordPatternSavedFromAnalyticsEvent } from "../services/patternPerformanceStore.js";
import {
  buildBaseFingerprint,
  buildFingerprint,
  extractCallReadyText,
  persistPatternIntelEvent,
  responseSignature,
} from "../services/patternIntelligence.js";
import { coachInsightFraming } from "../services/coachInsightFraming.js";
import {
  getFreeTierUsageSnapshot,
  getNormalizedUsageForUser,
} from "../services/freeTierUsage.js";
import { getPlanEntitlements } from "../services/planEntitlements.js";
import { parseCoachReplyMode } from "../types/coachReplyMode.js";
import { resolvePrecallDepthFromBody } from "../types/preCallDepth.js";
import {
  getCachedRebuttal,
  setCachedRebuttal,
} from "../services/rebuttalCache.js";

const BYPASS_LIMITS = process.env.BYPASS_USAGE_LIMITS === "true";

/**
 * Derive a short, readable conversation title from the first user message.
 * Strategy: take the first 6 words, strip trailing punctuation, cap at 50 chars.
 * No AI call — deterministic, fast, always succeeds.
 */
function deriveTitle(message: string): string {
  const words = message.trim().split(/\s+/).slice(0, 6).join(" ");
  const capped = words.length > 50 ? words.slice(0, 50) : words;
  // Strip trailing punctuation that looks bad as a title
  return capped.replace(/[.,!?;:]+$/, "").trim() || "Conversation";
}

function isMeaningfulUserMessage(message: string): boolean {
  const trimmed = message.trim();
  if (trimmed.length < 4) return false;
  // Require at least one alphanumeric character to avoid titling on punctuation-only content.
  return /[a-zA-Z0-9]/.test(trimmed);
}

function isMetaInstruction(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return false;
  return (
    normalized.startsWith("rename") ||
    normalized.startsWith("title this") ||
    normalized.startsWith("call this") ||
    normalized.includes("name this conversation") ||
    normalized.includes("set the title")
  );
}

type MessageRow = {
  id: string;
  conversation_id: string;
  user_id: string;
  role: string;
  content: string;
  objection_type: string | null;
  strategy_used: string | null;
  tone_used: string | null;
  structured_reply?: Record<string, unknown> | null;
  created_at: string;
};

async function getOwnedConversation(
  supabase: SupabaseClient,
  conversationId: string,
  userId: string
): Promise<ReturnType<typeof normalizeConversation> | null> {
  // Use select("*"): explicit column lists fail when optional migrations are not applied.
  const { data, error } = await supabase
    .from("conversations")
    .select("*")
    .eq("id", conversationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;
  return normalizeConversation(data as Record<string, unknown>);
}

export async function messageRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /api/messages — send user message, generate AI reply, persist both
  fastify.post<{
    Body: {
      conversation_id?: string;
      content?: string;
      objection_category?: string;
      tone_override?: string;
      /** `live` (default) | `precall` — dual-mode coach output (see `coachReplyMode` types). */
      coach_reply_mode?: string;
      /** Preferred: `instant` | `deep`. */
      precall_depth?: string;
      /** @deprecated Use `precall_depth`; still accepted for backward compatibility. */
      pre_call_depth?: string;
    };
  }>("/messages", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      const conversationId = request.body?.conversation_id?.trim();
      const content = request.body?.content?.trim();

      if (!conversationId) {
        return reply.status(400).send({ error: "conversation_id is required" });
      }
      if (!content) {
        return reply.status(400).send({ error: "content is required" });
      }

      const userId = request.user.id;
      const supabase = fastify.supabase;

      const conv = await getOwnedConversation(supabase, conversationId, userId);
      if (!conv) {
        return reply.status(404).send({ error: "Conversation not found" });
      }

      const { data: priorRows, error: priorErr } = await supabase
        .from("messages")
        .select("role, content, structured_reply, strategy_used")
        .eq("conversation_id", conversationId)
        .eq("user_id", userId)
        .order("created_at", { ascending: true });

      if (priorErr) {
        return reply.status(500).send({ error: priorErr.message });
      }

      const priorMessages = (priorRows ?? []).map((r) => ({
        role: r.role === "ai" ? ("ai" as const) : ("user" as const),
        content: String(r.content ?? ""),
        structuredReply:
          r.structured_reply != null &&
          typeof r.structured_reply === "object"
            ? (r.structured_reply as Record<string, unknown>)
            : null,
        patternKey:
          typeof (r as { strategy_used?: unknown }).strategy_used === "string"
            ? ((r as { strategy_used: string }).strategy_used as string)
            : null,
      }));

      const { data: userRow, error: userInsErr } = await supabase
        .from("messages")
        .insert({
          conversation_id: conversationId,
          user_id: userId,
          role: "user",
          content,
        })
        .select()
        .single();

      if (userInsErr || !userRow) {
        return reply.status(500).send({
          error: userInsErr?.message ?? "Failed to save user message",
        });
      }

      const usageRow = await getNormalizedUsageForUser(supabase, userId);
      const planType = usageRow?.plan ?? "free";
      const entitlements = getPlanEntitlements(planType);
      const dealContextForCoach =
        entitlements.structuredDealContext ? conv.deal_context : null;
      if (!entitlements.structuredDealContext && conv.deal_context != null) {
        // TEMP: remove after Pro gate validation — logs when coach ignores persisted deal_context
        request.log.info(
          { userId, conversationId, planType },
          "deal_context stripped: not Pro"
        );
      }

      const coachReplyMode = parseCoachReplyMode(request.body?.coach_reply_mode);
      const precallDepthResolved =
        coachReplyMode === "precall"
          ? resolvePrecallDepthFromBody(
              request.body?.precall_depth,
              request.body?.pre_call_depth
            )
          : undefined;

      // Check Redis cache before hitting the LLM
      const vertical = (conv.deal_context as any)?.productType ?? "general";
      const cacheParams = {
        objection: content,
        vertical,
        replyMode: coachReplyMode,
        planType,
      };
      const cachedResult = fastify.redis
        ? await getCachedRebuttal(fastify.redis, cacheParams)
        : null;

      if (cachedResult) {
        request.log.info(
          { conversationId, userId, vertical, planType },
          "rebuttal_cache_hit"
        );
        return reply.status(201).send({
          userMessage: userRow as MessageRow,
          assistantMessage: {
            id: "cached",
            conversation_id: conversationId,
            user_id: userId,
            role: "ai",
            content: cachedResult.text,
            objection_type: request.body?.objection_category ?? null,
            strategy_used: null,
            tone_used: null,
            structured_reply: null,
            created_at: cachedResult.cachedAt,
          } as MessageRow,
          coach_reply_mode: coachReplyMode,
          updatedTitle: null,
          cached: true,
        });
      }

      const coachT0 = Date.now();
      const coachReply = await generateCoachReply({
        supabase,
        userId,
        conversationTitle: conv.title ?? "Conversation",
        priorMessages,
        userMessage: content,
        toneOverride: request.body?.tone_override ?? null,
        dealContext: dealContextForCoach,
        clientContext: conv.client_context,
        objectionType: request.body?.objection_category ?? null,
        conversationId,
        coachReplyMode,
        ...(precallDepthResolved !== undefined
          ? { precallDepth: precallDepthResolved }
          : {}),
      });
      if (coachReply.ok && coachReply.timingMs) {
        request.log.info(
          {
            conversationId,
            userId,
            coachTimingMs: coachReply.timingMs,
            wallMs: Date.now() - coachT0,
          },
          "coach_reply_timing"
        );
      }

      // DEV ONLY: Allows bypassing usage limits to test backend flows (e.g. deal calculators)
      if (
        coachReply.ok === false &&
        coachReply.error === "limit_reached" &&
        !BYPASS_LIMITS
      ) {
        // Keep conversation activity ordering correct even when AI is blocked by plan limit.
        await supabase
          .from("conversations")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", conversationId)
          .eq("user_id", userId);

        const usage = await getFreeTierUsageSnapshot(supabase, userId);
        return reply.status(200).send({
          error: "limit_reached",
          message:
            (coachReply as any)?.message ??
            "You've reached your usage limit. Upgrade to continue.",
          upgradeRequired: true,
          userMessage: userRow as MessageRow,
          updatedTitle: null,
          ...(usage != null ? { usage } : {}),
        });
      }

      // Phase 5.0 alignment: even when BYPASS_USAGE_LIMITS is enabled, a known monetization
      // block must return the friendly payload (never a generic 500).
      if (coachReply.ok === false && coachReply.error === "limit_reached") {
        await supabase
          .from("conversations")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", conversationId)
          .eq("user_id", userId);

        const usage = await getFreeTierUsageSnapshot(supabase, userId);
        return reply.status(200).send({
          error: "limit_reached",
          message:
            (coachReply as any)?.message ??
            "You've reached your usage limit. Upgrade to continue.",
          upgradeRequired: true,
          userMessage: userRow as MessageRow,
          updatedTitle: null,
          ...(usage != null ? { usage } : {}),
        });
      }

      if (!coachReply.ok) {
        return reply.status(500).send({ error: "Failed to generate assistant reply" });
      }
      const assistantText = coachReply.text;
      const structuredReply = coachReply.structuredReply;

      if (
        assistantText.trim() === COACH_REPLY_FALLBACK_TEXT ||
        coachReply.fallbackUsed
      ) {
        request.log.warn(
          {
            conversationId,
            userId,
            fallbackUsed: coachReply.fallbackUsed ?? false,
          },
          "[COACH_REPLY_PAYLOAD]"
        );
      }

      const pa = coachReply.patternAnalytics;
      const { data: aiRow, error: aiInsErr } = await supabase
        .from("messages")
        .insert({
          conversation_id: conversationId,
          user_id: userId,
          role: "ai",
          content: assistantText,
          objection_type: pa?.objectionCategory ?? null,
          strategy_used: pa?.patternKey ?? null,
          tone_used: coachReply.appliedTone ?? null,
          structured_reply: structuredReply ?? null,
        })
        .select()
        .single();

      if (aiInsErr || !aiRow) {
        return reply.status(500).send({
          error: aiInsErr?.message ?? "Failed to save assistant message",
        });
      }

      // Store successful reply in Redis cache — fire and forget
      if (fastify.redis && assistantText) {
        void setCachedRebuttal(fastify.redis, cacheParams, assistantText);
      }

      // Phase 4.4 — persist lean pattern intelligence (best-effort; never blocks messaging).
      try {
        const coachMode = coachReply.structuredReply?.coachReplyMode ?? coachReplyMode;
        const objectionFamily =
          typeof structuredReply?.primaryObjectionType === "string"
            ? structuredReply.primaryObjectionType
            : null;
        // Live mode structured replies may omit `objectionType`; fall back to the already-resolved,
        // deterministic router classification so repetition signals actually key on the objection.
        const objectionType =
          typeof structuredReply?.objectionType === "string"
            ? structuredReply.objectionType
            : pa?.objectionCategory ?? null;
        const tone = coachReply.appliedTone ?? null;
        const baseFingerprint = buildBaseFingerprint({
          objectionFamily,
          objectionType,
          tone,
          coachReplyMode: coachMode,
          dealType: pa?.dealType ?? null,
        });
        const fingerprint = buildFingerprint({
          baseFingerprint,
          strategyTag: pa?.patternKey ?? null,
          patternKey: pa?.patternKey ?? null,
        });
        const primarySig = responseSignature(
          (structuredReply as any)?.rebuttals?.[0]?.sayThis ?? assistantText
        );
        const callReadySig = responseSignature(
          extractCallReadyText({
            coachReplyMode: coachMode,
            structuredReply: structuredReply ?? null,
          })
        );
        await persistPatternIntelEvent(supabase, {
          user_id: userId,
          conversation_id: conversationId,
          turn_id: aiRow.id,
          created_at: aiRow.created_at,
          coach_reply_mode: coachMode,
          deal_type: pa?.dealType ?? null,
          objection_family: objectionFamily,
          objection_type: objectionType,
          tone,
          strategy_tag: pa?.patternKey ?? null,
          pattern_key: pa?.patternKey ?? null,
          base_fingerprint: baseFingerprint,
          fingerprint,
          primary_response_signature: primarySig,
          call_ready_signature: callReadySig,
          had_structured_reply: structuredReply != null,
          was_saved: false,
          confidence_support: coachReply.patternSelection?.confidenceSupport ?? null,
          candidate_count:
            coachReply.patternSelection?.decisionIntelligence?.candidateCount ?? null,
          unique_pattern_key_count:
            coachReply.patternSelection?.decisionIntelligence?.uniquePatternKeyCount ?? null,
          score_gap:
            coachReply.patternSelection?.decisionIntelligence?.scoreGap ?? null,
          runner_up_pattern_key:
            coachReply.patternSelection?.decisionIntelligence?.runnerUpPatternKey ?? null,
          anti_repeat_applied:
            typeof coachReply.patternSelection?.antiRepeatApplied === "boolean"
              ? coachReply.patternSelection!.antiRepeatApplied
              : null,
          anti_repeat_reason:
            coachReply.patternSelection?.antiRepeatReason ?? null,
          dvl_applied:
            typeof coachReply.patternSelection?.decisionIntelligence?.dvlApplied === "boolean"
              ? coachReply.patternSelection!.decisionIntelligence!.dvlApplied
              : null,
          variant_index:
            coachReply.patternSelection?.decisionIntelligence?.variantIndex ?? null,
          debug: {
            selectedPatternKey: coachReply.patternSelection?.selectedPatternKey ?? null,
            selectedSource: coachReply.patternSelection?.selectedSource ?? null,
          },
        });
      } catch {
        /* best-effort */
      }

      if (coachReply.ok && coachReply.deferredEnrichment) {
        void runCoachReplyEnrichmentJob(fastify.supabase, {
          ...coachReply.deferredEnrichment,
          messageId: aiRow.id,
          conversationId,
          userId,
        });
      }

      // 4.9 prep — patternKey priority: (1) reuse coachReply.patternAnalytics as produced at generation (same patternKey string); (2) else skip (no alternate metadata on the row in this phase).
      if (coachReply.patternAnalytics) {
        const savedEvent = eventFromPayload(
          "response_saved",
          coachReply.patternAnalytics,
          conversationId
        );
        logPatternAnalyticsEvent(savedEvent);
        void recordPatternSavedFromAnalyticsEvent(supabase, savedEvent);
      }

      // Auto-title once after the first meaningful user message while title is default.
      const priorMeaningfulUserCount = priorMessages.filter(
        (m) => m.role === "user" && isMeaningfulUserMessage(m.content)
      ).length;
      const needsAutoTitle =
        conv.title === "New Conversation" &&
        priorMeaningfulUserCount === 0 &&
        isMeaningfulUserMessage(content) &&
        !isMetaInstruction(content);
      const autoTitle = needsAutoTitle ? deriveTitle(content) : null;

      const conversationUpdate: Record<string, string> = {
        updated_at: new Date().toISOString(),
      };
      if (autoTitle) conversationUpdate.title = autoTitle;

      await supabase
        .from("conversations")
        .update(conversationUpdate)
        .eq("id", conversationId)
        .eq("user_id", userId);

      const coachInsight =
        coachReply.patternAnalytics?.objectionCategory != null
          ? coachInsightFraming(coachReply.patternAnalytics.objectionCategory)
          : undefined;

      const assistantCoachMode =
        coachReply.structuredReply?.coachReplyMode ?? coachReplyMode;
      const isLiveAssistant = assistantCoachMode === "live";

      return reply.status(201).send({
        userMessage: userRow as MessageRow,
        assistantMessage: aiRow as MessageRow,
        coach_reply_mode: assistantCoachMode,
        // Include updated title so the frontend can update without a refetch
        updatedTitle: autoTitle ?? null,
        ...(!isLiveAssistant &&
          coachReply.deferredEnrichment == null &&
          coachReply.patternInsights != null && {
            patternInsights: coachReply.patternInsights,
          }),
        ...(!isLiveAssistant &&
          coachReply.deferredEnrichment == null &&
          coachReply.explanation != null && {
            explanation: coachReply.explanation,
          }),
        ...(!isLiveAssistant &&
          coachReply.deferredEnrichment == null &&
          coachInsight != null && { coachInsight }),
        ...(coachReply.usage != null && { usage: coachReply.usage }),
        ...(coachReply.deferredEnrichment != null && {
          enrichmentPending: true,
        }),
      });
    },
  });

  // GET /api/conversations/:id/messages — list messages (oldest first), ownership enforced
  fastify.get<{ Params: { id: string } }>("/conversations/:id/messages", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      const { id } = request.params;
      const userId = request.user.id;

      const conv = await getOwnedConversation(fastify.supabase, id, userId);
      if (!conv) {
        return reply.status(404).send({ error: "Conversation not found" });
      }

      const { data, error } = await fastify.supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", id)
        .eq("user_id", userId)
        .order("created_at", { ascending: true });

      if (error) return reply.status(500).send({ error: error.message });
      const rows = data ?? [];
      return reply.send(
        rows.map((r) => normalizeMessage(r as Record<string, unknown>))
      );
    },
  });

  // Legacy: POST /api/conversations/:id/messages (single message, no AI)
  fastify.post<{
    Params: { id: string };
    Body: { role?: string; content?: string };
  }>("/conversations/:id/messages", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      const { id } = request.params;
      const { role, content } = request.body ?? {};

      if (!role || !content) {
        return reply.status(400).send({ error: "role and content are required" });
      }
      if (role !== "user" && role !== "ai") {
        return reply.status(400).send({ error: "role must be user or ai" });
      }

      const conv = await getOwnedConversation(
        fastify.supabase,
        id,
        request.user.id
      );
      if (!conv) {
        return reply.status(404).send({ error: "Conversation not found" });
      }

      const { data, error } = await fastify.supabase
        .from("messages")
        .insert({
          conversation_id: id,
          user_id: request.user.id,
          role,
          content,
        })
        .select()
        .single();

      if (error) return reply.status(500).send({ error: error.message });
      return reply.status(201).send(data);
    },
  });
}
