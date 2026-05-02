import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { EnforcementUxModel } from "@/lib/generationEnforcementUx";
import { trackEvent } from "@/lib/trackEvent";
import type { MessageRow, UsageSnapshot } from "./conversationHelpers";
import {
  hasSeenVariantNudgeThisSession,
  markVariantNudgeSeenThisSession,
  readDismissed,
  writeDismissed,
} from "./conversationSession";

export function useEnforcement(args: {
  conversationId: string;
  planType: "free" | "starter" | "pro";
  setError: Dispatch<SetStateAction<string | null>>;
  isPro: boolean;
  isNearingLimit: boolean;
  messages: MessageRow[];
  usage: UsageSnapshot | null;
}): {
  showToneUpgradeNudge: boolean;
  showVariantUpgradeNudge: boolean;
  showPostGenUpgradeNudge: boolean;
  enforcementOpen: boolean;
  enforcementUx: EnforcementUxModel | null;
  enforcementMeta: { httpStatus: number; errorCode: string | null };
  openEnforcementPrompt: (
    model: EnforcementUxModel,
    meta: { httpStatus: number; errorCode: string | null }
  ) => void;
  closeEnforcementPrompt: () => void;
  handleLockedToneClick: (tone: string) => void;
  dismissToneNudge: () => void;
  dismissVariantNudge: () => void;
  dismissPostGenNudge: () => void;
} {
  const {
    conversationId,
    planType,
    setError,
    isPro,
    isNearingLimit,
    messages,
    usage,
  } = args;

  const shownNudgesRef = useRef<Set<string>>(new Set());

  const [showToneUpgradeNudge, setShowToneUpgradeNudge] = useState(false);
  const [showVariantUpgradeNudge, setShowVariantUpgradeNudge] = useState(false);
  const [showPostGenUpgradeNudge, setShowPostGenUpgradeNudge] = useState(false);
  const [enforcementOpen, setEnforcementOpen] = useState(false);
  const [enforcementUx, setEnforcementUx] = useState<EnforcementUxModel | null>(null);
  const [enforcementMeta, setEnforcementMeta] = useState<{
    httpStatus: number;
    errorCode: string | null;
  }>({ httpStatus: 0, errorCode: null });

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
    [planType, conversationId, setError]
  );

  const closeEnforcementPrompt = useCallback(() => {
    setEnforcementOpen(false);
    setEnforcementUx(null);
  }, []);

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

  const handleLockedToneClick = useCallback(
    (tone: string) => {
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
    },
    [isPro, planType, conversationId, usage]
  );

  const dismissToneNudge = useCallback(() => {
    trackEvent({
      eventName: "upgrade_nudge_dismissed",
      triggerType: "tone",
      planType,
      conversationId,
      surface: "ToneSwitcher",
    });
    writeDismissed("tone");
    setShowToneUpgradeNudge(false);
  }, [planType, conversationId]);

  const dismissVariantNudge = useCallback(() => {
    trackEvent({
      eventName: "upgrade_nudge_dismissed",
      triggerType: "variants",
      planType,
      conversationId,
      surface: "ConversationThread",
    });
    writeDismissed("variants");
    setShowVariantUpgradeNudge(false);
  }, [planType, conversationId]);

  const dismissPostGenNudge = useCallback(() => {
    trackEvent({
      eventName: "upgrade_nudge_dismissed",
      triggerType: "post_generation",
      planType,
      conversationId,
      surface: "ConversationThread",
    });
    writeDismissed("post_gen");
    setShowPostGenUpgradeNudge(false);
  }, [planType, conversationId]);

  return {
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
  };
}
