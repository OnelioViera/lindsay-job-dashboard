-- Lindsay Precast PM — add per-structure costs to the Job Logistics report (safe to run again).
-- Run this once in Supabase → SQL Editor, after logistics.sql.
alter table public.job_logistics add column if not exists costs jsonb not null default '{}'::jsonb;
