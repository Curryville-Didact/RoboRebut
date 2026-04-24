-- Assistant coaching: optional JSON payload for data-driven UI (legacy `content` unchanged).
alter table public.messages add column if not exists structured_reply jsonb;

comment on column public.messages.structured_reply is 'Optional AssistantStructuredReply JSON for rendering; null for historical rows.';

-- Refresh PostgREST schema cache so API clients see the new column without waiting.
notify pgrst, 'reload schema';
