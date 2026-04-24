-- Phase 8 — Offline Intelligence Layer (snapshots + run logs).
--
-- Stores offline aggregate performance signals. Does NOT feed back into Live.

create table if not exists public.intelligence_run_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running', -- running | success | error
  rows_processed integer not null default 0,
  snapshot_rows_written integer not null default 0,
  error_summary text,
  created_at timestamptz not null default now()
);

create index if not exists intelligence_run_logs_user_started_at_idx
  on public.intelligence_run_logs (user_id, started_at desc);

comment on table public.intelligence_run_logs is
  'Phase 8: offline intelligence rebuild runs (best-effort, no Live impact).';

alter table public.intelligence_run_logs enable row level security;

create table if not exists public.variant_intelligence_snapshots (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.intelligence_run_logs(id) on delete cascade,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  objection_type text,
  strategy_tag text,
  rhetorical_type text,
  variant_key text,
  usage_count integer not null default 0,
  avg_rating double precision,
  positive_outcome_count integer not null default 0,
  negative_outcome_count integer not null default 0,
  success_rate double precision,
  under_review_flag boolean not null default false,
  recommendation_type text,
  recommendation_reason text,
  metadata jsonb
);

create index if not exists variant_intel_snapshots_user_created_at_idx
  on public.variant_intelligence_snapshots (user_id, created_at desc);

create index if not exists variant_intel_snapshots_user_reco_idx
  on public.variant_intelligence_snapshots (user_id, recommendation_type);

create index if not exists variant_intel_snapshots_user_dims_idx
  on public.variant_intelligence_snapshots (user_id, objection_type, rhetorical_type);

comment on table public.variant_intelligence_snapshots is
  'Phase 8: offline aggregate intelligence snapshots for rebuttal variants (no online learning).';

alter table public.variant_intelligence_snapshots enable row level security;

-- Refresh PostgREST schema cache
notify pgrst, 'reload schema';

