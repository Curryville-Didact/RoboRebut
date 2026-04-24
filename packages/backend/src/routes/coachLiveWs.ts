/**
 * Authenticated WebSocket for live coach streaming (token deltas during generation).
 * POST /api/messages remains the primary path; this mirrors persistence + enrichment.
 *
 * Client sends one JSON message after connect:
 * { "token": "<jwt>", "conversation_id": "<uuid>", "content": "<text>", "tone_override"?: string }
 *
 * Server emits:
 * { "type": "delta", "text": "<chunk>" } (many)
 * then { "type": "complete", ...same shape as POST /api/messages 201 body }
 * or { "type": "error", "message": string }
 */

import type { FastifyInstance } from "fastify";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeConversation } from "../lib/normalizeConversation.js";
import {
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
} from "../services/freeTierUsage.js";
import { getPlanEntitlements } from "../services/planEntitlements.js";
import {
  assertAuthenticated,
  assertUsageAllowance,
  isPlanEnforcementError,
  resolvePlanContextForUserId,
} from "../services/planEnforcement.js";
import { parseCoachReplyMode } from "../types/coachReplyMode.js";
import { resolvePrecallDepthFromBody } from "../types/preCallDepth.js";

const BYPASS_LIMITS = process.env.BYPASS_USAGE_LIMITS === "true";

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

function deriveTitle(message: string): string {
  const words = message.trim().split(/\s+/).slice(0, 6).join(" ");
  const capped = words.length > 50 ? words.slice(0, 50) : words;
  return capped.replace(/[.,!?;:]+$/, "").trim() || "Conversation";
}

