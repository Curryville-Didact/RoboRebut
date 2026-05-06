"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { API_URL } from "@/lib/env";
import type { DealContext } from "@/lib/dealContext";
import type { ClientContext } from "@/lib/clientContext";
import { RebutBrandLogo } from "@/components/brand/RebutBrandLogo";
import { DashboardEmptyState } from "@/components/dashboard/DashboardEmptyState";
import {
  fetchUsageSnapshot,
  planMessagingFromUsage,
  type PlanMessagingTier,
  type UsageSnapshot,
} from "@/lib/usageBilling";
import {
  isLikelyForbiddenStatus,
  MSG_CONVERSATIONS_CREATE,
  MSG_CONVERSATIONS_LOAD,
  MSG_SESSION,
} from "@/lib/userFacingErrors";
import { OnboardingSteps } from "@/components/dashboard/OnboardingSteps";
import { PostCheckoutPlanActivation } from "@/components/dashboard/PostCheckoutPlanActivation";
import { UpgradeSuccessNotice } from "@/components/dashboard/UpgradeSuccessNotice";
import { isFounderEmail } from "@/lib/founder";
import { DEMO_CONVERSATIONS } from "@/lib/demoFixtures";
import { trackEvent } from "@/lib/trackEvent";

interface Conversation {
  id: string;
  title: string;
  deal_context: DealContext | null;
  client_context?: ClientContext | null;
  created_at: string;
  updated_at: string;
}

type BillingSyncEntitlementResponse = {
  ok: boolean;
  status:
    | "synced"
    | "no_change"
    | "unauthenticated"
    | "billing_not_configured"
    | "profile_not_found"
    | "provider_not_ready"
    | "error";
  planType?: string | null;
  entitlements?: Record<string, unknown>;
  usage?: unknown;
  message?: string;
};

function sortByUpdatedAtDesc(items: Conversation[]): Conversation[] {
  return [...items].sort(
    (a, b) =>
      new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  );
}

/** Bounded wait for browser session after navigation (e.g. post-login). */
const SESSION_MAX_ATTEMPTS = 5;
const SESSION_RETRY_DELAY_MS = 200;

function isValidConversationRecord(v: unknown): v is Conversation {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    o.id.length > 0 &&
    typeof o.title === "string" &&
    typeof o.created_at === "string" &&
    typeof o.updated_at === "string"
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const mountedRef = useRef(true);
  const createInFlightRef = useRef(false);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [planMessaging, setPlanMessaging] = useState<PlanMessagingTier>("unknown");
  const [isFounder, setIsFounder] = useState(false);
  const [demoMode, setDemoMode] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    trackEvent({
      eventName: "dashboard_view",
      surface: "dashboard",
      metadata: { route: "/dashboard", source: "app" },
    });
  }, []);

  useEffect(() => {
    // founder check (best-effort, UI-only)
    const supabase = createClient();
    void supabase.auth.getUser().then((res) => {
      if (!mountedRef.current) return;
      setIsFounder(isFounderEmail(res.data.user?.email ?? ""));
    });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const p = new URLSearchParams(window.location.search);
    setDemoMode(p.get("demo") === "1");
  }, []);

  async function waitForSessionAccessToken(): Promise<string | null> {
    const supabase = createClient();
    for (let attempt = 1; attempt <= SESSION_MAX_ATTEMPTS; attempt++) {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token ?? null;
      if (token) return token;
      if (attempt < SESSION_MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, SESSION_RETRY_DELAY_MS));
      }
    }
    return null;
  }

