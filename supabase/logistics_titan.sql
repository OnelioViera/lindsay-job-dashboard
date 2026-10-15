-- Lindsay Precast PM — extra Titan columns for the Job Logistics report (safe to run again).
-- Run once in Supabase → SQL Editor.
-- Load number (the real truck), quantity produced, quantity shipped, ship date, yardage.
alter table public.titan_lines add column if not exists load_no text;
alter table public.titan_lines add column if not exists qty_pro numeric;
alter table public.titan_lines add column if not exists qty_shp numeric;
alter table public.titan_lines add column if not exists ship_date date;
alter table public.titan_lines add column if not exists unit_yards numeric;
