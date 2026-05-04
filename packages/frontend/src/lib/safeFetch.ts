// IMPORTANT:
// Never allow server-component fetches to throw.
// Always return fallback data to prevent dashboard crashes.

import { createClient } from "@/lib/supabase/client";

export async function safeFetchJSON<T>(
  url: string,
  fallback: T
): Promise<{ data: T; error: string | null }> {
  try {
    const supabase = createClient();
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
