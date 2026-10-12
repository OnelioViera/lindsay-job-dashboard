-- Lindsay Precast PM — keep Titan's ExtPrice on each line (safe to run again).
-- Run this once in Supabase → SQL Editor, then paste the Titan sheet again to fill in prices.
alter table public.titan_lines add column if not exists ext_price numeric;
