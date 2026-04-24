/**
 * Phase 5.1 — Internal integrity inspection + safe replay for pattern analytics (ops / repair).
 * Sits on top of Phase 5.0 receipts + applied_events; does not change user-facing APIs.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PatternAnalyticsEvent } from "./patternAnalytics.js";
import {
  getPatternPerformanceAppliedEventByEventId,
  getPatternPerformanceReceiptPayloadByEventId,
  type PatternPerformanceReceiptRow,
  recordPatternGeneratedFromAnalyticsEvent,
  recordPatternSavedFromAnalyticsEvent,
} from "./patternPerformanceStore.js";

export type PatternEventProcessingStatus =
  | "applied"
  | "duplicate"
  | "received_not_applied"
  | "missing"
  | "invalid";

export interface PatternEventIntegrityResult {
  eventId: string;
  status: PatternEventProcessingStatus;
  receiptExists: boolean;
  appliedExists: boolean;
  recommendation: "no_action" | "safe_replay" | "investigate";
  details?: string[];
}

export interface PatternEventReplayResult {
  eventId: string;
  attempted: boolean;
  applied: boolean;
  reason:
    | "applied"
    | "duplicate"
    | "invalid_event_id"
    | "missing_payload"
    | "error";
  details?: string[];
}

function receiptToMinimalAnalyticsEvent(
  receipt: PatternPerformanceReceiptRow
): PatternAnalyticsEvent {
  return {
    eventId: receipt.event_id,
    eventType: receipt.event_type as PatternAnalyticsEvent["eventType"],
    patternKey: receipt.pattern_key,
    createdAt: receipt.created_at,
    conversationId: receipt.conversation_id ?? undefined,
  };
}

/**
 * Compare receipt vs applied_events for a single analytics eventId.
 */
export async function inspectPatternAnalyticsEventIntegrity(
  supabase: SupabaseClient | null | undefined,
  eventId: string
): Promise<PatternEventIntegrityResult> {
  const id = typeof eventId === "string" ? eventId.trim() : "";
  if (!id) {
    return {
      eventId: "",
      status: "invalid",
      receiptExists: false,
      appliedExists: false,
      recommendation: "investigate",
      details: ["eventId is blank or whitespace-only"],
    };
  }

  if (!supabase) {
    return {
      eventId: id,
      status: "invalid",
      receiptExists: false,
      appliedExists: false,
      recommendation: "investigate",
      details: ["Supabase client is missing"],
    };
  }

  try {
    const [receipt, applied] = await Promise.all([
      getPatternPerformanceReceiptPayloadByEventId(supabase, id),
      getPatternPerformanceAppliedEventByEventId(supabase, id),
    ]);

    const receiptExists = receipt != null;
    const appliedExists = applied != null;

    if (receiptExists && appliedExists) {
      return {
        eventId: id,
        status: "applied",
        receiptExists: true,
        appliedExists: true,
        recommendation: "no_action",
        details: [
          "Receipt and applied_events rows both present; aggregate was applied for this eventId.",
        ],
      };
    }

    if (receiptExists && !appliedExists) {
      return {
        eventId: id,
        status: "received_not_applied",
        receiptExists: true,
        appliedExists: false,
        recommendation: "safe_replay",
        details: [
          "Receipt exists but applied_events row is missing (e.g. RPC failed after receipt). Safe to re-run store aggregation for this eventId.",
        ],
      };
    }

    if (!receiptExists && appliedExists) {
      return {
        eventId: id,
        status: "duplicate",
        receiptExists: false,
        appliedExists: true,
        recommendation: "investigate",
        details: [
          "applied_events row exists without a matching receipt — inconsistent state; manual review recommended.",
        ],
      };
    }

    return {
      eventId: id,
      status: "missing",
      receiptExists: false,
      appliedExists: false,
      recommendation: "investigate",
      details: [
        "No receipt and no applied_events row for this eventId (never ingested or fully rolled back).",
      ],
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      eventId: id,
      status: "invalid",
      receiptExists: false,
      appliedExists: false,
      recommendation: "investigate",
      details: [`inspect failed: ${msg}`],
    };
  }
}

/**
 * Re-run aggregation only when integrity recommends safe_replay (receipt without applied row).
 * Uses {@link recordPatternGeneratedFromAnalyticsEvent} / {@link recordPatternSavedFromAnalyticsEvent} only.
 */
export async function replayPatternAnalyticsEventIfSafe(
  supabase: SupabaseClient | null | undefined,
  eventId: string
): Promise<PatternEventReplayResult> {
  const id = typeof eventId === "string" ? eventId.trim() : "";
  if (!id) {
    return {
      eventId: "",
      attempted: false,
      applied: false,
      reason: "invalid_event_id",
      details: ["eventId is blank"],
    };
  }

  const integrity = await inspectPatternAnalyticsEventIntegrity(supabase, id);

  if (integrity.recommendation === "no_action" && integrity.status === "applied") {
    return {
      eventId: id,
      attempted: false,
      applied: true,
      reason: "applied",
      details: ["Event already fully applied; no replay needed"],
    };
  }

  if (integrity.recommendation !== "safe_replay") {
    const reason: PatternEventReplayResult["reason"] =
      integrity.status === "duplicate" ? "duplicate" : "error";
    return {
      eventId: id,
      attempted: false,
      applied: false,
      reason,
      details: integrity.details,
    };
  }

  if (!supabase) {
    return {
      eventId: id,
      attempted: false,
      applied: false,
      reason: "error",
      details: ["Supabase client is missing"],
    };
  }

  const receipt = await getPatternPerformanceReceiptPayloadByEventId(supabase, id);
  if (!receipt?.event_type?.trim() || !receipt.pattern_key?.trim()) {
    return {
      eventId: id,
      attempted: false,
      applied: false,
      reason: "missing_payload",
      details: ["Receipt row missing event_type or pattern_key"],
    };
  }

  const event = receiptToMinimalAnalyticsEvent(receipt);

  try {
    const result =
      receipt.event_type === "response_generated"
        ? await recordPatternGeneratedFromAnalyticsEvent(supabase, event)
        : receipt.event_type === "response_saved"
          ? await recordPatternSavedFromAnalyticsEvent(supabase, event)
          : null;

    if (result === null) {
      return {
        eventId: id,
        attempted: true,
        applied: false,
        reason: "error",
        details: [`Unknown event_type: ${receipt.event_type}`],
      };
    }

    return {
      eventId: id,
      attempted: true,
      applied: result.applied,
      reason: result.applied ? "applied" : "error",
      details: result.applied
        ? ["Store aggregation completed (idempotent RPC)"]
        : ["Store aggregation returned applied: false"],
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      eventId: id,
      attempted: true,
      applied: false,
      reason: "error",
      details: [msg],
    };
  }
}

/*
 * Internal ops example (no public route in this phase):
 *   const s = await inspectPatternAnalyticsEventIntegrity(supabase, eventId);
 *   if (s.recommendation === "safe_replay") {
 *     await replayPatternAnalyticsEventIfSafe(supabase, eventId);
 *   }
 */
