-- Lindsay Precast PM — run this once in Supabase → SQL Editor.
-- (If you ran the earlier version, this replaces its table. Nothing else depends on it.)

drop table if exists public.structures;

create table if not exists public.titan_lines (
  id uuid primary key default gen_random_uuid(),
  import_batch uuid not null,          -- every paste gets a batch id so a failed import never wipes good data
  sort_order integer not null,         -- original row order from the Titan sheet

  priority integer,
  structure text not null,
  description text,
  plant_id text,
  production_dep text,
  sch_date date,                       -- Scheduled Date
  ready_date date,                     -- Ready Date
  pro_date date,                       -- Production Date
  pick_date date,                      -- Pick Date
  weight numeric,
  uom text,

  imported_at timestamptz not null default now()
);

create index if not exists titan_lines_order_idx on public.titan_lines (sort_order);
create index if not exists titan_lines_structure_idx on public.titan_lines (structure);

-- Only signed-in users can read or write.
alter table public.titan_lines enable row level security;

drop policy if exists "authenticated full access" on public.titan_lines;
create policy "authenticated full access"
on public.titan_lines
for all
to authenticated
using (true)
with check (true);

-- Added for the Procurement order page (safe to run again).
alter table public.titan_lines add column if not exists product text;  -- Titan "Product" code
alter table public.titan_lines add column if not exists qty numeric;    -- Titan "QO" (quantity ordered)

-- Jobs for the Dashboard (safe to run again).
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  job_number text not null,
  location text,
  customer text,
  created_at timestamptz not null default now()
);
alter table public.jobs enable row level security;
drop policy if exists "authenticated full access" on public.jobs;
create policy "authenticated full access"
on public.jobs
for all
to authenticated
using (true)
with check (true);

-- Drag-to-reorder for the Dashboard (safe to run again).
alter table public.jobs add column if not exists position integer;

-- Each job gets its own Titan data (safe to run again).
alter table public.titan_lines
  add column if not exists job_id uuid references public.jobs(id) on delete cascade;
create index if not exists titan_lines_job_idx on public.titan_lines (job_id);
-- Lines imported before jobs existed have no job. To keep them, assign them to one job:
--   update public.titan_lines set job_id = '<that job's id>' where job_id is null;
-- (or just import the Titan sheet again from that job's Structure Tracker.)

-- Archive jobs from the Dashboard (safe to run again).
alter table public.jobs add column if not exists archived boolean not null default false;

-- Procurement orders and the component list are saved online, so every computer sees the same data
-- (safe to run again). An order already built in one browser is moved here the first time that
-- job's Procurement Order page is opened on that computer.
create table if not exists public.procurement_orders (
  job_id uuid primary key references public.jobs(id) on delete cascade,
  po_number text,
  vendor text,
  notes text,
  lines jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.procurement_orders enable row level security;
drop policy if exists "authenticated full access" on public.procurement_orders;
create policy "authenticated full access"
on public.procurement_orders
for all
to authenticated
using (true)
with check (true);

create table if not exists public.procurement_catalog (
  id text primary key,
  items jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.procurement_catalog enable row level security;
drop policy if exists "authenticated full access" on public.procurement_catalog;
create policy "authenticated full access"
on public.procurement_catalog
for all
to authenticated
using (true)
with check (true);

-- Structures picked on the Structure Tracker are shown on the Procurement Order page (safe to run again).
create table if not exists public.pour_picks (
  job_id uuid primary key references public.jobs(id) on delete cascade,
  items jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.pour_picks enable row level security;
drop policy if exists "authenticated full access" on public.pour_picks;
create policy "authenticated full access"
on public.pour_picks
for all
to authenticated
using (true)
with check (true);

-- Recipes: which components one structure of a Product needs, used to fill the Procurement order (safe to run again).
create table if not exists public.procurement_recipes (
  id text primary key,
  items jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.procurement_recipes enable row level security;
drop policy if exists "authenticated full access" on public.procurement_recipes;
create policy "authenticated full access"
on public.procurement_recipes
for all
to authenticated
using (true)
with check (true);
