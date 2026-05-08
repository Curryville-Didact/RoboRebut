create table if not exists public.crm_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  crm_type text not null check (crm_type in ('hubspot', 'gohighlevel', 'salesforce', 'zoho', 'velocify')),
  api_key text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, crm_type)
);

alter table public.crm_connections enable row level security;

create policy "Users can manage their own CRM connections"
  on public.crm_connections
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index idx_crm_connections_user_id on public.crm_connections(user_id);

