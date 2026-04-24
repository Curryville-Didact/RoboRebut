/**
 * Robust structured-reply presence for Saved Responses filtering.
 * Prefer explicit metadata; fall back to lightweight content markers (legacy rows).
 */

import type { AssistantStructuredReply } from "@/types/assistantStructuredReply";
import { parseStructuredReplySafe } from "@/lib/parseStructuredReply";

/** True when parsed structured reply carries at least one coach-visible signal (not an empty object). */
export function structuredReplyHasMeaningfulPayload(
  parsed: AssistantStructuredReply | null
): boolean {
  if (!parsed) return false;
  /** Live-mode turns persist coachReplyMode even when arrays are still hydrating. */
  if (parsed.coachReplyMode === "live") return true;
  const lines = parsed.liveOpeningLines?.filter((x) => typeof x === "string" && x.trim()) ?? [];
  if (lines.length > 0) return true;
  const rb = parsed.rebuttals?.filter((r) => r?.sayThis?.trim()) ?? [];
  if (rb.length > 0) return true;
  if (parsed.callReadyLine?.trim()) return true;
  if (parsed.coachNote?.trim()) return true;
  if (parsed.followUp?.trim()) return true;
  if (parsed.precallWhatTheyReallyMean?.trim()) return true;
  if (parsed.precallLane1?.trim()) return true;
  if (parsed.precallLane2?.trim()) return true;
  if (parsed.merchantMeaning?.trim()) return true;
  return false;
}

/**
 * Legacy bodies sometimes embed section headings without JSON metadata.
 * Line-aware patterns reduce false positives on arbitrary prose.
 */
const LEGACY_SECTION_HEADINGS = [
  /^what\s+they\s+really\s+mean\b/i,
  /^lane\s*1\b/i,
  /^lane\s*2\b/i,
  /^call-ready\s+line\b/i,
  /^coach\s+note\b/i,
  /^follow[-\s]?up\b/i,
] as const;

export function contentHasLegacyStructuredMarkers(content: string | null | undefined): boolean {
  if (content == null || typeof content !== "string") return false;
  const t = content.trim();
  if (!t) return false;
  const lines = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const hits = new Set<string>();
  for (const line of lines) {
    for (const re of LEGACY_SECTION_HEADINGS) {
      if (re.test(line)) {
        hits.add(String(re));
        break;
      }
    }
    if (hits.size >= 2) return true;
  }
  return false;
}

function hasMeaningfulStructuredMetadataFragments(
  metadata: Record<string, unknown> | null | undefined
): boolean {
  if (!metadata) return false;
  const keys = [
    "whatTheyReallyMean",
    "lane1",
    "lane2",
    "callReadyLine",
    "coachNote",
    "followUp",
  ] as const;
  for (const k of keys) {
    const v = metadata[k];
    if (typeof v === "string" && v.trim().length > 0) return true;
  }
  return false;
}

export function detectStructuredReplyPresence(
  metadata: Record<string, unknown> | null | undefined,
  content: string
): boolean {
  const raw = metadata?.structured_reply;
  const parsed = parseStructuredReplySafe(raw);
  if (structuredReplyHasMeaningfulPayload(parsed)) return true;
  if (hasMeaningfulStructuredMetadataFragments(metadata)) return true;
  return contentHasLegacyStructuredMarkers(content);
}
