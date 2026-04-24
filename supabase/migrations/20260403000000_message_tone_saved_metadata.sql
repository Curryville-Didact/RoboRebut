-- Optional metadata for saved coaching snippets; tone applied on assistant turns (live thread).
alter table public.messages add column if not exists tone_used text;
alter table public.saved_responses add column if not exists metadata jsonb;

comment on column public.messages.tone_used is 'Tone mode applied when this assistant message was generated (coach thread).';
comment on column public.saved_responses.metadata is 'JSON: objection preview, tone, follow-up, pattern key, etc.';
