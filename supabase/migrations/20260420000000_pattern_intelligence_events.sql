-- Phase 4.4 — Lean Pattern Intelligence events (deterministic, additive).
-- Stores per-turn pattern dimensions + fingerprints + response signatures for bounded recurrence lookups.

create table if not exists public.pattern_intelligence_events (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  conversation_id text not null,
  turn_id text not null,
  created_at timestamptz not null default now(),

  coach_reply_mode text null,
  deal_type text null,
  objection_family text null,
  objection_type text null,
  tone text null,
  strategy_tag text null,
  pattern_key text null,

  fingerprint text null,
  base_fingerprint text null,
  primary_response_signature text null,
  call_ready_signature text null,

  had_structured_reply boolean null,
  was_saved boolean not null default false,
  confidence_support integer null,

  debug jsonb null,

  constraint pattern_intelligence_events_turn_unique unique (turn_id)
);

create index if not exists pattern_intel_events_user_conv_created_idx
  on public.pattern_intelligence_events (user_id, conversation_id, created_at desc);

create index if not exists pattern_intel_events_fingerprint_created_idx
  on public.pattern_intelligence_events (fingerprint, created_at desc);

create index if not exists pattern_intel_events_base_fingerprint_created_idx
  on public.pattern_intelligence_events (base_fingerprint, created_at desc);

create index if not exists pattern_intel_events_was_saved_idx
  on public.pattern_intelligence_events (was_saved) where was_saved = true;

comment on table public.pattern_intelligence_events is
  'Lean deterministic per-turn pattern intelligence events (Phase 4.4). Written by backend service role only.';

alter table public.pattern_intelligence_events enable row level security;

-- Service role only (backend inserts/updates). Hosted Supabase has service_role; local may not.
do $grant$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant select, insert, update on public.pattern_intelligence_events to service_role';
  end if;
end
$grant$;

