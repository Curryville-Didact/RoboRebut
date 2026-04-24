/**
 * Phase 5.3 — Pick a single clipboard-friendly script from assistant coaching text (heuristic).
 */

export function extractPrimaryRebuttalScript(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return "";

  const lower = trimmed.toLowerCase();
  const rebuttalIdx = lower.search(/\brebuttal[s]?\b/);
  if (rebuttalIdx !== -1) {
    const fromRebut = trimmed.slice(rebuttalIdx);
    const afterLabel = fromRebut.replace(/^\s*rebuttal[s]?\s*[1-9.:)\-]?\s*/i, "");
    const firstChunk = afterLabel.split(/\n\n+/)[0]?.trim() ?? afterLabel.trim();
    const firstLineRun = firstChunk
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .join(" ");
    if (firstLineRun.length >= 25) return firstLineRun.slice(0, 1500);
  }

  const blocks = trimmed.split(/\n\n+/);
  for (const block of blocks) {
    const compact = block.replace(/\s+/g, " ").trim();
    if (compact.length < 35) continue;
    if (/^coach note|^follow-?up|^---|^#+\s/i.test(compact)) continue;
    return compact.slice(0, 1500);
  }

  return trimmed.slice(0, 1500);
}
