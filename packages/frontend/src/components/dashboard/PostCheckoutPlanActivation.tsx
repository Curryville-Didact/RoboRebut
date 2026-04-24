"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { API_URL } from "@/lib/env";
import {
  fetchUsageSnapshot,
  planMessagingFromUsage,
  planReflectsPostCheckoutSuccess,
  type UsageSnapshot,
} from "@/lib/usageBilling";
import type { PlanMessagingTier } from "@/lib/usageBilling";

const MAX_ATTEMPTS = 6;
const POLL_INTERVAL_MS = 1500;
const SESSION_ATTEMPTS = 5;
const SESSION_RETRY_MS = 200;

async function waitForAccessToken(): Promise<string | null> {
  const supabase = createClient();
  for (let attempt = 1; attempt <= SESSION_ATTEMPTS; attempt++) {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token ?? null;
    if (token) return token;
    if (attempt < SESSION_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, SESSION_RETRY_MS));
    }
  }
  return null;
}

async function syncEntitlementBestEffort(token: string): Promise<void> {
  try {
    await fetch(`${API_URL}/api/billing/sync-entitlement`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    /* best-effort */
  }
}

type Props = {
  demoMode: boolean;
  /** Called on each poll tick with latest usage; update plan-derived UI (e.g. plan messaging). */
  onPlanRefresh: (usage: UsageSnapshot | null) => void;
};

/**
 * Bounded post-checkout entitlement refresh when ?upgrade=starter_success|pro_success.
 */
export function PostCheckoutPlanActivation({ demoMode, onPlanRefresh }: Props) {
  const searchParams = useSearchParams();
  const upgrade = searchParams.get("upgrade");
  const mode =
    upgrade === "starter_success" || upgrade === "pro_success" ? upgrade : null;

  const [showActivating, setShowActivating] = useState(false);
  const cancelledRef = useRef(false);
  const onPlanRefreshRef = useRef(onPlanRefresh);
  onPlanRefreshRef.current = onPlanRefresh;

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  useEffect(() => {
    if (demoMode || !mode) {
      setShowActivating(false);
      return;
    }

    let attempts = 0;

    async function run(): Promise<void> {
      const token = await waitForAccessToken();
      if (!token || cancelledRef.current || !mode) return;
      const upgradeMode = mode;

      while (attempts < MAX_ATTEMPTS && !cancelledRef.current) {
        attempts += 1;
        await syncEntitlementBestEffort(token);
        const usage = await fetchUsageSnapshot(token);
        if (cancelledRef.current) return;

        onPlanRefreshRef.current(usage);

        if (planReflectsPostCheckoutSuccess(usage, upgradeMode)) {
          setShowActivating(false);
          return;
        }

        setShowActivating(true);

        if (attempts >= MAX_ATTEMPTS) {
          setShowActivating(false);
          return;
        }

        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }

      if (!cancelledRef.current) {
        setShowActivating(false);
      }
    }

    void run();
  }, [demoMode, mode]);

  if (!mode || !showActivating) return null;

  return (
    <div className="mb-4 rounded-xl border border-white/12 bg-white/[0.04] px-4 py-2.5 text-sm text-gray-300">
      <p className="leading-snug">Activating your plan…</p>
    </div>
  );
}
