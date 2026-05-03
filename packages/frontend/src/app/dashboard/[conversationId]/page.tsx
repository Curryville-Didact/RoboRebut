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
import type { AssistantStructuredReply } from "@/types/assistantStructuredReply";
import {
  type CoachReplyMode,
  effectiveMessageCoachMode,
} from "@/types/coachReplyMode";
import type { PreCallDepth } from "@/types/preCallDepth";
import { CoachModeToggle } from "@/components/CoachModeToggle";
import { PreCallDepthToggle } from "@/components/PreCallDepthToggle";
import { EnforcementPromptModal } from "@/components/enforcement/EnforcementPromptModal";
import {
  type Conversation,
  type MessageRow,
  type UsageSnapshot,
  resolveAssistantHeaderMetadata,
} from "./conversationHelpers";
import {
  derivePlanType,
  structuredDealContextEnabledFromUsage,
  syncEntitlement,
  waitForSessionAccessToken,
} from "./conversationSession";
import { useConversationLoader } from "./useConversationLoader";
import { useCoachSocket } from "./useCoachSocket";
import { useEnforcement } from "./useEnforcement";
import { useMessageSend } from "./useMessageSend";

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

  const {
    showToneUpgradeNudge,
    showVariantUpgradeNudge,
    showPostGenUpgradeNudge,
    enforcementOpen,
    enforcementUx,
    enforcementMeta,
    openEnforcementPrompt,
    closeEnforcementPrompt,
    handleLockedToneClick,
    dismissToneNudge,
    dismissVariantNudge,
    dismissPostGenNudge,
  } = useEnforcement({
    conversationId,
    planType,
    setError,
    isPro,
    isNearingLimit,
    messages,
    usage,
  });

  const { attemptCoachWsLiveSend } = useCoachSocket({
    coachReplyMode,
    selectedTone,
    usage,
    inflightConvRef,
    setMessages,
    setComposer,
    setSending,
    setUsage,
    setError,
    openEnforcementPrompt,
  });

  const { handleSend } = useMessageSend({
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
  });

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
  useConversationLoader({
    createClient,
    conversationId,
    searchParams,
    inflightConvRef,
    isFirstScrollRef,
    setConversation,
    setMessages,
    setError,
    setUsage,
    setPageLoading,
    setMessagesLoading,
    setSaveStatus,
    setIntelByMessageId,
    setRenaming,
    setConfirmDelete,
    setDemoMode,
    setIsFounder,
    setCoachReplyMode,
    setPreCallDepth,
  });

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
