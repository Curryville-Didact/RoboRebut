export type CoachReplyMode = "live" | "precall";

export function parseCoachReplyMode(raw: unknown): CoachReplyMode {
  if (raw === "live" || raw === "precall") return raw;
  if (typeof raw === "string") {
    const s = raw.trim().toLowerCase().replace(/-/g, "_");
    if (s === "precall" || s === "pre_call" || s === "breakdown") return "precall";
    if (s === "live" || s === "live_call") return "live";
  }
  return "live";
}

/** Stored assistant message mode; missing => legacy pre-call rich panels. */
export function effectiveMessageCoachMode(
  structuredReplyRaw: unknown,
  parsed?: { coachReplyMode?: CoachReplyMode } | null
): CoachReplyMode {
  if (parsed?.coachReplyMode === "live" || parsed?.coachReplyMode === "precall") {
    return parsed.coachReplyMode;
  }
  if (
    structuredReplyRaw != null &&
    typeof structuredReplyRaw === "object" &&
    "coachReplyMode" in structuredReplyRaw
  ) {
    return parseCoachReplyMode(
      (structuredReplyRaw as { coachReplyMode?: unknown }).coachReplyMode
    );
  }
  return "precall";
}
