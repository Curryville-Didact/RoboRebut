/**
 * Next inlines `NEXT_PUBLIC_*` at build time. Treat empty string as unset — a common `.env` mistake
 * that otherwise yields `${""}/api/...` and breaks API/checkout URLs.
 */
export function readNextPublicString(name: string, fallback: string): string {
  const raw = process.env[name];
  if (raw === undefined || raw === null) return fallback;
  const t = String(raw).trim();
  return t === "" ? fallback : t;
}
