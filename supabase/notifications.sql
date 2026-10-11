-- Lindsay Precast PM — notification bell settings (safe to run again).
-- Run this once in Supabase → SQL Editor. Run it AFTER per_user.sql.
-- One row per person: how far ahead to warn, and which alerts were dismissed or snoozed.

create table if not exists public.user_settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  alerts jsonb not null default '{}'::jsonb,
  dismissed jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_settings enable row level security;
drop policy if exists "own rows only" on public.user_settings;
create policy "own rows only" on public.user_settings
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
