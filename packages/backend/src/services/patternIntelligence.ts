import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

type PatternIntelInsert = {
  user_id: string;
  conversation_id: string;
  turn_id: string;
  created_at?: string;

  coach_reply_mode?: string | null;
  deal_type?: string | null;
  objection_family?: string | null;
  objection_type?: string | null;
  tone?: string | null;
  strategy_tag?: string | null;
  pattern_key?: string | null;

  fingerprint?: string | null;
  base_fingerprint?: string | null;
  primary_response_signature?: string | null;
  call_ready_signature?: string | null;

  had_structured_reply?: boolean | null;
  was_saved?: boolean;
  confidence_support?: number | null;
  candidate_count?: number | null;
  unique_pattern_key_count?: number | null;
  score_gap?: number | null;
  runner_up_pattern_key?: string | null;
  anti_repeat_applied?: boolean | null;
  anti_repeat_reason?: string | null;
  dvl_applied?: boolean | null;
  variant_index?: number | null;
  debug?: Record<string, unknown> | null;
};

function normToken(v: string | null | undefined): string {
  return (v ?? "").trim().toLowerCase().replace(/\s+/g, "_");
}

function normText(v: string | null | undefined): string {
  return (v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function buildBaseFingerprint(input: {
  objectionFamily?: string | null;
  objectionType?: string | null;
  tone?: string | null;
  coachReplyMode?: string | null;
  dealType?: string | null;
}): string {
  return [
    normToken(input.objectionFamily) || "unknown",
    normToken(input.objectionType) || "unknown",
    normToken(input.tone) || "default",
    normToken(input.coachReplyMode) || "unknown",
    normToken(input.dealType) || "unknown",
  ].join("|");
}

export function buildFingerprint(input: {
  baseFingerprint: string;
  strategyTag?: string | null;
  patternKey?: string | null;
}): string {
  return [
    input.baseFingerprint,
    normToken(input.strategyTag) || normToken(input.patternKey) || "unknown",
  ].join("|");
}

export function responseSignature(text: string | null | undefined): string | null {
  const t = normText(text);
  if (!t) return null;
  return createHash("sha256").update(t).digest("hex").slice(0, 24);
}

export function extractCallReadyText(input: {
  coachReplyMode: string | null | undefined;
  structuredReply: Record<string, unknown> | null | undefined;
}): string | null {
  const sr = input.structuredReply;
  if (!sr || typeof sr !== "object") return null;
  const direct = typeof (sr as any).callReadyLine === "string" ? (sr as any).callReadyLine : null;
  if (typeof direct === "string" && direct.trim()) return direct.trim();

  // Live mode: use the first live opening line as the on-call “call-ready” proxy when explicit callReadyLine is absent.
  if (String(input.coachReplyMode ?? "") === "live") {
    const lines = (sr as any).liveOpeningLines;
    if (Array.isArray(lines)) {
      const first = lines.find((x: unknown) => typeof x === "string" && x.trim());
      if (typeof first === "string" && first.trim()) return first.trim();
    }
    const sayThis = (sr as any).rebuttals?.[0]?.sayThis;
    if (typeof sayThis === "string" && sayThis.trim()) return sayThis.trim();
  }
  return null;
}

export async function persistPatternIntelEvent(
  supabase: SupabaseClient | null | undefined,
  row: PatternIntelInsert
): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.from("pattern_intelligence_events").insert({
      ...row,
      created_at: row.created_at ?? new Date().toISOString(),
      was_saved: row.was_saved ?? false,
    });
  } catch (e) {
    // Rollout safety: if the table schema is behind (new additive columns missing),
    // retry with the legacy column set so we don't drop the entire event.
    try {
      const {
        candidate_count,
        unique_pattern_key_count,
        score_gap,
        runner_up_pattern_key,
        anti_repeat_applied,
        anti_repeat_reason,
        dvl_applied,
        variant_index,
        ...legacy
      } = row as any;
      await supabase.from("pattern_intelligence_events").insert({
        ...legacy,
        created_at: (row as any).created_at ?? new Date().toISOString(),
        was_saved: (row as any).was_saved ?? false,
      });
    } catch {
      console.warn("[patternIntelligence] persistPatternIntelEvent failed", e);
    }
  }
}

export async function markPatternIntelSaved(
  supabase: SupabaseClient | null | undefined,
  turnId: string
): Promise<void> {
  if (!supabase) return;
  const id = turnId.trim();
  if (!id) return;
  try {
    await supabase
      .from("pattern_intelligence_events")
      .update({ was_saved: true })
      .eq("turn_id", id);
  } catch (e) {
    console.warn("[patternIntelligence] markPatternIntelSaved failed", e);
  }
}

export async function getRecentPatternIntelEvents(
  supabase: SupabaseClient | null | undefined,
  input: { userId: string; conversationId: string; limit: number }
): Promise<
  Array<{
    turn_id: string;
    base_fingerprint: string | null;
    fingerprint: string | null;
    strategy_tag: string | null;
    pattern_key: string | null;
    primary_response_signature: string | null;
    call_ready_signature: string | null;
    created_at: string;
  }>
> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("pattern_intelligence_events")
    .select(
      "turn_id,base_fingerprint,fingerprint,strategy_tag,pattern_key,primary_response_signature,call_ready_signature,created_at"
    )
    .eq("user_id", input.userId)
    .eq("conversation_id", input.conversationId)
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(input.limit, 50)));
  if (error) return [];
  return (data ?? []) as any;
}