async function syncEntitlement(token: string): Promise<void> {
  try {
    const res = await fetch(`${API_URL}/api/billing/sync-entitlement`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = (await res.json()) as BillingSyncEntitlementResponse;
    if (body.status === "unauthenticated") {
      return;
    }
    if (body.status === "billing_not_configured" || body.status === "provider_not_ready") {
      return;
    }
  } catch {
    /* best-effort */
  }
}

  const loadConversations = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (!silent) {
      setError(null);
      setLoading(true);
    }
    if (demoMode && isFounder) {
      setConversations(
        DEMO_CONVERSATIONS.map((c) => ({
          id: c.id,
          title: c.title,
          deal_context: null,
          client_context: null,
          created_at: c.created_at,
          updated_at: c.updated_at,
        }))
      );
      setLoading(false);
      return;
    }
    try {
      const token = await waitForSessionAccessToken();
      if (!token) {
        setError(MSG_SESSION);
        return;
      }

      await syncEntitlement(token);
      const usage = await fetchUsageSnapshot(token);
      if (mountedRef.current) {
        setPlanMessaging(planMessagingFromUsage(usage));
      }

      const res = await fetch(`${API_URL}/api/conversations`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        const data = (await res.json()) as Conversation[];
        setConversations(
          Array.isArray(data) ? sortByUpdatedAtDesc(data) : []
        );
      } else {
        void res.json().catch(() => null);
        setError(isLikelyForbiddenStatus(res.status) ? MSG_SESSION : MSG_CONVERSATIONS_LOAD);
      }
    } catch {
      setError(MSG_CONVERSATIONS_LOAD);
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [demoMode, isFounder]);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  const handlePostCheckoutPlanRefresh = useCallback((usage: UsageSnapshot | null) => {
    setPlanMessaging(planMessagingFromUsage(usage));
  }, []);

  /**
   * Deterministic create flow: one POST, validate body, optimistic list update,
   * navigate by returned id. No loadConversations() after create (avoids races
   * with navigation and duplicate GETs).
   */
  async function handleCreateConversation() {
    if (createInFlightRef.current) return;
    createInFlightRef.current = true;
    if (mountedRef.current) {
      setCreating(true);
      setError(null);
    }

    const wasFirstConversationCandidate = conversations.length === 0;
    try {
      const token = await waitForSessionAccessToken();
      if (!token) {
        if (mountedRef.current) {
          setError(MSG_SESSION);
        }
        return;
      }

      const res = await fetch(`${API_URL}/api/conversations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ title: "New Conversation" }),
      });

      let body: unknown;
      try {
        body = await res.json();
      } catch {
        body = null;
      }

      if (!res.ok) {
        if (mountedRef.current) setError(MSG_CONVERSATIONS_CREATE);
        return;
      }

      if (!isValidConversationRecord(body)) {
        if (mountedRef.current) {
          setError(MSG_CONVERSATIONS_CREATE);
        }
        return;
      }

      const created = body;
      if (mountedRef.current) {
        setConversations((prev) =>
          sortByUpdatedAtDesc([created, ...prev])
        );
        if (wasFirstConversationCandidate) {
          trackEvent({
            eventName: "first_conversation_created",
            surface: "dashboard",
            conversationId: created.id,
            metadata: { activationCandidate: true, source: "dashboard" },
          });
        }
        router.push(`/dashboard/${created.id}`);
      }
    } catch {
      if (mountedRef.current) {
        setError(MSG_CONVERSATIONS_CREATE);
      }
    } finally {
      createInFlightRef.current = false;
      if (mountedRef.current) {
        setCreating(false);
      }
    }
  }

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  const logoVariant = planMessaging === "starter" ? "starter" : "pro";
  const emptySubtitle =
    planMessaging === "starter"
      ? "Build consistency before the pressure hits."
      : planMessaging === "pro"
        ? "Use RoboRebut on your next live call."
        : "Open a thread to run Live or precall coaching.";

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <Suspense fallback={null}>
        <PostCheckoutPlanActivation
          demoMode={demoMode}
          onPlanRefresh={handlePostCheckoutPlanRefresh}
        />
      </Suspense>
      <Suspense fallback={null}>
        <UpgradeSuccessNotice />
      </Suspense>
      <div className="sticky top-0 z-20 -mx-8 border-b border-white/10 bg-black/80 px-8 py-6 backdrop-blur supports-[backdrop-filter]:bg-black/60">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-white">Conversations</h2>
            <p className="mt-1 text-sm text-gray-500">
              Open a thread to run Live or precall coaching.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleCreateConversation()}
            disabled={creating}
            className="shrink-0 rounded-lg border border-emerald-500/35 bg-emerald-500/15 px-4 py-2.5 text-sm font-semibold text-emerald-50 shadow-[0_0_24px_rgba(16,185,129,0.12)] transition hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {creating ? "Creating…" : "+ New Conversation"}
          </button>
        </div>
      </div>

      {error ? (
        <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-100/90">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <>
          <OnboardingSteps hasUploadedCall={conversations.length > 0} />
          {conversations.length === 0 ? (
            <DashboardEmptyState
              title="Start your first conversation"
              description={emptySubtitle}
              logo={<RebutBrandLogo variant={logoVariant} className="h-14 w-14" />}
            >
              <button
                type="button"
                onClick={() => void handleCreateConversation()}
                disabled={creating}
                className="rounded-lg border border-white/20 bg-white/[0.08] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-white/[0.12] disabled:opacity-60"
              >
                {creating ? "Creating…" : "+ New Conversation"}
              </button>
              {isFounder ? (
                <button
                  type="button"
                  onClick={() => {
                    try {
                      const url = new URL(window.location.href);
                      url.searchParams.set("demo", "1");
                      router.push(`${url.pathname}?${url.searchParams.toString()}`);
                    } catch {
                      router.push("/dashboard?demo=1");
                    }
                  }}
                  className="rounded-lg border border-white/15 bg-transparent px-5 py-2.5 text-sm font-semibold text-gray-300 transition hover:bg-white/[0.06]"
                >
                  Load demo workspace
                </button>
              ) : null}
              <div className="w-full" />
            </DashboardEmptyState>
          ) : (
            <div className="space-y-3">
              {conversations.map((conv) => (
                <Link
                  key={conv.id}
                  href={`/dashboard/${conv.id}`}
                  className="block rounded-2xl border border-white/[0.1] bg-gradient-to-b from-white/[0.04] to-black/30 p-5 transition hover:border-emerald-500/25 hover:bg-white/[0.05] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-white">{conv.title}</p>
                    <p className="shrink-0 text-xs text-gray-500">
                      {formatDate(conv.updated_at)}
                    </p>
                  </div>
                  <p className="mt-2 text-xs text-gray-500">Created {formatDate(conv.created_at)}</p>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
