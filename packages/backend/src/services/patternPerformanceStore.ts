/**
 * Phase 5.0 — Persistent aggregates for pattern analytics (feeds Phase 4.9 PatternStatsProvider).
 * Pre-5.1 — Receipts (ingestion) + applied_events inside RPC (aggregation idempotency); RPC safe to retry.
 *
 * Expected Supabase objects (if missing, writes/reads degrade safely):
 * - Table `pattern_performance` — read by `getPatternStats` (empty object on failure).
 * - Table `pattern_performance_event_receipts` — dedupe receipts for aggregation RPCs.
 * - Table `pattern_performance_applied_events` — optional read for integrity helpers.
 * - RPCs `pattern_performance_record_generated`, `pattern_performance_record_saved` — called after receipt insert;
 *   RPC errors are logged; live messaging continues.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PatternAnalyticsEvent } from "./patternAnalytics.js";
import type {
  PatternPerformanceStats,
  PatternStatsProvider,
} from "./patternPreference.js";

export type PatternAggregateRecordResult = {
  applied: boolean;
  reason: "applied" | "error";
};

function isUniqueViolation(err: { code?: string; message?: string }): boolean {
  return (
    err.code === "23505" ||
    (typeof err.message === "string" &&
      /duplicate key|unique constraint/i.test(err.message))
  );
}

/**
 * eventId is required for dedupe correctness; do not pass null/undefined through to RPCs.
 * Blank/whitespace-only values fail closed (warn + no RPC) so p_event_id is never used to bypass applied_events.
 */
function validateAggregationEventId(
  eventId: string | undefined | null,
  context: string
): string | null {
  const trimmed = typeof eventId === "string" ? eventId.trim() : "";
  if (!trimmed) {
    console.warn(
      `[patternPerformanceStore] missing or blank eventId (${context}); skipping aggregation — dedupe requires a non-empty eventId`
    );
    return null;
  }
  return trimmed;
}

function validatePatternKey(patternKey: string | undefined | null, context: string): string | null {
  const trimmed = typeof patternKey === "string" ? patternKey.trim() : "";
  if (!trimmed) {
    console.warn(
      `[patternPerformanceStore] missing or blank patternKey (${context}); skipping aggregation`
    );
    return null;
  }
  return trimmed;
}

/**
 * 1) Insert ingestion receipt (audit / first-line dedupe).
 * 2) Call idempotent RPC with eventId: applied_events + aggregate in one DB transaction.
 * Duplicate receipt (retries) still invokes RPC so a failed first attempt can converge.
 */
export async function recordPatternGenerated(
  supabase: SupabaseClient | null | undefined,
  eventId: string,
  patternKey: string,
  createdAt?: string,
  conversationId?: string | null
): Promise<PatternAggregateRecordResult> {
  if (!supabase) {
    return { applied: false, reason: "error" };
  }
  const id = validateAggregationEventId(eventId, "recordPatternGenerated");
  const pk = validatePatternKey(patternKey, "recordPatternGenerated");
  if (!id || !pk) {
    return { applied: false, reason: "error" };
  }
  try {
    const { error: receiptErr } = await supabase
      .from("pattern_performance_event_receipts")
      .insert({
        event_id: id,
        event_type: "response_generated",
        pattern_key: pk,
        conversation_id: conversationId?.trim() || null,
      });

    if (receiptErr) {
      if (isUniqueViolation(receiptErr)) {
        console.info(
          `[patternPerformanceStore] duplicate receipt for eventId=${id} (response_generated); idempotent RPC`
        );
      } else {
        throw receiptErr;
      }
    }

    const at = createdAt ?? new Date().toISOString();
    const { error: aggErr } = await supabase.rpc(
      "pattern_performance_record_generated",
      {
        p_pattern_key: pk,
        p_at: at,
        p_event_id: id,
      }
    );
    if (aggErr) {
      console.warn(
        `[patternPerformanceStore] recordPatternGenerated RPC failed eventId=${id}`,
        aggErr
      );
      return { applied: false, reason: "error" };
    }
    return { applied: true, reason: "applied" };
  } catch (e) {
    console.warn("[patternPerformanceStore] recordPatternGenerated failed", e);
    return { applied: false, reason: "error" };
  }
}

export async function recordPatternSaved(
  supabase: SupabaseClient | null | undefined,
  eventId: string,
  patternKey: string,
  createdAt?: string,
  conversationId?: string | null
): Promise<PatternAggregateRecordResult> {
  if (!supabase) {
    return { applied: false, reason: "error" };
  }
  const id = validateAggregationEventId(eventId, "recordPatternSaved");
  const pk = validatePatternKey(patternKey, "recordPatternSaved");
  if (!id || !pk) {
    return { applied: false, reason: "error" };
  }
  try {
    const { error: receiptErr } = await supabase
      .from("pattern_performance_event_receipts")
      .insert({
        event_id: id,
        event_type: "response_saved",
        pattern_key: pk,
        conversation_id: conversationId?.trim() || null,
      });

    if (receiptErr) {
      if (isUniqueViolation(receiptErr)) {
        console.info(
          `[patternPerformanceStore] duplicate receipt for eventId=${id} (response_saved); idempotent RPC`
        );
      } else {
        throw receiptErr;
      }
    }

    const at = createdAt ?? new Date().toISOString();
    const { error: aggErr } = await supabase.rpc(
      "pattern_performance_record_saved",
      {
        p_pattern_key: pk,
        p_at: at,
        p_event_id: id,
      }
    );
    if (aggErr) {
      console.warn(
        `[patternPerformanceStore] recordPatternSaved RPC failed eventId=${id}`,
        aggErr
      );
      return { applied: false, reason: "error" };
    }
    return { applied: true, reason: "applied" };
  } catch (e) {
    console.warn("[patternPerformanceStore] recordPatternSaved failed", e);
    return { applied: false, reason: "error" };
  }
}

