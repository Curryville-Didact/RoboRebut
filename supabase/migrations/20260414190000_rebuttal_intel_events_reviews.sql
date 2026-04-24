-- Phase 7 — Rebuttal intelligence capture + review (Live-safe, offline loop).
--
-- Adds:
-- - public.rebuttal_events
-- - public.rebuttal_reviews
--
-- Notes:
-- - Backend writes with service role (bypasses RLS). These tables still enable RLS by default.
-- - Frontend access should go through backend APIs that enforce ownership.

create table if not exists public.rebuttal_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  conversation_id uuid,
  source_mode text not null,
  source_surface text,
  merchant_message text,
  final_live_script text,
  objection_family text,
  objection_type text,
  tone_mode text,
  delivery_mode text,
  confidence_score double precision,
  selected_variant_text text,
  rhetorical_type text,
  situation_label text,
  deal_type text,
  business_name text,
  industry text,
  rep_label text,
  conversation_title text,
  created_at timestamptz not null default now()
);

create index if not exists rebuttal_events_user_created_at_idx
  on public.rebuttal_events (user_id, created_at desc);

create index if not exists rebuttal_events_user_family_idx
  on public.rebuttal_events (user_id, objection_family);

create index if not exists rebuttal_events_user_rhetorical_idx
  on public.rebuttal_events (user_id, rhetorical_type);

create index if not exists rebuttal_events_user_conversation_idx
  on public.rebuttal_events (user_id, conversation_id);

comment on table public.rebuttal_events is
  'Phase 7: passive capture of rebuttal outputs for offline review + analytics (no learning loop).';

alter table public.rebuttal_events enable row level security;

create table if not exists public.rebuttal_reviews (
  id uuid primary key default gen_random_uuid(),
  rebuttal_event_id uuid not null references public.rebuttal_events(id) on delete cascade,
  user_id uuid not null,
  rating integer not null,
  outcome_tag text,
  notes text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rebuttal_reviews_rating_range check (rating >= 1 and rating <= 5)
);

create unique index if not exists rebuttal_reviews_user_event_unique
  on public.rebuttal_reviews (user_id, rebuttal_event_id);

create index if not exists rebuttal_reviews_user_reviewed_at_idx
  on public.rebuttal_reviews (user_id, reviewed_at desc);

comment on table public.rebuttal_reviews is
  'Phase 7: user QA review for rebuttal_events (rating/outcome/notes).';

alter table public.rebuttal_reviews enable row level security;

-- Refresh PostgREST schema cache
notify pgrst, 'reload schema';

