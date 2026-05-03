import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { API_URL } from "@/lib/env";
import { extractPrimaryRebuttalScript } from "@/lib/extractPrimaryRebuttalScript";
import { polishLiveSpeakableScript } from "@/lib/liveVoicePolish";
import {
  persistAssistantIntelEntry,
  type AssistantMessageIntel,
} from "@/lib/patternIntel";
import { parseStructuredReplySafe } from "@/lib/parseStructuredReply";
import { trackEvent } from "@/lib/trackEvent";
import {
  parseApiErrorPayload,
  resolveGenerationFailureUX,
  type EnforcementUxModel,
} from "@/lib/generationEnforcementUx";
import type { CoachReplyMode } from "@/types/coachReplyMode";
import type { PreCallDepth } from "@/types/preCallDepth";
import type { Conversation, MessageRow, UsageSnapshot } from "./conversationHelpers";
import {
  bumpEnforcementHits,
  derivePlanType,
  resetEnforcementHits,
  waitForSessionAccessToken,
} from "./conversationSession";

export function useMessageSend(args: {
  composer: string;
  setComposer: Dispatch<SetStateAction<string>>;
  sending: boolean;
  setSending: Dispatch<SetStateAction<boolean>>;
  atUsageLimit: boolean;
  conversationId: string;
  conversation: Conversation | null;
  messages: MessageRow[];
  usage: UsageSnapshot | null;
  setUsage: Dispatch<SetStateAction<UsageSnapshot | null>>;
  coachReplyMode: CoachReplyMode;
  preCallDepth: PreCallDepth;
  selectedTone: string;
  inflightConvRef: MutableRefObject<string | null>;
  activationFirstObjectionTrackedRef: MutableRefObject<boolean>;
  activationFirstResponseTrackedRef: MutableRefObject<boolean>;
  attemptCoachWsLiveSend: (params: {
    text: string;
    sentInConv: string;
    token: string;
    messages: MessageRow[];
  }) => boolean;
  openEnforcementPrompt: (
    model: EnforcementUxModel,
    meta: { httpStatus: number; errorCode: string | null }
  ) => void;
  setError: Dispatch<SetStateAction<string | null>>;
  setMessages: Dispatch<SetStateAction<MessageRow[]>>;
  setConversation: Dispatch<SetStateAction<Conversation | null>>;
  setIntelByMessageId: Dispatch<
    SetStateAction<Record<string, AssistantMessageIntel>>
  >;
}): { handleSend: () => Promise<void> } {
  const {
    composer,
    setComposer,
    sending,
    setSending,
    atUsageLimit,
    conversationId,
    conversation,
    messages,
    usage,
    setUsage,
    coachReplyMode,
    preCallDepth,
    selectedTone,
    inflightConvRef,
    activationFirstObjectionTrackedRef,
    activationFirstResponseTrackedRef,
    attemptCoachWsLiveSend,
    openEnforcementPrompt,
    setError,
    setMessages,
    setConversation,
    setIntelByMessageId,
  } = args;

  const refetchThreadMessages = useCallback(async () => {
    const token = await waitForSessionAccessToken();
    if (!token) return;
    try {
      const msgsRes = await fetch(
        `${API_URL}/api/conversations/${conversationId}/messages`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!msgsRes.ok) return;
      const msgs = (await msgsRes.json()) as MessageRow[];
      if (Array.isArray(msgs)) setMessages(msgs);
    } catch {
      /* ignore */
    }
  }, [conversationId, setMessages]);

  const handleSend = useCallback(async () => {
    const text = composer.trim();
    if (!text || sending || atUsageLimit) return;

    const sentInConv = conversationId;
    inflightConvRef.current = sentInConv;

    if (!activationFirstObjectionTrackedRef.current) {
      activationFirstObjectionTrackedRef.current = true;
      trackEvent({
        eventName: "first_objection_submitted",
        surface: "conversation",
        conversationId: sentInConv,
        metadata: { activationCandidate: true, source: "conversation" },
      });
    }

    setComposer("");
    setSending(true);
    setError(null);

    try {
      const token = await waitForSessionAccessToken();
      if (!token) {
        if (inflightConvRef.current === sentInConv) {
          openEnforcementPrompt(
            resolveGenerationFailureUX({
              httpStatus: 401,
              errorCode: "AUTH_REQUIRED",
              errorMessage: null,
              planTier: derivePlanType(usage),
              surface: "conversation",
              enforcementHits: bumpEnforcementHits(),
            }),
            { httpStatus: 401, errorCode: "AUTH_REQUIRED" }
          );
          setComposer(text);
        }
        return;
      }

      if (
        attemptCoachWsLiveSend({
          text,
          sentInConv,
          token,
          messages,
        })
      ) {
        return;
      }

      const res = await fetch(`${API_URL}/api/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          conversation_id: sentInConv,
          content: text,
          coach_reply_mode: coachReplyMode,
          ...(coachReplyMode === "precall"
            ? { precall_depth: preCallDepth }
            : {}),
          ...(selectedTone ? { tone_override: selectedTone } : {}),
        }),
      });

      let body: unknown;
      try { body = await res.json(); } catch { body = null; }

      if (!res.ok) {
        if (inflightConvRef.current === sentInConv) {
          const { code, message } = parseApiErrorPayload(body);
          const ux = resolveGenerationFailureUX({
            httpStatus: res.status,
            errorCode: code,
            errorMessage: message,
            planTier: derivePlanType(usage),
            surface: "conversation",
            enforcementHits: bumpEnforcementHits(),
          });
          openEnforcementPrompt(ux, { httpStatus: res.status, errorCode: code });
          setComposer(text);
        }
        return;
      }

      if (inflightConvRef.current !== sentInConv) return;

      const parsed = body as {
        userMessage?: MessageRow;
        assistantMessage?: MessageRow;
        updatedTitle?: string | null;
        error?: string;
        coach_reply_mode?: CoachReplyMode;
        patternInsights?: AssistantMessageIntel["patternInsights"];
        explanation?: string;
        coachInsight?: string;
        usage?: UsageSnapshot;
        /** True when alternates/coaching will arrive via async enrichment — refetch to hydrate. */
        enrichmentPending?: boolean;
      };

      if (parsed?.usage != null) {
        setUsage(parsed.usage);
      }

      if (parsed?.error === "limit_reached") {
        const tierAtLimit = derivePlanType(parsed.usage ?? usage);
        if (inflightConvRef.current === sentInConv && tierAtLimit === "free") {
          openEnforcementPrompt(
            resolveGenerationFailureUX({
              httpStatus: 200,
              errorCode: null,
              errorMessage: null,
              planTier: tierAtLimit,
              limitReachedLegacy: true,
              surface: "conversation",
              enforcementHits: bumpEnforcementHits(),
            }),
            { httpStatus: 200, errorCode: "limit_reached" }
          );
        } else if (inflightConvRef.current === sentInConv && tierAtLimit !== "free") {
          setError("Could not complete that reply. Check your plan or try again.");
        }
        if (parsed.userMessage) {
          setMessages((prev) => {
            const existingIds = new Set(prev.map((m) => m.id));
            return existingIds.has(parsed.userMessage!.id)
              ? prev
              : [...prev, parsed.userMessage!];
          });
        }
        return;
      }

      if (parsed?.userMessage && parsed?.assistantMessage) {
        resetEnforcementHits();
        const assistantId = parsed.assistantMessage.id;
        const hasIntel =
          parsed.patternInsights != null ||
          parsed.explanation != null ||
          parsed.coachInsight != null;
        const responseIsLive =
          parsed.coach_reply_mode === "live" ||
          parseStructuredReplySafe(parsed.assistantMessage.structured_reply)
            ?.coachReplyMode === "live";
        if (hasIntel && assistantId && !responseIsLive) {
          const intel: AssistantMessageIntel = {
            ...(parsed.patternInsights != null && {
              patternInsights: parsed.patternInsights,
            }),
            ...(parsed.explanation != null && {
              explanation: parsed.explanation,
            }),
            ...(parsed.coachInsight != null && {
              coachInsight: parsed.coachInsight,
            }),
          };
          persistAssistantIntelEntry(sentInConv, assistantId, intel);
          setIntelByMessageId((prev) => ({ ...prev, [assistantId]: intel }));
        }

        setMessages((prev) => {
          const existingIds = new Set(prev.map((m) => m.id));
          const toAdd = [parsed.userMessage!, parsed.assistantMessage!].filter(
            (m) => !existingIds.has(m.id)
          );
          return toAdd.length > 0 ? [...prev, ...toAdd] : prev;
        });

        // Phase 7 — passive capture (fail-open): record the final Live script shown.
        const structured = parseStructuredReplySafe(
          parsed.assistantMessage.structured_reply
        );
        const isLive =
          parsed.coach_reply_mode === "live" || structured?.coachReplyMode === "live";
        if (isLive) {
          const rawScript =
            structured?.rebuttals?.[0]?.sayThis?.trim() ||
            structured?.callReadyLine?.trim() ||
            extractPrimaryRebuttalScript(String(parsed.assistantMessage.content ?? "")) ||
            String(parsed.assistantMessage.content ?? "").trim();
          const finalLiveScript = rawScript
            ? polishLiveSpeakableScript(rawScript, {
                situationLabel: structured?.liveResponseVisibility?.situationLabel ?? null,
              })
            : "";
          void fetch(`${API_URL}/api/rebuttal-events`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              conversation_id: sentInConv,
              source_mode: "live",
              source_surface: "dashboard_conversation",
              merchant_message: text,
              final_live_script: finalLiveScript || null,
              objection_family:
                structured?.primaryObjectionType?.trim() ||
                structured?.objectionType?.trim() ||
                null,
              objection_type: parsed.assistantMessage.objection_type ?? null,
              strategy_tag: parsed.assistantMessage.strategy_used ?? null,
              tone_mode: parsed.assistantMessage.tone_used ?? null,
              selected_variant_text: rawScript || null,
              situation_label: structured?.liveResponseVisibility?.situationLabel ?? null,
              conversation_title: conversation?.title ?? null,
              created_at: parsed.assistantMessage.created_at ?? null,
            }),
          }).catch(() => {
            /* best-effort */
          });
        }

        if (parsed.updatedTitle) {
          setConversation((prev) =>
            prev ? { ...prev, title: parsed.updatedTitle! } : prev
          );
        }

        if (parsed.enrichmentPending) {
          window.setTimeout(() => void refetchThreadMessages(), 2800);
        }

        if (!activationFirstResponseTrackedRef.current) {
          activationFirstResponseTrackedRef.current = true;
          trackEvent({
            eventName: "first_response_generated",
            surface: "conversation",
            conversationId: sentInConv,
            metadata: { activationCandidate: true, source: "conversation" },
          });
        }
      } else {
        setError("Unexpected response from server.");
        setComposer(text);
      }
    } catch (e) {
      if (inflightConvRef.current === sentInConv) {
        setError(e instanceof Error ? e.message : "Failed to send message");
        setComposer(text);
      }
    } finally {
      if (inflightConvRef.current === sentInConv) {
        inflightConvRef.current = null;
        setSending(false);
      }
    }
  }, [
    composer,
    sending,
    atUsageLimit,
    conversationId,
    conversation,
    messages,
    usage,
    coachReplyMode,
    preCallDepth,
    selectedTone,
    inflightConvRef,
    activationFirstObjectionTrackedRef,
    activationFirstResponseTrackedRef,
    attemptCoachWsLiveSend,
    openEnforcementPrompt,
    setComposer,
    setSending,
    setError,
    setMessages,
    setUsage,
    setConversation,
    setIntelByMessageId,
    refetchThreadMessages,
  ]);

  return { handleSend };
}
