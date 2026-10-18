"use client";

// Combined logistics printout: pick any of your jobs and print their Job Logistics
// reports together. It reads the same saved data as the single-job Logistics page
// (Titan lines, hand-added deliveries, typed costs, truckload limit) but keeps its
// own print options, so it never changes the single-job report.

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { jobLine, type Job } from "@/lib/jobs";
import {
  DEFAULT_LIMIT,
  buildItems,
  buildReport,
  money,
  sumC,
  sumW,
  todayIso,
  type Costs,
  type LLine,
  type ManualItem,
} from "@/lib/logistics";
import { hasExtPrice } from "@/lib/priceColumn";
import UserBadge from "./UserBadge";

const lb = (n: number) => `${Math.round(n).toLocaleString("en-US")} lb`;
const us = (d: string | null) => {
  if (!d) return "";
  const [y, m, day] = d.split("-");
  return `${m}/${day}/${y}`;
};
const dow = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { weekday: "short" });
const rank = (x: string) => (x === "FPC-DAC" ? 0 : x === "FPC-A" ? 1 : 2);
const plantTotals = (items: { plants: Record<string, { cost: number }> }[]) => {
  const t: Record<string, number> = {};
  for (const it of items)
    for (const [pl, v] of Object.entries(it.plants))
      t[pl] = (t[pl] ?? 0) + v.cost;
  return Object.entries(t).sort(
    ([a], [b]) => rank(a) - rank(b) || a.localeCompare(b),
  );
};

type Scope = { from: string; to: string } | null;
const EPOCH = "0000-01-01";
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const PRESETS: [string, string][] = [
  ["all", "All dates"],
  ["today", "Today"],
  ["week", "This week"],
  ["lastweek", "Last week"],
  ["month", "This month"],
  ["lastmonth", "Last month"],
  ["custom", "Pick dates…"],
];
function presetRange(k: string): Scope {
  const n = new Date();
  const day = new Date(n.getFullYear(), n.getMonth(), n.getDate());
  const mon = new Date(day);
  mon.setDate(day.getDate() - ((day.getDay() + 6) % 7)); // Monday
  const add = (d: Date, x: number) => {
    const r = new Date(d);
    r.setDate(r.getDate() + x);
    return r;
  };
  if (k === "today") return { from: iso(day), to: iso(day) };
  if (k === "week") return { from: iso(mon), to: iso(add(mon, 6)) };
  if (k === "lastweek")
    return { from: iso(add(mon, -7)), to: iso(add(mon, -1)) };
  if (k === "month")
    return {
      from: iso(new Date(n.getFullYear(), n.getMonth(), 1)),
      to: iso(new Date(n.getFullYear(), n.getMonth() + 1, 0)),
    };
  if (k === "lastmonth")
    return {
      from: iso(new Date(n.getFullYear(), n.getMonth() - 1, 1)),
      to: iso(new Date(n.getFullYear(), n.getMonth(), 0)),
    };
  return null;
}

/** The structures and report for one job under the chosen date range. */
function prep(d: JobData, scope: Scope, includePast: boolean, today: string) {
  let items = buildItems(d.lines, d.manual, d.costs, true);
  if (scope)
    items = items.filter(
      (i) => i.pick && i.pick >= scope.from && i.pick <= scope.to,
    );
  // In a range (or when past deliveries are included) every dated delivery counts,
  // even when its delivery date has already gone by.
  const r = buildReport(items, d.limit, scope || includePast ? EPOCH : today);
  return { items, r };
}

type JobData = {
  lines: LLine[];
  manual: ManualItem[];
  costs: Costs;
  limit: number;
};

