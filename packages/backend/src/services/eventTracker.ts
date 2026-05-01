import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type TrackableEventName =
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

export type TrackableEventPayload = {
  eventName: TrackableEventName;
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
  ctaGroup?: string;
  metadata?: Record<string, unknown>;
};

const ALLOWED_EVENTS = new Set<string>([
  "signup_page_view",
  "login_page_view",
  "account_created",
  "login_success",
  "dashboard_view",
  "first_conversation_created",
  "first_objection_submitted",
  "first_response_generated",
  "enforcement_prompt_shown",
  "enforcement_prompt_primary_clicked",
  "enforcement_prompt_secondary_clicked",
  "enforcement_prompt_dismissed",
  "pricing_page_view",
  "pricing_starter_click",
  "pricing_pro_click",
  "pricing_team_demo_click",
  "pricing_signin_click",
  "home_pricing_starter_click",
  "home_pricing_pro_click",
  "home_pricing_team_demo_click",
  "upgrade_nudge_shown",
  "upgrade_nudge_clicked",
  "upgrade_nudge_dismissed",
  "tone_locked_click",
  "response_generated",
  "priority_generation_used",
  "saved_response_created",
  "saved_response_copied",
  "review_submitted",
  "integration_created",
  "prelimit_warning_shown",
  "prelimit_cta_clicked",
]);

type LoggerLike = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
};

const MAX_RECENT_EVENTS = 1000;
const recentEvents: Array<TrackableEventPayload & { serverTimestamp: string }> = [];

let cachedSupabase: SupabaseClient | null | undefined;

export function getSupabaseForAnalytics(): SupabaseClient | null {
  if (cachedSupabase !== undefined) return cachedSupabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    cachedSupabase = null;
    return null;
  }
  cachedSupabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cachedSupabase;
}

type AnalyticsDbRow = {
  id: string;
  event_name: string;
  plan_type: string | null;
  surface: string | null;
  cta_label: string | null;
  cta_group: string | null;
  trigger_type: string | null;
  tone: string | null;
  conversation_id: string | null;
  priority_generation: boolean | null;
  response_variants: number | null;
  objection_type: string | null;
  strategy_tag: string | null;
  metadata: Record<string, unknown> | null;
  client_timestamp: string | null;
  created_at: string;
};

function dbRowToClient(
  row: AnalyticsDbRow
): TrackableEventPayload & { serverTimestamp: string } {
  return {
    eventName: row.event_name as TrackableEventName,
    timestamp: row.client_timestamp ?? undefined,
    planType: row.plan_type,
    triggerType: row.trigger_type,
    tone: row.tone,
    conversationId: row.conversation_id,
    priorityGeneration: row.priority_generation ?? undefined,
    responseVariants: row.response_variants,
    objectionType: row.objection_type,
    strategyTag: row.strategy_tag,
    surface: row.surface,
    ctaLabel: row.cta_label ?? undefined,
    ctaGroup: row.cta_group ?? undefined,
    metadata: row.metadata ?? undefined,
    serverTimestamp: row.created_at,
  };
}

export function normalizeTrackingEvent(
  payload: unknown
): (TrackableEventPayload & { serverTimestamp: string }) | null {
  if (!payload || typeof payload !== "object") return null;
  const input = payload as Record<string, unknown>;
  const rawName = input.eventName;
  if (typeof rawName !== "string" || !ALLOWED_EVENTS.has(rawName)) return null;
  const eventName = rawName as TrackableEventName;

  return {
    eventName,
    timestamp:
      typeof input.timestamp === "string"
        ? input.timestamp
        : new Date().toISOString(),
    planType: typeof input.planType === "string" ? input.planType : null,
    triggerType:
      typeof input.triggerType === "string" ? input.triggerType : null,
    tone: typeof input.tone === "string" ? input.tone : null,
    conversationId:
      typeof input.conversationId === "string" ? input.conversationId : null,
    priorityGeneration:
      typeof input.priorityGeneration === "boolean"
        ? input.priorityGeneration
        : undefined,
    responseVariants:
      typeof input.responseVariants === "number"
        ? input.responseVariants
        : null,
    objectionType:
      typeof input.objectionType === "string" ? input.objectionType : null,
    strategyTag:
      typeof input.strategyTag === "string" ? input.strategyTag : null,
    surface: typeof input.surface === "string" ? input.surface : null,
    ctaLabel: typeof input.ctaLabel === "string" ? input.ctaLabel : undefined,
    ctaGroup: typeof input.ctaGroup === "string" ? input.ctaGroup : undefined,
    metadata:
      input.metadata && typeof input.metadata === "object"
        ? (input.metadata as Record<string, unknown>)
        : undefined,
    serverTimestamp: new Date().toISOString(),
  };
}

async function persistAnalyticsEvent(
  supabase: SupabaseClient,
  normalized: TrackableEventPayload & { serverTimestamp: string }
): Promise<void> {
  const { error } = await supabase.from("analytics_events").insert({
    event_name: normalized.eventName,
    plan_type: normalized.planType,
    surface: normalized.surface,
    cta_label: normalized.ctaLabel ?? null,
    cta_group: normalized.ctaGroup ?? null,
    trigger_type: normalized.triggerType ?? null,
    tone: normalized.tone ?? null,
    conversation_id: normalized.conversationId ?? null,
    priority_generation: normalized.priorityGeneration ?? null,
    response_variants: normalized.responseVariants ?? null,
    objection_type: normalized.objectionType ?? null,
    strategy_tag: normalized.strategyTag ?? null,
    metadata: normalized.metadata ?? null,
    client_timestamp: normalized.timestamp ?? null,
  });
  if (error) throw error;
}

