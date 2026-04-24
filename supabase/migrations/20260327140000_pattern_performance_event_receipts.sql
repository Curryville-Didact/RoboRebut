-- Pre-5.1 — Idempotent aggregation: one row per analytics eventId before incrementing pattern_performance.

create table if not exists public.pattern_performance_event_receipts (
  event_id text primary key,
  event_type text not null,
  pattern_key text not null,
  conversation_id text null,
  created_at timestamptz not null default now()
);

create index if not exists pattern_performance_event_receipts_pattern_key_idx
  on public.pattern_performance_event_receipts (pattern_key);

comment on table public.pattern_performance_event_receipts is 'Dedupe gate for pattern_performance increments: each eventId applied at most once.';

alter table public.pattern_performance_event_receipts enable row level security;
