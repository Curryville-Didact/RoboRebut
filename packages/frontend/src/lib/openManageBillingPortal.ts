"use client";

import { API_URL } from "@/lib/env";
import { createClient } from "@/lib/supabase/client";

/** Opens Polar customer portal (same contract as pricing Manage Billing). Returns false if session missing or request fails. */
export async function openManageBillingPortal(): Promise<boolean> {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return false;
  const returnUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}${window.location.pathname}${window.location.search}`
      : "";
  try {
    const res = await fetch(`${API_URL}/api/billing/customer-portal/session`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ return_url: returnUrl }),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { url?: string };
    if (body.url) {
      window.location.assign(body.url);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}
