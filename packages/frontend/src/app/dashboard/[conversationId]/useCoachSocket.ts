import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { connectAndStream } from "@/lib/liveWsClient";
import { API_URL } from "@/lib/env";
import { extractPrimaryRebuttalScript } from "@/lib/extractPrimaryRebuttalScript";
import { polishLiveSpeakableScript } from "@/lib/liveVoicePolish";
import { parseStructuredReplySafe } from "@/lib/parseStructuredReply";
import {
  parseApiErrorPayload,
  resolveGenerationFailureUX,
  type EnforcementUxModel,
} from "@/lib/generationEnforcementUx";
import type { AssistantMessageIntel } from "@/lib/patternIntel";
import type { CoachReplyMode } from "@/types/coachReplyMode";
import type { MessageRow, UsageSnapshot } from "./conversationHelpers";
import {
  USE_WS_LIVE,
  bumpEnforcementHits,
  derivePlanType,
  resetEnforcementHits,
} from "./conversationSession";

export function useCoachSocket(args: {
  coachReplyMode: CoachReplyMode;
  conversationTitle: string | null;
  selectedTone: string;
  usage: UsageSnapshot | null;
  inflightConvRef: MutableRefObject<string | null>;
  setMessages: Dispatch<SetStateAction<MessageRow[]>>;
  setComposer: Dispatch<SetStateAction<string>>;
  setSending: Dispatch<SetStateAction<boolean>>;
  setUsage: Dispatch<SetStateAction<UsageSnapshot | null>>;
  setError: Dispatch<SetStateAction<string | null>>;
  openEnforcementPrompt: (
    model: EnforcementUxModel,
    meta: { httpStatus: number; errorCode: string | null }
  ) => void;
}): {
  attemptCoachWsLiveSend: (params: {
    text: string;
    sentInConv: string;
    token: string;
    messages: MessageRow[];
  }) => boolean;
} {
  const {
    coachReplyMode,
    conversationTitle,
    selectedTone,
    usage,
    inflightConvRef,
    setMessages,
    setComposer,
    setSending,
    setUsage,
    setError,
    openEnforcementPrompt,
  } = args;

  const attemptCoachWsLiveSend = useCallback(
    (params: {
      text: string;
      sentInConv: string;
      token: string;
      messages: MessageRow[];
    }) => {
      const { text, sentInConv, token, messages } = params;

      // Live mode: attempt WS streaming first (additive transport); fall back to HTTP only if WS
      // fails before any streaming begins, to avoid duplicate persisted messages.
      if (USE_WS_LIVE && coachReplyMode === "live") {
        const requestId = `ws_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        const tempUserId = `ws_user_${requestId}`;
        const tempAiId = `ws_ai_${requestId}`;
        const createdAt = new Date().toISOString();

        setMessages((prev) => [
          ...prev,
          {
            id: tempUserId,
            conversation_id: sentInConv,
            user_id: "local",
            role: "user",
            content: text,
            created_at: createdAt,
          } as MessageRow,
          {
            id: tempAiId,
            conversation_id: sentInConv,
            user_id: "local",
            role: "ai",
            content: "",
            created_at: createdAt,
          } as MessageRow,
        ]);

        let hasReceivedDelta = false;
        let hasCompleted = false;
        let delayedRefetchScheduled = false;

        const coachMessagesPostUrl = `${API_URL}/api/messages`;

        const client = connectAndStream({
          token,
          conversationId: sentInConv,
          content: text,
          options: {
            coachReplyMode: "live",
            toneOverride: selectedTone || null,
          },
        });

        const cleanup = () => {
          try {
            client.close();
          } catch {
            /* ignore */
          }
        };

        const reconcileAfterMidstreamFailure = async () => {
          if (typeof window !== "undefined") {
            console.debug(
              "[WS_RECONCILE] mid-stream failure → refetch triggered",
              { conversationId: sentInConv, requestId }
            );
          }

          try {
            const msgsRes = await fetch(
              `${API_URL}/api/conversations/${sentInConv}/messages`,
              { headers: { Authorization: `Bearer ${token}` } }
            );
            if (!msgsRes.ok) return;
            const fetched = (await msgsRes.json()) as MessageRow[];
            if (!Array.isArray(fetched)) return;

            setMessages((prev) => {
              const prevTempUser = prev.find((m) => m.id === tempUserId) ?? null;
              const fetchedIds = new Set(fetched.map((m) => m.id));
              const next = fetched.slice();

              // If the persisted user row isn't visible yet, keep the temp user message.
              if (prevTempUser && !fetchedIds.has(prevTempUser.id)) {
                next.push(prevTempUser);
              }

              // Ensure temp assistant is removed after mid-stream failure.
              return next.filter((m) => m.id !== tempAiId);
            });

            // Eventual-consistency polish: if the persisted user row still isn't visible yet,
            // schedule exactly one delayed refetch for this request.
            const hasMatchingUser = fetched.some((m) => {
              if (m.role !== "user") return false;
              if (String(m.content ?? "").trim() !== text.trim()) return false;
              const t = Date.parse(String(m.created_at ?? ""));
              const t0 = Date.parse(createdAt);
              if (!Number.isFinite(t) || !Number.isFinite(t0)) return true;
              return Math.abs(t - t0) <= 30_000;
            });
            const tempUserStillPresent = messages.some((m) => m.id === tempUserId);
            if (!hasMatchingUser && tempUserStillPresent && !delayedRefetchScheduled) {
              delayedRefetchScheduled = true;
              setTimeout(() => {
                if (!hasCompleted && hasReceivedDelta) {
                  void reconcileAfterMidstreamFailure();
                }
              }, 750);
            }
          } catch {
            /* ignore */
          }
        };

        const fallbackToHttp = async () => {
          // Remove temp AI placeholder; user message will be reconciled by HTTP response.
          setMessages((prev) => prev.filter((m) => m.id !== tempAiId));
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
              ...(selectedTone ? { tone_override: selectedTone } : {}),
            }),
          });

          let body: unknown;
          try {
            body = await res.json();
          } catch {
            body = null;
          }

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
              openEnforcementPrompt(ux, {
                httpStatus: res.status,
                errorCode: code,
              });
              setComposer(text);
            }
            setSending(false);
            return;
          }

          if (inflightConvRef.current !== sentInConv) {
            setSending(false);
            return;
          }

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
            enrichmentPending?: boolean;
          };

          if (parsed?.usage != null) {
            setUsage(parsed.usage);
          }

          // Reconcile temp user message with persisted id (and attach assistant).
          if (parsed?.userMessage && parsed?.assistantMessage) {
            resetEnforcementHits();
            setMessages((prev) => {
              const out = prev.filter((m) => m.id !== tempUserId);
              const existingIds = new Set(out.map((m) => m.id));
              const toAdd = [parsed.userMessage!, parsed.assistantMessage!].filter(
                (m) => !existingIds.has(m.id)
              );
              return toAdd.length > 0 ? [...out, ...toAdd] : out;
            });
          }

          setSending(false);
        };

        client.onDelta((d) => {
          hasReceivedDelta = true;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === tempAiId
                ? ({ ...m, content: `${m.content ?? ""}${d.text}` } as MessageRow)
                : m
            )
          );
        });

        client.onComplete((c) => {
          hasCompleted = true;
          cleanup();
          const parsed = c as unknown as {
            userMessage?: MessageRow;
            assistantMessage?: MessageRow;
            updatedTitle?: string | null;
            error?: string;
            coach_reply_mode?: CoachReplyMode;
            usage?: UsageSnapshot;
            enrichmentPending?: boolean;
            patternInsights?: AssistantMessageIntel["patternInsights"];
            explanation?: string;
            coachInsight?: string;
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
              setComposer(text);
            } else if (inflightConvRef.current === sentInConv && tierAtLimit !== "free") {
              setError("Could not complete that reply. Check your plan or try again.");
            }
            // Remove temp placeholders; backend persisted user message already exists.
            setMessages((prev) => prev.filter((m) => m.id !== tempUserId && m.id !== tempAiId));
            setSending(false);
            return;
          }

          if (parsed?.userMessage && parsed?.assistantMessage) {
            resetEnforcementHits();
            setMessages((prev) => {
              const out = prev.filter((m) => m.id !== tempUserId && m.id !== tempAiId);
              const existingIds = new Set(out.map((m) => m.id));
              const toAdd = [parsed.userMessage!, parsed.assistantMessage!].filter(
                (m) => !existingIds.has(m.id)
              );
              return toAdd.length > 0 ? [...out, ...toAdd] : out;
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
              void fetch(
                coachMessagesPostUrl.replace(/\/api\/messages$/, "/api/rebuttal-events"),
                {
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
                    conversation_title: conversationTitle ?? null,
                    created_at: parsed.assistantMessage.created_at ?? null,
                  }),
                }
              ).catch((e) => {
                console.error("[rebuttal-events] WS POST failed", e);
              });
            }
          } else {
            // If complete payload is unexpected, fall back to leaving streamed text and stop sending.
          }

          setSending(false);
        });

        client.onError((e) => {
          if (hasCompleted) return;

          // Only fall back to HTTP if streaming never started (prevents duplicate persisted messages).
          if (!hasReceivedDelta) {
            cleanup();
            void fallbackToHttp();
            return;
          }

          cleanup();
          // Mid-stream failure: do not fall back (would duplicate). Reconcile messages so persisted
          // user row becomes visible without refresh, and surface enforcement/error.
          void reconcileAfterMidstreamFailure();
          const code = typeof e.code === "string" ? e.code : "WS_ERROR";
          const map = (
            wsCode: string
          ): { httpStatus: number; errorCode: string; errorMessage: string | null } => {
            if (wsCode === "AUTH_REQUIRED") return { httpStatus: 401, errorCode: "AUTH_REQUIRED", errorMessage: e.message ?? null };
            if (wsCode === "USAGE_LIMIT_REACHED") return { httpStatus: 403, errorCode: "USAGE_LIMIT_REACHED", errorMessage: e.message ?? null };
            if (wsCode === "USAGE_UNAVAILABLE") return { httpStatus: 503, errorCode: "USAGE_UNAVAILABLE", errorMessage: e.message ?? null };
            if (wsCode === "RATE_LIMITED") return { httpStatus: 429, errorCode: "RATE_LIMITED", errorMessage: e.message ?? null };
            return { httpStatus: 503, errorCode: "WS_ERROR", errorMessage: e.message ?? "WebSocket error" };
          };

          if (inflightConvRef.current === sentInConv) {
            const mapped = map(code);
            const ux = resolveGenerationFailureUX({
              httpStatus: mapped.httpStatus,
              errorCode: mapped.errorCode,
              errorMessage: mapped.errorMessage,
              planTier: derivePlanType(usage),
              surface: "conversation",
              enforcementHits: bumpEnforcementHits(),
            });
            openEnforcementPrompt(ux, {
              httpStatus: mapped.httpStatus,
              errorCode: mapped.errorCode,
            });
            setComposer(text);
          }

          // Keep temp user message until reconcile fetch makes persisted state visible.
          setMessages((prev) => prev.filter((m) => m.id !== tempAiId));
          setSending(false);
        });

        client.onClose(() => {
          if (hasCompleted) return;
          if (!hasReceivedDelta) {
            cleanup();
            void fallbackToHttp();
            return;
          }
          // Mid-stream close without complete: reconcile so persisted message doesn't disappear.
          cleanup();
          void reconcileAfterMidstreamFailure();
          if (inflightConvRef.current === sentInConv) {
            setError("Connection lost. Try again.");
            setComposer(text);
          }
          // Keep temp user message until reconcile fetch makes persisted state visible.
          setMessages((prev) => prev.filter((m) => m.id !== tempAiId));
          setSending(false);
        });

        return true;
      }

      return false;
    },
    [
      coachReplyMode,
      conversationTitle,
      selectedTone,
      usage,
      inflightConvRef,
      setMessages,
      setComposer,
      setSending,
      setUsage,
      setError,
      openEnforcementPrompt,
    ]
  );

  return { attemptCoachWsLiveSend };
}
