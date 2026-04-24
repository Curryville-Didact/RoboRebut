export function asTrimmedString(v: unknown, maxLen: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  if (t.length > maxLen) return t.slice(0, maxLen);
  return t;
}

export function asOptionalTrimmedString(v: unknown, maxLen: number): string | null {
  if (v == null) return null;
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return t.length > maxLen ? t.slice(0, maxLen) : t;
}

export function requireOneOf<T extends readonly string[]>(
  v: unknown,
  allowed: T
): (T[number]) | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return (allowed as readonly string[]).includes(t) ? (t as T[number]) : null;
}

export function asIntInRange(v: unknown, min: number, max: number): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  if (i < min || i > max) return null;
  return i;
}

export function asStringArray(v: unknown, maxItems: number, maxItemLen: number): string[] | null {
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const it of v) {
    if (typeof it !== "string") return null;
    const t = it.trim();
    if (!t) continue;
    out.push(t.length > maxItemLen ? t.slice(0, maxItemLen) : t);
    if (out.length >= maxItems) break;
  }
  return out;
}

