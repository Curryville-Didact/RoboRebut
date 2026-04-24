-- Phase 4.0: Usage tracking and plan enforcement
-- Run this in the Supabase SQL Editor.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS plan_type  text        NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS usage_count integer    NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS usage_reset_at timestamptz NOT NULL
    DEFAULT (now() + interval '30 days');

-- Existing rows get plan_type='free', usage_count=0, and a fresh 30-day window
-- from the time this migration runs. New users get the same defaults via the
-- column defaults (the trigger inserts only id + email, so defaults apply).

-- Refresh the trigger function to be explicit about the new columns.
-- This ensures future signups always get a clean initial state.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email, plan_type, usage_count, usage_reset_at)
  VALUES (
    new.id,
    new.email,
    'free',
    0,
    now() + interval '30 days'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
