-- Nullable JSONB for per-conversation account intelligence (Client Context panel).
-- Safe if an older migration already added the column (IF NOT EXISTS).
alter table public.conversations
  add column if not exists client_context jsonb default null;

comment on column public.conversations.client_context is
  'Optional account/sales context JSON; null for legacy rows.';
