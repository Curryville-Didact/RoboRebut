/**
 * Phase 5.2 — Pattern intelligence surfaced from POST /api/messages (not persisted server-side).
 * Client + sessionStorage keeps intel keyed by assistant message id for the current session.
 */

export type PatternInsightsClient = {
  selectedPatternKey: string;
  confidenceLevel: "high" | "medium" | "low";
  reason: string;
  stats?: {
    saveRate: number;
    sampleSize: number;
  };
  note?: string;
};

/** Optional metadata for an assistant turn (may be partial). */
export type AssistantMessageIntel = {
  patternInsights?: PatternInsightsClient;
  explanation?: string;
  /** Phase 5.3 — deterministic framing line from objection category. */
  coachInsight?: string;
};

const storageKey = (conversationId: string) =>
  `roborebut:assistant-intel:${conversationId}`;

export function loadAssistantIntelMap(
  conversationId: string
): Record<string, AssistantMessageIntel> {
  if (typeof window === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(storageKey(conversationId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, AssistantMessageIntel>;
  } catch {
    return {};
  }
}

export function persistAssistantIntelEntry(
  conversationId: string,
  messageId: string,
  intel: AssistantMessageIntel
): void {
  if (typeof window === "undefined") return;
  try {
    const map = loadAssistantIntelMap(conversationId);
    map[messageId] = intel;
    sessionStorage.setItem(storageKey(conversationId), JSON.stringify(map));
  } catch {
    /* quota or private mode */
  }
}

export function pruneAssistantIntelToMessageIds(
  conversationId: string,
  messageIds: Set<string>
): Record<string, AssistantMessageIntel> {
  const full = loadAssistantIntelMap(conversationId);
  const next: Record<string, AssistantMessageIntel> = {};
  for (const id of messageIds) {
    if (full[id]) next[id] = full[id]!;
  }
  if (Object.keys(next).length !== Object.keys(full).length) {
    try {
      sessionStorage.setItem(storageKey(conversationId), JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }
  return next;
}