/**
 * Preferred call path: passes through fields from {@link PatternAnalyticsEvent} so eventId cannot be dropped accidentally.
 */
export async function recordPatternGeneratedFromAnalyticsEvent(
  supabase: SupabaseClient | null | undefined,
  event: PatternAnalyticsEvent
): Promise<PatternAggregateRecordResult> {
  if (event.eventType !== "response_generated") {
    console.warn(
      `[patternPerformanceStore] expected response_generated, got ${event.eventType}; skipping aggregation`
    );
    return { applied: false, reason: "error" };
  }
  return recordPatternGenerated(
    supabase,
    event.eventId,
    event.patternKey,
    event.createdAt,
    event.conversationId
  );
}

export async function recordPatternSavedFromAnalyticsEvent(
  supabase: SupabaseClient | null | undefined,
  event: PatternAnalyticsEvent
): Promise<PatternAggregateRecordResult> {
  if (event.eventType !== "response_saved") {
    console.warn(
      `[patternPerformanceStore] expected response_saved, got ${event.eventType}; skipping aggregation`
    );
    return { applied: false, reason: "error" };
  }
  return recordPatternSaved(
    supabase,
    event.eventId,
    event.patternKey,
    event.createdAt,
    event.conversationId
  );
}

/** Row shape from `pattern_performance_event_receipts` (minimal fields for integrity / replay). */
export type PatternPerformanceReceiptRow = {
  event_id: string;
  event_type: string;
  pattern_key: string;
  conversation_id: string | null;
  created_at: string;
};

/** Row shape from `pattern_performance_applied_events`. */
export type PatternPerformanceAppliedRow = {
  event_id: string;
  pattern_key: string;
  event_type: string;
  applied_at: string;
};

export async function getPatternPerformanceReceiptByEventId(
  supabase: SupabaseClient,
  eventId: string
): Promise<PatternPerformanceReceiptRow | null> {
  const id = eventId.trim();
  if (!id) return null;
  const { data, error } = await supabase
    .from("pattern_performance_event_receipts")
    .select("event_id, event_type, pattern_key, conversation_id, created_at")
    .eq("event_id", id)
    .maybeSingle();
  if (error) {
    console.warn(
      "[patternPerformanceStore] getPatternPerformanceReceiptByEventId failed",
      error
    );
    return null;
  }
  return data as PatternPerformanceReceiptRow | null;
}

/** Alias: full receipt payload for replay (same as {@link getPatternPerformanceReceiptByEventId}). */
export async function getPatternPerformanceReceiptPayloadByEventId(
  supabase: SupabaseClient,
  eventId: string
): Promise<PatternPerformanceReceiptRow | null> {
  return getPatternPerformanceReceiptByEventId(supabase, eventId);
}

export async function getPatternPerformanceAppliedEventByEventId(
  supabase: SupabaseClient,
  eventId: string
): Promise<PatternPerformanceAppliedRow | null> {
  const id = eventId.trim();
  if (!id) return null;
  const { data, error } = await supabase
    .from("pattern_performance_applied_events")
    .select("event_id, pattern_key, event_type, applied_at")
    .eq("event_id", id)
    .maybeSingle();
  if (error) {
    console.warn(
      "[patternPerformanceStore] getPatternPerformanceAppliedEventByEventId failed",
      error
    );
    return null;
  }
  return data as PatternPerformanceAppliedRow | null;
}

export async function getPatternStats(
  supabase: SupabaseClient,
  patternKeys: string[]
): Promise<Record<string, PatternPerformanceStats>> {
  if (patternKeys.length === 0) return {};
  try {
    const { data, error } = await supabase
      .from("pattern_performance")
      .select("pattern_key, generated_count, saved_count, save_rate")
      .in("pattern_key", patternKeys);

    if (error) {
      console.warn(
        "[patternPerformanceStore] getPatternStats query failed (degrading to empty stats)",
        error
      );
      return {};
    }

    const out: Record<string, PatternPerformanceStats> = {};
    for (const row of data ?? []) {
      const rec = row as {
        pattern_key: string;
        generated_count: number;
        saved_count: number;
        save_rate: number;
      };
      out[rec.pattern_key] = {
        patternKey: rec.pattern_key,
        generatedCount: Number(rec.generated_count ?? 0),
        savedCount: Number(rec.saved_count ?? 0),
        saveRate: Number(rec.save_rate ?? 0),
      };
    }
    return out;
  } catch (e) {
    console.warn(
      "[patternPerformanceStore] getPatternStats failed (degrading to empty stats)",
      e
    );
    return {};
  }
}

/**
 * Real stats for Phase 4.9. On read failure or missing client, returns {} (same as default no-op).
 */
export function createPatternStatsProvider(
  supabase: SupabaseClient | null | undefined
): PatternStatsProvider {
  return {
    async getStats(patternKeys: string[]) {
      if (!supabase) return {};
      try {
        return await getPatternStats(supabase, patternKeys);
      } catch (e) {
        console.warn("[patternPerformanceStore] getStats failed", e);
        return {};
      }
    },
  };
}
