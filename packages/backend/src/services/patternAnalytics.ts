/**
 * Phase 4.8 — Structured telemetry for objection-response patterns (observability only).
 */

import { randomUUID } from "node:crypto";

export type PatternAnalyticsEventType =
  | "response_generated"
  | "response_saved";

export interface PatternAnalyticsEvent {
  /** Unique per log line; never reuse across event types or paired generate/save events. */
  eventId: string;
  eventType: PatternAnalyticsEventType;
  conversationId?: string;
  objectionCategory?: string;
  posture?: string;
  dealType?: string | null;
  rebuttalStyle?: string;
  coachNoteStyle?: string;
  followUpStyle?: string;
  confidenceStyle?: string;
  patternKey: string;
  createdAt: string;
}

export type PatternAnalyticsPayload = {
  patternKey: string;
  objectionCategory: string;
  posture: string;
  /** Resolved calculator label (e.g. mca, unknown). */
  dealType: string;
  rebuttalStyle: string;
  coachNoteStyle: string;
  followUpStyle: string;
  confidenceStyle: string;
};

export type BuildPatternKeyInput = {
  objectionCategory?: string | null;
  posture?: string | null;
  dealType?: string | null;
  rebuttalStyle?: string | null;
  followUpStyle?: string | null;
  confidenceStyle?: string | null;
};

/**
 * Deterministic key: objectionCategory::posture::dealType::rebuttalStyle::followUpStyle::confidenceStyle
 * (dealType uses "generic" when missing or unknown.)
 */
export function buildPatternKey(input: BuildPatternKeyInput): string {
  const objectionCategory = input.objectionCategory?.trim() || "unknown";
  const posture = input.posture?.trim() || "unknown";
  const rawDeal = input.dealType?.trim();
  const deal =
    !rawDeal || rawDeal === "unknown" ? "generic" : rawDeal;
  const rebuttalStyle = input.rebuttalStyle?.trim() || "unknown";
  const followUpStyle = input.followUpStyle?.trim() || "unknown";
  const confidenceStyle = input.confidenceStyle?.trim() || "unknown";
  return [
    objectionCategory,
    posture,
    deal,
    rebuttalStyle,
    followUpStyle,
    confidenceStyle,
  ].join("::");
}

/** Unique id per analytics event (response_generated vs response_saved each get their own). */
export function newPatternAnalyticsEventId(): string {
  try {
    return randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

export function buildPatternAnalyticsEvent(
  input: Omit<PatternAnalyticsEvent, "createdAt" | "eventId"> & {
    eventId?: string;
  }
): PatternAnalyticsEvent {
  return {
    ...input,
    eventId: input.eventId ?? newPatternAnalyticsEventId(),
    createdAt: new Date().toISOString(),
  };
}

/**
 * Builds a log event from the in-memory snapshot produced at generation time.
 *
 * patternKey integrity (4.9 prep): always pass through `payload.patternKey` unchanged — it was
 * computed once via buildPatternKey in the generate flow. Do not recompute here.
 */
export function eventFromPayload(
  eventType: PatternAnalyticsEventType,
  payload: PatternAnalyticsPayload,
  conversationId?: string | null
): PatternAnalyticsEvent {
  return buildPatternAnalyticsEvent({
    eventType,
    conversationId: conversationId?.trim() || undefined,
    objectionCategory: payload.objectionCategory,
    posture: payload.posture,
    dealType: payload.dealType,
    rebuttalStyle: payload.rebuttalStyle,
    coachNoteStyle: payload.coachNoteStyle,
    followUpStyle: payload.followUpStyle,
    confidenceStyle: payload.confidenceStyle,
    patternKey: payload.patternKey,
  });
}

export function logPatternAnalyticsEvent(event: PatternAnalyticsEvent): void {
  console.info(
    JSON.stringify({
      source: "pattern_analytics",
      ...event,
    })
  );
}
