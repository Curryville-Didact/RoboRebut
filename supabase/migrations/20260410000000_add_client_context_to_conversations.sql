alter table public.conversations
  add column if not exists client_context jsonb;
