-- Lindsay Precast PM — every signed-in person gets their OWN data (safe to run again).
-- Run this once in Supabase → SQL Editor.
--
-- STEP 1: change the email below to the login that should OWN everything that exists today.
-- All current jobs, Titan lines, orders, component list and recipes are assigned to that login.
-- Anyone else who signs in starts with a clean, empty account.

do $$
declare
  owner_email text := 'PUT-YOUR-LOGIN-EMAIL-HERE';   -- <<< CHANGE THIS
  owner uuid;
  t text;
begin
  select id into owner from auth.users where lower(email) = lower(owner_email);
  if owner is null then
    raise exception 'No user with email % — change owner_email at the top, then run again.', owner_email;
  end if;

  foreach t in array array[
    'jobs', 'titan_lines', 'procurement_orders', 'pour_picks',
    'procurement_catalog', 'procurement_recipes'
  ] loop
    execute format('alter table public.%I add column if not exists user_id uuid references auth.users(id) on delete cascade', t);
    execute format('update public.%I set user_id = %L where user_id is null', t, owner);
    execute format('alter table public.%I alter column user_id set default auth.uid()', t);
    execute format('alter table public.%I alter column user_id set not null', t);
    execute format('create index if not exists %I on public.%I (user_id)', t || '_user_idx', t);

    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "authenticated full access" on public.%I', t);
    execute format('drop policy if exists "own rows only" on public.%I', t);
    execute format(
      'create policy "own rows only" on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())',
      t);
  end loop;
end $$;

-- The component list and recipes were one shared row ("main"); now it is one row per person.
alter table public.procurement_catalog drop constraint if exists procurement_catalog_pkey;
alter table public.procurement_catalog add primary key (user_id, id);
alter table public.procurement_recipes drop constraint if exists procurement_recipes_pkey;
alter table public.procurement_recipes add primary key (user_id, id);
