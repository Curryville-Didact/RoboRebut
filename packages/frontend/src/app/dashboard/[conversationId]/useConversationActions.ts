import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { ReadonlyURLSearchParams } from "next/navigation";
import { API_URL } from "@/lib/env";
import { extractPrimaryRebuttalScript } from "@/lib/extractPrimaryRebuttalScript";
import { formatStrategyLabel } from "@/lib/strategyDisplay";
import { formatToneLabel } from "@/lib/toneDisplay";
import {
  pruneAssistantIntelToMessageIds,
  type AssistantMessageIntel,
} from "@/lib/patternIntel";
import { parseStructuredReplySafe } from "@/lib/parseStructuredReply";
import { resolveSavedResponseObjectionSemantics } from "@/lib/objectionFamilyResolve";
import { trackEvent } from "@/lib/trackEvent";
import { useSpeechRecognition } from "@/lib/useSpeechRecognition";
import type { CoachReplyMode } from "@/types/coachReplyMode";
import type { PreCallDepth } from "@/types/preCallDepth";
import type { Conversation, MessageRow, UsageSnapshot } from "./conversationHelpers";
import type { MonetizationUiState } from "@/lib/monetizationUi";
import { waitForSessionAccessToken } from "./conversationSession";
import { useConversationLoader } from "./useConversationLoader";

type CreateBrowserSupabaseClient = typeof import("@/lib/supabase/client").createClient;

type ToneOption = { value: string };

export function useConversationActions(args: {
  micDisabled: boolean;
  router: { push: (href: string) => void };
  createClient: CreateBrowserSupabaseClient;
  searchParams: ReadonlyURLSearchParams;
  conversationId: string;
  conversation: Conversation | null;
  messages: MessageRow[];
  usage: UsageSnapshot | null;
  planType: "free" | "starter" | "pro";
  /** From `getVisibleToneOptions` in the page. */
  toneOptions: ToneOption[];
  renameValue: string;
  renaming: boolean;
  selectedTone: string;
  intelByMessageId: Record<string, AssistantMessageIntel>;
  setCallCopiedId: Dispatch<SetStateAction<string | null>>;
  copyEventsCount: number;
  setCopyEventsCount: Dispatch<SetStateAction<number>>;
  confirmDelete: boolean;
  deleting: boolean;
  atUsageLimit: boolean;
  threadEndRef: MutableRefObject<HTMLDivElement | null>;
  isFirstScrollRef: MutableRefObject<boolean>;
  renameInputRef: MutableRefObject<HTMLInputElement | null>;
  inflightConvRef: MutableRefObject<string | null>;
  setComposer: Dispatch<SetStateAction<string>>;
  setConversation: Dispatch<SetStateAction<Conversation | null>>;
  setMessages: Dispatch<SetStateAction<MessageRow[]>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setUsage: Dispatch<SetStateAction<UsageSnapshot | null>>;
  setSaveStatus: Dispatch<SetStateAction<Record<string, "saving" | "saved" | "error">>>;
  setRenaming: Dispatch<SetStateAction<boolean>>;
  setRenameValue: Dispatch<SetStateAction<string>>;
  setRenameError: Dispatch<SetStateAction<string | null>>;
  setDeleting: Dispatch<SetStateAction<boolean>>;
  setConfirmDelete: Dispatch<SetStateAction<boolean>>;
  setSelectedTone: Dispatch<SetStateAction<string>>;
  setIntelByMessageId: Dispatch<SetStateAction<Record<string, AssistantMessageIntel>>>;
  setPageLoading: Dispatch<SetStateAction<boolean>>;
  setMessagesLoading: Dispatch<SetStateAction<boolean>>;
  setDemoMode: Dispatch<SetStateAction<boolean>>;
  setIsFounder: Dispatch<SetStateAction<boolean>>;
  setCoachReplyMode: Dispatch<SetStateAction<CoachReplyMode>>;
  setPreCallDepth: Dispatch<SetStateAction<PreCallDepth>>;
  isNearingLimit: boolean;
  monetizationUi: MonetizationUiState | null;
  messagesLoading: boolean;
}): {
  micState: ReturnType<typeof useSpeechRecognition>["state"];
  micStart: ReturnType<typeof useSpeechRecognition>["start"];
  micError: ReturnType<typeof useSpeechRecognition>["errorMessage"];
  prelimitBannerVisible: boolean;
  startRename: () => void;
  cancelRename: () => void;
  commitRename: () => Promise<void>;
  handleDelete: () => Promise<void>;
  handleSaveResponse: (msg: MessageRow, aiIndex: number) => Promise<void>;
  formatTime: (iso: string) => string;
  handleUseOnCall: (msg: MessageRow) => Promise<void>;
  userMessageCount: number;
  lastAssistantMessageIndex: number;
  intentNudgeVisible: boolean;
} {
  const {
    micDisabled,
    router,
    createClient,
    searchParams,
    conversationId,
    conversation,
    messages,
    usage,
    planType,
    toneOptions,
    renameValue,
    renaming,
    selectedTone,
    intelByMessageId,
    setCallCopiedId,
    copyEventsCount,
    setCopyEventsCount,
    confirmDelete,
    deleting,
    atUsageLimit,
    threadEndRef,
    isFirstScrollRef,
    renameInputRef,
    inflightConvRef,
    setComposer,
    setConversation,
    setMessages,
    setError,
    setUsage,
    setSaveStatus,
    setRenaming,
    setRenameValue,
    setRenameError,
    setDeleting,
    setConfirmDelete,
    setSelectedTone,
    setIntelByMessageId,
    setPageLoading,
    setMessagesLoading,
    setDemoMode,
    setIsFounder,
    setCoachReplyMode,
    setPreCallDepth,
    isNearingLimit,
    monetizationUi,
    messagesLoading,
  } = args;

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
    if (monetizationUi.kind === "paid_or_unlimited") {
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
  }, [setComposer]);

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
  }, [conversationId, messages, conversation, setIntelByMessageId]);

  // --- Scroll ---
  useEffect(() => {
    if (messagesLoading || messages.length === 0) return;
    const behavior: ScrollBehavior = isFirstScrollRef.current ? "instant" : "smooth";
    isFirstScrollRef.current = false;
    threadEndRef.current?.scrollIntoView({ behavior });
  }, [messagesLoading, messages.length, isFirstScrollRef, threadEndRef]);

  // Focus rename input when rename mode opens
  useEffect(() => {
    if (renaming) {
      renameInputRef.current?.select();
    }
  }, [renaming, renameInputRef]);

  useEffect(() => {
    if (!selectedTone) return;
    const allowed = new Set(toneOptions.map((tone) => tone.value));
    if (!allowed.has(selectedTone)) {
      setSelectedTone("");
    }
  }, [selectedTone, toneOptions, setSelectedTone]);

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

  return {
    micState,
    micStart,
    micError,
    prelimitBannerVisible,
    startRename,
    cancelRename,
    commitRename,
    handleDelete,
    handleSaveResponse,
    formatTime,
    handleUseOnCall,
    userMessageCount,
    lastAssistantMessageIndex,
    intentNudgeVisible,
  };
}
