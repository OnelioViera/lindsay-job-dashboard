"use client";

import Link from "next/link";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { getSupabase } from "@/lib/supabase";
import { jobLine, useActiveJob, withJob } from "@/lib/jobs";
import {
  DEFAULT_LIMIT,
  buildItems,
  buildReport,
  money,
  sumC,
  sumW,
  type Costs,
  todayIso,
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
const plantTotals = (items: { plants: Record<string, { cost: number }> }[]) => {
  const t: Record<string, number> = {};
  for (const it of items)
    for (const [pl, v] of Object.entries(it.plants))
      t[pl] = (t[pl] ?? 0) + v.cost;
  return Object.entries(t).sort(([a], [b]) => a.localeCompare(b));
};
const dow = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { weekday: "short" });
const n = (x: number, one: string, many = `${one}s`) =>
  `${x.toLocaleString("en-US")} ${x === 1 ? one : many}`;

const blank = {
  name: "",
  description: "",
  qty: "1",
  weight: "",
  cost: "",
  pick: "",
};

export default function Logistics() {
  const { job, loading: jobLoading } = useActiveJob();
  const jobId = job?.id ?? null;
  const [lines, setLines] = useState<LLine[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [limitText, setLimitText] = useState(String(DEFAULT_LIMIT));
  const [manual, setManual] = useState<ManualItem[]>([]);
  const [costs, setCosts] = useState<Costs>({});
  const [form, setForm] = useState(blank);
  const [error, setError] = useState<string | null>(null);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [noPrint, setNoPrint] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const v = localStorage.getItem("logistics-print-hidden");
      if (v) setNoPrint(new Set(JSON.parse(v)));
    } catch {}
  }, []);
  const togglePrint = (k: string) =>
    setNoPrint((cur) => {
      const next = new Set(cur);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      try {
        localStorage.setItem(
          "logistics-print-hidden",
          JSON.stringify([...next]),
        );
      } catch {}
      return next;
    });
  const skip = (k: string) => (noPrint.has(k) ? "print:hidden" : "");
  const [emptyNote, setEmptyNote] = useState("");
  useEffect(() => {
    try {
      setEmptyNote(localStorage.getItem(`logistics-empty-note:${jobId}`) ?? "");
    } catch {}
  }, [jobId]);
  const changeEmptyNote = (v: string) => {
    setEmptyNote(v);
    try {
      localStorage.setItem(`logistics-empty-note:${jobId}`, v);
    } catch {}
  };
  const [nrCols, setNrCols] = useState<Set<string>>(new Set(["sch", "ready"]));
  useEffect(() => {
    try {
      const v = localStorage.getItem("logistics-notready-cols");
      if (v) setNrCols(new Set(JSON.parse(v)));
    } catch {}
  }, []);
  const toggleNrCol = (k: string) =>
    setNrCols((cur) => {
      const next = new Set(cur);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      try {
        localStorage.setItem(
          "logistics-notready-cols",
          JSON.stringify([...next]),
        );
      } catch {}
      return next;
    });
  const [showNotReady, setShowNotReady] = useState(true);
  useEffect(() => {
    try {
      if (localStorage.getItem("logistics-show-notready") === "0")
        setShowNotReady(false);
    } catch {}
  }, []);
  const changeShowNotReady = (v: boolean) => {
    setShowNotReady(v);
    try {
      localStorage.setItem("logistics-show-notready", v ? "1" : "0");
    } catch {}
  };
  const PRINT_SECTIONS: [string, string][] = [
    ["sum", "Delivery summary"],
    ["day", "Delivery schedule by day"],
    ["yard", "Yard and risk list"],
    ["load", "Truckload grouping"],
    ["cost", "Costs"],
    ["trucks", "Truckload numbers"],
  ];
  const ready = useRef(false); // settings loaded; changes after this get saved

  const limit = Math.max(
    1,
    Number(limitText.replace(/,/g, "")) || DEFAULT_LIMIT,
  );
  const localKey = `logistics:${jobId}`;

  const load = useCallback(async () => {
    if (!jobId) return;
    const supabase = getSupabase();
    const all: LLine[] = [];
    const withPrice = await hasExtPrice();
    for (let from = 0; ; from += 1000) {
      const { data, error: e } = await supabase
        .from("titan_lines")
        .select(
          "structure, description, plant_id, sch_date, ready_date, pick_date, weight, qty" +
            (withPrice ? ", ext_price" : ""),
        )
        .eq("job_id", jobId)
        .order("sort_order")
        .range(from, from + 999);
      if (e) {
        setError(e.message);
        break;
      }
      all.push(...((data ?? []) as unknown as LLine[]));
      if (!data || data.length < 1000) break;
    }
    setLines(all);
    setLoaded(true);

    // Settings: online if the table exists, otherwise this computer's copy.
    type Saved = {
      truck_limit?: number;
      manual?: ManualItem[];
      costs?: Costs;
    };
    let s: Saved | null = null;
    let { data: row, error: se } = await supabase
      .from("job_logistics")
      .select("truck_limit, manual, costs")
      .eq("job_id", jobId)
      .maybeSingle();
    // Older table without the costs column: load the rest and keep costs on this computer.
    if (se && /costs/i.test(se.message)) {
      ({ data: row, error: se } = await supabase
        .from("job_logistics")
        .select("truck_limit, manual")
        .eq("job_id", jobId)
        .maybeSingle());
      try {
        const loc = JSON.parse(localStorage.getItem(localKey) ?? "null");
        if (loc?.costs) setCosts(loc.costs);
      } catch {}
    }
    if (se) {
      setSaveNote(
        `Settings are saved on this computer only (${se.message}). Run supabase/logistics.sql in Supabase to save them online.`,
      );
      try {
        s = JSON.parse(localStorage.getItem(localKey) ?? "null");
      } catch {}
    } else if (row) {
      s = row as Saved;
    } else {
      try {
        s = JSON.parse(localStorage.getItem(localKey) ?? "null");
      } catch {}
    }
    if (s?.truck_limit) setLimitText(String(s.truck_limit));
    if (Array.isArray(s?.manual)) setManual(s!.manual!);
    if (s?.costs && typeof s.costs === "object") setCosts(s.costs);
    ready.current = true;
  }, [jobId, localKey]);

  useEffect(() => {
    void load();
  }, [load]);

  // Save the limit and hand-added items shortly after they change.
  useEffect(() => {
    if (!jobId || !ready.current) return;
    const t = setTimeout(async () => {
      try {
        localStorage.setItem(
          localKey,
          JSON.stringify({ truck_limit: limit, manual, costs }),
        );
      } catch {}
      const sb = getSupabase();
      let { error: e } = await sb
        .from("job_logistics")
        .upsert(
          { job_id: jobId, truck_limit: limit, manual, costs },
          { onConflict: "job_id" },
        );
      if (e && /costs/i.test(e.message)) {
        // costs column not added yet: still save the limit and hand-added items.
        ({ error: e } = await sb
          .from("job_logistics")
          .upsert(
            { job_id: jobId, truck_limit: limit, manual },
            { onConflict: "job_id" },
          ));
        if (!e)
          setSaveNote(
            "Costs are saved on this computer only. Run supabase/logistics_costs.sql in Supabase to save them online.",
          );
        return;
      }
      setSaveNote(
        e
          ? `Settings are saved on this computer only (${e.message}). Run supabase/logistics.sql in Supabase to save them online.`
          : null,
      );
    }, 600);
    return () => clearTimeout(t);
  }, [limit, manual, costs, jobId, localKey]);

  const today = todayIso();
  const items = useMemo(
    () => buildItems(lines, manual, costs),
    [lines, manual, costs],
  );
  const r = useMemo(
    () => buildReport(items, limit, today),
    [items, limit, today],
  );

  const addManual = () => {
    const w = Number(form.weight.replace(/,/g, ""));
    if (!form.name.trim() || !form.pick || !(w >= 0)) return;
    setManual((m) => [
      ...m,
      {
        id: crypto.randomUUID(),
        name: form.name.trim(),
        description: form.description.trim(),
        qty: Math.max(1, Number(form.qty) || 1),
        weight: w,
        cost: Number(form.cost.replace(/[$,\s]/g, "")) || 0,
        pick: form.pick,
      },
    ]);
    setForm(blank);
  };

  const totalLoads = r.days.reduce((x, d) => x + d.loads.length, 0);
  const heading =
    "mb-1 border-b-2 border-navy pb-0.5 text-sm font-bold text-navy";
  const th = "px-2 py-1.5 text-left";
  const td = "px-2 py-1.5";
  const field =
    "rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-navy focus:outline-none";

  return (
    <main className="mx-auto max-w-5xl p-4 print:max-w-none print:p-0">
      <header className="mb-5 flex flex-wrap items-center gap-4 print:hidden">
        <img src="/logo.png" alt="Lindsay Precast" className="h-20 w-auto" />
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-navy">Job logistics</h1>
          <p className="text-sm text-slate-600">
            Deliveries, truckloads and what is waiting in the yard.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <UserBadge />
          <Link
            href="/"
            className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-white"
          >
            ← Dashboard
          </Link>
          <Link
            href={withJob("/structures", jobId)}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-white"
          >
            ← Back to job
          </Link>
          <button
            onClick={() => window.print()}
            className="rounded-md bg-brand-red px-4 py-2 text-sm font-semibold text-white hover:bg-brand-red-dark"
          >
            Print / Save PDF
          </button>
        </div>
      </header>

      {error && (
        <div className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 print:hidden">
          {error}
        </div>
      )}
      {saveNote && (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 print:hidden">
          {saveNote}
        </div>
      )}

      {!jobId && !jobLoading && (
        <p className="rounded-md border border-slate-200 bg-white p-6 text-center text-slate-600">
          No job picked. Go to the Dashboard and open a job’s Metrics, then
          Logistics report.
        </p>
      )}

      {jobId && (
        <>
          <section className="mb-5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm print:hidden">
            <div className="flex flex-wrap items-end gap-4">
              <label className="text-sm">
                <span className="font-medium text-navy">
                  Truckload weight limit (lb)
                </span>
                <input
                  value={limitText}
                  onChange={(e) => setLimitText(e.target.value)}
                  inputMode="numeric"
                  className={`${field} mt-1 block w-36`}
                />
              </label>
              <button
                onClick={() => setLimitText(String(DEFAULT_LIMIT))}
                className="text-sm text-slate-500 hover:underline"
              >
                Reset to {DEFAULT_LIMIT.toLocaleString("en-US")}
              </button>
            </div>

            <h2 className="mt-4 mb-2 text-sm font-semibold text-navy">
              Print these sections
            </h2>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
              {PRINT_SECTIONS.map(([k, label]) => (
                <label key={k} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={!noPrint.has(k)}
                    onChange={() => togglePrint(k)}
                  />
                  {label}
                </label>
              ))}
            </div>
            <label className="mt-2 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={showNotReady}
                onChange={(e) => changeShowNotReady(e.target.checked)}
              />
              List the structures that are not ready yet (screen and printout)
            </label>

            {showNotReady && (
              <div className="mt-1 ml-6 flex flex-wrap gap-x-5 gap-y-1 text-sm">
                <span className="text-slate-600">Show dates:</span>
                {[
                  ["sch", "Scheduled date"],
                  ["ready", "Ready date"],
                  ["pick", "Pick date"],
                ].map(([k, label]) => (
                  <label key={k} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={nrCols.has(k)}
                      onChange={() => toggleNrCol(k)}
                    />
                    {label}
                  </label>
                ))}
              </div>
            )}

            <label className="mt-4 block text-sm font-semibold text-navy">
              Note to show when nothing is scheduled for delivery
              <input
                value={emptyNote}
                onChange={(e) => changeEmptyNote(e.target.value)}
                placeholder="Nothing is scheduled for delivery from today on."
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-800"
              />
            </label>

            <h2 className="mt-4 mb-2 text-sm font-semibold text-navy">
              Add a delivery by hand
            </h2>
            <div className="flex flex-wrap items-end gap-2">
              <input
                placeholder="Name (e.g. Extra riser)"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className={`${field} w-48`}
              />
              <input
                placeholder="Description"
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
                className={`${field} w-56`}
              />
              <input
                placeholder="Qty"
                value={form.qty}
                onChange={(e) => setForm({ ...form, qty: e.target.value })}
                inputMode="numeric"
                className={`${field} w-16`}
              />
              <input
                placeholder="Weight each (lb)"
                value={form.weight}
                onChange={(e) => setForm({ ...form, weight: e.target.value })}
                inputMode="numeric"
                className={`${field} w-36`}
              />
              <input
                placeholder="Cost each ($)"
                value={form.cost}
                onChange={(e) => setForm({ ...form, cost: e.target.value })}
                inputMode="decimal"
                className={`${field} w-32`}
              />
              <label className="text-xs text-slate-600">
                Delivery date
                <input
                  type="date"
                  value={form.pick}
                  onChange={(e) => setForm({ ...form, pick: e.target.value })}
                  className={`${field} ml-1`}
                />
              </label>
              <button
                onClick={addManual}
                disabled={!form.name.trim() || !form.pick || !form.weight}
                className="rounded-md bg-navy px-4 py-1.5 text-sm font-semibold text-white hover:bg-navy-dark disabled:opacity-40"
              >
                Add
              </button>
            </div>

            <details className="mt-4 text-sm">
              <summary className="cursor-pointer font-semibold text-navy">
                Cost per structure
                {items.some((i) => !i.manual) &&
                  ` (${items.filter((i) => !i.manual && i.cost > 0).length} of ${items.filter((i) => !i.manual).length} entered · total ${money(sumC(items))})`}
              </summary>
              <p className="mt-2 mb-2 text-xs text-slate-600">
                Costs come from Titan’s ExtPrice (added up across each
                structure’s lines). Type a cost to override one. Totals appear
                in the report per delivery day, per truckload and for the whole
                job. Costs are saved with this job.
              </p>
              <div className="max-h-80 overflow-auto rounded-md border border-slate-200">
                <table className="w-full border-collapse text-sm">
                  <thead className="sticky top-0 bg-slate-100 text-left text-xs">
                    <tr>
                      <th className="px-2 py-1">Structure</th>
                      <th className="px-2 py-1">Pick date</th>
                      <th className="px-2 py-1 text-right">Weight</th>
                      <th className="px-2 py-1">Cost ($)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items
                      .filter((i) => !i.manual)
                      .map((i) => (
                        <tr key={i.key} className="border-t border-slate-100">
                          <td className="px-2 py-1 font-medium">{i.name}</td>
                          <td className="px-2 py-1">{us(i.pick)}</td>
                          <td className="px-2 py-1 text-right tabular-nums">
                            {lb(i.weight)}
                          </td>
                          <td className="px-2 py-1">
                            <input
                              value={costs[i.key] ?? ""}
                              onChange={(e) =>
                                setCosts((c) => ({
                                  ...c,
                                  [i.key]: e.target.value,
                                }))
                              }
                              inputMode="decimal"
                              placeholder={
                                i.titanCost ? i.titanCost.toFixed(2) : "0.00"
                              }
                              className={`${field} w-32 py-1`}
                            />
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </details>

            {manual.length > 0 && (
              <ul className="mt-3 divide-y divide-slate-100 text-sm">
                {manual.map((m) => (
                  <li key={m.id} className="flex items-center gap-3 py-1.5">
                    <span className="flex-1">
                      <strong>{m.name}</strong>
                      {m.description ? ` · ${m.description}` : ""} · {m.qty} ×{" "}
                      {lb(m.weight)}
                      {m.cost ? ` · ${money(m.cost)} each` : ""} · {us(m.pick)}
                    </span>
                    <button
                      onClick={() =>
                        setManual((x) => x.filter((y) => y.id !== m.id))
                      }
                      className="text-brand-red hover:underline"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ───────── the report ───────── */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm print:rounded-none print:border-0 print:p-0 print:shadow-none">
            {/* 1. Header */}
            <div className="mb-4 flex items-center gap-4 border-b-2 border-navy pb-3">
              <img
                src="/logo.png"
                alt="Lindsay Precast"
                className="h-14 w-auto"
              />
              <div className="flex-1">
                <h2 className="text-xl font-bold text-navy">
                  Job Logistics Report
                </h2>
                <p className="text-sm">{jobLine(job)}</p>
              </div>
              <p className="text-right text-xs text-slate-600">
                Printed{" "}
                {new Date().toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
                <span className={skip("trucks")}>
                  <br />
                  Truckload limit {lb(limit)}
                </span>
              </p>
            </div>

            {!loaded && <p className="text-sm text-slate-500">Loading…</p>}
            {loaded && items.length === 0 && (
              <p className="text-sm text-slate-600">
                No structures yet. Import the Titan sheet in the Structure
                Tracker, or add a delivery by hand.
              </p>
            )}

            {items.length > 0 && (
              <>
                {/* 2. Delivery summary */}
                <div className={skip("sum")}>
                  <h3 className={heading}>Delivery summary</h3>
                  <table className="mb-5 w-full border-collapse text-sm">
                    <thead>
                      <tr className="bg-navy text-white">
                        <th className={th}>Status</th>
                        <th className={`${th} text-right`}>Structures</th>
                        <th className={`${th} text-right`}>Weight</th>
                        <th className={`${th} text-right ${skip("cost")}`}>
                          Cost
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ["Already picked (pick date passed)", r.picked],
                        ["Scheduled for delivery", r.scheduled],
                        ["Ready, no pick date (in the yard)", r.yard],
                        ...(showNotReady
                          ? [["Not ready yet", r.notReady]]
                          : []),
                      ].map(([label, xs]) => (
                        <tr
                          key={label as string}
                          className="border-b border-slate-300"
                        >
                          <td className={td}>{label as string}</td>
                          <td className={`${td} text-right tabular-nums`}>
                            {(xs as unknown[]).length}
                          </td>
                          <td className={`${td} text-right tabular-nums`}>
                            {lb(sumW(xs as { weight: number }[]))}
                          </td>
                          <td
                            className={`${td} text-right tabular-nums ${skip("cost")}`}
                          >
                            {money(sumC(xs as { cost: number }[]))}
                          </td>
                        </tr>
                      ))}
                      <tr className="font-bold">
                        <td className={td}>
                          {showNotReady
                            ? "Whole job"
                            : "Total (not-ready structures left out)"}
                        </td>
                        <td className={`${td} text-right tabular-nums`}>
                          {showNotReady ? r.total : r.total - r.notReady.length}
                        </td>
                        <td className={`${td} text-right tabular-nums`}>
                          {lb(
                            showNotReady
                              ? r.totalWeight
                              : r.totalWeight - sumW(r.notReady),
                          )}
                        </td>
                        <td
                          className={`${td} text-right tabular-nums ${skip("cost")}`}
                        >
                          {money(
                            showNotReady
                              ? r.totalCost
                              : r.totalCost - sumC(r.notReady),
                          )}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                {/* 3. Delivery schedule by day */}
                <div className={skip("day")}>
                  <h3 className={heading}>Delivery schedule by day</h3>
                  {r.days.length === 0 ? (
                    <p className="mb-5 text-sm text-slate-600">
                      {emptyNote.trim() ||
                        "Nothing is scheduled for delivery from today on."}
                    </p>
                  ) : (
                    <table className="mb-5 w-full border-collapse text-sm">
                      <thead>
                        <tr className="bg-navy text-white">
                          <th className={th}>Delivery date</th>
                          <th className={`${th} text-right`}>Structures</th>
                          <th className={`${th} text-right`}>Weight</th>
                          <th className={`${th} text-right ${skip("cost")}`}>
                            Cost
                          </th>
                          <th className={`${th} text-right ${skip("trucks")}`}>
                            Truckloads
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.days.map((d) => (
                          <Fragment key={d.date}>
                            <tr className="border-t-2 border-slate-400 bg-slate-100 font-semibold">
                              <td className={td}>
                                {dow(d.date)} {us(d.date)}
                                {d.date === today && (
                                  <span className="ml-2 text-xs font-semibold text-brand-red">
                                    today
                                  </span>
                                )}
                              </td>
                              <td className={`${td} text-right tabular-nums`}>
                                {d.items.length}
                              </td>
                              <td className={`${td} text-right tabular-nums`}>
                                {lb(d.weight)}
                              </td>
                              <td
                                className={`${td} text-right tabular-nums ${skip("cost")}`}
                              >
                                {money(d.cost)}
                              </td>
                              <td
                                className={`${td} text-right tabular-nums ${skip("trucks")}`}
                              >
                                {d.loads.length}
                              </td>
                            </tr>
                            {d.items.map((it) => (
                              <tr
                                key={it.key}
                                className="border-b border-slate-200 text-xs"
                              >
                                <td className={`${td} pl-6`}>
                                  <span className="font-medium">{it.name}</span>
                                  {it.description ? ` — ${it.description}` : ""}
                                  {Object.entries(it.plants).length > 0 && (
                                    <div className="mt-0.5 text-[11px] text-slate-600">
                                      {Object.entries(it.plants).map(
                                        ([pl, v], k) => (
                                          <span key={pl}>
                                            {k > 0 && " · "}
                                            <strong>{pl}</strong>
                                            <span className={skip("cost")}>
                                              {" "}
                                              {money(v.cost)}
                                            </span>
                                          </span>
                                        ),
                                      )}
                                    </div>
                                  )}
                                </td>
                                <td className={td}></td>
                                <td className={`${td} text-right tabular-nums`}>
                                  {lb(it.weight)}
                                </td>
                                <td
                                  className={`${td} text-right tabular-nums ${skip("cost")}`}
                                >
                                  {it.cost ? money(it.cost) : ""}
                                </td>
                                <td
                                  className={`${td} text-right ${skip("trucks")}`}
                                >
                                  Load{" "}
                                  {d.loads.findIndex((l) =>
                                    l.items.includes(it),
                                  ) + 1}
                                </td>
                              </tr>
                            ))}
                            {plantTotals(d.items).length > 0 && (
                              <tr
                                className={`border-b border-slate-300 text-xs font-semibold ${skip("cost")}`}
                              >
                                <td
                                  colSpan={5}
                                  className={`${td} pl-6 text-right`}
                                >
                                  Plant totals for this day:{" "}
                                  {plantTotals(d.items).map(([pl, c], k) => (
                                    <span key={pl}>
                                      {k > 0 && " · "}
                                      {pl} {money(c)}
                                    </span>
                                  ))}
                                </td>
                              </tr>
                            )}
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
                          <td
                            className={`${td} text-right tabular-nums ${skip("cost")}`}
                          >
                            {money(sumC(r.scheduled))}
                          </td>
                          <td
                            className={`${td} text-right tabular-nums ${skip("trucks")}`}
                          >
                            {totalLoads}
                          </td>
                        </tr>
                        {plantTotals(r.scheduled).length > 0 && (
                          <tr className={`font-bold ${skip("cost")}`}>
                            <td colSpan={5} className={`${td} text-right`}>
                              Plant totals:{" "}
                              {plantTotals(r.scheduled).map(([pl, c], k) => (
                                <span key={pl}>
                                  {k > 0 && " · "}
                                  {pl} {money(c)}
                                </span>
                              ))}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  )}
                </div>
                {/* Not ready yet list */}
                {showNotReady && (
                  <div>
                    <h3 className={heading}>
                      Not ready yet ({r.notReady.length})
                    </h3>
                    {r.notReady.length === 0 ? (
                      <p className="mb-5 text-sm text-slate-600">None.</p>
                    ) : (
                      <table className="mb-5 w-full border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-slate-400 text-left">
                            <th className={th}>Structure</th>
                            <th className={th}>Description</th>
                            {nrCols.has("sch") && (
                              <th className={th}>Scheduled date</th>
                            )}
                            {nrCols.has("ready") && (
                              <th className={th}>Ready date</th>
                            )}
                            {nrCols.has("pick") && (
                              <th className={th}>Pick date</th>
                            )}
                            <th className={`${th} text-right`}>Weight</th>
                            <th className={`${th} text-right ${skip("cost")}`}>
                              Cost
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {r.notReady.map((i) => (
                            <tr
                              key={i.key}
                              className="border-b border-slate-200"
                            >
                              <td className={`${td} font-medium`}>{i.name}</td>
                              <td className={td}>{i.description}</td>
                              {nrCols.has("sch") && (
                                <td className={td}>{us(i.sch)}</td>
                              )}
                              {nrCols.has("ready") && (
                                <td className={td}>{us(i.ready)}</td>
                              )}
                              {nrCols.has("pick") && (
                                <td className={td}>{us(i.pick)}</td>
                              )}
                              <td className={`${td} text-right tabular-nums`}>
                                {lb(i.weight)}
                              </td>
                              <td
                                className={`${td} text-right tabular-nums ${skip("cost")}`}
                              >
                                {money(i.cost)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
                {/* 4. Yard and risk list */}
                <div className={skip("yard")}>
                  <h3 className={heading}>Yard and risk list</h3>
                  <div className="mb-5 space-y-3 text-sm">
                    <div>
                      <p className="font-semibold">
                        Ready but no pick date ({r.yard.length})
                      </p>
                      {r.yard.length === 0 ? (
                        <p className="text-slate-600">None.</p>
                      ) : (
                        <table className="w-full border-collapse text-xs">
                          <thead>
                            <tr className="border-b border-slate-400 text-left">
                              <th className={th}>Structure</th>
                              <th className={th}>Description</th>
                              <th className={th}>Ready date</th>
                              <th className={`${th} text-right`}>Waiting</th>
                              <th className={`${th} text-right`}>Weight</th>
                            </tr>
                          </thead>
                          <tbody>
                            {r.yard.map((i) => (
                              <tr
                                key={i.key}
                                className="border-b border-slate-200"
                              >
                                <td className={`${td} font-medium`}>
                                  {i.name}
                                </td>
                                <td className={td}>{i.description}</td>
                                <td className={td}>{us(i.ready)}</td>
                                <td className={`${td} text-right tabular-nums`}>
                                  {i.waiting === 0
                                    ? "today"
                                    : n(i.waiting, "day")}
                                </td>
                                <td className={`${td} text-right tabular-nums`}>
                                  {lb(i.weight)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                    <div>
                      <p className="font-semibold">
                        Pick date is before the ready date ({r.early.length})
                      </p>
                      {r.early.length === 0 ? (
                        <p className="text-slate-600">None.</p>
                      ) : (
                        <p className="text-xs">
                          {r.early
                            .map(
                              (i) =>
                                `${i.name} (pick ${us(i.pick)}, ready ${us(i.ready)})`,
                            )
                            .join("; ")}
                        </p>
                      )}
                    </div>
                    <div>
                      <p className="font-semibold">
                        Heavier than one truckload ({r.overLimit.length})
                      </p>
                      {r.overLimit.length === 0 ? (
                        <p className="text-slate-600">None.</p>
                      ) : (
                        <p className="text-xs">
                          {r.overLimit
                            .map((i) => `${i.name} (${lb(i.weight)})`)
                            .join("; ")}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
                {/* 5. Truckload grouping */}
                <div className={skip("load")}>
                  <h3 className={heading}>Truckload grouping</h3>
                  <p className="mb-2 text-xs text-slate-600">
                    Structures on the same day are packed into loads of no more
                    than {lb(limit)}, heaviest first. A structure is never split
                    between trucks.
                  </p>
                  {r.days.length === 0 && (
                    <p className="text-sm text-slate-600">
                      No upcoming deliveries.
                    </p>
                  )}
                  {r.days.map((d) => (
                    <div
                      key={d.date}
                      className="mb-3 break-inside-avoid text-sm"
                    >
                      <p className="font-semibold text-navy">
                        {dow(d.date)} {us(d.date)} — {n(d.loads.length, "load")}
                        , {lb(d.weight)}
                        <span className={skip("cost")}>, {money(d.cost)}</span>
                      </p>
                      {d.loads.map((l, i) => (
                        <p key={i} className="ml-3 text-xs">
                          <strong>Load {i + 1}</strong> · {lb(l.weight)} (
                          {Math.round((l.weight / limit) * 100)}% of limit)
                          <span className={skip("cost")}>
                            {" "}
                            · {money(sumC(l.items))}
                          </span>
                          {l.over && (
                            <span className="font-semibold text-brand-red">
                              {" "}
                              · over the limit
                            </span>
                          )}
                          {" — "}
                          {l.items
                            .map((x) => `${x.name} (${lb(x.weight)})`)
                            .join(", ")}
                        </p>
                      ))}
                    </div>
                  ))}
                </div>
                <p className="mt-4 text-xs text-slate-500">
                  A structure’s weight is the sum of the Weight on each of its
                  lines in the Tracker. Based on the last Titan paste, pick
                  dates entered in the Tracker, and items added by hand.
                </p>
              </>
            )}
          </div>
        </>
      )}
    </main>
  );
}