export function trackEvent(
  logger: LoggerLike,
  payload: unknown,
  options?: { supabase?: SupabaseClient | null }
): { ok: true } | { ok: false } {
  const normalized = normalizeTrackingEvent(payload);
  if (!normalized) {
    logger.warn({ payload }, "analytics event rejected");
    return { ok: false };
  }

  recentEvents.unshift(normalized);
  if (recentEvents.length > MAX_RECENT_EVENTS) {
    recentEvents.length = MAX_RECENT_EVENTS;
  }

  const client = options?.supabase ?? getSupabaseForAnalytics();
  if (client) {
    void persistAnalyticsEvent(client, normalized).catch((err) => {
      logger.warn({ err }, "analytics event persist failed");
    });
  }

  logger.info({ analyticsEvent: normalized }, "analytics event received");
  return { ok: true };
}

export type EventQuery = {
  eventName?: string;
  planType?: string;
  ctaGroup?: string;
  limit?: number;
};

export async function getRecentEvents(query?: EventQuery) {
  const supabase = getSupabaseForAnalytics();
  if (supabase) {
    let q = supabase
      .from("analytics_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(Math.min(normalizeLimit(query?.limit), MAX_RECENT_EVENTS));
    if (query?.eventName) q = q.eq("event_name", query.eventName);
    if (query?.planType) q = q.eq("plan_type", query.planType);
    if (query?.ctaGroup) q = q.eq("cta_group", query.ctaGroup);
    const { data, error } = await q;
    if (!error && data != null) {
      return (data as AnalyticsDbRow[]).map(dbRowToClient);
    }
    if (error) {
      console.warn("[eventTracker] getRecentEvents db error", error);
    }
  }

  const filtered = recentEvents.filter((event) => {
    if (query?.eventName && event.eventName !== query.eventName) return false;
    if (query?.planType && event.planType !== query.planType) return false;
    if (query?.ctaGroup && event.ctaGroup !== query.ctaGroup) return false;
    return true;
  });

  return filtered.slice(0, normalizeLimit(query?.limit));
}

type SummaryPayload = {
  totalEvents: number;
  countsByEventName: Record<string, number>;
  countsByCtaLabel: Record<string, number>;
  countsByCtaGroup: Record<string, number>;
  countsByPlanType: Record<string, number>;
};

function coerceNumberRecord(
  raw: Record<string, unknown> | undefined
): Record<string, number> {
  if (!raw) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "number" && !Number.isNaN(v)) out[k] = v;
    else if (typeof v === "string") {
      const n = Number(v);
      if (!Number.isNaN(n)) out[k] = n;
    }
  }
  return out;
}

export async function getAnalyticsSummary(query?: EventQuery) {
  const supabase = getSupabaseForAnalytics();
  if (supabase) {
    const { data, error } = await supabase.rpc("roborebut_analytics_summary", {
      p_event_name: query?.eventName ?? null,
      p_plan_type: query?.planType ?? null,
      p_cta_group: query?.ctaGroup ?? null,
    });
    if (!error && data && typeof data === "object") {
      const row = data as Record<string, unknown>;
      return {
        totalEvents: Number(row.totalEvents) || 0,
        countsByEventName: coerceNumberRecord(
          row.countsByEventName as Record<string, unknown>
        ),
        countsByCtaLabel: coerceNumberRecord(
          row.countsByCtaLabel as Record<string, unknown>
        ),
        countsByCtaGroup: coerceNumberRecord(
          row.countsByCtaGroup as Record<string, unknown>
        ),
        countsByPlanType: coerceNumberRecord(
          row.countsByPlanType as Record<string, unknown>
        ),
      } satisfies SummaryPayload;
    }
    if (error) {
      console.warn("[eventTracker] getAnalyticsSummary rpc error", error);
    }
  }

  const events = recentEvents.filter((event) => {
    if (query?.eventName && event.eventName !== query.eventName) return false;
    if (query?.planType && event.planType !== query.planType) return false;
    if (query?.ctaGroup && event.ctaGroup !== query.ctaGroup) return false;
    return true;
  });

  const countsByEventName = countBy(events, (event) => event.eventName);
  const countsByCtaLabel = countBy(
    events.filter((event) => event.ctaLabel != null),
    (event) => event.ctaLabel!
  );
  const countsByCtaGroup = countBy(
    events.filter((event) => event.ctaGroup != null),
    (event) => event.ctaGroup!
  );
  const countsByPlanType = countBy(
    events.filter((event) => event.planType != null),
    (event) => event.planType!
  );

  return {
    totalEvents: events.length,
    countsByEventName,
    countsByCtaLabel,
    countsByCtaGroup,
    countsByPlanType,
  };
}

function countBy<T>(items: T[], getKey: (item: T) => string) {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = getKey(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function normalizeLimit(limit?: number): number {
  if (typeof limit !== "number" || Number.isNaN(limit)) return 100;
  return Math.max(1, Math.min(MAX_RECENT_EVENTS, Math.floor(limit)));
}
