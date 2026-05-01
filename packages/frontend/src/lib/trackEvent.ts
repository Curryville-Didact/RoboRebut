"use client";

import { API_URL } from "@/lib/env";

export type TrackEventPayload = {
  eventName:
    | "signup_page_view"
    | "login_page_view"
    | "account_created"
    | "login_success"
    | "dashboard_view"
    | "first_conversation_created"
    | "first_objection_submitted"
    | "first_response_generated"
    | "enforcement_prompt_shown"
    | "enforcement_prompt_primary_clicked"
    | "enforcement_prompt_secondary_clicked"
    | "enforcement_prompt_dismissed"
    | "pricing_page_view"
    | "pricing_starter_click"
    | "pricing_pro_click"
    | "pricing_team_demo_click"
    | "pricing_signin_click"
    | "home_pricing_starter_click"
    | "home_pricing_pro_click"
    | "home_pricing_team_demo_click"
    | "upgrade_nudge_shown"
    | "upgrade_nudge_clicked"
    | "upgrade_nudge_dismissed"
    | "tone_locked_click"
    | "response_generated"
    | "priority_generation_used"
    | "saved_response_created"
    | "saved_response_copied"
    | "review_submitted"
    | "integration_created"
    | "prelimit_warning_shown"
    | "prelimit_cta_clicked";
  timestamp?: string;
  planType?: string | null;
  triggerType?: string | null;
  tone?: string | null;
  conversationId?: string | null;
  priorityGeneration?: boolean;
  responseVariants?: number | null;
  objectionType?: string | null;
  strategyTag?: string | null;
  surface?: string | null;
  ctaLabel?: string;
  ctaGroup?: "tone" | "variants" | "limit" | "post_gen";
  metadata?: Record<string, unknown>;
};

export function trackEvent(payload: TrackEventPayload): void {
  const body = JSON.stringify({
    ...payload,
    timestamp: payload.timestamp ?? new Date().toISOString(),
  });

  try {
    void fetch(`${API_URL}/api/analytics/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // fire-and-forget only
  }
}
