-- Phase 12 — CRM-agnostic integrations (generic webhook endpoints + delivery logs).
-- Additive only; no impact to Live semantics.

create table if not exists public.integration_endpoints (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  workspace_id uuid,
  user_id uuid not null,
  is_enabled boolean not null default true,
  provider_type text not null,
  endpoint_url text not null,
  signing_secret text,
  auth_type text not null default 'none', -- none | bearer | header
  auth_config jsonb,
  event_types text[] not null default '{}',
  metadata jsonb
);

create index if not exists integration_endpoints_user_idx
  on public.integration_endpoints (user_id, created_at desc);

create index if not exists integration_endpoints_user_enabled_idx
  on public.integration_endpoints (user_id, is_enabled);

comment on table public.integration_endpoints is
  'Phase 12: CRM-agnostic outbound webhook endpoints. Generic delivery; provider_type is label only.';

alter table public.integration_endpoints enable row level security;

create table if not exists public.integration_delivery_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  integration_endpoint_id uuid not null references public.integration_endpoints(id) on delete cascade,
  user_id uuid not null,
  event_type text not null,
  delivery_status text not null, -- pending | delivered | failed | skipped
  http_status integer,
  duration_ms integer,
  correlation_id text,
  error_message text,
  payload_preview jsonb,
  retryable boolean not null default false
);

create index if not exists integration_delivery_logs_endpoint_created_at_idx
  on public.integration_delivery_logs (integration_endpoint_id, created_at desc);

create index if not exists integration_delivery_logs_user_created_at_idx
  on public.integration_delivery_logs (user_id, created_at desc);

comment on table public.integration_delivery_logs is
  'Phase 12: outbound delivery attempt logs (best-effort, no retries in this phase).';

alter table public.integration_delivery_logs enable row level security;

notify pgrst, 'reload schema';

