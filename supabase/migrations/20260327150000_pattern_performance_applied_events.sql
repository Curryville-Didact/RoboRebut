-- Pre-5.1 hardening: aggregation idempotency via applied_events + RPC guard (receipts unchanged).

create table if not exists public.pattern_performance_applied_events (
  event_id text primary key,
  pattern_key text not null,
  event_type text not null,
  applied_at timestamptz not null default now()
);

comment on table public.pattern_performance_applied_events is
  'Dedupe gate #2: each event_id applies aggregate increments at most once (receipts = gate #1).';

alter table public.pattern_performance_applied_events enable row level security;

-- Replace 2-arg RPCs with 3-arg versions (p_event_id optional for backward compatibility).

drop function if exists public.pattern_performance_record_generated(text, timestamptz);
drop function if exists public.pattern_performance_record_saved(text, timestamptz);

create or replace function public.pattern_performance_record_generated(
  p_pattern_key text,
  p_at timestamptz default null,
  p_event_id text default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  ts timestamptz := coalesce(p_at, now());
  v_new text;
begin
  if p_event_id is not null then
    insert into public.pattern_performance_applied_events (event_id, pattern_key, event_type)
    values (p_event_id, p_pattern_key, 'response_generated')
    on conflict (event_id) do nothing
    returning event_id into v_new;

    if v_new is null then
      return;
    end if;
  end if;

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
  p_at timestamptz default null,
  p_event_id text default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  ts timestamptz := coalesce(p_at, now());
  v_new text;
begin
  if p_event_id is not null then
    insert into public.pattern_performance_applied_events (event_id, pattern_key, event_type)
    values (p_event_id, p_pattern_key, 'response_saved')
    on conflict (event_id) do nothing
    returning event_id into v_new;

    if v_new is null then
      return;
    end if;
  end if;

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

grant execute on function public.pattern_performance_record_generated(text, timestamptz, text) to service_role;
grant execute on function public.pattern_performance_record_saved(text, timestamptz, text) to service_role;
