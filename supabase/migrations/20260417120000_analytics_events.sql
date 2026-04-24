-- Product analytics (pricing CTAs, nudges, activation, etc.) — persisted for Founder dashboard.
-- Written only by the backend using the service role (bypasses RLS).

create table if not exists public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  event_name text not null,
  plan_type text,
  surface text,
  cta_label text,
  cta_group text,
  trigger_type text,
  tone text,
  conversation_id text,
  priority_generation boolean,
  response_variants integer,
  objection_type text,
  strategy_tag text,
  metadata jsonb,
  client_timestamp timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists analytics_events_created_at_idx
  on public.analytics_events (created_at desc);

create index if not exists analytics_events_event_name_idx
  on public.analytics_events (event_name);

comment on table public.analytics_events is
  'RoboRebut client/server analytics; backend service role inserts only.';

alter table public.analytics_events enable row level security;

-- Aggregates for GET /api/analytics/summary (matches countsByEventName / CTA / plan filters).
create or replace function public.roborebut_analytics_summary(
  p_event_name text default null,
  p_plan_type text default null,
  p_cta_group text default null
)
returns jsonb
language sql
stable
set search_path = public
as $$
  with filtered as (
    select event_name, plan_type, cta_label, cta_group
    from public.analytics_events e
    where (p_event_name is null or e.event_name = p_event_name)
      and (p_plan_type is null or e.plan_type = p_plan_type)
      and (p_cta_group is null or e.cta_group = p_cta_group)
  ),
  by_event as (
    select event_name, count(*)::int as cnt
    from filtered
    group by event_name
  ),
  by_cta as (
    select cta_label, count(*)::int as cnt
    from filtered
    where cta_label is not null
    group by cta_label
  ),
  by_group as (
    select cta_group, count(*)::int as cnt
    from filtered
    where cta_group is not null
    group by cta_group
  ),
  by_plan as (
    select plan_type, count(*)::int as cnt
    from filtered
    where plan_type is not null
    group by plan_type
  )
  select jsonb_build_object(
    'totalEvents', (select count(*)::bigint from filtered),
    'countsByEventName',
      coalesce(
        (select jsonb_object_agg(event_name, cnt) from by_event),
        '{}'::jsonb
      ),
    'countsByCtaLabel',
      coalesce(
        (select jsonb_object_agg(cta_label, cnt) from by_cta),
        '{}'::jsonb
      ),
    'countsByCtaGroup',
      coalesce(
        (select jsonb_object_agg(cta_group, cnt) from by_group),
        '{}'::jsonb
      ),
    'countsByPlanType',
      coalesce(
        (select jsonb_object_agg(plan_type, cnt) from by_plan),
        '{}'::jsonb
      )
  );
$$;

-- Supabase hosted projects define service_role; local Postgres may not.
do $grant$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.roborebut_analytics_summary(text, text, text) to service_role';
    execute 'grant select, insert on public.analytics_events to service_role';
  end if;
end
$grant$;