type Opts = {
  sum: boolean;
  day: boolean;
  notReady: boolean;
  yard: boolean;
  cost: boolean;
  trucks: boolean;
  overall: boolean;
  newPage: boolean;
};
const OPTS: [keyof Opts, string][] = [
  ["sum", "Delivery summary"],
  ["day", "Delivery schedule by day"],
  ["notReady", "Structures not ready yet"],
  ["yard", "Ready, no pick date (yard)"],
  ["cost", "Costs"],
  ["trucks", "Truckload numbers"],
  ["overall", "Overall totals page"],
  ["newPage", "Start each job on a new page"],
];
const DEFAULT_OPTS: Opts = {
  sum: true,
  day: true,
  notReady: false,
  yard: true,
  cost: true,
  trucks: true,
  overall: true,
  newPage: true,
};

async function loadJob(id: string): Promise<JobData> {
  const sb = getSupabase();
  const withPrice = await hasExtPrice();
  const lines: LLine[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await sb
      .from("titan_lines")
      .select(
        "structure, description, plant_id, sch_date, ready_date, pick_date, weight, qty" +
          (withPrice ? ", ext_price" : ""),
      )
      .eq("job_id", id)
      .order("sort_order")
      .range(from, from + 999);
    lines.push(...((data ?? []) as unknown as LLine[]));
    if (!data || data.length < 1000) break;
  }
  type Saved = { truck_limit?: number; manual?: ManualItem[]; costs?: Costs };
  let s: Saved | null = null;
  let { data: row, error } = await sb
    .from("job_logistics")
    .select("truck_limit, manual, costs")
    .eq("job_id", id)
    .maybeSingle();
  if (error && /costs/i.test(error.message)) {
    ({ data: row, error } = await sb
      .from("job_logistics")
      .select("truck_limit, manual")
      .eq("job_id", id)
      .maybeSingle());
  }
  const local = () => {
    try {
      return JSON.parse(localStorage.getItem(`logistics:${id}`) ?? "null");
    } catch {
      return null;
    }
  };
  s = !error && row ? (row as Saved) : local();
  const loc = local();
  return {
    lines,
    manual: Array.isArray(s?.manual) ? s!.manual! : [],
    costs:
      s?.costs && typeof s.costs === "object" ? s.costs : (loc?.costs ?? {}),
    limit: s?.truck_limit || DEFAULT_LIMIT,
  };
}

const th = "px-2 py-1.5 text-left";
const td = "px-2 py-1.5";
const heading =
  "mb-1 border-b-2 border-navy pb-0.5 text-sm font-bold text-navy";

