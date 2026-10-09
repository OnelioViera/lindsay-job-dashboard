-- Lindsay Precast PM — Job Logistics report settings (safe to run again).
-- Run this once in Supabase → SQL Editor. Run it AFTER per_user.sql.
-- Stores, per job: the truckload weight limit and the items you add by hand.

create table if not exists public.job_logistics (
  job_id uuid primary key references public.jobs(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  truck_limit numeric not null default 55000,
  manual jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists job_logistics_user_idx on public.job_logistics (user_id);

alter table public.job_logistics enable row level security;
drop policy if exists "own rows only" on public.job_logistics;
create policy "own rows only" on public.job_logistics
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
