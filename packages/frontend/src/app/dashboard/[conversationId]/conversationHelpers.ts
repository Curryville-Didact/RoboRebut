import type { DealContext } from "@/lib/dealContext";
import type { ClientContext } from "@/lib/clientContext";
import type { AssistantStructuredReply } from "@/types/assistantStructuredReply";
import { effectiveMessageCoachMode } from "@/types/coachReplyMode";

/** Phase 5.3 — matches backend GET/POST usage payload. */
export type UsageSnapshot = {
  used: number;
  limit: number;
  remaining: number;
  blocked: boolean;
  entitlements?: {
    responseVariants?: number;
    priorityGeneration?: boolean;
    advancedStrategies?: boolean;
    advancedToneModes?: boolean;
    structuredDealContext?: boolean;
  };
};

export type BillingSyncEntitlementResponse = {
  ok: boolean;
  status:
    | "synced"
    | "no_change"
    | "unauthenticated"
    | "billing_not_configured"
    | "profile_not_found"
    | "provider_not_ready"
    | "error";
  planType?: string | null;
  entitlements?: Record<string, unknown>;
  usage?: UsageSnapshot;
  message?: string;
};

export interface Conversation {
  id: string;
  title: string;
  deal_context: DealContext | null;
  /** Optional uploaded call transcript stored on the conversation row. */
  call_transcript?: string | null;
  /** Account intelligence JSONB; absent on legacy rows. */
  client_context?: ClientContext | null;
  created_at: string;
  updated_at: string;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  user_id: string;
  role: "user" | "ai";
  content: string;
  created_at: string;
  /** Present when returned from API / DB (optional). */
  objection_type?: string | null;
  strategy_used?: string | null;
  tone_used?: string | null;
  /** Assistant turns: optional JSON from `messages.structured_reply`. */
  structured_reply?: Record<string, unknown> | null;
}

/** Trim, lowercase, collapse spaces to underscores for canonical objection slugs. */
export function normalizeObjectionSlugForHeader(
  value: string | null | undefined
): string | null {
  if (value == null) return null;
  const t = value.trim();
  if (t === "") return null;
  return t.toLowerCase().replace(/\s+/g, "_");
}

export function firstResolvedObjectionSlug(
  ...candidates: (string | null | undefined)[]
): string | null {
  for (const c of candidates) {
    const n = normalizeObjectionSlugForHeader(c);
    if (n) return n;
  }
  return null;
}

/**
 * Thread header chips — TYPE display:
 * Prefer the same human artifact label as precall body (`precallObjectionTypeLabel`) when present;
 * else structured_reply.primaryObjectionType → objectionType → messages.objection_type → "unknown".
 */
export function readPrecallObjectionTypeLabelForHeader(
  parsedStructured: AssistantStructuredReply | null,
  raw: MessageRow["structured_reply"]
): string | null {
  const fromParsed = parsedStructured?.precallObjectionTypeLabel?.trim();
  if (fromParsed) return fromParsed;
  if (raw != null && typeof raw === "object" && !Array.isArray(raw)) {
    const v = (raw as Record<string, unknown>).precallObjectionTypeLabel;
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return null;
}

export function resolveAssistantHeaderMetadata(
  m: MessageRow,
  parsedStructured: AssistantStructuredReply | null
): {
  objectionSlug: string | null;
  /** Same wording as precall “Objection Type” in the card when the artifact supplies it. */
  objectionDisplayOverride: string | null;
  toneSlug: string | null;
} {
  if (effectiveMessageCoachMode(m.structured_reply, parsedStructured) === "live") {
    return { objectionSlug: null, objectionDisplayOverride: null, toneSlug: null };
  }
  const legTone = m.tone_used?.trim() || null;
  const raw = m.structured_reply;

  const parsedPrimary =
    typeof parsedStructured?.primaryObjectionType === "string"
      ? parsedStructured.primaryObjectionType
      : null;
  const parsedObjType =
    typeof parsedStructured?.objectionType === "string"
      ? parsedStructured.objectionType
      : null;
  const rawPrimary =
    raw != null && typeof raw.primaryObjectionType === "string"
      ? raw.primaryObjectionType
      : null;
  const rawObjType =
    raw != null && typeof raw.objectionType === "string"
      ? raw.objectionType
      : null;
  const legObj = m.objection_type?.trim() || null;

  const srObj =
    firstResolvedObjectionSlug(
      parsedPrimary,
      rawPrimary,
      parsedObjType,
      rawObjType,
      legObj
    ) ?? null;

  const objectionDisplayOverride = readPrecallObjectionTypeLabelForHeader(
    parsedStructured,
    raw
  );

  const srTone =
    legTone ??
    (typeof parsedStructured?.toneUsed === "string"
      ? parsedStructured.toneUsed.trim() || null
      : null) ??
    (raw != null && typeof raw.toneUsed === "string"
      ? raw.toneUsed.trim() || null
      : null);

  return {
    objectionSlug: srObj,
    objectionDisplayOverride,
    toneSlug: srTone,
  };
}
