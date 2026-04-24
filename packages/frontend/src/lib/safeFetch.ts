// IMPORTANT:
// Never allow server-component fetches to throw.
// Always return fallback data to prevent dashboard crashes.

export async function safeFetchJSON<T>(
  url: string,
  fallback: T
): Promise<{ data: T; error: string | null }> {
  try {
    const res = await fetch(url, { cache: "no-store" });
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
