-- Phase 9 — Review System refinement (additive, backwards-compatible).
--
-- Adds:
-- - rebuttal_reviews.disposition (strong | weak | missed | cleared)
-- - rebuttal_reviews.structured_tags (text[])
--
-- Keeps legacy fields (rating, outcome_tag, notes) intact.

alter table public.rebuttal_reviews
  add column if not exists disposition text;

comment on column public.rebuttal_reviews.disposition is
  'Phase 9: normalized quick review label (strong|weak|missed|cleared).';

alter table public.rebuttal_reviews
  add column if not exists structured_tags text[] default null;

comment on column public.rebuttal_reviews.structured_tags is
  'Phase 9: structured failure/success tags (multi-select) for offline intelligence.';

create index if not exists rebuttal_reviews_user_disposition_idx
  on public.rebuttal_reviews (user_id, disposition);

-- Refresh PostgREST schema cache
notify pgrst, 'reload schema';

