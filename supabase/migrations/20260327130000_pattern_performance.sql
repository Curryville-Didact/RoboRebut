-- Phase 5.0 — Aggregated pattern performance for adaptive preference (Phase 4.9).

create table if not exists public.pattern_performance (
  pattern_key text primary key,
  generated_count integer not null default 0,
  saved_count integer not null default 0,
  save_rate double precision not null default 0,
  last_generated_at timestamptz,
  last_saved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pattern_performance_updated_at_idx
  on public.pattern_performance (updated_at desc);

comment on table public.pattern_performance is 'Aggregated counts per analytics patternKey for Phase 4.9 preference scoring.';

-- Atomic increments + save_rate = saved_count / generated_count (when generated_count > 0).

create or replace function public.pattern_performance_record_generated(
  p_pattern_key text,
  p_at timestamptz default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  ts timestamptz := coalesce(p_at, now());
begin
  insert into public.pattern_performance (
    pattern_key,
    generated_count,
    saved_count,
    save_rate,
    last_generated_at,
    updated_at
  )
  values (p_pattern_key, 1, 0, 0, ts, now())
  on conflict (pattern_key) do update set
    generated_count = pattern_performance.generated_count + 1,
    save_rate = case
      when pattern_performance.generated_count + 1 > 0
      then pattern_performance.saved_count::double precision
        / (pattern_performance.generated_count + 1)::double precision
      else 0
    end,
    last_generated_at = ts,
    updated_at = now();
end;
$$;

create or replace function public.pattern_performance_record_saved(
  p_pattern_key text,
  p_at timestamptz default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  ts timestamptz := coalesce(p_at, now());
begin
  insert into public.pattern_performance (
    pattern_key,
    generated_count,
    saved_count,
    save_rate,
    last_saved_at,
    updated_at
  )
  values (p_pattern_key, 0, 1, 0, ts, now())
  on conflict (pattern_key) do update set
    saved_count = pattern_performance.saved_count + 1,
    save_rate = case
      when pattern_performance.generated_count > 0
      then (pattern_performance.saved_count + 1)::double precision
        / pattern_performance.generated_count::double precision
      else 0
    end,
    last_saved_at = ts,
    updated_at = now();
end;
$$;

grant execute on function public.pattern_performance_record_generated(text, timestamptz) to service_role;
grant execute on function public.pattern_performance_record_saved(text, timestamptz) to service_role;

alter table public.pattern_performance enable row level security;

-- Backend uses service role (bypasses RLS). No public policies required for this phase.
