# Lindsay Precast — Job Dashboard & Structure Tracker

Next.js 15 + Tailwind 4 + Supabase, deployed on Vercel.

## What it does

- **Dashboard** (`/`): add, edit and delete jobs (Job #, Job location, Customer), view them as **Cards** or **Rows**,
  search, and jobs are grouped by customer; click a customer header to collapse or expand its jobs (or Collapse all); drag a customer group to reorder groups, or drag jobs within a group (the order is saved). Jobs can be archived (Active / Archived tabs, with Restore). Open a job's **Structure Tracker** (`/structures`) or **Procurement Order** (`/procurement`); the job's
  details show at the top of both pages and in the header of their printed PDFs. Each job has its own Titan data and
  its own procurement order — nothing is shared between jobs.
- **Paste the Titan production sheet** (header row included). The first paste loads every line. After that, paste the
  whole sheet again whenever Titan changes: lines are matched by Structure + Product + Description, only the ones whose
  values changed are updated, new lines are added, and nothing is duplicated or deleted. A preview shows what will change
  before you apply it. Lines no longer in Titan are kept unless you tick the box to remove them.
- Shows exactly these columns: **Priority, Structure ID, Product, Description, Plant ID, Production Department, Scheduled Date,
  Ready Date, Pick Date, Weight, UOM** (Titan's `Pri`, `Structure`, `Product`, `Description`, `Plant ID`,
  `Production Dep`, `Sch_Date`, `Ready_Date`, `Pick Date`, `Wt.`, `UOM`).
- Everything down to and including the column header bar stays pinned; only the table rows scroll.
- **Collapsible structures**: every structure starts collapsed, showing just its first line. Click the structure
  (▶) to expand its remaining lines, or use **Expand all / Collapse all**. Print / Save PDF prints what is
  currently expanded, so expand first if you want every line on the PDF.
- **Multi-select filters** (selected filters combine with OR; unselected ones are hidden; none selected shows all):
  - Scheduled to pour → has a Scheduled Date
  - Scheduled for delivery → has a Pick Date
- **Needs to be scheduled** (red button): shows only structures that have never been scheduled to pour (no line has a
  Scheduled Date). Tick the structures you want to schedule, click **Show only selected structures**, then
  Print / Save PDF to send the list to the scheduler (the printout is titled "Schedule to pour"). "Show full list again" brings everything back.
- **Date range**: pick a date field (Any date, Scheduled, Ready or Pick), set From / To (or use the
  Today / This week / Next 7 days / This month presets) and only the structures with a line in that range are shown
  — all of each matching structure's lines appear. Works together with the filters above, and the range is listed
  in the printed header.
- **Delete**: per-row Delete, row checkboxes (with select-all for what's currently shown) for "Delete selected", and
  "Delete all". Everything asks for confirmation; Delete all requires typing DELETE.
- **Procurement order** (button in the header → `/procurement`): add PO number / vendor / notes, then Print / Save PDF.
  **Add Components**: pick a component from the dropdown with a quantity (and optional structure/job). "Edit component
  list" lets you add, edit and delete components (type, name, cost, weight; starts from `lib/catalog.ts`). Order lines
  can be edited in place (structure, qty, unit cost) or removed. The component list and order are remembered in this
  browser.
- **Print / Save PDF** of exactly what's on screen (landscape, logo header, active filters listed).

## Setup

1. **Supabase**: create a project, open SQL Editor, run `supabase/schema.sql` (also creates the `jobs` table)
   (it also removes the table from the earlier version of this app). If you already ran it, run it again — it adds
   the `product` and `qty` columns — then re-import from Titan so those fill in.
2. **Supabase → Authentication → Users → Add user**: create your login (email + password). Row-level security allows
   only signed-in users to read/write.
3. Copy `.env.local.example` to `.env.local` and fill in the Project URL and anon key
   (Project Settings → API).
4. `npm install` then `npm run dev` → http://localhost:3000

## Deploy to Vercel

Push to GitHub, import the repo in Vercel, add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` under
Environment Variables, deploy.

## Check the Titan parser

`npm run test:parser -- path/to/titan-export.txt`
