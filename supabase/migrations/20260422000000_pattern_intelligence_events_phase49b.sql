-- Phase 4.9b — Additive telemetry fields for selection-depth + anti-repeat + DVL observability.
-- Add columns only; no constraint/RLS changes.

alter table public.pattern_intelligence_events
  add column if not exists candidate_count integer;

alter table public.pattern_intelligence_events
  add column if not exists unique_pattern_key_count integer;

alter table public.pattern_intelligence_events
  add column if not exists score_gap numeric;

alter table public.pattern_intelligence_events
  add column if not exists runner_up_pattern_key text;

alter table public.pattern_intelligence_events
  add column if not exists anti_repeat_applied boolean;

alter table public.pattern_intelligence_events
  add column if not exists anti_repeat_reason text;

alter table public.pattern_intelligence_events
  add column if not exists dvl_applied boolean;

alter table public.pattern_intelligence_events
  add column if not exists variant_index integer;

