import type { ClientContext } from "../types/clientContext.js";
import type { DealContext } from "../types/dealContext.js";

export type NormalizedConversation = {
  id: string;
  title: string;
  deal_context: DealContext | null;
  client_context: ClientContext | null;
};

/**
 * Map a raw `conversations` row (e.g. from `select("*")`) to stable app fields.
 * Omits reliance on fixed column lists so optional/migrated columns never break reads.
 */
export function normalizeConversation(
  row: Record<string, unknown>
): NormalizedConversation {
  const rawCc = row["client_context"];
  const client_context =
    rawCc != null && typeof rawCc === "object" && !Array.isArray(rawCc)
      ? (rawCc as ClientContext)
      : null;

  return {
    id: row["id"] != null ? String(row["id"]) : "",
    title: typeof row["title"] === "string" ? row["title"] : "",
    deal_context: (row["deal_context"] as DealContext | null) ?? null,
    client_context,
  };
}
