"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import BackButton from "./BackButton";
import { getSupabase } from "@/lib/supabase";
import { FILTERS, type FilterKey, type Row } from "@/lib/types";
import Link from "next/link";
import ImportModal from "./ImportModal";
import JobBanner from "./JobBanner";
import { jobLine, useActiveJob, withJob } from "@/lib/jobs";
import { analyze, QUICK_LABELS, type QuickKey } from "@/lib/metrics";

const QUICK_KEYS = Object.keys(QUICK_LABELS) as QuickKey[];

type SortKey =
  "paste" | "priority" | "structure" | "sch_date" | "ready_date" | "pick_date";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "paste", label: "Titan order" },
  { key: "priority", label: "Priority" },
  { key: "structure", label: "Structure ID" },
  { key: "sch_date", label: "Scheduled Date" },
  { key: "ready_date", label: "Ready Date" },
  { key: "pick_date", label: "Pick Date" },
];

type DateKey = "any" | "sch_date" | "ready_date" | "pick_date";

const DATE_FIELDS: { key: DateKey; label: string }[] = [
  { key: "any", label: "Any date" },
  { key: "sch_date", label: "Scheduled Date" },
  { key: "ready_date", label: "Ready Date" },
  { key: "pick_date", label: "Pick Date" },
];

// Local-time YYYY-MM-DD (toISOString would shift to UTC and can land on the wrong day).
const toIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const addDays = (d: Date, n: number) => {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
};

const PRESETS: { label: string; range: () => [string, string] }[] = [
  { label: "Today", range: () => [toIso(new Date()), toIso(new Date())] },
  {
    label: "This week",
    range: () => {
      const t = new Date();
      const monday = addDays(t, -((t.getDay() + 6) % 7)); // Monday–Sunday
      return [toIso(monday), toIso(addDays(monday, 6))];
    },
  },
  {
    label: "Next 7 days",
    range: () => {
      const t = new Date();
      return [toIso(t), toIso(addDays(t, 6))];
    },
  },
  {
    label: "This month",
    range: () => {
      const t = new Date();
      return [
        toIso(new Date(t.getFullYear(), t.getMonth(), 1)),
        toIso(new Date(t.getFullYear(), t.getMonth() + 1, 0)),
      ];
    },
  },
];

const fmtDate = (d: string | null) => {
  if (!d) return "";
  const [y, m, day] = d.split("-");
  return `${m}/${day}/${y}`;
};

const fmtWeight = (w: number | null) =>
  w === null ? "" : w.toLocaleString("en-US", { maximumFractionDigits: 1 });

function compare(a: Row, b: Row, key: SortKey): number {
  const byPaste = a.sort_order - b.sort_order;
  if (key === "paste") return byPaste;
  if (key === "priority") {
    const pa = a.priority ?? Number.MAX_SAFE_INTEGER;
    const pb = b.priority ?? Number.MAX_SAFE_INTEGER;
    return pa - pb || byPaste;
  }
  if (key === "structure")
    return (
      a.structure.localeCompare(b.structure, undefined, { numeric: true }) ||
      byPaste
    );
  const va = a[key];
  const vb = b[key];
  if (va && vb) return va.localeCompare(vb) || byPaste;
  if (va) return -1; // dated rows first
  if (vb) return 1;
  return byPaste;
}

// One group per structure. `header` is the structure's first line (in the current sort order);
// it is the only row shown while the structure is collapsed.
type Group = { structure: string; header: Row; lines: Row[] };

const PAGE = 1000;

