alter table public.conversations
  add column if not exists deal_context jsonb;
