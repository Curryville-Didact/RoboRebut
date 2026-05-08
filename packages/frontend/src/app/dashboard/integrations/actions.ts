"use server";

import { API_URL } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

function trimSlash(s: string): string {
  return s.replace(/\/$/, "");
}

function publicBackendUrl(): string {
  const raw = process.env.NEXT_PUBLIC_BACKEND_URL?.trim();
  return raw ? trimSlash(raw) : API_URL;
}

export type SyncHubSpotContactResult =
  | { ok: true }
  | { ok: false; error: string };

export async function syncHubSpotContactAction(input: {
  userId: string;
  email: string;
  name: string;
}): Promise<SyncHubSpotContactResult> {
  const url = `${publicBackendUrl()}/api/crm/hubspot/sync-contact`;

  const supabase = await createClient();
  let {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    const { data } = await supabase.auth.refreshSession();
    session = data.session;
  }

  if (!session?.access_token) {
    return { ok: false, error: "Not authenticated" };
  }

  const token = session.access_token;

  let data: unknown = null;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
      cache: "no-store",
    });
    data = await res.json().catch(() => null);
    if (!res.ok) {
      const msg =
        data && typeof data === "object" && data !== null
          ? (data as any)?.error?.message ??
            (data as any)?.error ??
            (data as any)?.message
          : null;
      return { ok: false, error: typeof msg === "string" && msg ? msg : `Request failed: ${res.status}` };
    }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Sync failed",
    };
  }

  if (!data || typeof data !== "object" || (data as any)?.ok !== true) {
    return { ok: false, error: "Sync failed" };
  }

  return { ok: true };
}