function JobReport({
  job,
  data,
  o,
  today,
  scope,
  includePast,
  expanded,
  toggle,
}: {
  job: Job;
  data: JobData;
  o: Opts;
  today: string;
  scope: Scope;
  includePast: boolean;
  expanded: Set<string>;
  toggle: (key: string) => void;
}) {
  const { items, r } = useMemo(
    () => prep(data, scope, includePast, today),
    [data, scope, includePast, today],
  );
  const c = o.cost ? "" : "hidden";
  const t = o.trucks ? "" : "hidden";
  const rows: [string, { weight: number; cost: number }[]][] = scope
    ? [["Deliveries in this date range", r.scheduled]]
    : [
        ...(includePast
          ? ([["Picked or scheduled (all pick dates)", r.scheduled]] as [
              string,
              { weight: number; cost: number }[],
            ][])
          : ([
              ["Already picked (pick date passed)", r.picked],
              ["Scheduled for delivery", r.scheduled],
            ] as [string, { weight: number; cost: number }[]][])),
        ["Ready, no pick date (in the yard)", r.yard],
        ...(o.notReady
          ? ([["Not ready yet", r.notReady]] as [
              string,
              { weight: number; cost: number }[],
            ][])
          : []),
      ];
  const shown =
    scope || o.notReady ? items : items.filter((i) => !r.notReady.includes(i));
  const showNotReady = o.notReady && !scope;
  const showYard = o.yard && !scope;
  return (
    <section
      className={`rounded-xl border border-slate-200 bg-white p-6 shadow-sm print:rounded-none print:border-0 print:p-0 print:shadow-none ${
        o.newPage
          ? "print:break-before-page print:first:break-before-auto"
          : "print:mt-8"
      }`}
    >
      <div className="mb-3 flex items-center gap-4 border-b-2 border-navy pb-3">
        <img src="/logo.png" alt="" className="h-14 w-auto" />
        <div className="flex-1">
          <h2 className="text-xl font-bold text-navy">Job Logistics Report</h2>
          <p className="text-sm">{jobLine(job)}</p>
        </div>
        <div className="text-right text-xs text-slate-600">
          <p>
            Printed{" "}
            {new Date().toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </p>
          <p>Truckload limit {data.limit.toLocaleString("en-US")} lb</p>
          {scope && (
            <p className="font-semibold text-navy">
              Deliveries {us(scope.from)} – {us(scope.to)}
            </p>
          )}
        </div>
      </div>

      {items.length === 0 && (
        <p className="text-sm text-slate-600">
          No structures for this job yet.
        </p>
      )}

      {items.length > 0 && o.sum && (
        <>
          <h3 className={heading}>Delivery summary</h3>
          <table className="mb-5 w-full border-collapse text-sm">
            <thead>
              <tr className="bg-navy text-white">
                <th className={th}>Status</th>
                <th className={`${th} text-right`}>Structures</th>
                <th className={`${th} text-right`}>Weight</th>
                <th className={`${th} text-right ${c}`}>Cost</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, xs]) => (
                <tr key={label} className="border-b border-slate-300">
                  <td className={td}>{label}</td>
                  <td className={`${td} text-right tabular-nums`}>
                    {xs.length}
                  </td>
                  <td className={`${td} text-right tabular-nums`}>
                    {lb(sumW(xs))}
                  </td>
                  <td className={`${td} text-right tabular-nums ${c}`}>
                    {money(sumC(xs))}
                  </td>
                </tr>
              ))}
              <tr className="font-bold">
                <td className={td}>
                  {scope
                    ? "Total for this date range"
                    : o.notReady
                      ? "Whole job"
                      : "Total (not-ready structures left out)"}
                </td>
                <td className={`${td} text-right tabular-nums`}>
                  {shown.length}
                </td>
                <td className={`${td} text-right tabular-nums`}>
                  {lb(sumW(shown))}
                </td>
                <td className={`${td} text-right tabular-nums ${c}`}>
                  {money(sumC(shown))}
                </td>
              </tr>
            </tbody>
          </table>
        </>
      )}

      {items.length > 0 && o.day && (
        <>
          <h3 className={heading}>Delivery schedule by day</h3>
          {r.days.length === 0 ? (
            <p className="mb-5 text-sm text-slate-600">
              Nothing is scheduled for delivery from today on.
            </p>
          ) : (
            <table className="mb-5 w-full border-collapse text-sm">
              <thead>
                <tr className="bg-navy text-white">
                  <th className={th}>Delivery date</th>
                  <th className={`${th} text-right`}>Structures</th>
                  <th className={`${th} text-right`}>Weight</th>
                  <th className={`${th} text-right ${c}`}>Cost</th>
                  <th className={`${th} text-right ${t}`}>Truckloads</th>
                </tr>
              </thead>
              <tbody>
                {r.days.map((d) => (
                  <Fragment key={d.date}>
                    <tr className="border-t-2 border-slate-400 bg-slate-100 font-semibold">
                      <td className={td}>
                        {dow(d.date)} {us(d.date)}
                      </td>
                      <td className={`${td} text-right tabular-nums`}>
                        {d.items.length}
                      </td>
                      <td className={`${td} text-right tabular-nums`}>
                        {lb(d.weight)}
                      </td>
                      <td className={`${td} text-right tabular-nums ${c}`}>
                        {money(d.cost)}
                      </td>
                      <td className={`${td} text-right tabular-nums ${t}`}>
                        {d.loads.length}
                      </td>
                    </tr>
                    {d.items.map((it) => (
                      <Fragment key={it.key}>
                        <tr className="border-b border-slate-200 text-xs">
                          <td className={`${td} pl-6`}>
                            {it.pieces.length > 1 ? (
                              <button
                                onClick={() => toggle(`${job.id}|${it.key}`)}
                                className="mr-1 inline-block w-4 text-left text-navy print:hidden"
                                title="Show or hide the parts of this structure"
                              >
                                {expanded.has(`${job.id}|${it.key}`)
                                  ? "▼"
                                  : "▶"}
                              </button>
                            ) : null}
                            <span className="font-medium">{it.name}</span>
                            {it.description && it.pieces.length <= 1
                              ? ` — ${it.description}`
                              : ""}
                            {it.pieces.length > 1 &&
                              !expanded.has(`${job.id}|${it.key}`) && (
                                <span className="ml-2 text-slate-500">
                                  ({it.pieces.length} parts)
                                </span>
                              )}
                            {Object.keys(it.plants).length > 0 && (
                              <div className="mt-0.5 text-[11px] text-slate-600">
                                {Object.entries(it.plants).map(([pl, v], k) => (
                                  <span key={pl}>
                                    {k > 0 && " · "}
                                    <strong>{pl}</strong>
                                    <span className={c}> {money(v.cost)}</span>
                                  </span>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className={td}></td>
                          <td className={`${td} text-right tabular-nums`}>
                            {lb(it.weight)}
                          </td>
                          <td className={`${td} text-right tabular-nums ${c}`}>
                            {it.cost ? money(it.cost) : ""}
                          </td>
                          <td className={`${td} text-right ${t}`}>
                            Load{" "}
                            {d.loads.findIndex((l) => l.items.includes(it)) + 1}
                          </td>
                        </tr>
                        {it.pieces.length > 1 &&
                          expanded.has(`${job.id}|${it.key}`) &&
                          it.pieces.map((pc, pi) => (
                            <tr
                              key={pi}
                              className="border-b border-slate-100 text-[11px] text-slate-600"
                            >
                              <td className={`${td} pl-10`}>
                                • {pc.description || "(part)"} — {pc.plant}
                              </td>
                              <td className={td}></td>
                              <td className={`${td} text-right tabular-nums`}>
                                {lb(pc.weight)}
                              </td>
                              <td
                                className={`${td} text-right tabular-nums ${c}`}
                              >
                                {pc.cost ? money(pc.cost) : ""}
                              </td>
                              <td className={`${td} ${t}`}></td>
                            </tr>
                          ))}
                      </Fragment>
                    ))}
                    {plantTotals(d.items).map(([pl, amt], k, all) => (
                      <tr
                        key={pl}
                        className={`bg-sky-50 text-sm font-semibold ${
                          k === all.length - 1
                            ? "border-b-2 border-slate-300"
                            : ""
                        } ${c}`}
                      >
                        <td
                          colSpan={3}
                          className={`${td} border-l-4 border-navy pr-3 text-right text-navy`}
                        >
                          {k === 0 ? "Invoiced by plant for this day — " : ""}
                          {pl}
                        </td>
                        <td className={`${td} text-right tabular-nums`}>
                          {money(amt)}
                        </td>
                        <td className={`${td} ${t}`}></td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
                <tr className="font-bold">
                  <td className={td}>Total</td>
                  <td className={`${td} text-right tabular-nums`}>
                    {r.scheduled.length}
                  </td>
                  <td className={`${td} text-right tabular-nums`}>
                    {lb(sumW(r.scheduled))}
                  </td>
                  <td className={`${td} text-right tabular-nums ${c}`}>
                    {money(sumC(r.scheduled))}
                  </td>
                  <td className={`${td} text-right tabular-nums ${t}`}>
                    {r.days.reduce((x, d) => x + d.loads.length, 0)}
                  </td>
                </tr>
                {plantTotals(r.scheduled).length > 0 && (
                  <>
                    <tr className={`bg-navy text-white ${c}`}>
                      <td colSpan={5} className={`${td} font-bold`}>
                        Total invoiced by plant (all scheduled deliveries)
                      </td>
                    </tr>
                    {plantTotals(r.scheduled).map(([pl, amt]) => (
                      <tr
                        key={pl}
                        className={`border-b border-slate-300 text-base font-bold ${c}`}
                      >
                        <td colSpan={3} className={`${td} text-right`}>
                          {pl}
                        </td>
                        <td className={`${td} text-right tabular-nums`}>
                          {money(amt)}
                        </td>
                        <td className={`${td} ${t}`}></td>
                      </tr>
                    ))}
                  </>
                )}
              </tbody>
            </table>
          )}
        </>
      )}

      {items.length > 0 && showNotReady && (
        <>
          <h3 className={heading}>Not ready yet ({r.notReady.length})</h3>
          {r.notReady.length === 0 ? (
            <p className="mb-5 text-sm text-slate-600">None.</p>
          ) : (
            <table className="mb-5 w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-400 text-left">
                  <th className={th}>Structure</th>
                  <th className={th}>Description</th>
                  <th className={th}>Scheduled date</th>
                  <th className={th}>Ready date</th>
                  <th className={`${th} text-right`}>Weight</th>
                  <th className={`${th} text-right ${c}`}>Cost</th>
                </tr>
              </thead>
              <tbody>
                {r.notReady.map((i) => (
                  <tr key={i.key} className="border-b border-slate-200">
                    <td className={`${td} font-medium`}>{i.name}</td>
                    <td className={td}>{i.description}</td>
                    <td className={td}>{us(i.sch)}</td>
                    <td className={td}>{us(i.ready)}</td>
                    <td className={`${td} text-right tabular-nums`}>
                      {lb(i.weight)}
                    </td>
                    <td className={`${td} text-right tabular-nums ${c}`}>
                      {money(i.cost)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {items.length > 0 && showYard && (
        <>
          <h3 className={heading}>Ready but no pick date ({r.yard.length})</h3>
          {r.yard.length === 0 ? (
            <p className="mb-5 text-sm text-slate-600">None.</p>
          ) : (
            <table className="mb-5 w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-400 text-left">
                  <th className={th}>Structure</th>
                  <th className={th}>Description</th>
                  <th className={th}>Ready date</th>
                  <th className={`${th} text-right`}>Weight</th>
                  <th className={`${th} text-right ${c}`}>Cost</th>
                </tr>
              </thead>
              <tbody>
                {r.yard.map((i) => (
                  <tr key={i.key} className="border-b border-slate-200">
                    <td className={`${td} font-medium`}>{i.name}</td>
                    <td className={td}>{i.description}</td>
                    <td className={td}>{us(i.ready)}</td>
                    <td className={`${td} text-right tabular-nums`}>
                      {lb(i.weight)}
                    </td>
                    <td className={`${td} text-right tabular-nums ${c}`}>
                      {money(i.cost)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}

export default function LogisticsBundle() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [data, setData] = useState<Record<string, JobData>>({});
  const [busy, setBusy] = useState(false);
  const [o, setO] = useState<Opts>(DEFAULT_OPTS);
  const [preset, setPreset] = useState("all");
  const [cFrom, setCFrom] = useState("");
  const [cTo, setCTo] = useState("");
  const [includePast, setIncludePast] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const v = localStorage.getItem("bundle-expanded");
      if (v) setExpanded(new Set(JSON.parse(v)));
    } catch {}
  }, []);
  const saveExpanded = (next: Set<string>) => {
    setExpanded(next);
    try {
      localStorage.setItem("bundle-expanded", JSON.stringify([...next]));
    } catch {}
  };
  const toggleOne = (key: string) => {
    const next = new Set(expanded);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    saveExpanded(next);
  };

  useEffect(() => {
    try {
      const p = localStorage.getItem("bundle-jobs");
      if (p) setPicked(JSON.parse(p));
      const v = localStorage.getItem("bundle-opts");
      if (v) setO({ ...DEFAULT_OPTS, ...JSON.parse(v) });
    } catch {}
    getSupabase()
      .from("jobs")
      .select("id, job_number, location, customer, position, archived")
      .order("position", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false })
      .then(({ data: d, error: e }) => {
        if (e) setError(e.message);
        setJobs((d ?? []) as Job[]);
        setLoading(false);
      });
  }, []);

  const save = (ids: string[]) => {
    setPicked(ids);
    try {
      localStorage.setItem("bundle-jobs", JSON.stringify(ids));
    } catch {}
  };
  const setOpt = (k: keyof Opts, v: boolean) =>
    setO((cur) => {
      const next = { ...cur, [k]: v };
      try {
        localStorage.setItem("bundle-opts", JSON.stringify(next));
      } catch {}
      return next;
    });

  const visibleJobs = jobs.filter((j) => {
    if (!showArchived && j.archived) return false;
    const q = search.trim().toLowerCase();
    return (
      !q ||
      [j.job_number, j.location, j.customer].some((x) =>
        (x ?? "").toLowerCase().includes(q),
      )
    );
  });
  const chosen = jobs.filter((j) => picked.includes(j.id));

  // Load whatever picked job hasn't been loaded yet.
  useEffect(() => {
    const need = picked.filter(
      (id) => !data[id] && jobs.some((j) => j.id === id),
    );
    if (need.length === 0) return;
    let dead = false;
    setBusy(true);
    void Promise.all(
      need.map(async (id) => [id, await loadJob(id)] as const),
    ).then((res) => {
      if (dead) return;
      setData((d) => ({ ...d, ...Object.fromEntries(res) }));
      setBusy(false);
    });
    return () => {
      dead = true;
    };
  }, [picked, jobs, data]);

  const today = todayIso();
  const scope: Scope = useMemo(() => {
    if (preset === "all") return null;
    if (preset === "custom")
      return cFrom || cTo
        ? { from: cFrom || "0000-01-01", to: cTo || "9999-12-31" }
        : null;
    return presetRange(preset);
  }, [preset, cFrom, cTo]);
  // With a date range, jobs with nothing delivered in it are left out.
  const reportJobs = useMemo(
    () =>
      chosen.filter((j) => {
        const d = data[j.id];
        if (!d) return false;
        return !scope || prep(d, scope, includePast, today).items.length > 0;
      }),
    [chosen, data, scope, includePast, today],
  );
  const overall = useMemo(() => {
    const per = reportJobs.map((j) => {
      const { r } = prep(data[j.id], scope, includePast, today);
      return { job: j, r };
    });
    const plants: Record<string, number> = {};
    for (const { r } of per)
      for (const [pl, c] of plantTotals(r.scheduled))
        plants[pl] = (plants[pl] ?? 0) + c;
    return {
      per,
      plants: Object.entries(plants).sort(
        ([a], [b]) => rank(a) - rank(b) || a.localeCompare(b),
      ),
    };
  }, [reportJobs, data, scope, includePast, today]);

  const c = o.cost ? "" : "hidden";

  return (
    <main className="mx-auto max-w-5xl px-6 py-4 sm:px-10">
      <div className="print:hidden">
        <header className="mb-5 flex flex-wrap items-center gap-4">
          <img src="/logo.png" alt="Lindsay Precast" className="h-20 w-auto" />
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-navy">
              Combined logistics report
            </h1>
            <p className="text-sm text-slate-600">
              Pick any of your jobs and print their logistics reports together.
            </p>
          </div>
          <UserBadge />
          <Link
            href="/"
            className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-white"
          >
            ← Dashboard
          </Link>
          <button
            onClick={() => window.print()}
            disabled={chosen.length === 0 || busy}
            className="rounded-md bg-brand-red px-4 py-2 text-sm font-semibold text-white hover:bg-brand-red-dark disabled:opacity-50"
          >
            Print / Save PDF ({chosen.length})
          </button>
        </header>

        {error && (
          <div className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
            {error}
          </div>
        )}

        <section className="mb-5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <h2 className="font-semibold text-navy">Choose jobs</h2>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search job #, location or customer"
              className="min-w-64 flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
              />
              Show archived
            </label>
            <button
              onClick={() =>
                save([...new Set([...picked, ...visibleJobs.map((j) => j.id)])])
              }
              className="text-sm text-navy underline"
            >
              Select all shown
            </button>
            <button
              onClick={() => save([])}
              className="text-sm text-slate-600 underline"
            >
              Clear
            </button>
          </div>
          {loading ? (
            <p className="text-sm text-slate-600">Loading jobs…</p>
          ) : visibleJobs.length === 0 ? (
            <p className="text-sm text-slate-600">No jobs found.</p>
          ) : (
            <ul className="grid max-h-80 gap-1 overflow-y-auto sm:grid-cols-2">
              {visibleJobs.map((j) => (
                <li key={j.id}>
                  <label className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={picked.includes(j.id)}
                      onChange={(e) =>
                        save(
                          e.target.checked
                            ? [...picked, j.id]
                            : picked.filter((x) => x !== j.id),
                        )
                      }
                    />
                    <span>
                      <strong>{j.job_number}</strong>
                      {j.location ? ` · ${j.location}` : ""}
                      {j.customer && (
                        <span className="block text-xs text-slate-500">
                          {j.customer}
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}

          <h2 className="mt-4 mb-2 text-sm font-semibold text-navy">
            Delivery dates to include
          </h2>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {PRESETS.map(([k, label]) => (
              <button
                key={k}
                onClick={() => setPreset(k)}
                className={`rounded-full border px-3 py-1 ${
                  preset === k
                    ? "border-navy bg-navy text-white"
                    : "border-slate-300 hover:bg-slate-50"
                }`}
              >
                {label}
              </button>
            ))}
            {preset === "custom" && (
              <>
                <label className="flex items-center gap-1">
                  From
                  <input
                    type="date"
                    value={cFrom}
                    onChange={(e) => setCFrom(e.target.value)}
                    className="rounded-md border border-slate-300 px-2 py-1"
                  />
                </label>
                <label className="flex items-center gap-1">
                  To
                  <input
                    type="date"
                    value={cTo}
                    onChange={(e) => setCTo(e.target.value)}
                    className="rounded-md border border-slate-300 px-2 py-1"
                  />
                </label>
              </>
            )}
          </div>
          {scope ? (
            <p className="mt-2 text-xs text-slate-600">
              Showing every structure with a pick (delivery) date from{" "}
              {us(scope.from)} to {us(scope.to)}, including deliveries that have
              already happened. Pick two months by choosing “Pick dates…” and
              setting From and To. Jobs with nothing in the range are left out.
            </p>
          ) : (
            <label className="mt-2 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={includePast}
                onChange={(e) => setIncludePast(e.target.checked)}
              />
              Include deliveries whose date has already passed (already picked)
              in the schedule and totals
            </label>
          )}

          <h2 className="mt-4 mb-2 text-sm font-semibold text-navy">
            Structures with several parts
          </h2>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <button
              onClick={() => {
                const all = new Set<string>();
                for (const j of reportJobs)
                  for (const i of prep(data[j.id], scope, includePast, today)
                    .items)
                    if (i.pieces.length > 1) all.add(`${j.id}|${i.key}`);
                saveExpanded(all);
              }}
              className="rounded-md border border-navy px-3 py-1 font-semibold text-navy hover:bg-slate-50"
            >
              Expand all
            </button>
            <button
              onClick={() => saveExpanded(new Set())}
              className="rounded-md border border-slate-300 px-3 py-1 hover:bg-slate-50"
            >
              Collapse all
            </button>
            <span className="text-xs text-slate-500">
              Or click the ▶ arrow next to a structure in the report below. What
              is open is what prints.
            </span>
          </div>

          <h2 className="mt-4 mb-2 text-sm font-semibold text-navy">
            What to print
          </h2>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
            {OPTS.map(([k, label]) => (
              <label key={k} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={o[k]}
                  onChange={(e) => setOpt(k, e.target.checked)}
                />
                {label}
              </label>
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Each report uses that job’s saved truckload limit, hand-added
            deliveries and typed costs from its own Logistics page. These
            options only apply to this combined printout.
          </p>
        </section>
        {busy && (
          <p className="mb-3 text-sm text-slate-600">Loading reports…</p>
        )}
        {chosen.length === 0 && !loading && (
          <p className="text-sm text-slate-600">
            Tick one or more jobs above to see the combined report.
          </p>
        )}
      </div>

      <div className="space-y-6 print:space-y-0">
        {reportJobs.map((j) => (
          <JobReport
            key={j.id}
            job={j}
            data={data[j.id]}
            o={o}
            today={today}
            scope={scope}
            includePast={includePast}
            expanded={expanded}
            toggle={toggleOne}
          />
        ))}

        {o.overall &&
          reportJobs.length > 1 &&
          overall.per.length === reportJobs.length && (
            <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm print:break-before-page print:rounded-none print:border-0 print:p-0 print:shadow-none">
              <div className="mb-3 flex items-center gap-4 border-b-2 border-navy pb-3">
                <img src="/logo.png" alt="" className="h-14 w-auto" />
                <div className="flex-1">
                  <h2 className="text-xl font-bold text-navy">
                    Overall totals — scheduled deliveries
                  </h2>
                  <p className="text-sm">
                    {reportJobs.length} jobs
                    {scope
                      ? ` · deliveries ${us(scope.from)} – ${us(scope.to)}`
                      : ""}{" "}
                    · printed{" "}
                    {new Date().toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}
                  </p>
                </div>
              </div>
              <table className="mb-5 w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-navy text-white">
                    <th className={th}>Job</th>
                    <th className={`${th} text-right`}>Structures</th>
                    <th className={`${th} text-right`}>Weight</th>
                    <th className={`${th} text-right ${c}`}>Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {overall.per.map(({ job, r }) => (
                    <tr key={job.id} className="border-b border-slate-300">
                      <td className={td}>
                        <strong>{job.job_number}</strong>
                        {job.location ? ` · ${job.location}` : ""}
                      </td>
                      <td className={`${td} text-right tabular-nums`}>
                        {r.scheduled.length}
                      </td>
                      <td className={`${td} text-right tabular-nums`}>
                        {lb(sumW(r.scheduled))}
                      </td>
                      <td className={`${td} text-right tabular-nums ${c}`}>
                        {money(sumC(r.scheduled))}
                      </td>
                    </tr>
                  ))}
                  <tr className="font-bold">
                    <td className={td}>All jobs</td>
                    <td className={`${td} text-right tabular-nums`}>
                      {overall.per.reduce(
                        (x, p) => x + p.r.scheduled.length,
                        0,
                      )}
                    </td>
                    <td className={`${td} text-right tabular-nums`}>
                      {lb(
                        overall.per.reduce(
                          (x, p) => x + sumW(p.r.scheduled),
                          0,
                        ),
                      )}
                    </td>
                    <td className={`${td} text-right tabular-nums ${c}`}>
                      {money(
                        overall.per.reduce(
                          (x, p) => x + sumC(p.r.scheduled),
                          0,
                        ),
                      )}
                    </td>
                  </tr>
                  {overall.plants.length > 0 && (
                    <>
                      <tr className={`bg-navy text-white ${c}`}>
                        <td colSpan={4} className={`${td} font-bold`}>
                          Total invoiced by plant (all jobs)
                        </td>
                      </tr>
                      {overall.plants.map(([pl, amt]) => (
                        <tr
                          key={pl}
                          className={`border-b border-slate-300 text-base font-bold ${c}`}
                        >
                          <td colSpan={3} className={`${td} text-right`}>
                            {pl}
                          </td>
                          <td className={`${td} text-right tabular-nums`}>
                            {money(amt)}
                          </td>
                        </tr>
                      ))}
                    </>
                  )}
                </tbody>
              </table>
            </section>
          )}
      </div>
    </main>
  );
}