function isMeaningfulUserMessage(message: string): boolean {
  const trimmed = message.trim();
  if (trimmed.length < 4) return false;
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

export async function coachLiveWsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/ws/coach", { websocket: true }, (socket) => {
    socket.once("message", async (raw: Buffer) => {
      const send = (obj: Record<string, unknown>) => {
        try {
          socket.send(JSON.stringify(obj));
        } catch {
          /* ignore */
        }
      };
      const reject = (code: string, message: string) => {
        send({ type: "error", code, message });
        socket.close();
      };

      let payload: {
        token?: string;
        conversation_id?: string;
        content?: string;
        tone_override?: string;
        objection_category?: string;
        coach_reply_mode?: string;
        precall_depth?: string;
        pre_call_depth?: string;
      };
      try {
        payload = JSON.parse(raw.toString()) as typeof payload;
      } catch {
        reject("BAD_REQUEST", "Invalid JSON");
        return;
      }

      const token = payload.token?.trim();
      const conversationId = payload.conversation_id?.trim();
      const content = payload.content?.trim();
      if (!token || !conversationId || !content) {
        reject(
          "BAD_REQUEST",
          "token, conversation_id, and content are required"
        );
        return;
      }

      const supabase = fastify.supabase;
      const { data: authData, error: authErr } =
        await supabase.auth.getUser(token);
      if (authErr || !authData.user) {
        reject("AUTH_REQUIRED", "Authentication required");
        return;
      }
      const userId = authData.user.id;

      try {
        // Enforce plan/usage using the same fail-closed helpers as hardened HTTP generation routes.
        const planContext = await resolvePlanContextForUserId(supabase, userId);
        assertAuthenticated(planContext);
        await assertUsageAllowance(supabase, planContext);

        const conv = await getOwnedConversation(supabase, conversationId, userId);
        if (!conv) {
          reject("NOT_FOUND", "Conversation not found");
          return;
        }

        const { data: priorRows, error: priorErr } = await supabase
          .from("messages")
          .select("role, content, structured_reply, strategy_used")
          .eq("conversation_id", conversationId)
          .eq("user_id", userId)
          .order("created_at", { ascending: true });

        if (priorErr) {
          reject("WS_ERROR", priorErr.message);
          return;
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
          reject(
            "WS_ERROR",
            userInsErr?.message ?? "Failed to save user message"
          );
          return;
        }

        const entitlements = getPlanEntitlements(planContext.planType);
        const dealContextForCoach =
          entitlements.structuredDealContext ? conv.deal_context : null;

        const wsCoachMode = parseCoachReplyMode(payload.coach_reply_mode);
        const precallDepthResolved =
          wsCoachMode === "precall"
            ? resolvePrecallDepthFromBody(
                payload.precall_depth,
                payload.pre_call_depth
              )
            : undefined;

        const coachReply = await generateCoachReply({
          supabase,
          userId,
          conversationTitle: conv.title ?? "Conversation",
          priorMessages,
          userMessage: content,
          toneOverride: payload.tone_override ?? null,
          dealContext: dealContextForCoach,
          clientContext: conv.client_context,
          objectionType: payload.objection_category ?? null,
          conversationId,
          coachReplyMode: wsCoachMode,
          ...(precallDepthResolved !== undefined
            ? { precallDepth: precallDepthResolved }
            : {}),
          onStreamDelta: (chunk: string) => {
            send({ type: "delta", text: chunk });
          },
        });

        if (
          coachReply.ok === false &&
          coachReply.error === "limit_reached" &&
          !BYPASS_LIMITS
        ) {
          await supabase
            .from("conversations")
            .update({ updated_at: new Date().toISOString() })
            .eq("id", conversationId)
            .eq("user_id", userId);

          const usage = await getFreeTierUsageSnapshot(supabase, userId);
          send({
            type: "complete",
            error: "limit_reached",
            userMessage: userRow as MessageRow,
            updatedTitle: null,
            ...(usage != null ? { usage } : {}),
          });
          socket.close();
          return;
        }

        // Phase 5.0 alignment: even when BYPASS_USAGE_LIMITS is enabled, a known monetization
        // block must complete with the friendly payload (never WS_ERROR).
        if (coachReply.ok === false && coachReply.error === "limit_reached") {
          await supabase
            .from("conversations")
            .update({ updated_at: new Date().toISOString() })
            .eq("id", conversationId)
            .eq("user_id", userId);

          const usage = await getFreeTierUsageSnapshot(supabase, userId);
          send({
            type: "complete",
            error: "limit_reached",
            userMessage: userRow as MessageRow,
            updatedTitle: null,
            ...(usage != null ? { usage } : {}),
          });
          socket.close();
          return;
        }

        if (!coachReply.ok) {
          reject("WS_ERROR", "Failed to generate assistant reply");
          return;
        }

        const assistantText = coachReply.text;
        const structuredReply = coachReply.structuredReply;
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
          reject(
            "WS_ERROR",
            aiInsErr?.message ?? "Failed to save assistant message"
          );
          return;
        }

        // Phase 4.4 — persist lean pattern intelligence (best-effort; never blocks WS).
        try {
          const coachMode = coachReply.structuredReply?.coachReplyMode ?? wsCoachMode;
          const objectionFamily =
            typeof structuredReply?.primaryObjectionType === "string"
              ? structuredReply.primaryObjectionType
              : null;
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

        if (coachReply.deferredEnrichment) {
          void runCoachReplyEnrichmentJob(fastify.supabase, {
            ...coachReply.deferredEnrichment,
            messageId: aiRow.id,
            conversationId,
            userId,
          });
        }

        if (coachReply.patternAnalytics) {
          const savedEvent = eventFromPayload(
            "response_saved",
            coachReply.patternAnalytics,
            conversationId
          );
          logPatternAnalyticsEvent(savedEvent);
          void recordPatternSavedFromAnalyticsEvent(supabase, savedEvent);
        }

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

        const wsAssistantMode =
          coachReply.structuredReply?.coachReplyMode ?? wsCoachMode;
        const wsIsLive = wsAssistantMode === "live";

        send({
          type: "complete",
          userMessage: userRow as MessageRow,
          assistantMessage: aiRow as MessageRow,
          coach_reply_mode: wsAssistantMode,
          updatedTitle: autoTitle ?? null,
          ...(!wsIsLive &&
            coachReply.deferredEnrichment == null &&
            coachReply.patternInsights != null && {
              patternInsights: coachReply.patternInsights,
            }),
          ...(!wsIsLive &&
            coachReply.deferredEnrichment == null &&
            coachReply.explanation != null && {
              explanation: coachReply.explanation,
            }),
          ...(!wsIsLive &&
            coachReply.deferredEnrichment == null &&
            coachInsight != null && { coachInsight }),
          ...(coachReply.usage != null && { usage: coachReply.usage }),
          ...(coachReply.deferredEnrichment != null && {
            enrichmentPending: true,
          }),
        });
        socket.close();
      } catch (e) {
        if (isPlanEnforcementError(e)) {
          reject(e.code, e.message);
          return;
        }
        reject("WS_ERROR", e instanceof Error ? e.message : "Coach request failed");
      }
    });
  });
}
