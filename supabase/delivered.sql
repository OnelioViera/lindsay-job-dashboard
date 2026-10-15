-- Lindsay Precast PM — track picked / delivered structures (safe to run again).
-- Run once in Supabase → SQL Editor.
-- picked = Titan's Pick check mark (-1); invoice_date = Titan's Invoice_ Date.
alter table public.titan_lines add column if not exists picked boolean;
alter table public.titan_lines add column if not exists invoice_date date;
