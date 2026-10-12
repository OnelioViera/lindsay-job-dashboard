-- Lindsay Precast PM — reminders in the notification bell (safe to run again).
-- Run once in Supabase → SQL Editor, after notifications.sql.
alter table public.user_settings add column if not exists reminders jsonb not null default '[]'::jsonb;
