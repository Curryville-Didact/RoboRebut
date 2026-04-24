export function founderEmailAllowlist(): string[] {
  const raw = process.env.NEXT_PUBLIC_FOUNDER_EMAILS?.trim();
  if (raw) {
    return raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  }
  // Deterministic fallback (safe default = hidden for everyone else).
  return ["admin@getrebut.ai"];
}

export function isFounderEmail(email: string | null | undefined): boolean {
  const e = (email ?? "").trim().toLowerCase();
  if (!e) return false;
  return founderEmailAllowlist().includes(e);
}

