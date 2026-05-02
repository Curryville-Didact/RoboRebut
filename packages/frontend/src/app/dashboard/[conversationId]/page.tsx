"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { API_URL } from "@/lib/env";
import { useSpeechRecognition } from "@/lib/useSpeechRecognition";
import { ClientContextPanel } from "@/components/ClientContextPanel";
import { DealContextPanel } from "@/components/DealContextPanel";
import { AssistantCoachMessageBody } from "@/components/AssistantCoachMessageBody";
import { AssistantStructuredMessageBoundary } from "@/components/AssistantStructuredMessageBoundary";
import { StructuredAssistantCoachMessage } from "@/components/StructuredAssistantCoachMessage";
import { parseStructuredReplySafe } from "@/lib/parseStructuredReply";
import { polishLiveSpeakableScript } from "@/lib/liveVoicePolish";
import { PatternIntelligenceBlock } from "@/components/PatternIntelligenceBlock";
import {
  DecisionInspectorPanel,
  isInspectorEnabled,
  type DecisionIntelligenceMeta,
} from "@/components/dev/DecisionInspectorPanel";
import { ToneSwitcher } from "@/components/ToneSwitcher";
import {
  loadAssistantIntelMap,
  persistAssistantIntelEntry,
  pruneAssistantIntelToMessageIds,
  type AssistantMessageIntel,
} from "@/lib/patternIntel";
import { extractPrimaryRebuttalScript } from "@/lib/extractPrimaryRebuttalScript";
import { MONETIZATION_LINKS } from "@/lib/monetizationLinks";
import { getVisibleToneOptions } from "@/lib/toneOptions";
import { UpgradeNudge } from "@/components/UpgradeNudge";
import { trackEvent } from "@/lib/trackEvent";
import { getProCheckoutHref } from "@/lib/checkoutLinks";
import { getStarterCheckoutHref } from "@/lib/checkoutLinks";
import {
  resolveConversationCtaLinks,
  resolveMonetizationUiState,
} from "@/lib/monetizationUi";
import { navigateProBillingSameTab } from "@/lib/resolveProBillingDestination";
import { formatObjectionTypeLabel } from "@/lib/objectionDisplay";
import { formatToneLabel } from "@/lib/toneDisplay";
import { formatStrategyLabel } from "@/lib/strategyDisplay";
import { resolveSavedResponseObjectionSemantics } from "@/lib/objectionFamilyResolve";
import { connectAndStream } from "@/lib/liveWsClient";
import type { AssistantStructuredReply } from "@/types/assistantStructuredReply";
import {
  type CoachReplyMode,
  effectiveMessageCoachMode,
} from "@/types/coachReplyMode";
import type { PreCallDepth } from "@/types/preCallDepth";
import { CoachModeToggle } from "@/components/CoachModeToggle";
import { PreCallDepthToggle } from "@/components/PreCallDepthToggle";
import { isFounderEmail } from "@/lib/founder";
import { DEMO_THREADS } from "@/lib/demoFixtures";
import {
  parseApiErrorPayload,
  resolveGenerationFailureUX,
  type EnforcementUxModel,
} from "@/lib/generationEnforcementUx";
import { EnforcementPromptModal } from "@/components/enforcement/EnforcementPromptModal";
import {
  type Conversation,
  type MessageRow,
  type UsageSnapshot,
  resolveAssistantHeaderMetadata,
} from "./conversationHelpers";
import {
  USE_WS_LIVE,
  bumpEnforcementHits,
  derivePlanType,
  hasSeenVariantNudgeThisSession,
  markVariantNudgeSeenThisSession,
  readDismissed,
  resetEnforcementHits,
  structuredDealContextEnabledFromUsage,
  syncEntitlement,
  waitForSessionAccessToken,
  writeDismissed,
} from "./conversationSession";

