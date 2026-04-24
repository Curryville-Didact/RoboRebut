-- Phase 8 refinement patch:
-- - add strategy_tag to rebuttal_events (passive capture)
-- - add variant_inventory_registry_snapshots for unused/missing coverage detection
-- - add metadata jsonb to intelligence_run_logs for richer run reporting

alter table public.rebuttal_events
  add column if not exists strategy_tag text;

comment on column public.rebuttal_events.strategy_tag is
  'Phase 8: passive strategy/pattern key (e.g. patternKey/strategy_used) captured for offline intelligence only.';

create table if not exists public.variant_inventory_registry_snapshots (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.intelligence_run_logs(id) on delete cascade,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  objection_type text,
  rhetorical_type text,
  strategy_tag text,
  variant_key text,
  variant_text_sample text,
  source_family text,
  source_module text,
  metadata jsonb
);

create index if not exists variant_inventory_registry_user_created_at_idx
  on public.variant_inventory_registry_snapshots (user_id, created_at desc);

create index if not exists variant_inventory_registry_user_key_idx
  on public.variant_inventory_registry_snapshots (user_id, variant_key);

comment on table public.variant_inventory_registry_snapshots is
  'Phase 8: offline snapshot of known variant inventory (static registry) for unused/missing coverage detection.';

alter table public.variant_inventory_registry_snapshots enable row level security;

alter table public.intelligence_run_logs
  add column if not exists metadata jsonb;

-- Refresh PostgREST schema cache
notify pgrst, 'reload schema';

