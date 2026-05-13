/**
 * Dual-mode coach output: live call script vs pre-call prep / teaching.
 * Persisted on `messages.structured_reply.coach_reply` as `coachReplyMode` (camelCase in JSON).
 */

export type CoachReplyMode = "live" | "precall" | "roleplay";

export function parseCoachReplyMode(raw: unknown): CoachReplyMode {
  if (raw === "live" || raw === "precall" || raw === "roleplay") return raw;
  if (typeof raw === "string") {
    const s = raw.trim().toLowerCase().replace(/-/g, "_");
    if (s === "precall" || s === "pre_call" || s === "breakdown") return "precall";
    if (s === "live" || s === "live_call") return "live";
    if (s === "roleplay" || s === "role_play") return "roleplay";
  }
  return "live";
}
