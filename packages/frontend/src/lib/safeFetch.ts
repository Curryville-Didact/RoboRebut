// IMPORTANT:
// Never allow server-component fetches to throw.
// Always return fallback data to prevent dashboard crashes.

import { createClient } from "@/lib/supabase/server";

export async function safeFetchJSON<T>(
  url: string,
  fallback: T
): Promise<{ data: T; error: string | null }> {
  try {
    const supabase = await createClient();
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    const res = await fetch(url, {
      cache: "no-store",
      ...(token
        ? { headers: { Authorization: `Bearer ${token}` } }
        : {}),
    });
    if (!res.ok) throw new Error(`Request failed: ${res.status}`);
    const data = (await res.json()) as T;
    return { data, error: null };
  } catch (err) {
    return {
      data: fallback,
      error:
        err instanceof Error ? err.message : "Data temporarily unavailable",
    };
  }
}

function extractErrorMessage(parsed: unknown, status: number): string {
  let msg = `Request failed: ${status}`;
  if (parsed && typeof parsed === "object") {
    const p = parsed as Record<string, unknown>;
    if (typeof p.message === "string") return p.message;
    if (typeof p.error === "string") return p.error;
    if (p.error && typeof p.error === "object" && p.error !== null) {
      const e = p.error as Record<string, unknown>;
      if (typeof e.message === "string") return e.message;
    }
  }
  return msg;
}

/**
 * Authenticated fetch (Supabase session on the server). Use from Server Components or Server Actions.
 * Merges `Authorization: Bearer <access_token>` and sets JSON Content-Type when a body is present.
 */
export async function safeFetch<T>(
  url: string,
  init: RequestInit,
  fallback: T
): Promise<{ data: T; error: string | null }> {
  try {
    const supabase = await createClient();
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;

    const headers = new Headers(init.headers ?? undefined);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    if (init.body != null && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const res = await fetch(url, {
      ...init,
      cache: "no-store",
      headers,
    });

    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }

    if (!res.ok) {
      return {
        data: fallback,
        error: extractErrorMessage(parsed, res.status),
      };
    }

    return { data: (parsed ?? fallback) as T, error: null };
  } catch (err) {
    return {
      data: fallback,
      error:
        err instanceof Error ? err.message : "Data temporarily unavailable",
    };
  }
}