export default function ConversationDetailPage() {
  const params = useParams();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const conversationId = params.conversationId as string;
  const [demoMode, setDemoMode] = useState(false);
  const [isFounder, setIsFounder] = useState(false);

  const inflightConvRef = useRef<string | null>(null);
  const threadEndRef = useRef<HTMLDivElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const isFirstScrollRef = useRef(true);
  const shownNudgesRef = useRef<Set<string>>(new Set());
  const activationFirstObjectionTrackedRef = useRef(false);
  const activationFirstResponseTrackedRef = useRef(false);

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  /** True only until conversation metadata is available; never waits on usage. */
  const [pageLoading, setPageLoading] = useState(true);
  /** True until messages list fetch finishes (conversation shell can render earlier). */
  const [messagesLoading, setMessagesLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [composer, setComposer] = useState("");
  const [selectedTone, setSelectedTone] = useState("");
  const [coachReplyMode, setCoachReplyMode] = useState<CoachReplyMode>("live");
  /** Pre-call only; default Instant for speed (per conversation in sessionStorage). */
  const [preCallDepth, setPreCallDepth] = useState<PreCallDepth>("instant");
  const [error, setError] = useState<string | null>(null);
  /** Phase 5.3 — backend-backed free tier usage; null until loaded. */
  const [usage, setUsage] = useState<UsageSnapshot | null>(null);
  const [saveStatus, setSaveStatus] = useState<Record<string, "saving" | "saved" | "error">>({});
  const [callCopiedId, setCallCopiedId] = useState<string | null>(null);
  /** Conversion layer: “Use This On Call” clicks (session-local). */
  const [copyEventsCount, setCopyEventsCount] = useState(0);
  /** Phase 5.2 — pattern intel keyed by assistant message id (sessionStorage-backed). */
  const [intelByMessageId, setIntelByMessageId] = useState<
    Record<string, AssistantMessageIntel>
  >({});

  // Rename state
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);

  // Delete state
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showToneUpgradeNudge, setShowToneUpgradeNudge] = useState(false);
  const [showVariantUpgradeNudge, setShowVariantUpgradeNudge] = useState(false);
  const [showPostGenUpgradeNudge, setShowPostGenUpgradeNudge] = useState(false);
  const [enforcementOpen, setEnforcementOpen] = useState(false);
  const [enforcementUx, setEnforcementUx] = useState<EnforcementUxModel | null>(null);
  const [enforcementMeta, setEnforcementMeta] = useState<{
    httpStatus: number;
    errorCode: string | null;
  }>({ httpStatus: 0, errorCode: null });
  const returnTo = `${pathname}${searchParams?.toString() ? `?${searchParams.toString()}` : ""}`;

  // --- Composer / mic disabled flags ---
  // Keep custom hook (`useSpeechRecognition`) argument stable and decoupled from
  // monetization-derived helpers to avoid any hook-order surprises during error recovery renders.
  const micDisabled = sending || usage?.blocked === true;

  const monetizationUi = resolveMonetizationUiState(usage);
  const ctaLinks = resolveConversationCtaLinks({ returnTo });
  const atUsageLimit = monetizationUi?.kind === "limit_reached";
  const composerDisabled = sending || atUsageLimit;
  const toneOptions = getVisibleToneOptions(
    usage?.entitlements?.advancedToneModes === true
  );
  const isPro = usage?.entitlements?.advancedToneModes === true;
  const structuredDealContextEnabled =
    structuredDealContextEnabledFromUsage(usage ?? null);
  const planType = derivePlanType(usage);
  const isNearingLimit = monetizationUi?.kind === "nearing_limit";

  const openEnforcementPrompt = useCallback(
    (
      model: EnforcementUxModel,
      meta: { httpStatus: number; errorCode: string | null }
    ) => {
      setError(null);
      setEnforcementUx(model);
      setEnforcementMeta(meta);
      setEnforcementOpen(true);
      trackEvent({
        eventName: "enforcement_prompt_shown",
        triggerType: model.analyticsReason,
        planType,
        conversationId,
        surface: "conversation",
        metadata: {
          reason: model.analyticsReason,
          http_status: meta.httpStatus,
          error_code: meta.errorCode,
          pressure_level: model.pressureLevel,
          pressure_tier: model.pressureTier,
          enforcement_hits: model.enforcementHits,
        },
      });
    },
    [planType, conversationId]
  );

  const closeEnforcementPrompt = useCallback(() => {
    setEnforcementOpen(false);
    setEnforcementUx(null);
  }, []);

  const [prelimitBannerVisible, setPrelimitBannerVisible] = useState(false);
  const prelimitWarningFiredRef = useRef(false);

  useEffect(() => {
    if (!isNearingLimit) {
      setPrelimitBannerVisible(false);
      return;
    }
    const id = requestAnimationFrame(() => setPrelimitBannerVisible(true));
    return () => cancelAnimationFrame(id);
  }, [isNearingLimit]);

  useEffect(() => {
    if (!isNearingLimit || usage == null || monetizationUi == null) {
      prelimitWarningFiredRef.current = false;
      return;
    }
    if (prelimitWarningFiredRef.current) return;
    prelimitWarningFiredRef.current = true;
    trackEvent({
      eventName: "prelimit_warning_shown",
      planType,
      conversationId,
      surface: "conversation",
      metadata: {
        planTier: planType,
        usageUsed: monetizationUi.used,
        usageLimit: monetizationUi.limit,
        threshold: "remaining<=3",
      },
    });
  }, [isNearingLimit, usage, planType, conversationId, monetizationUi]);

  // --- Speech-to-text ---
  const handleTranscript = useCallback((text: string) => {
    setComposer((prev) => {
      const trimmed = prev.trimEnd();
      return trimmed ? `${trimmed} ${text}` : text;
    });
  }, []);

  const { state: micState, start: micStart, errorMessage: micError } =
    useSpeechRecognition(handleTranscript, micDisabled);

  // --- Load ---
  useEffect(() => {
    let cancelled = false;
    setConversation(null);
    setMessages([]);
    setError(null);
    setUsage(null);
    setPageLoading(true);
    setMessagesLoading(true);
    setSaveStatus({});
    setIntelByMessageId(loadAssistantIntelMap(conversationId));
    setRenaming(false);
    setConfirmDelete(false);
    inflightConvRef.current = null;
    isFirstScrollRef.current = true;

    // Demo mode: founder-only, local fixtures (no API calls, no DB writes).
    try {
      const demo = searchParams?.get("demo") === "1";
      setDemoMode(demo);
    } catch {
      setDemoMode(false);
    }

    void createClient()
      .auth.getUser()
      .then((res) => setIsFounder(isFounderEmail(res.data.user?.email ?? "")))
      .catch(() => setIsFounder(false));

    if (searchParams?.get("demo") === "1" && conversationId in DEMO_THREADS) {
      // Let founder gating happen async; show immediately for demo convenience.
      const thread = DEMO_THREADS[conversationId] ?? [];
      setConversation({
        id: conversationId,
        title: conversationId.replace(/demo_/g, "").replace(/_/g, " "),
        deal_context: null,
        client_context: null,
        created_at: thread[0]?.created_at ?? new Date().toISOString(),
        updated_at: thread[thread.length - 1]?.created_at ?? new Date().toISOString(),
      } as any);
      setMessages(
        thread.map((m, idx) => ({
          id: `${conversationId}_${idx}`,
          conversation_id: conversationId,
          user_id: "demo",
          role: m.role,
          content: m.content,
          created_at: m.created_at,
        }))
      );
      setPageLoading(false);
      setMessagesLoading(false);
      return () => {
        cancelled = true;
      };
    }

    if (typeof window !== "undefined") {
      const stored = window.sessionStorage.getItem(
        `roborebut:coachReplyMode:${conversationId}`
      );
      setCoachReplyMode(
        stored === "precall" || stored === "live" ? stored : "live"
      );
      const storedDepth = window.sessionStorage.getItem(
        `roborebut:preCallDepth:${conversationId}`
      );
      setPreCallDepth(storedDepth === "deep" ? "deep" : "instant");
    } else {
      setCoachReplyMode("live");
      setPreCallDepth("instant");
    }

    async function load() {
      const token = await waitForSessionAccessToken();
      if (cancelled) return;

      if (!token) {
        setError("Could not load your session. Try refreshing.");
        setPageLoading(false);
        setMessagesLoading(false);
        return;
      }

      const syncedUsage = await syncEntitlement(token);
      if (cancelled) return;
      if (syncedUsage != null) {
        setUsage(syncedUsage);
      }

      let metaRes: Response;
      let usageRes: Response | null = null;
      try {
        [metaRes, usageRes] = await Promise.all([
          fetch(`${API_URL}/api/conversations/${conversationId}`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch(`${API_URL}/api/usage`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
        ]);
      } catch {
        if (!cancelled) {
          setError("Could not reach the server. Is the backend running?");
          setPageLoading(false);
          setMessagesLoading(false);
        }
        return;
      }

      if (cancelled) return;

      if (!metaRes.ok) {
        setError(metaRes.status === 404 ? "Conversation not found." : "Failed to load conversation.");
        setPageLoading(false);
        setMessagesLoading(false);
        return;
      }

      const conv = (await metaRes.json()) as Conversation;
      if (cancelled) return;
      setConversation(conv);
      setPageLoading(false);

      if (usageRes?.ok) {
        try {
          const u = (await usageRes.json()) as UsageSnapshot;
          if (!cancelled && u && typeof u.used === "number") {
            setUsage(u);
          } else if (!cancelled) {
            setUsage(null);
          }
        } catch {
          if (!cancelled) setUsage(null);
        }
      } else if (!cancelled) {
        setUsage(null);
      }

      let msgsRes: Response;
      try {
        msgsRes = await fetch(
          `${API_URL}/api/conversations/${conversationId}/messages`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
      } catch {
        if (!cancelled) {
          setError("Loaded conversation but could not fetch messages.");
          setMessagesLoading(false);
        }
        return;
      }

      if (cancelled) return;

      if (!msgsRes.ok) {
        setError("Failed to load messages.");
        setMessagesLoading(false);
        return;
      }

      const msgs = (await msgsRes.json()) as MessageRow[];
      if (cancelled) return;
      setMessages(Array.isArray(msgs) ? msgs : []);
      setMessagesLoading(false);
    }

    void load();
    return () => { cancelled = true; };
  }, [conversationId]);

  /** Reload thread after background structured_reply enrichment (non-blocking). */
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
  }, [conversationId]);

  // Drop orphaned intel keys when the thread changes; keep storage in sync.
  useEffect(() => {
    if (!conversation) return;
    const ids = new Set(messages.map((m) => m.id));
    setIntelByMessageId(pruneAssistantIntelToMessageIds(conversationId, ids));
  }, [conversationId, messages, conversation]);

  // --- Scroll ---
  useEffect(() => {
    if (messagesLoading || messages.length === 0) return;
    const behavior: ScrollBehavior = isFirstScrollRef.current ? "instant" : "smooth";
    isFirstScrollRef.current = false;
    threadEndRef.current?.scrollIntoView({ behavior });
  }, [messagesLoading, messages.length]);

  // Focus rename input when rename mode opens
  useEffect(() => {
    if (renaming) {
      renameInputRef.current?.select();
    }
  }, [renaming]);

  useEffect(() => {
    if (!selectedTone) return;
    const allowed = new Set(toneOptions.map((tone) => tone.value));
    if (!allowed.has(selectedTone)) {
      setSelectedTone("");
    }
  }, [selectedTone, toneOptions]);

  useEffect(() => {
    if (isPro) {
      setShowToneUpgradeNudge(false);
      setShowVariantUpgradeNudge(false);
      setShowPostGenUpgradeNudge(false);
      return;
    }
    setShowToneUpgradeNudge(false);
    setShowVariantUpgradeNudge(false);
    setShowPostGenUpgradeNudge(!readDismissed("post_gen"));
  }, [isPro, conversationId]);

  useEffect(() => {
    if (isPro) return;
    const responseCount = messages.filter((m) => m.role === "ai").length;
    const hasLimitedVariants =
      (usage?.entitlements?.responseVariants ?? 1) < 4;
    if (
      hasLimitedVariants &&
      responseCount >= 2 &&
      !readDismissed("variants") &&
      !hasSeenVariantNudgeThisSession(conversationId)
    ) {
      setShowVariantUpgradeNudge(true);
      markVariantNudgeSeenThisSession(conversationId);
    }
  }, [isPro, messages, usage, conversationId]);

  useEffect(() => {
    if (isPro) return;
    const hasAssistantResponse = messages.some((m) => m.role === "ai");
    if (
      hasAssistantResponse &&
      usage?.entitlements?.advancedStrategies === false &&
      !readDismissed("post_gen")
    ) {
      setShowPostGenUpgradeNudge(true);
    }
  }, [isPro, messages, usage]);

  useEffect(() => {
    const nudgeStates = [
      {
        key: "tone",
        visible: showToneUpgradeNudge && !isPro,
        surface: "ToneSwitcher",
      },
      {
        key: "variants",
        visible: showVariantUpgradeNudge && !isPro,
        surface: "ConversationThread",
      },
      {
        key: "near_limit",
        visible: isNearingLimit && !isPro,
        surface: "ConversationComposer",
      },
      {
        key: "post_generation",
        visible: showPostGenUpgradeNudge && !isPro,
        surface: "ConversationThread",
      },
    ] as const;

    for (const nudge of nudgeStates) {
      if (!nudge.visible || shownNudgesRef.current.has(nudge.key)) continue;
      shownNudgesRef.current.add(nudge.key);
      trackEvent({
        eventName: "upgrade_nudge_shown",
        triggerType: nudge.key,
        planType,
        conversationId,
        priorityGeneration: usage?.entitlements?.priorityGeneration,
        responseVariants: usage?.entitlements?.responseVariants ?? null,
        surface: nudge.surface,
      });
    }
  }, [
    conversationId,
    isPro,
    planType,
    showPostGenUpgradeNudge,
    showToneUpgradeNudge,
    showVariantUpgradeNudge,
    usage,
    isNearingLimit,
  ]);

  // --- Send ---
  async function handleSend() {
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
  }

  function handleLockedToneClick(tone: string) {
    if (isPro || readDismissed("tone")) return;
    trackEvent({
      eventName: "tone_locked_click",
      triggerType: "tone",
      tone,
      planType,
      conversationId,
      priorityGeneration: usage?.entitlements?.priorityGeneration,
      responseVariants: usage?.entitlements?.responseVariants ?? null,
      surface: "ToneSwitcher",
    });
    setShowToneUpgradeNudge(true);
  }

  function dismissToneNudge() {
    trackEvent({
      eventName: "upgrade_nudge_dismissed",
      triggerType: "tone",
      planType,
      conversationId,
      surface: "ToneSwitcher",
    });
    writeDismissed("tone");
    setShowToneUpgradeNudge(false);
  }

  function dismissVariantNudge() {
    trackEvent({
      eventName: "upgrade_nudge_dismissed",
      triggerType: "variants",
      planType,
      conversationId,
      surface: "ConversationThread",
    });
    writeDismissed("variants");
    setShowVariantUpgradeNudge(false);
  }

  function dismissPostGenNudge() {
    trackEvent({
      eventName: "upgrade_nudge_dismissed",
      triggerType: "post_generation",
      planType,
      conversationId,
      surface: "ConversationThread",
    });
    writeDismissed("post_gen");
    setShowPostGenUpgradeNudge(false);
  }

  // --- Rename ---
  function startRename() {
    setRenameValue(conversation?.title ?? "");
    setRenameError(null);
    setRenaming(true);
  }

  function cancelRename() {
    setRenaming(false);
    setRenameError(null);
  }

  async function commitRename() {
    const trimmed = renameValue.trim();
    if (!trimmed) {
      setRenameError("Title cannot be empty.");
      return;
    }
    if (trimmed === "New Conversation") {
      setRenameError("Please choose a more specific title.");
      return;
    }
    if (trimmed === conversation?.title) {
      setRenaming(false);
      return;
    }

    const token = await waitForSessionAccessToken();
    if (!token) {
      setRenameError("Session expired. Please refresh.");
      return;
    }

    try {
      const res = await fetch(`${API_URL}/api/conversations/${conversationId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ title: trimmed }),
      });

      if (!res.ok) {
        setRenameError("Failed to rename. Try again.");
        return;
      }

      const updated = (await res.json()) as Conversation;
      setConversation(updated);
      setRenaming(false);
      setRenameError(null);
    } catch {
      setRenameError("Failed to rename. Try again.");
    }
  }

  // --- Delete ---
  async function handleDelete() {
    if (!confirmDelete || deleting) return;
    setDeleting(true);

    const token = await waitForSessionAccessToken();
    if (!token) {
      setDeleting(false);
      setConfirmDelete(false);
      return;
    }

    try {
      const res = await fetch(`${API_URL}/api/conversations/${conversationId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok || res.status === 204) {
        router.push("/dashboard");
        return;
      }

      setDeleting(false);
      setConfirmDelete(false);
    } catch {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  // --- Save response ---
  function findPriorUserObjection(aiIndex: number): string | undefined {
    for (let i = aiIndex - 1; i >= 0; i--) {
      if (messages[i]?.role === "user") return messages[i]!.content;
    }
    return undefined;
  }

  async function handleSaveResponse(msg: MessageRow, aiIndex: number) {
    setSaveStatus((prev) => ({ ...prev, [msg.id]: "saving" }));

    const token = await waitForSessionAccessToken();
    if (!token) {
      setSaveStatus((prev) => ({ ...prev, [msg.id]: "error" }));
      return;
    }

    const intel = intelByMessageId[msg.id];
    const objectionPreview = findPriorUserObjection(aiIndex);
    const toneApplied = msg.tone_used ?? selectedTone ?? null;
    const parsedStructured = parseStructuredReplySafe(msg.structured_reply);
    const { categoryFamily, objectionTypeSpecific } = resolveSavedResponseObjectionSemantics(
      parsedStructured,
      msg
    );

    const strategyRaw =
      msg.strategy_used?.trim() ||
      parsedStructured?.reframeStrategy?.trim() ||
      null;
    const strategyLabel = formatStrategyLabel(strategyRaw);
    const toneLabel = toneApplied ? formatToneLabel(toneApplied) : null;

    try {
      const res = await fetch(`${API_URL}/api/saved-responses`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          label: conversation?.title ?? "Saved response",
          content: msg.content,
          // Saved Responses list shows this as "Objection".
          category: categoryFamily ?? null,
          metadata: {
            tone: toneApplied ?? null,
            toneLabel: toneLabel ?? null,
            objectionPreview: objectionPreview?.slice(0, 600) ?? null,
            merchantObjection: objectionPreview?.slice(0, 2000) ?? null,
            objectionType: objectionTypeSpecific ?? null,
            category: categoryFamily ?? null,
            patternKey: intel?.patternInsights?.selectedPatternKey ?? null,
            strategyRaw: strategyRaw ?? null,
            strategyLabel: strategyLabel ?? null,
            // Back-compat: older cards read `strategyUsed` directly.
            strategyUsed: (strategyLabel ?? strategyRaw) ?? null,
            whatTheyReallyMean:
              parsedStructured?.precallWhatTheyReallyMean?.trim() ||
              parsedStructured?.merchantMeaning?.trim() ||
              null,
            lane1: parsedStructured?.precallLane1?.trim() || null,
            lane2: parsedStructured?.precallLane2?.trim() || null,
            callReadyLine: parsedStructured?.callReadyLine?.trim() || null,
            coachNote: parsedStructured?.coachNote?.trim() || null,
            followUp: parsedStructured?.followUp?.trim() || null,
            savedAt: new Date().toISOString(),
            ...(msg.structured_reply != null
              ? { structured_reply: msg.structured_reply }
              : {}),
          },
        }),
      });

      setSaveStatus((prev) => ({ ...prev, [msg.id]: res.ok ? "saved" : "error" }));
      if (res.ok) {
        trackEvent({
          eventName: "saved_response_created",
          surface: "conversation",
          planType,
          conversationId,
          metadata: { route: `/dashboard/${conversationId}` },
        });
        setTimeout(() => {
          setSaveStatus((prev) => {
            const next = { ...prev };
            delete next[msg.id];
            return next;
          });
        }, 2000);
      }
    } catch {
      setSaveStatus((prev) => ({ ...prev, [msg.id]: "error" }));
    }
  }

  function formatTime(iso: string): string {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }

  async function handleUseOnCall(msg: MessageRow) {
    const parsed = parseStructuredReplySafe(msg.structured_reply);
    let script = "";
    if (parsed?.coachReplyMode === "live") {
      const lines = parsed.liveOpeningLines?.filter(Boolean) ?? [];
      script =
        lines.length > 0
          ? lines.join("\n")
          : (parsed.rebuttals?.[0]?.sayThis?.trim() ?? msg.content.trim());
    } else {
      script = extractPrimaryRebuttalScript(msg.content);
    }
    if (!script) return;
    try {
      await navigator.clipboard.writeText(script);
      setCopyEventsCount((c) => c + 1);
      setCallCopiedId(msg.id);
      window.setTimeout(() => {
        setCallCopiedId((id) => (id === msg.id ? null : id));
      }, 2000);
    } catch {
      /* clipboard denied */
    }
  }

  const userMessageCount = messages.filter((m) => m.role === "user").length;
  const lastAssistantMessageIndex = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]!.role === "ai") return i;
    }
    return -1;
  })();
  const intentNudgeVisible =
    !atUsageLimit &&
    (copyEventsCount >= 1 || userMessageCount >= 3);

  // --- Render: loading ---
  if (pageLoading) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mb-4">
          <Link href="/dashboard" className="text-sm text-gray-400 underline hover:text-white">
            ← Back to conversations
          </Link>
        </div>
        <p className="text-gray-400">Loading…</p>
      </div>
    );
  }

  // --- Render: not found ---
  if (!conversation) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mb-4">
          <Link href="/dashboard" className="text-sm text-gray-400 underline hover:text-white">
            ← Back to conversations
          </Link>
        </div>
        <p className="text-sm text-red-400">{error ?? "Conversation not found."}</p>
      </div>
    );
  }

  // --- Render: conversation ---
  return (
    <div className="flex h-[100dvh] min-h-0 flex-1 flex-col overflow-hidden">
      {/* TOP STICKY RAIL (conversation context + actions) */}
      <div className="sticky top-0 z-30 shrink-0 border-b border-white/10 bg-black/80 backdrop-blur supports-[backdrop-filter]:bg-black/60">
        <div className="p-4">
          {/* Header row */}
          <div className="mb-4 flex items-start justify-between gap-4">
            <Link
              href="/dashboard"
              className="mt-1 text-sm text-gray-400 underline hover:text-white"
            >
              ← Back
            </Link>


            {/* Actions */}
            {!confirmDelete && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={startRename}
                  className="text-xs text-gray-500 transition hover:text-white"
                >
                  Rename
                </button>
                <span className="text-gray-700">·</span>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="text-xs text-gray-500 transition hover:text-red-400"
                >
                  Delete
                </button>
              </div>
            )}

            {/* Delete confirmation — inline, no modal */}
            {confirmDelete && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-gray-400 text-xs">Delete this conversation?</span>
                <button
                  type="button"
                  onClick={() => void handleDelete()}
                  disabled={deleting}
                  className="text-xs font-medium text-red-400 transition hover:text-red-300 disabled:opacity-50"
                >
                  {deleting ? "Deleting…" : "Yes, delete"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  disabled={deleting}
                  className="text-xs text-gray-500 transition hover:text-white disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>

          {/* Title — inline edit */}
          {renaming ? (
            <div className="mb-4 flex items-center gap-2">
              <input
                ref={renameInputRef}
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); void commitRename(); }
                  if (e.key === "Escape") cancelRename();
                }}
                onBlur={() => void commitRename()}
                maxLength={100}
                className="flex-1 rounded-lg border border-white/30 bg-transparent px-3 py-1.5 text-xl font-bold text-white outline-none focus:border-white/60"
              />
              {renameError && (
                <span className="text-xs text-red-400">{renameError}</span>
              )}
            </div>
          ) : (
            <div className="mb-4 flex items-center gap-3">
              <h2
                className="shrink-0 cursor-default text-2xl font-bold"
                title="Click Rename to edit"
              >
                {conversation.title}
              </h2>
              {isPro && (
                <div className="rounded-full border border-emerald-500/40 bg-emerald-950/30 px-3 py-1 text-xs text-emerald-200">
                  <span className="font-semibold">Pro Active</span>
                  {usage?.entitlements?.priorityGeneration && (
                    <span className="ml-2 text-emerald-300/80">Priority mode enabled</span>
                  )}
                </div>
              )}
            </div>
          )}

          {monetizationUi != null &&
            monetizationUi.kind !== "paid_or_unlimited" && (
            <div
              className={`mb-3 rounded-lg border px-3 py-2 text-xs ${
                monetizationUi.kind === "limit_reached"
                  ? "border-red-500/35 bg-red-950/25 text-red-200"
                  : monetizationUi.kind === "nearing_limit"
                    ? "border-amber-500/35 bg-amber-950/20 text-amber-100"
                    : "border-white/10 bg-white/[0.03] text-gray-300"
              }`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium text-gray-200">Live rebuttals (free tier)</span>
                <span
                  className={
                    monetizationUi.kind === "limit_reached"
                      ? "text-red-300"
                      : monetizationUi.kind === "nearing_limit"
                        ? "text-amber-200"
                        : "text-emerald-400/90"
                  }
                >
                  {monetizationUi.used} / {monetizationUi.limit} used
                  {monetizationUi.kind === "limit_reached"
                    ? " — limit reached"
                    : ` — ${monetizationUi.remaining} left`}
                </span>
              </div>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/10">
                <div
                  className={`h-full rounded-full transition-all ${
                    monetizationUi.kind === "limit_reached"
                      ? "bg-red-500/80"
                      : monetizationUi.kind === "nearing_limit"
                        ? "bg-amber-500/70"
                        : "bg-emerald-500/70"
                  }`}
                  style={{
                    width: `${monetizationUi.progressPct}%`,
                  }}
                />
              </div>
            </div>
          )}

          {monetizationUi?.kind === "paid_or_unlimited" && (
            <p className="mb-3 text-xs text-emerald-400/80">
              Live rebuttals: <span className="font-semibold text-white">Unlimited</span> on your plan.
            </p>
          )}

          {error && (
            <div className="mb-3 rounded-lg border border-red-500/30 bg-red-950/20 px-3 py-2 text-sm text-red-400">
              {error}
            </div>
          )}
        </div>
      </div>

      {/* MIDDLE SCROLL REGION (messages only) */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="space-y-3 rounded-xl border border-white/10 p-4">
        {messagesLoading && messages.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-gray-400">Loading messages…</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-gray-400">No messages yet.</p>
            <p className="mt-1 text-sm text-gray-500">
              Type a merchant objection below — RoboRebut will coach you on how to handle it.
            </p>
          </div>
        ) : (
          <>
            {lastAssistantMessageIndex < 0 && intentNudgeVisible && !isPro && (
              <div className="mr-auto max-w-[85%] shrink-0">
                <UpgradeNudge visible />
              </div>
            )}
            {messages.map((m, idx) => {
              const structuredReply =
                m.role === "ai"
                  ? parseStructuredReplySafe(m.structured_reply)
                  : null;
              const headerMeta =
                m.role === "ai"
                  ? resolveAssistantHeaderMetadata(m, structuredReply)
                  : {
                      objectionSlug: null as string | null,
                      objectionDisplayOverride: null as string | null,
                      toneSlug: null as string | null,
                    };
              const patternIntel =
                m.role === "ai" ? intelByMessageId[m.id] : undefined;
              const msgCoachMode = effectiveMessageCoachMode(
                m.structured_reply,
                structuredReply
              );
              const showPatternIntelBlock =
                m.role === "ai" &&
                patternIntel &&
                structuredReply == null &&
                msgCoachMode !== "live";
              const showUpgradeHere =
                m.role === "ai" &&
                idx === lastAssistantMessageIndex &&
                intentNudgeVisible;

              return (
                <div
                  key={m.id}
                  className={
                    m.role === "user"
                      ? "ml-auto max-w-[85%] rounded-lg border border-white/20 bg-white/5 px-4 py-2"
                      : "mr-auto max-w-[85%] rounded-lg border border-emerald-500/30 bg-emerald-950/30 px-4 py-2"
                  }
                >
                  <div className="mb-2 flex flex-wrap items-start justify-between gap-2 border-b border-white/5 pb-2 text-xs">
                    <div className="min-w-0 flex flex-col gap-0.5 text-gray-500">
                      <span>{m.role === "user" ? "You" : "RoboRebut"}</span>
                      {m.role === "ai" &&
                        msgCoachMode !== "live" &&
                        (headerMeta.objectionSlug ||
                          headerMeta.toneSlug) && (
                        <span className="text-[11px] leading-snug">
                          <span className="inline-flex flex-wrap items-baseline gap-x-1">
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                              Type
                            </span>
                            <span className="font-normal text-gray-400">
                              {headerMeta.objectionDisplayOverride?.trim()
                                ? headerMeta.objectionDisplayOverride.trim()
                                : headerMeta.objectionSlug
                                  ? formatObjectionTypeLabel(headerMeta.objectionSlug)
                                  : "unknown"}
                            </span>
                          </span>
                          {headerMeta.toneSlug ? (
                            <>
                              <span className="text-gray-600"> · </span>
                              <span className="inline-flex flex-wrap items-baseline gap-x-1">
                                <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                                  Tone
                                </span>
                                <span className="font-normal text-gray-400">
                                  {formatToneLabel(headerMeta.toneSlug)}
                                </span>
                              </span>
                            </>
                          ) : null}
                        </span>
                      )}
                    </div>
                    <span className="shrink-0 text-gray-500">{formatTime(m.created_at)}</span>
                  </div>
                  {showPatternIntelBlock && (
                    <PatternIntelligenceBlock intel={patternIntel} />
                  )}
                  <UpgradeNudge visible={showUpgradeHere && !isPro} />
                  {m.role === "ai" ? (
                    structuredReply ? (
                      <AssistantStructuredMessageBoundary content={m.content}>
                        <StructuredAssistantCoachMessage
                          data={structuredReply}
                          messageContent={m.content}
                          structuredReplyRaw={m.structured_reply}
                        />
                      </AssistantStructuredMessageBoundary>
                    ) : (
                      <AssistantCoachMessageBody content={m.content} />
                    )
                  ) : (
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-200">
                      {m.content}
                    </p>
                  )}
                  {m.role === "ai" &&
                    isInspectorEnabled() && (
                      <DecisionInspectorPanel
                        decision={
                          ((m as any)?.patternSelectionMeta?.decisionIntelligence ??
                            null) as DecisionIntelligenceMeta | null
                        }
                        scoredCandidates={
                          ((m as any)?.patternSelectionMeta?.scoredCandidates ??
                            undefined) as any
                        }
                      />
                    )}
                  {m.role === "ai" &&
                    idx === lastAssistantMessageIndex &&
                    showPostGenUpgradeNudge &&
                    !isPro && (
                      <div className="mt-2 flex items-center justify-between gap-3 text-xs text-gray-500">
                        <span>Pro adds advanced strategy layers to these responses.</span>
                        <div className="flex items-center gap-3">
                          <a
                            href={getProCheckoutHref(returnTo)}
                            onClick={(e) => {
                              e.preventDefault();
                              trackEvent({
                                eventName: "upgrade_nudge_clicked",
                                triggerType: "post_generation",
                                planType,
                                conversationId,
                                priorityGeneration: usage?.entitlements?.priorityGeneration,
                                responseVariants: usage?.entitlements?.responseVariants ?? null,
                                surface: "ConversationThread",
                                ctaLabel: "Improve My Responses",
                                ctaGroup: "post_gen",
                              });
                              void navigateProBillingSameTab({
                                getAccessToken: waitForSessionAccessToken,
                                checkoutFallbackUrl: getProCheckoutHref(returnTo),
                                portalReturnUrl:
                                  typeof window !== "undefined" ? window.location.href : "",
                              });
                            }}
                            className="text-emerald-400/80 transition hover:text-emerald-300"
                          >
                            Improve My Responses
                          </a>
                          <button
                            type="button"
                            onClick={dismissPostGenNudge}
                            className="transition hover:text-white"
                          >
                            Dismiss
                          </button>
                        </div>
                      </div>
                    )}
                  {m.role === "ai" && (
                    <div className="mt-2 flex flex-wrap items-center justify-end gap-3">
                      <button
                        type="button"
                        onClick={() => void handleUseOnCall(m)}
                        className="text-xs font-semibold text-emerald-300 transition hover:text-emerald-200"
                      >
                        {callCopiedId === m.id ? "Copied" : "Use This On Call"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleSaveResponse(m, idx)}
                        disabled={saveStatus[m.id] === "saving"}
                        className="text-xs text-gray-600 transition hover:text-emerald-400 disabled:opacity-50"
                      >
                        {saveStatus[m.id] === "saving"
                          ? "Saving…"
                          : saveStatus[m.id] === "saved"
                            ? "✓ Saved"
                            : saveStatus[m.id] === "error"
                              ? "Save failed"
                              : "Save response"}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            <UpgradeNudge
              visible={showVariantUpgradeNudge && !isPro}
              title="See More Ways to Close"
              body="Each live reply is one focused coaching response. Pro adds priority generation, advanced tones, and deeper strategy layers — beyond what the free thread shows."
              ctaLabel="Explore Pro features"
              href={getProCheckoutHref(returnTo)}
              onDismiss={dismissVariantNudge}
              onClick={() =>
                trackEvent({
                  eventName: "upgrade_nudge_clicked",
                  triggerType: "variants",
                  planType,
                  conversationId,
                  priorityGeneration: usage?.entitlements?.priorityGeneration,
                  responseVariants: usage?.entitlements?.responseVariants ?? null,
                  surface: "ConversationThread",
                  ctaLabel: "Explore Pro features",
                  ctaGroup: "variants",
                })
              }
            />
          </>
        )}

        {sending && (
          <div className="mr-auto max-w-[85%] rounded-lg border border-emerald-500/20 bg-emerald-950/20 px-4 py-3">
            <div className="flex items-center gap-2 text-xs text-emerald-500/70">
              <span className="inline-flex gap-1">
                <span className="animate-bounce [animation-delay:0ms]">●</span>
                <span className="animate-bounce [animation-delay:150ms]">●</span>
                <span className="animate-bounce [animation-delay:300ms]">●</span>
              </span>
              <span>RoboRebut is thinking…</span>
            </div>
          </div>
        )}

        <div ref={threadEndRef} />
        </div>
      </div>

      {/* BOTTOM STICKY RAIL (deal/tone/mode/composer) */}
      <div className="sticky bottom-0 z-30 shrink-0 border-t border-white/10 bg-black/80 backdrop-blur supports-[backdrop-filter]:bg-black/60">
        <div className="p-4 space-y-2">
        {atUsageLimit && (
          <div className="rounded-xl border border-red-500/35 bg-gradient-to-b from-red-950/40 to-black/40 px-4 py-4">
            <h3 className="text-base font-semibold leading-snug text-white">
              You’ve already used this on real objections.
            </h3>
            <p className="mt-2 text-sm font-medium text-gray-100">
              The next step is using it consistently during live calls.
            </p>
            <p className="mt-3 text-sm text-gray-400">
              This is where most reps either hesitate or close.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a
                href={ctaLinks.starterUpgradeHref}
                className="inline-flex rounded-lg border border-emerald-500/50 bg-emerald-600/20 px-3 py-2 text-sm font-medium text-emerald-100 hover:bg-emerald-600/30"
              >
                Unlock Full Access
              </a>
              <a
                href={MONETIZATION_LINKS.demo}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex rounded-lg border border-white/25 px-3 py-2 text-sm font-medium text-white hover:bg-white/10"
              >
                Book a Live Demo
              </a>
            </div>
            <a
              href={ctaLinks.comparePlansHref}
              className="mt-2 inline-block text-xs text-gray-500 underline hover:text-gray-300"
            >
              See pricing
            </a>
          </div>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-6">
          <div className="min-w-0 flex-1">
            <DealContextPanel
              conversationId={conversationId}
              savedDealContext={conversation.deal_context}
              getAccessToken={waitForSessionAccessToken}
              structuredDealContextEnabled={structuredDealContextEnabled}
              proUpgradeHref={getProCheckoutHref(returnTo)}
              onDealContextSaved={(deal_context) =>
                setConversation((c) => (c ? { ...c, deal_context } : c))
              }
            />
          </div>
          <div className="min-w-0 flex-1">
            <ClientContextPanel
              conversationId={conversationId}
              savedClientContext={conversation.client_context ?? null}
              getAccessToken={waitForSessionAccessToken}
              onClientContextSaved={(client_context) =>
                setConversation((c) => (c ? { ...c, client_context } : c))
              }
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
              Tone Mode
            </p>
            {usage?.entitlements?.advancedToneModes === true && (
              <span className="text-xs text-emerald-400/80">Pro tones enabled</span>
            )}
          </div>
          <ToneSwitcher
            selectedTone={selectedTone}
            onSelect={(tone) =>
              setSelectedTone((current) => (current === tone ? "" : tone))
            }
            disabled={composerDisabled}
            tones={toneOptions}
            showLockedToneNudge={showToneUpgradeNudge && !isPro}
            onLockedToneClick={handleLockedToneClick}
            onDismissLockedToneNudge={dismissToneNudge}
            onLockedToneCtaClick={() =>
              trackEvent({
                eventName: "upgrade_nudge_clicked",
                triggerType: "tone",
                planType,
                conversationId,
                priorityGeneration: usage?.entitlements?.priorityGeneration,
                responseVariants: usage?.entitlements?.responseVariants ?? null,
                surface: "ToneSwitcher",
                ctaLabel: "Use Closer Mode",
                ctaGroup: "tone",
              })
            }
          />
          <CoachModeToggle
            mode={coachReplyMode}
            disabled={composerDisabled}
            onChange={(m) => {
              setCoachReplyMode(m);
              if (typeof window !== "undefined") {
                window.sessionStorage.setItem(
                  `roborebut:coachReplyMode:${conversationId}`,
                  m
                );
              }
            }}
          />
          {coachReplyMode === "precall" && (
            <PreCallDepthToggle
              depth={preCallDepth}
              disabled={composerDisabled}
              onChange={(d) => {
                setPreCallDepth(d);
                if (typeof window !== "undefined") {
                  window.sessionStorage.setItem(
                    `roborebut:preCallDepth:${conversationId}`,
                    d
                  );
                }
              }}
            />
          )}
        </div>

        {isNearingLimit && monetizationUi != null && (
          <div
            className={`mb-3 rounded-lg border border-emerald-500/20 bg-white/[0.03] px-3 py-2.5 transition-opacity duration-500 ease-out ${
              prelimitBannerVisible ? "opacity-100" : "opacity-0"
            }`}
          >
            <p className="text-sm text-gray-300">
              You’re nearing your free limit. Upgrade now to avoid interruption.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
              <a
                href={ctaLinks.starterUpgradeHref}
                onClick={() =>
                  trackEvent({
                    eventName: "prelimit_cta_clicked",
                    ctaLabel: "Continue without limits",
                    planType,
                    conversationId,
                    surface: "conversation",
                    metadata: {
                      planTier: planType,
                      usageUsed: monetizationUi.used,
                      usageLimit: monetizationUi.limit,
                      threshold: "remaining<=3",
                    },
                  })
                }
                className="inline-flex rounded-md border border-emerald-500/40 bg-emerald-600/15 px-3 py-1.5 text-xs font-semibold text-emerald-50 transition hover:bg-emerald-600/25"
              >
                Continue without limits
              </a>
              <Link
                href={ctaLinks.comparePlansHref}
                className="text-xs text-gray-400 underline-offset-2 transition hover:text-gray-200 hover:underline"
              >
                Compare plans
              </Link>
            </div>
          </div>
        )}

        <textarea
          value={composer}
          onChange={(e) => setComposer(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
          placeholder="Type a merchant objection… (Enter to send, Shift+Enter for new line)"
          rows={3}
          disabled={composerDisabled}
          className="w-full resize-y rounded-lg border border-white/20 bg-transparent px-3 py-2 text-sm text-white outline-none placeholder:text-gray-600 focus:border-white/50 disabled:opacity-50"
        />

        {/* Mic: unsupported notice */}
        {micState === "unsupported" && (
          <p className="text-xs text-gray-500">
            🎤 Speech input is not supported in this browser. Try Chrome or Edge.
          </p>
        )}

        {/* Mic: error notice */}
        {micState === "error" && micError && (
          <p className="text-xs text-red-400">{micError}</p>
        )}

        {/* Send row */}
        <div className="flex items-center gap-2">

          {/* Mic button — only shown when speech API is available */}
          {micState !== "unsupported" && (
            <button
              type="button"
              onClick={micStart}
              disabled={composerDisabled}
              title={
                micState === "listening"
                  ? "Stop listening"
                  : composerDisabled
                  ? "Microphone unavailable while sending"
                  : "Click to speak"
              }
              aria-label={micState === "listening" ? "Stop speech input" : "Start speech input"}
              aria-pressed={micState === "listening"}
              className={[
                "flex h-9 w-9 items-center justify-center rounded-lg border text-base transition select-none",
                micState === "listening"
                  ? "animate-pulse border-red-400 bg-red-950/40 text-red-300"
                  : "border-white/20 text-gray-400 hover:border-white/50 hover:text-white",
                composerDisabled ? "cursor-not-allowed opacity-40" : "cursor-pointer",
              ].join(" ")}
            >
              {micState === "listening" ? "⏹" : "🎤"}
            </button>
          )}

          {/* Listening badge */}
          {micState === "listening" && (
            <span className="text-xs font-medium text-red-400 animate-pulse">
              Listening…
            </span>
          )}

          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={composerDisabled || !composer.trim()}
            className="ml-auto rounded-lg border border-white/60 px-4 py-2 text-sm font-semibold transition hover:bg-white hover:text-black disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
        </div>
      </div>

      <EnforcementPromptModal
        open={enforcementOpen}
        onClose={closeEnforcementPrompt}
        model={enforcementUx}
        surface="conversation"
        planType={planType}
        conversationId={conversationId}
        httpStatus={enforcementMeta.httpStatus}
        errorCode={enforcementMeta.errorCode}
        returnTo={returnTo}
      />
    </div>
  );
}
