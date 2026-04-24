alter table public.profiles
  add column if not exists plan_type text default 'free' not null,
  add column if not exists usage_count integer default 0 not null,
  add column if not exists usage_reset_at timestamptz default now() not null;

update public.profiles
set
  plan_type = coalesce(plan_type, 'free'),
  usage_count = coalesce(usage_count, 0),
  usage_reset_at = coalesce(usage_reset_at, now());
