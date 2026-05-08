"use server";

import { API_URL } from "@/lib/env";
import { safeFetch } from "@/lib/safeFetch";

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
  type Resp = { ok?: boolean };
  const fallback: Resp = {};
  const { data, error } = await safeFetch<Resp>(
    url,
    { method: "POST", body: JSON.stringify(input) },
    fallback
  );
  if (error) return { ok: false, error };
  if (data?.ok !== true) return { ok: false, error: "Sync failed" };
  return { ok: true };
}
