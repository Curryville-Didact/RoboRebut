import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { ReadonlyURLSearchParams } from "next/navigation";
import { API_URL } from "@/lib/env";
import {
  loadAssistantIntelMap,
  type AssistantMessageIntel,
} from "@/lib/patternIntel";
import { isFounderEmail } from "@/lib/founder";
import { DEMO_THREADS } from "@/lib/demoFixtures";
import type { CoachReplyMode } from "@/types/coachReplyMode";
import type { PreCallDepth } from "@/types/preCallDepth";
import type { Conversation, MessageRow, UsageSnapshot } from "./conversationHelpers";
import { syncEntitlement, waitForSessionAccessToken } from "./conversationSession";

type CreateBrowserSupabaseClient = typeof import("@/lib/supabase/client").createClient;

export function useConversationLoader(args: {
  createClient: CreateBrowserSupabaseClient;
  conversationId: string;
  searchParams: ReadonlyURLSearchParams;
  inflightConvRef: MutableRefObject<string | null>;
  isFirstScrollRef: MutableRefObject<boolean>;
  setConversation: Dispatch<SetStateAction<Conversation | null>>;
  setMessages: Dispatch<SetStateAction<MessageRow[]>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setUsage: Dispatch<SetStateAction<UsageSnapshot | null>>;
  setPageLoading: Dispatch<SetStateAction<boolean>>;
  setMessagesLoading: Dispatch<SetStateAction<boolean>>;
  setSaveStatus: Dispatch<SetStateAction<Record<string, "saving" | "saved" | "error">>>;
  setIntelByMessageId: Dispatch<SetStateAction<Record<string, AssistantMessageIntel>>>;
  setRenaming: Dispatch<SetStateAction<boolean>>;
  setConfirmDelete: Dispatch<SetStateAction<boolean>>;
  setDemoMode: Dispatch<SetStateAction<boolean>>;
  setIsFounder: Dispatch<SetStateAction<boolean>>;
  setCoachReplyMode: Dispatch<SetStateAction<CoachReplyMode>>;
  setPreCallDepth: Dispatch<SetStateAction<PreCallDepth>>;
}): void {
  const {
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
  } = args;

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
        call_transcript: null,
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
}
