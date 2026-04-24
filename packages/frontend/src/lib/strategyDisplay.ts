/**
 * Deterministic, presentation-only label for internal strategy tags.
 *
 * The app historically persisted raw concatenated strategy strings (e.g. "unknown::assertive_opportunity::...").
 * Saved Responses should display a short, readable label without changing generation behavior.
 */
export function formatStrategyLabel(
  raw: string | null | undefined
): string | null {
  const input = typeof raw === "string" ? raw.trim() : "";
  if (!input) return null;

  const tokens = input
    .split("::")
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => t.toLowerCase() !== "unknown");

  if (tokens.length === 0) return null;

  // Prefer first meaningful token; keep it concise for pill/chip UI.
  const primary = tokens[0]!;

  const toTitleWords = (s: string): string =>
    s
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");

  const label = toTitleWords(primary);
  return label || null;
}

