/**
 * Map a raw `messages` row to stable fields for API responses.
 */
export function normalizeMessage(row: Record<string, unknown>): {
  id: string;
  conversation_id: string;
  user_id: string;
  role: string;
  content: string;
  objection_type: string | null;
  strategy_used: string | null;
  tone_used: string | null;
  structured_reply: Record<string, unknown> | null;
  created_at: string;
} {
  const sr = row["structured_reply"];
  const structured_reply =
    sr != null && typeof sr === "object" && !Array.isArray(sr)
      ? (sr as Record<string, unknown>)
      : null;

  return {
    id: row["id"] != null ? String(row["id"]) : "",
    conversation_id:
      row["conversation_id"] != null ? String(row["conversation_id"]) : "",
    user_id: row["user_id"] != null ? String(row["user_id"]) : "",
    role: typeof row["role"] === "string" ? row["role"] : "",
    content: typeof row["content"] === "string" ? row["content"] : "",
    objection_type:
      row["objection_type"] == null ? null : String(row["objection_type"]),
    strategy_used:
      row["strategy_used"] == null ? null : String(row["strategy_used"]),
    tone_used: row["tone_used"] == null ? null : String(row["tone_used"]),
    structured_reply,
    created_at:
      typeof row["created_at"] === "string" ? row["created_at"] : "",
  };
}
