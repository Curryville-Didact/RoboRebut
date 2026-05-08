alter table public.profiles
  add column if not exists webhook_secret text not null default '';
