"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { rememberJob, withJob, type Job } from "@/lib/jobs";
import BackButton from "./BackButton";
import {
  analyze,
  fmtShort,
  type JobMetrics,
  type MetricLine,
  type QuickKey,
} from "@/lib/metrics";

const PAGE = 1000;

type View = "cards" | "rows";
const VIEW_KEY = "jobs-view";
const empty = { job_number: "", location: "", customer: "" };

export default function Dashboard() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(empty);
  const [editId, setEditId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<View>("cards");
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      const v = localStorage.getItem("jobs-collapsed");
      if (v) setCollapsed(new Set(JSON.parse(v) as string[]));
    } catch {}
  }, []);
  const saveCollapsed = (next: Set<string>) => {
    setCollapsed(next);
    try {
      localStorage.setItem("jobs-collapsed", JSON.stringify([...next]));
    } catch {}
  };
  const toggleGroup = (key: string) => {
    const n = new Set(collapsed);
    if (n.has(key)) n.delete(key);
    else n.add(key);
    saveCollapsed(n);
  };
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [dragGroup, setDragGroup] = useState<string | null>(null);
  const [overGroup, setOverGroup] = useState<string | null>(null);

  useEffect(() => {
    try {
      const v = localStorage.getItem(VIEW_KEY);
      if (v === "cards" || v === "rows") setView(v);
    } catch {}
  }, []);
  const pickView = (v: View) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {}
  };

  const load = useCallback(async () => {
    const { data, error } = await getSupabase()
      .from("jobs")
      .select("id, job_number, location, customer, position, archived")
      .order("position", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });
    if (error) {
      setError(
        /relation|jobs|position|archived/.test(error.message)
          ? `${error.message} — run the updated supabase/schema.sql in Supabase first.`
          : error.message,
      );
    } else {
      setError(null);
      setJobs((data ?? []) as Job[]);
    }
    setLoading(false);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  // Per-job metrics (structure counts), from the lines saved for each job.
  // Remember where you left off (search, tab, scroll) so Back returns to the same view.
  const restoredUi = useRef(false);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("dash-ui");
      if (raw) {
        const u = JSON.parse(raw);
        setSearch(u.search ?? "");
        setShowArchived(!!u.showArchived);
      }
    } catch {}
    restoredUi.current = true;
  }, []);
  useEffect(() => {
    if (!restoredUi.current) return;
    try {
      sessionStorage.setItem(
        "dash-ui",
        JSON.stringify({ search, showArchived }),
      );
    } catch {}
  }, [search, showArchived]);
  useEffect(() => {
    let t: number | undefined;
    const save = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => {
        try {
          sessionStorage.setItem("dash-scroll", String(window.scrollY));
        } catch {}
      }, 100);
    };
    window.addEventListener("scroll", save, { passive: true });
    return () => window.removeEventListener("scroll", save);
  }, []);
  useEffect(() => {
    if (loading) return;
    try {
      const y = Number(sessionStorage.getItem("dash-scroll") ?? 0);
      if (y > 0) requestAnimationFrame(() => window.scrollTo(0, y));
    } catch {}
  }, [loading]);

  const [metrics, setMetrics] = useState<Record<string, JobMetrics>>({});
  const [metricsJobId, setMetricsJobId] = useState<string | null>(null);
  useEffect(() => {
    try {
      setMetricsJobId(localStorage.getItem("metrics-job-id"));
    } catch {}
  }, []);
  const openMetrics = (id: string | null) => {
    setMetricsJobId(id);
    try {
      if (id) localStorage.setItem("metrics-job-id", id);
      else localStorage.removeItem("metrics-job-id");
    } catch {}
  };
  const [metricsError, setMetricsError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const byJob = new Map<string, MetricLine[]>();
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await getSupabase()
          .from("titan_lines")
          .select("job_id, structure, sch_date, ready_date, pick_date")
          .order("id", { ascending: true })
          .range(from, from + PAGE - 1);
        if (cancelled) return;
        if (error) {
          setMetricsError(error.message);
          return;
        }
        for (const r of (data ?? []) as (MetricLine & {
          job_id: string | null;
        })[]) {
          if (!r.job_id) continue;
          const list = byJob.get(r.job_id) ?? [];
          list.push(r);
          byJob.set(r.job_id, list);
        }
        if (!data || data.length < PAGE) break;
      }
      const out: Record<string, JobMetrics> = {};
      for (const [id, lines] of byJob) out[id] = analyze(lines);
      setMetrics(out);
      setMetricsError(null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async () => {
    if (!form.job_number.trim()) return;
    setBusy(true);
    const record = {
      job_number: form.job_number.trim(),
      location: form.location.trim() || null,
      customer: form.customer.trim() || null,
    };
    const q = getSupabase().from("jobs");
    const top = jobs.reduce((m, j) => Math.min(m, j.position ?? 0), 0) - 1;
    const { error } = editId
      ? await q.update(record).eq("id", editId)
      : await q.insert({ ...record, position: top });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setForm(empty);
    setEditId(null);
    await load();
  };

  const startEdit = (j: Job) => {
    setEditId(j.id);
    setForm({
      job_number: j.job_number,
      location: j.location ?? "",
      customer: j.customer ?? "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const cancelEdit = () => {
    setEditId(null);
    setForm(empty);
  };

  const setArchived = async (j: Job, archived: boolean) => {
    const { error } = await getSupabase()
      .from("jobs")
      .update({ archived })
      .eq("id", j.id);
    if (error) setError(error.message);
    else {
      if (editId === j.id) cancelEdit();
      await load();
    }
  };

  const remove = async (j: Job) => {
    if (!window.confirm(`Delete job #${j.job_number}? This can't be undone.`))
      return;
    const { error } = await getSupabase().from("jobs").delete().eq("id", j.id);
    if (error) setError(error.message);
    else {
      if (editId === j.id) cancelEdit();
      await load();
    }
  };

  const canDrag = search.trim() === "";
  const viewJobs = useMemo(
    () => jobs.filter((j) => !!j.archived === showArchived),
    [jobs, showArchived],
  );
  const activeCount = jobs.filter((j) => !j.archived).length;
  const archivedCount = jobs.length - activeCount;

  // Jobs are grouped by customer. Group order = order of each group's first job.
  const groupsOf = (list: Job[]) => {
    const map = new Map<string, { key: string; name: string; jobs: Job[] }>();
    for (const j of list) {
      const name = (j.customer ?? "").trim() || "No customer";
      const key = name.toLowerCase();
      const g = map.get(key) ?? { key, name, jobs: [] };
      g.jobs.push(j);
      map.set(key, g);
    }
    return [...map.values()];
  };

  const persist = async (viewFlat: Job[]) => {
    // Keep jobs from the other tab after the reordered ones.
    const inView = new Set(viewFlat.map((j) => j.id));
    const flat = [...viewFlat, ...jobs.filter((j) => !inView.has(j.id))];
    const ordered = flat.map((j, n) => ({ ...j, position: n }));
    setJobs(ordered);
    const results = await Promise.all(
      ordered.map((j) =>
        getSupabase()
          .from("jobs")
          .update({ position: j.position })
          .eq("id", j.id),
      ),
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) {
      setError(failed.error.message);
      await load();
    }
  };

  const clearDrag = () => {
    setDragId(null);
    setOverId(null);
    setDragGroup(null);
    setOverGroup(null);
  };

  const dropGroup = async (targetKey: string) => {
    const from = dragGroup;
    clearDrag();
    if (!from || from === targetKey) return;
    const gs = groupsOf(viewJobs);
    const i = gs.findIndex((g) => g.key === from);
    const k = gs.findIndex((g) => g.key === targetKey);
    if (i < 0 || k < 0) return;
    const [moved] = gs.splice(i, 1);
    gs.splice(k, 0, moved);
    await persist(gs.flatMap((g) => g.jobs));
  };

  // Jobs can be reordered within their customer's group.
  const dropJob = async (targetId: string) => {
    const from = dragId;
    clearDrag();
    if (!from || from === targetId) return;
    const gs = groupsOf(viewJobs);
    const g = gs.find(
      (x) =>
        x.jobs.some((j) => j.id === from) &&
        x.jobs.some((j) => j.id === targetId),
    );
    if (!g) return;
    const i = g.jobs.findIndex((j) => j.id === from);
    const k = g.jobs.findIndex((j) => j.id === targetId);
    const [moved] = g.jobs.splice(i, 1);
    g.jobs.splice(k, 0, moved);
    await persist(gs.flatMap((x) => x.jobs));
  };

  const jobDrag = (id: string, key: string) =>
    canDrag
      ? {
          draggable: true,
          onDragStart: (e: React.DragEvent) => {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", id);
            setDragId(id);
          },
          onDragOver: (e: React.DragEvent) => {
            if (!dragId) return;
            const same = groupsOf(viewJobs).some(
              (g) => g.key === key && g.jobs.some((j) => j.id === dragId),
            );
            if (!same) return;
            e.preventDefault();
            if (overId !== id) setOverId(id);
          },
          onDrop: (e: React.DragEvent) => {
            e.preventDefault();
            void dropJob(id);
          },
          onDragEnd: clearDrag,
        }
      : {};
  const jobState = (id: string) =>
    dragId === id
      ? "opacity-40"
      : overId === id && dragId
        ? "ring-2 ring-navy"
        : "";

  const groupDrag = (key: string) =>
    canDrag
      ? {
          draggable: true,
          onDragStart: (e: React.DragEvent) => {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", key);
            setDragGroup(key);
          },
          onDragOver: (e: React.DragEvent) => {
            if (!dragGroup) return;
            e.preventDefault();
            if (overGroup !== key) setOverGroup(key);
          },
          onDrop: (e: React.DragEvent) => {
            e.preventDefault();
            void dropGroup(key);
          },
          onDragEnd: clearDrag,
        }
      : {};
  const groupState = (key: string) =>
    dragGroup === key
      ? "opacity-40"
      : overGroup === key && dragGroup
        ? "ring-2 ring-navy"
        : "";

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return viewJobs;
    return viewJobs.filter((j) =>
      [j.job_number, j.location, j.customer].some((v) =>
        (v ?? "").toLowerCase().includes(q),
      ),
    );
  }, [viewJobs, search]);

  const groups = useMemo(() => groupsOf(shown), [shown]);

  const groupHeader = (g: { key: string; name: string; jobs: Job[] }) => (
    <div
      {...groupDrag(g.key)}
      onClick={() => toggleGroup(g.key)}
      className={`flex items-center gap-2 bg-navy px-3 py-2 text-white select-none ${collapsed.has(g.key) ? "rounded-lg" : "rounded-t-lg"} ${canDrag ? "cursor-grab active:cursor-grabbing" : ""} ${groupState(g.key)}`}
    >
      {canDrag && (
        <span className="text-white/60" aria-hidden>
          ⋮⋮
        </span>
      )}
      <span className="w-3 text-xs" aria-hidden>
        {collapsed.has(g.key) ? "▶" : "▼"}
      </span>
      <h3 className="font-semibold">{g.name}</h3>
      <span className="text-sm text-white/70">
        {g.jobs.length} job{g.jobs.length === 1 ? "" : "s"}
      </span>
    </div>
  );

  const actions = (j: Job) => (
    <div className="flex flex-wrap items-center justify-end gap-2 text-sm">
      <button
        onClick={() => openMetrics(metricsJobId === j.id ? null : j.id)}
        aria-pressed={metricsJobId === j.id}
        className={`rounded-md border border-navy px-3 py-1.5 font-semibold ${
          metricsJobId === j.id
            ? "bg-navy text-white"
            : "bg-white text-navy hover:bg-slate-50"
        }`}
      >
        Metrics
      </button>
      <Link
        href={withJob("/structures", j.id)}
        onClick={() => rememberJob(j.id)}
        className="rounded-md bg-navy px-3 py-1.5 font-semibold text-white hover:bg-navy-dark"
      >
        Structure Tracker
      </Link>
      <Link
        href={withJob("/procurement", j.id)}
        onClick={() => rememberJob(j.id)}
        className="rounded-md border border-navy px-3 py-1.5 font-semibold text-navy hover:bg-white"
      >
        Procurement Order
      </Link>
      <button
        onClick={() => setArchived(j, !j.archived)}
        className="px-2 py-1.5 font-medium text-slate-600 hover:underline"
      >
        {j.archived ? "Restore" : "Archive"}
      </button>
      <button
        onClick={() => startEdit(j)}
        className="px-2 py-1.5 font-medium text-navy hover:underline"
      >
        Edit
      </button>
      <button
        onClick={() => remove(j)}
        className="px-2 py-1.5 text-brand-red hover:underline"
      >
        Delete
      </button>
    </div>
  );

  const metricsJob = jobs.find((j) => j.id === metricsJobId) ?? null;

  // Fixed to the right edge so the dashboard itself stays centered.
  const MetricsPanel = () => {
    if (!metricsJob) return null;
    const m = metrics[metricsJob.id];
    const link = (key: QuickKey) =>
      `${withJob("/structures", metricsJob.id)}&show=${key}`;

    const chip = (
      key: QuickKey,
      label: string,
      note: string | null,
      tone: "red" | "navy" | "green",
    ) => {
      const count = m.sets[key].size;
      const color =
        tone === "red"
          ? "border-brand-red text-brand-red hover:bg-red-50"
          : tone === "green"
            ? "border-emerald-600 text-emerald-700 hover:bg-emerald-50"
            : "border-navy text-navy hover:bg-slate-50";
      return (
        <Link
          key={key}
          href={link(key)}
          onClick={() => rememberJob(metricsJob.id)}
          title={`Open these ${count} structure${count === 1 ? "" : "s"} in the Structure Tracker`}
          className={`flex items-center justify-between rounded-lg border-2 bg-white px-3 py-2 ${color}`}
        >
          <span className="text-sm font-semibold">{label}</span>
          <span className="text-right">
            <span className="text-xl font-bold">{count}</span>
            {note && (
              <span className="block text-xs text-slate-600">{note}</span>
            )}
          </span>
        </Link>
      );
    };

    let body: React.ReactNode;
    if (!m) {
      body = (
        <p className="text-sm text-slate-600">
          {metricsError
            ? metricsError
            : "No Titan data for this job yet. Open its Structure Tracker and paste the Titan sheet."}
        </p>
      );
    } else {
      const { sets } = m;
      let schedOnly = 0;
      for (const s of sets.scheduled)
        if (!sets.ready.has(s) && !sets.picked.has(s)) schedOnly++;
      let readyOnly = 0;
      for (const s of sets.ready) if (!sets.picked.has(s)) readyOnly++;
      const segs = [
        { n: sets.notScheduled.size, c: "bg-brand-red", t: "Not scheduled" },
        { n: schedOnly, c: "bg-navy/60", t: "Scheduled to pour" },
        { n: readyOnly, c: "bg-amber-400", t: "Ready" },
        { n: sets.picked.size, c: "bg-emerald-600", t: "Pick date set" },
      ];
      body = (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            {m.total} structure{m.total === 1 ? "" : "s"} in this job
          </p>
          <div>
            <div className="flex h-3 overflow-hidden rounded-full bg-slate-200">
              {segs.map((s) => (
                <div
                  key={s.t}
                  title={`${s.t}: ${s.n}`}
                  className={s.c}
                  style={{ width: `${(s.n / Math.max(m.total, 1)) * 100}%` }}
                />
              ))}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-600">
              {segs.map((s) => (
                <span key={s.t} className="inline-flex items-center gap-1">
                  <span className={`h-2 w-2 rounded-full ${s.c}`} />
                  {s.t}
                </span>
              ))}
            </div>
          </div>
          {chip("notScheduled", "Not scheduled to pour", null, "red")}
          {chip("scheduled", "Scheduled to pour", null, "navy")}
          {chip(
            "ready",
            "Ready Date",
            m.nextReady ? `next ${fmtShort(m.nextReady)}` : "none upcoming",
            "navy",
          )}
          {chip(
            "picked",
            "Pick Date",
            m.nextPick ? `next ${fmtShort(m.nextPick)}` : "none upcoming",
            "green",
          )}
          {(sets.pourOverdue.size > 0 || sets.readyOverdue.size > 0) && (
            <div className="space-y-2 border-t border-slate-200 pt-3">
              <p className="text-xs font-semibold tracking-wide text-brand-red uppercase">
                Overdue
              </p>
              {sets.pourOverdue.size > 0 &&
                chip("pourOverdue", "Pour date passed, not ready", null, "red")}
              {sets.readyOverdue.size > 0 &&
                chip(
                  "readyOverdue",
                  "Ready date passed, not picked",
                  null,
                  "red",
                )}
            </div>
          )}
        </div>
      );
    }

    return (
      <aside className="fixed top-0 right-0 z-40 flex h-full w-80 flex-col border-l border-slate-200 bg-slate-50 shadow-xl sm:w-96 print:hidden">
        <div className="flex items-start gap-2 bg-navy p-4 text-white">
          <div className="flex-1">
            <p className="text-xs tracking-wide text-white/70 uppercase">
              Job metrics
            </p>
            <p className="text-lg font-bold">Job #{metricsJob.job_number}</p>
            <p className="text-sm text-white/80">
              {[metricsJob.location, metricsJob.customer]
                .filter(Boolean)
                .join(" · ") || "—"}
            </p>
          </div>
          <button
            onClick={() => openMetrics(null)}
            aria-label="Close metrics"
            className="rounded px-2 text-xl leading-none text-white/80 hover:text-white"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">{body}</div>
        <p className="border-t border-slate-200 p-3 text-xs text-slate-500">
          Counts are structures (a structure counts once). Based on the last
          Titan paste. Click a number to open those structures in the tracker.
        </p>
      </aside>
    );
  };

  const field =
    "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/20";

  return (
    <main className="mx-auto max-w-7xl px-6 py-4 sm:px-10">
      <header className="mb-5 flex flex-wrap items-center gap-4">
        <img src="/logo.png" alt="Lindsay Precast" className="h-20 w-auto" />
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-navy">Dashboard</h1>
          <p className="text-sm text-slate-600">
            Your jobs. Open one to see its Structure Tracker or Procurement
            Order.
          </p>
        </div>
        <BackButton />
        <button
          onClick={() => void getSupabase().auth.signOut()}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-white"
        >
          Sign out
        </button>
      </header>

      {error && (
        <div className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <section className="mb-5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 font-semibold text-navy">
          {editId ? "Edit job" : "Add a job"}
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm">
            <span className="font-medium text-navy">Job #</span>
            <input
              value={form.job_number}
              onChange={(e) => setForm({ ...form, job_number: e.target.value })}
              className={field}
            />
          </label>
          <label className="text-sm">
            <span className="font-medium text-navy">Job location</span>
            <input
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
              className={field}
            />
          </label>
          <label className="text-sm">
            <span className="font-medium text-navy">Customer</span>
            <input
              value={form.customer}
              onChange={(e) => setForm({ ...form, customer: e.target.value })}
              className={field}
            />
          </label>
        </div>
        <div className="mt-3 flex gap-2">
          <button
            onClick={save}
            disabled={busy || !form.job_number.trim()}
            className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy-dark disabled:opacity-50"
          >
            {busy ? "Saving…" : editId ? "Save changes" : "Add job"}
          </button>
          {editId && (
            <button
              onClick={cancelEdit}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
            >
              Cancel
            </button>
          )}
        </div>
      </section>

      <div className="mb-3 inline-flex overflow-hidden rounded-md border border-navy text-sm">
        {[
          { archived: false, label: `Active (${activeCount})` },
          { archived: true, label: `Archived (${archivedCount})` },
        ].map((t) => (
          <button
            key={t.label}
            onClick={() => setShowArchived(t.archived)}
            aria-pressed={showArchived === t.archived}
            className={`px-4 py-2 font-medium ${
              showArchived === t.archived
                ? "bg-navy text-white"
                : "bg-white text-navy"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search jobs…"
          className="w-64 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
        />
        <span className="text-sm text-slate-600">
          {shown.length} job{shown.length === 1 ? "" : "s"}
          {canDrag && shown.length > 1
            ? " · drag groups or jobs to reorder"
            : shown.length > 1
              ? " · clear search to reorder"
              : ""}
        </span>
        {groups.length > 0 && (
          <button
            onClick={() =>
              saveCollapsed(
                groups.every((g) => collapsed.has(g.key))
                  ? new Set()
                  : new Set(groups.map((g) => g.key)),
              )
            }
            className="text-sm font-medium text-navy underline"
          >
            {groups.every((g) => collapsed.has(g.key))
              ? "Expand all"
              : "Collapse all"}
          </button>
        )}
        <div
          className="ml-auto inline-flex overflow-hidden rounded-md border border-navy text-sm"
          role="group"
          aria-label="View"
        >
          {(["cards", "rows"] as View[]).map((v) => (
            <button
              key={v}
              onClick={() => pickView(v)}
              aria-pressed={view === v}
              className={`px-4 py-2 font-medium ${
                view === v ? "bg-navy text-white" : "bg-white text-navy"
              }`}
            >
              {v === "cards" ? "Cards" : "Rows"}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="p-6 text-slate-600">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="rounded-md border border-slate-200 bg-white p-6 text-slate-600">
          {viewJobs.length > 0
            ? "No jobs match your search."
            : showArchived
              ? "No archived jobs."
              : jobs.length === 0
                ? "No jobs yet. Add your first job above."
                : "No active jobs. Check the Archived tab."}
        </p>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.key}>
              {groupHeader(g)}
              {collapsed.has(g.key) ? null : view === "cards" ? (
                <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {g.jobs.map((j) => (
                    <article
                      key={j.id}
                      {...jobDrag(j.id, g.key)}
                      className={`flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm ${canDrag ? "cursor-grab active:cursor-grabbing" : ""} ${jobState(j.id)}`}
                    >
                      <div>
                        <p className="text-xs tracking-wide text-slate-500 uppercase">
                          Job #
                        </p>
                        <p className="text-xl font-bold text-navy">
                          {j.job_number}
                        </p>
                      </div>
                      <div className="text-sm">
                        <p>
                          <span className="text-slate-500">Location:</span>{" "}
                          {j.location || "—"}
                        </p>
                        <p>
                          <span className="text-slate-500">Customer:</span>{" "}
                          {j.customer || "—"}
                        </p>
                      </div>
                      <div className="mt-auto [&>div]:justify-start">
                        {actions(j)}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="overflow-x-auto rounded-b-xl border border-t-0 border-slate-200 bg-white shadow-sm">
                  <table className="w-full table-fixed text-left text-sm">
                    <thead className="bg-slate-100 text-slate-700">
                      <tr>
                        <th className="w-32 px-3 py-2">Job #</th>
                        <th className="w-[20%] px-3 py-2">Job location</th>
                        <th className="w-[13%] px-3 py-2">Customer</th>
                        <th className="px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {g.jobs.map((j) => (
                        <tr
                          key={j.id}
                          {...jobDrag(j.id, g.key)}
                          className={`border-t border-slate-200 ${canDrag ? "cursor-grab active:cursor-grabbing" : ""} ${jobState(j.id)}`}
                        >
                          <td className="px-3 py-2 font-semibold text-navy">
                            {canDrag && (
                              <span className="mr-2 text-slate-400" aria-hidden>
                                ⋮⋮
                              </span>
                            )}
                            {j.job_number}
                          </td>
                          <td className="px-3 py-2">{j.location || "—"}</td>
                          <td className="px-3 py-2">{j.customer || "—"}</td>
                          <td className="px-3 py-2 [&>div]:flex-nowrap [&>div]:whitespace-nowrap">
                            {actions(j)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ))}
        </div>
      )}
      {MetricsPanel()}
    </main>
  );
}