export default function Tracker() {
  const { job, loading: jobLoading } = useActiveJob();
  const onSignOut = () => void getSupabase().auth.signOut();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<Set<FilterKey>>(new Set());
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("paste");
  const [showImport, setShowImport] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // "Needs to be scheduled": structures with no Scheduled Date on any line.
  const [needsPour, setNeedsPour] = useState(false);
  // Opened from a Dashboard metrics chip (?show=…): only structures in that group.
  const [quick, setQuick] = useState<QuickKey | null>(null);
  const router = useRouter();
  const tableRef = useRef<HTMLElement | null>(null);
  const restoredFor = useRef<string | null>(null);
  const scrolled = useRef(false);
  // Structures picked for the scheduler; when set, only these are shown.
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{
    ids: string[];
    all: boolean;
    label: string;
  } | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [dateField, setDateField] = useState<DateKey>("any");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  // Structures start collapsed; names in this set are expanded.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const jobId = job?.id ?? null;

  // Remember where you left off (filters, picks, expanded structures, scroll) for this tab, so
  // coming Back to this page shows it exactly as it was.
  useEffect(() => {
    if (!jobId || restoredFor.current === jobId) return;
    restoredFor.current = jobId;
    scrolled.current = false;
    try {
      const raw = sessionStorage.getItem(`tracker-ui:${jobId}`);
      if (raw) {
        const u = JSON.parse(raw);
        setActive(new Set(u.active ?? []));
        setSearch(u.search ?? "");
        setSort(u.sort ?? "paste");
        setSelected(new Set(u.selected ?? []));
        setNeedsPour(!!u.needsPour);
        setQuick(u.quick ?? null);
        setPicked(u.picked ? new Set(u.picked) : null);
        setDateField(u.dateField ?? "any");
        setDateFrom(u.dateFrom ?? "");
        setDateTo(u.dateTo ?? "");
        setExpanded(new Set(u.expanded ?? []));
      }
    } catch {}
    // A Dashboard metrics chip opens this page with ?show=…; apply it once, then tidy the URL.
    const url = new URL(window.location.href);
    const s = url.searchParams.get("show");
    if (s) {
      if ((QUICK_KEYS as string[]).includes(s)) setQuick(s as QuickKey);
      url.searchParams.delete("show");
      window.history.replaceState(null, "", url.pathname + url.search);
    }
  }, [jobId]);
  useEffect(() => {
    if (!jobId || restoredFor.current !== jobId) return;
    try {
      sessionStorage.setItem(
        `tracker-ui:${jobId}`,
        JSON.stringify({
          active: [...active],
          search,
          sort,
          selected: [...selected],
          needsPour,
          quick,
          picked: picked ? [...picked] : null,
          dateField,
          dateFrom,
          dateTo,
          expanded: [...expanded],
        }),
      );
    } catch {}
  }, [
    jobId,
    active,
    search,
    sort,
    selected,
    needsPour,
    quick,
    picked,
    dateField,
    dateFrom,
    dateTo,
    expanded,
  ]);
  useEffect(() => {
    if (loading || !jobId || scrolled.current || restoredFor.current !== jobId)
      return;
    scrolled.current = true;
    try {
      const y = Number(sessionStorage.getItem(`tracker-scroll:${jobId}`) ?? 0);
      if (y > 0)
        requestAnimationFrame(() => {
          if (tableRef.current) tableRef.current.scrollTop = y;
        });
    } catch {}
  }, [loading, jobId]);

  // The structures picked for the scheduler are shared with the Procurement Order page as a reference list.
  const savePicks = async (structures: Set<string>) => {
    if (!jobId || structures.size === 0) return;
    const first = new Map<string, Row>();
    for (const r of [...rows].sort((a, b) => a.sort_order - b.sort_order))
      if (structures.has(r.structure) && !first.has(r.structure))
        first.set(r.structure, r);
    const items = [...first.values()].map((r) => ({
      structure: r.structure,
      product: r.product,
      description: r.description,
    }));
    const { error } = await getSupabase().from("pour_picks").upsert({
      job_id: jobId,
      items,
      updated_at: new Date().toISOString(),
    });
    if (error)
      setError(
        /pour_picks|relation/.test(error.message)
          ? `${error.message} — run the updated supabase/schema.sql in Supabase first.`
          : error.message,
      );
  };
  // The browser uses the page title for the print header and the default PDF name.
  const pageTitle = picked ? "Schedule to pour" : "Structure Tracker";
  useEffect(() => {
    document.title = `Lindsay Precast — ${pageTitle}`;
  }, [pageTitle]);
  const load = useCallback(async () => {
    if (!jobId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const supabase = getSupabase();
    const all: Row[] = [];
    // Supabase returns at most 1000 rows per request, so page through.
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("titan_lines")
        .select(
          "id, sort_order, priority, structure, description, plant_id, production_dep, sch_date, ready_date, pro_date, pick_date, weight, uom, product, qty",
        )
        .eq("job_id", jobId)
        .order("sort_order", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }
      all.push(...((data ?? []) as Row[]));
      if (!data || data.length < PAGE) break;
    }
    setError(null);
    setRows(all);
    setLoading(false);
  }, [jobId]);

  useEffect(() => {
    if (jobLoading) return;
    void load();
  }, [load, jobLoading]);

  const neverScheduled = useMemo(() => {
    const has = new Map<string, boolean>();
    for (const r of rows)
      has.set(r.structure, (has.get(r.structure) ?? false) || !!r.sch_date);
    return new Set([...has.entries()].filter(([, v]) => !v).map(([k]) => k));
  }, [rows]);

  const quickSets = useMemo(() => analyze(rows).sets, [rows]);

  const counts = useMemo(() => {
    const out = {} as Record<FilterKey, number>;
    for (const f of FILTERS) out[f.key] = rows.filter(f.test).length;
    return out;
  }, [rows]);

  // Selected filters combine with OR: a line shows if it matches ANY selected filter.
  // Nothing selected = show everything.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const tests = FILTERS.filter((f) => active.has(f.key));

    // Date range works per structure: a structure is kept if ANY of its lines has the chosen
    // date (or any of the four dates for "Any date") inside the range; then all its lines show.
    let inRange: Set<string> | null = null;
    if (dateFrom || dateTo) {
      const keys: (keyof Row)[] =
        dateField === "any"
          ? ["sch_date", "ready_date", "pick_date"]
          : [dateField];
      const hit = (d: string | null) =>
        !!d && (!dateFrom || d >= dateFrom) && (!dateTo || d <= dateTo);
      inRange = new Set(
        rows
          .filter((r) => keys.some((k) => hit(r[k] as string | null)))
          .map((r) => r.structure),
      );
    }

    return (
      rows
        .filter((r) => (needsPour ? neverScheduled.has(r.structure) : true))
        .filter((r) => (picked ? picked.has(r.structure) : true))
        .filter((r) => (quick ? quickSets[quick].has(r.structure) : true))
        .filter((r) => (inRange ? inRange.has(r.structure) : true))
        .filter((r) =>
          tests.length === 0 ? true : tests.some((f) => f.test(r)),
        )
        .filter((r) =>
          q
            ? r.structure.toLowerCase().includes(q) ||
              (r.description ?? "").toLowerCase().includes(q) ||
              (r.product ?? "").toLowerCase().includes(q)
            : true,
        )
        // Structures that already have a Pick Date can't be scheduled any more: keep them at the bottom.
        .sort(
          (a, b) =>
            Number(quickSets.picked.has(a.structure)) -
              Number(quickSets.picked.has(b.structure)) || compare(a, b, sort),
        )
    );
  }, [
    quickSets,
    rows,
    active,
    search,
    sort,
    dateField,
    dateFrom,
    dateTo,
    needsPour,
    neverScheduled,
    picked,
    quick,
    quickSets,
  ]);

  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Row[]>();
    for (const r of visible) {
      const list = map.get(r.structure);
      if (list) list.push(r);
      else map.set(r.structure, [r]);
    }
    return [...map.entries()].map(([structure, lines]) => ({
      structure,
      header: lines[0],
      lines,
    }));
  }, [visible]);

  const allExpanded =
    groups.length > 0 && groups.every((g) => expanded.has(g.structure));

  // Only rows currently shown count as selected, so hidden rows are never deleted by accident.
  const selectedIds = useMemo(
    () => visible.filter((r) => selected.has(r.id)).map((r) => r.id),
    [visible, selected],
  );
  const allVisibleSelected =
    visible.length > 0 && selectedIds.length === visible.length;

  const toggleRow = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAllVisible = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visible.forEach((r) => next.delete(r.id));
      else visible.forEach((r) => next.add(r.id));
      return next;
    });

  const toggleGroup = (structure: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(structure)) next.delete(structure);
      else next.add(structure);
      return next;
    });

  const expandAll = () => setExpanded(new Set(groups.map((g) => g.structure)));
  const collapseAll = () => setExpanded(new Set());

  const selectedInGroup = (g: Group) =>
    g.lines.filter((l) => selected.has(l.id)).length;

  const toggleGroupSelected = (g: Group) =>
    setSelected((prev) => {
      const next = new Set(prev);
      const all = g.lines.every((l) => prev.has(l.id));
      g.lines.forEach((l) => (all ? next.delete(l.id) : next.add(l.id)));
      return next;
    });

  const toggleFilter = (k: FilterKey) =>
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const askDelete = (ids: string[], all: boolean, label: string) => {
    setConfirmText("");
    setPendingDelete({ ids, all, label });
  };

  const runDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    const supabase = getSupabase();
    let failure: string | null = null;

    if (pendingDelete.all) {
      const { error } = await supabase
        .from("titan_lines")
        .delete()
        .eq("job_id", jobId);
      if (error) failure = error.message;
    } else {
      for (let i = 0; i < pendingDelete.ids.length; i += 100) {
        const { error } = await supabase
          .from("titan_lines")
          .delete()
          .in("id", pendingDelete.ids.slice(i, i + 100));
        if (error) {
          failure = error.message;
          break;
        }
      }
    }

    setDeleting(false);
    setPendingDelete(null);
    setSelected(new Set());
    if (failure) setError(`Delete failed: ${failure}`);
    await load(); // reload so the screen always matches what is really in the database
  };

  const activeLabels = FILTERS.filter((f) => active.has(f.key)).map(
    (f) => f.label,
  );
  const printedOn = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const rangeInvalid = !!dateFrom && !!dateTo && dateFrom > dateTo;
  const rangeLabel =
    dateFrom || dateTo
      ? `${DATE_FIELDS.find((d) => d.key === dateField)?.label ?? "Date"}: ${
          dateFrom ? fmtDate(dateFrom) : "…"
        } – ${dateTo ? fmtDate(dateTo) : "…"}`
      : "";

  const COLS = 12;

  return (
    <div className="mx-auto flex h-screen w-full max-w-[1800px] flex-col overflow-hidden px-4 py-5 md:px-12 print:block print:h-auto print:overflow-visible print:max-w-none print:p-0">
      {/* Screen header */}
      <header className="mb-5 flex flex-wrap items-center gap-4 print:hidden">
        <img src="/logo.png" alt="Lindsay Precast" className="h-20 w-auto" />
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-navy">Structure Tracker</h1>
          <p className="text-sm text-slate-600">
            Scheduled, ready, production and pick dates straight from Titan.
          </p>
        </div>
        <div className="flex gap-2">
          <BackButton />
          <Link
            href="/"
            className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-white"
          >
            ← Dashboard
          </Link>
          <button
            onClick={() => setShowImport(true)}
            disabled={!jobId}
            className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy-dark"
          >
            Import from Titan
          </button>
          <Link
            href={withJob("/procurement", job?.id)}
            onClick={async (e) => {
              // Hand the structures you picked (or ticked) to the Procurement page first.
              // Priority: structures picked for the scheduler, then ticked rows, then — when the
              // list is narrowed by a filter, date range or search — the structures being shown.
              const narrowed =
                active.size > 0 ||
                search.trim() !== "" ||
                dateFrom !== "" ||
                dateTo !== "" ||
                needsPour ||
                quick !== null;
              const chosen =
                picked ??
                (selectedIds.length > 0
                  ? new Set(
                      visible
                        .filter((r) => selected.has(r.id))
                        .map((r) => r.structure),
                    )
                  : narrowed
                    ? new Set(groups.map((g) => g.structure))
                    : null);
              if (!chosen || chosen.size === 0) return;
              e.preventDefault();
              await savePicks(chosen);
              router.push(withJob("/procurement", job?.id));
            }}
            className="rounded-md border border-navy px-4 py-2 text-sm font-semibold text-navy hover:bg-white"
          >
            Procurement order
          </Link>
          <button
            onClick={() => window.print()}
            disabled={visible.length === 0}
            className="rounded-md bg-brand-red px-4 py-2 text-sm font-semibold text-white hover:bg-brand-red-dark disabled:opacity-50"
          >
            Print / Save PDF
          </button>
          <button
            onClick={onSignOut}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-white"
          >
            Sign out
          </button>
        </div>
      </header>

      <JobBanner job={job} loading={jobLoading} />

      {/* Print header */}
      <div className="mb-3 hidden items-center gap-4 border-b-2 border-navy pb-2 print:flex">
        <img src="/logo.png" alt="Lindsay Precast" className="h-16 w-auto" />
        <div className="flex-1">
          <h1 className="text-xl font-bold text-navy">
            {picked ? "Schedule to pour" : "Structure Tracker"}
          </h1>
          {job && (
            <p className="text-sm font-semibold text-slate-800">
              {jobLine(job)}
            </p>
          )}
          <p className="text-xs text-slate-700">
            {activeLabels.length > 0
              ? `Showing: ${activeLabels.join(" OR ")}`
              : "Showing: all lines"}
            {search.trim() ? ` · Search: "${search.trim()}"` : ""}
            {rangeLabel ? ` · ${rangeLabel}` : ""}
            {needsPour ? " · Structures never scheduled to pour" : ""}
            {picked ? " · Selected structures only" : ""}
            {quick ? ` · ${QUICK_LABELS[quick]}` : ""}
          </p>
        </div>
        <div className="text-right text-xs text-slate-700">
          <div>Printed {printedOn}</div>
          <div>
            {groups.length} structures · {visible.length} lines
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 print:hidden">
          {error}
        </div>
      )}

      {/* Filters */}
      <section className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm print:hidden">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => {
              setNeedsPour((v) => !v);
              setPicked(null);
            }}
            aria-pressed={needsPour}
            className={`rounded-full border-2 px-4 py-1.5 text-sm font-semibold transition ${
              needsPour
                ? "border-brand-red bg-brand-red text-white"
                : "border-brand-red bg-white text-brand-red hover:bg-red-50"
            }`}
          >
            Needs to be scheduled{" "}
            <span className={needsPour ? "text-white/80" : "text-brand-red/70"}>
              ({neverScheduled.size})
            </span>
          </button>
          {FILTERS.map((f) => {
            const on = active.has(f.key);
            return (
              <button
                key={f.key}
                onClick={() => toggleFilter(f.key)}
                aria-pressed={on}
                className={`rounded-full border px-4 py-1.5 text-sm font-medium transition ${
                  on
                    ? "border-navy bg-navy text-white"
                    : "border-slate-300 bg-white text-slate-700 hover:border-navy hover:text-navy"
                }`}
              >
                {f.label}{" "}
                <span className={on ? "text-white/80" : "text-slate-400"}>
                  ({counts[f.key]})
                </span>
              </button>
            );
          })}
          {quick && (
            <span className="inline-flex items-center gap-2 rounded-full border-2 border-navy bg-navy px-4 py-1.5 text-sm font-semibold text-white">
              {QUICK_LABELS[quick]} ({quickSets[quick].size})
              <button
                onClick={() => setQuick(null)}
                aria-label="Clear dashboard filter"
                className="text-white/80 hover:text-white"
              >
                ✕
              </button>
            </span>
          )}
          {active.size > 0 && (
            <button
              onClick={() => setActive(new Set())}
              className="px-2 text-sm text-brand-red hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3 text-sm">
          <span className="font-medium text-slate-700">Date range</span>
          <select
            value={dateField}
            onChange={(e) => setDateField(e.target.value as DateKey)}
            aria-label="Which date to filter on"
            className="rounded-md border border-slate-300 px-2 py-1.5"
          >
            {DATE_FIELDS.map((d) => (
              <option key={d.key} value={d.key}>
                {d.label}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-slate-600">
            From
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="rounded-md border border-slate-300 px-2 py-1.5"
            />
          </label>
          <label className="flex items-center gap-2 text-slate-600">
            To
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="rounded-md border border-slate-300 px-2 py-1.5"
            />
          </label>
          <div className="flex flex-wrap gap-1">
            {PRESETS.map((p) => {
              const [pf, pt] = p.range();
              const on = dateFrom === pf && dateTo === pt;
              return (
                <button
                  key={p.label}
                  aria-pressed={on}
                  onClick={() => {
                    // Clicking the highlighted preset again clears it.
                    setDateFrom(on ? "" : pf);
                    setDateTo(on ? "" : pt);
                  }}
                  className={`rounded-full border px-3 py-1 ${
                    on
                      ? "border-navy bg-navy text-white"
                      : "border-slate-300 text-slate-700 hover:border-navy hover:text-navy"
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
          {(dateFrom || dateTo) && (
            <button
              onClick={() => {
                setDateFrom("");
                setDateTo("");
              }}
              className="text-brand-red hover:underline"
            >
              Clear dates
            </button>
          )}
          {rangeInvalid && (
            <span className="text-brand-red">
              “From” is after “To” — nothing can match.
            </span>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search structure, product or description…"
            className="w-64 rounded-md border border-slate-300 px-3 py-1.5 focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/20"
          />
          <label className="flex items-center gap-2 text-slate-600">
            Sort by
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="rounded-md border border-slate-300 px-2 py-1.5"
            >
              {SORTS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <span className="ml-auto text-slate-500">
            Showing {groups.length} structures ({visible.length} of{" "}
            {rows.length} lines)
            {active.size > 1 ? " (matches any selected filter)" : ""}
          </span>
        </div>
      </section>

      {/* Delete toolbar */}
      {rows.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-3 text-sm print:hidden">
          <span className="text-slate-600">
            {selectedIds.length > 0
              ? `${selectedIds.length} selected`
              : "Tick rows to delete several at once"}
          </span>
          <button
            onClick={allExpanded ? collapseAll : expandAll}
            disabled={groups.length === 0}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:border-navy hover:text-navy disabled:opacity-50"
          >
            {allExpanded ? "Collapse all" : "Expand all"}
          </button>
          {picked ? (
            <button
              onClick={() => setPicked(null)}
              className="rounded-md bg-navy px-3 py-1.5 font-semibold text-white hover:bg-navy-dark"
            >
              Show full list again ({picked.size} structure
              {picked.size === 1 ? "" : "s"} picked)
            </button>
          ) : (
            selectedIds.length > 0 && (
              <button
                onClick={() => {
                  const chosen = new Set(
                    visible
                      .filter((r) => selected.has(r.id))
                      .map((r) => r.structure),
                  );
                  setPicked(chosen);
                  void savePicks(chosen);
                }}
                className="rounded-md bg-navy px-3 py-1.5 font-semibold text-white hover:bg-navy-dark"
              >
                Show only selected structures (
                {
                  new Set(
                    visible
                      .filter((r) => selected.has(r.id))
                      .map((r) => r.structure),
                  ).size
                }
                )
              </button>
            )
          )}
          {selectedIds.length > 0 && (
            <>
              <button
                onClick={() =>
                  askDelete(
                    selectedIds,
                    false,
                    `${selectedIds.length} selected line${selectedIds.length === 1 ? "" : "s"}`,
                  )
                }
                className="rounded-md bg-brand-red px-3 py-1.5 font-semibold text-white hover:bg-brand-red-dark"
              >
                Delete selected ({selectedIds.length})
              </button>
              <button
                onClick={() => setSelected(new Set())}
                className="text-slate-500 hover:underline"
              >
                Clear selection
              </button>
            </>
          )}
          <button
            onClick={() =>
              askDelete(
                rows.map((r) => r.id),
                true,
                `all ${rows.length} lines`,
              )
            }
            className="ml-auto rounded-md border border-brand-red px-3 py-1.5 font-semibold text-brand-red hover:bg-red-50"
          >
            Delete all ({rows.length})
          </button>
        </div>
      )}

      {/* Table */}
      <section
        ref={tableRef}
        onScroll={(e) => {
          try {
            if (jobId)
              sessionStorage.setItem(
                `tracker-scroll:${jobId}`,
                String(e.currentTarget.scrollTop),
              );
          } catch {}
        }}
        className="min-h-0 overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm print:max-h-none print:overflow-visible print:rounded-none print:border-0 print:shadow-none"
      >
        <table className="print-fit w-full text-left text-sm">
          <thead className="sticky top-0 z-10 bg-navy text-white print:static">
            <tr>
              <th className="w-8 px-2 py-2 print:hidden">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={toggleAllVisible}
                  disabled={visible.length === 0}
                  aria-label="Select all shown lines"
                />
              </th>
              <th className="px-2 py-2 print:px-1.5">Priority</th>
              <th className="px-2 py-2 print:px-1.5">Structure ID</th>
              <th className="px-2 py-2 print:px-1.5">Product</th>
              <th className="px-2 py-2 print:px-1.5">Description</th>
              <th className="px-2 py-2 print:px-1.5">Plant ID</th>
              <th className="px-2 py-2 print:hidden">Production Department</th>
              <th className="px-2 py-2 print:px-1.5">Scheduled Date</th>
              <th className="px-2 py-2 print:px-1.5">Ready Date</th>
              <th className="px-2 py-2 print:px-1.5">Pick Date</th>
              <th className="px-2 py-2 text-right print:px-1.5">Weight</th>
              <th className="px-2 py-2 print:hidden">UOM</th>
              <th className="px-2 py-2 print:hidden">
                <span className="sr-only">Delete</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td
                  colSpan={COLS + 1}
                  className="px-3 py-8 text-center text-slate-500"
                >
                  Loading…
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td
                  colSpan={COLS + 1}
                  className="px-3 py-10 text-center text-slate-500"
                >
                  Nothing here yet. Click <strong>Import from Titan</strong> and
                  paste your spreadsheet.
                </td>
              </tr>
            )}
            {!loading && rows.length > 0 && visible.length === 0 && (
              <tr>
                <td
                  colSpan={COLS + 1}
                  className="px-3 py-10 text-center text-slate-500"
                >
                  Nothing matches the selected filters.
                </td>
              </tr>
            )}
            {groups.flatMap((g, gi) => {
              const open = expanded.has(g.structure);
              const shown = open ? g.lines : [g.header];
              return shown.map((r) => {
                const isHeader = r.id === g.header.id;
                return (
                  <tr
                    key={r.id}
                    className={`align-top ${
                      isHeader
                        ? "border-t border-slate-200 font-medium"
                        : "border-t border-slate-100 text-slate-600"
                    } ${
                      selected.has(r.id)
                        ? "bg-red-50/60"
                        : isHeader
                          ? gi % 2
                            ? "bg-slate-50"
                            : "bg-white"
                          : "bg-slate-50/40"
                    }`}
                  >
                    <td className="px-2 py-2 print:hidden">
                      {isHeader ? (
                        <input
                          type="checkbox"
                          checked={selectedInGroup(g) === g.lines.length}
                          ref={(el) => {
                            if (el)
                              el.indeterminate =
                                selectedInGroup(g) > 0 &&
                                selectedInGroup(g) < g.lines.length;
                          }}
                          onChange={() => toggleGroupSelected(g)}
                          aria-label={`Select all ${g.lines.length} lines of ${g.structure}`}
                        />
                      ) : (
                        <input
                          type="checkbox"
                          checked={selected.has(r.id)}
                          onChange={() => toggleRow(r.id)}
                          aria-label={`Select ${r.structure}: ${r.description ?? ""}`}
                        />
                      )}
                    </td>
                    <td className="px-2 py-2 text-slate-600 print:px-1.5">
                      {r.priority ?? ""}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap print:whitespace-normal print:px-1.5">
                      {isHeader ? (
                        <button
                          type="button"
                          onClick={() => toggleGroup(g.structure)}
                          aria-expanded={open}
                          title={
                            open ? "Collapse structure" : "Expand structure"
                          }
                          className="flex items-center gap-2 font-semibold text-navy hover:underline print:pointer-events-none"
                        >
                          <span
                            aria-hidden
                            className="inline-block w-3 text-xs print:hidden"
                          >
                            {open ? "▼" : "▶"}
                          </span>
                          {r.structure}
                          {g.lines.length > 1 && (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 print:hidden">
                              {g.lines.length} lines
                            </span>
                          )}
                        </button>
                      ) : (
                        <span className="pl-5 text-slate-400">
                          ↳ {r.structure}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-xs whitespace-nowrap print:whitespace-normal print:px-1.5">
                      {r.product}
                    </td>
                    <td className="min-w-56 px-2 py-2 print:min-w-0 print:px-1.5">
                      {r.description}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap print:whitespace-normal print:px-1.5">
                      {r.plant_id}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap print:hidden">
                      {r.production_dep}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap print:whitespace-normal print:px-1.5">
                      {fmtDate(r.sch_date)}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap print:whitespace-normal print:px-1.5">
                      {fmtDate(r.ready_date)}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap print:whitespace-normal print:px-1.5">
                      {fmtDate(r.pick_date)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums print:px-1.5">
                      {fmtWeight(r.weight)}
                    </td>
                    <td className="px-2 py-2 print:hidden">{r.uom}</td>
                    <td className="px-2 py-2 text-right print:hidden">
                      <button
                        onClick={() =>
                          isHeader
                            ? askDelete(
                                g.lines.map((l) => l.id),
                                false,
                                g.lines.length === 1
                                  ? `${g.structure} (1 line)`
                                  : `${g.structure} (all ${g.lines.length} lines)`,
                              )
                            : askDelete(
                                [r.id],
                                false,
                                `this line (${r.structure})`,
                              )
                        }
                        className="rounded px-2 py-1 text-xs font-semibold text-brand-red hover:bg-red-50"
                        title={
                          isHeader
                            ? `Delete ${g.structure} and its ${g.lines.length} line(s)`
                            : `Delete ${r.structure}: ${r.description ?? ""}`
                        }
                      >
                        {isHeader && g.lines.length > 1
                          ? "Delete all"
                          : "Delete"}
                      </button>
                    </td>
                  </tr>
                );
              });
            })}
          </tbody>
        </table>
      </section>

      {pendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 print:hidden">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-brand-red">
              Delete {pendingDelete.label}?
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              This permanently removes{" "}
              {pendingDelete.all || pendingDelete.ids.length > 1
                ? "them"
                : "it"}{" "}
              from the tracker. It can&apos;t be undone, but pasting your Titan
              sheet again will bring everything back.
            </p>
            {pendingDelete.all && (
              <div className="mt-4">
                <label className="text-sm text-slate-700">
                  Type <strong>DELETE</strong> to confirm
                  <input
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    autoFocus
                    className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2 text-sm focus:border-brand-red focus:outline-none focus:ring-2 focus:ring-brand-red/20"
                  />
                </label>
              </div>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setPendingDelete(null)}
                disabled={deleting}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void runDelete()}
                disabled={
                  deleting || (pendingDelete.all && confirmText !== "DELETE")
                }
                className="rounded-md bg-brand-red px-4 py-2 text-sm font-semibold text-white hover:bg-brand-red-dark disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showImport && (
        <ImportModal
          jobId={jobId!}
          onClose={() => setShowImport(false)}
          onDone={() => {
            setShowImport(false);
            setSelected(new Set());
            void load();
          }}
        />
      )}
    </div>
  );
}
