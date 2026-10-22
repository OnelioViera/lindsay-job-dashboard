"use client";

// Customer-facing shipping status: which structures (and which parts of them) have
// shipped and which have not. A part counts as shipped when its Pick check mark is
// ticked or it has an invoice date (the Titan "Pick" and "Invoice_ Date" columns).
// No prices are shown, so the report can be sent to the customer as it is.

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { jobLine, useActiveJob, withJob } from "@/lib/jobs";
import { hasDeliveredCols } from "@/lib/priceColumn";
import UserBadge from "./UserBadge";

type Line = {
  structure: string;
  description: string | null;
  uom: string | null;
  plant_id: string | null;
  pick_date: string | null;
  weight: number | null;
  picked?: boolean | null;
  invoice_date?: string | null;
};

type Status = "shipped" | "partly" | "not";
const LABEL: Record<Status, string> = {
  shipped: "Shipped",
  partly: "Partly shipped",
  not: "Not shipped",
};
const COLOR: Record<Status, string> = {
  shipped: "bg-emerald-100 text-emerald-800 border-emerald-300",
  partly: "bg-amber-100 text-amber-900 border-amber-300",
  not: "bg-slate-100 text-slate-700 border-slate-300",
};

const lb = (n: number) => `${Math.round(n).toLocaleString("en-US")} lb`;
const us = (d: string | null | undefined) => {
  if (!d) return "";
  const [y, m, day] = d.split("-");
  return `${m}/${day}/${y}`;
};
const natural = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true });
const isShipped = (l: Line) => !!l.picked || !!l.invoice_date;

const th = "px-2 py-1.5 text-left";
const td = "px-2 py-1.5";

export default function ShippingReport() {
  const { job, loading: jobLoading } = useActiveJob();
  const jobId = job?.id ?? null;
  const [lines, setLines] = useState<Line[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasCols, setHasCols] = useState(true);
  const [show, setShow] = useState<Record<Status, boolean>>({
    shipped: true,
    partly: true,
    not: true,
  });
  const [parts, setParts] = useState(true);
  const [skipMisc, setSkipMisc] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    try {
      const v = localStorage.getItem("shipping-opts");
      if (v) {
        const o = JSON.parse(v);
        if (o.show) setShow((s) => ({ ...s, ...o.show }));
        if (typeof o.parts === "boolean") setParts(o.parts);
        if (typeof o.skipMisc === "boolean") setSkipMisc(o.skipMisc);
      }
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(
        "shipping-opts",
        JSON.stringify({ show, parts, skipMisc }),
      );
    } catch {}
  }, [show, parts, skipMisc]);
  useEffect(() => {
    if (!jobId) return;
    try {
      setNote(localStorage.getItem(`shipping-note:${jobId}`) ?? "");
    } catch {}
  }, [jobId]);
  const changeNote = (v: string) => {
    setNote(v);
    try {
      localStorage.setItem(`shipping-note:${jobId}`, v);
    } catch {}
  };

  useEffect(() => {
    if (!jobId) return;
    let dead = false;
    (async () => {
      const sb = getSupabase();
      const withDelivered = await hasDeliveredCols();
      setHasCols(withDelivered);
      const all: Line[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error: e } = await sb
          .from("titan_lines")
          .select(
            "structure, description, uom, plant_id, pick_date, weight" +
              (withDelivered ? ", picked, invoice_date" : ""),
          )
          .eq("job_id", jobId)
          .order("sort_order")
          .range(from, from + 999);
        if (e) {
          if (!dead) setError(e.message);
          break;
        }
        all.push(...((data ?? []) as unknown as Line[]));
        if (!data || data.length < 1000) break;
      }
      if (dead) return;
      setLines(all);
      setLoaded(true);
    })();
    return () => {
      dead = true;
    };
  }, [jobId]);

  const groups = useMemo(() => {
    const by = new Map<string, Line[]>();
    for (const l of lines) {
      // "Misc" = lines with no weight (freight charges, bill & hold, supplies).
      if (skipMisc && !(Number(l.weight) > 0)) continue;
      (by.get(l.structure) ?? by.set(l.structure, []).get(l.structure)!).push(
        l,
      );
    }
    return [...by.entries()]
      .map(([structure, ls]) => {
        const done = ls.filter(isShipped).length;
        const status: Status =
          done === 0 ? "not" : done === ls.length ? "shipped" : "partly";
        const w = (xs: Line[]) =>
          xs.reduce((n, x) => n + (Number(x.weight) || 0), 0);
        return {
          structure,
          lines: ls,
          done,
          status,
          weight: w(ls),
          shippedWeight: w(ls.filter(isShipped)),
        };
      })
      .sort((a, b) => natural(a.structure, b.structure));
  }, [lines, skipMisc]);

  const count = (s: Status) => groups.filter((g) => g.status === s).length;
  const weightOf = (s: Status) =>
    groups.filter((g) => g.status === s).reduce((n, g) => n + g.weight, 0);
  const shippedParts = groups.reduce((n, g) => n + g.done, 0);
  const totalParts = groups.reduce((n, g) => n + g.lines.length, 0);
  const shownGroups = groups.filter((g) => show[g.status]);
  const printedOn = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <main className="mx-auto max-w-5xl px-6 py-4 sm:px-10">
      <header className="mb-5 flex flex-wrap items-center gap-4 print:hidden">
        <img src="/logo.png" alt="Lindsay Precast" className="h-20 w-auto" />
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-navy">Shipping report</h1>
          <p className="text-sm text-slate-600">
            What has shipped and what has not, for the customer.
          </p>
        </div>
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
          disabled={shownGroups.length === 0}
          className="rounded-md bg-brand-red px-4 py-2 text-sm font-semibold text-white hover:bg-brand-red-dark disabled:opacity-50"
        >
          Print / Save PDF
        </button>
      </header>

      {error && (
        <div className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 print:hidden">
          {error}
        </div>
      )}
      {!hasCols && (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 print:hidden">
          Picked and Invoice Date aren’t saved yet, so nothing can show as
          shipped. Run supabase/delivered.sql in Supabase, then import the Titan
          export again.
        </div>
      )}

      <section className="mb-5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm print:hidden">
        <h2 className="mb-2 text-sm font-semibold text-navy">What to print</h2>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
          {(Object.keys(LABEL) as Status[]).map((s) => (
            <label key={s} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={show[s]}
                onChange={(e) => setShow({ ...show, [s]: e.target.checked })}
              />
              {LABEL[s]} ({count(s)})
            </label>
          ))}
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={parts}
              onChange={(e) => setParts(e.target.checked)}
            />
            List every part of every structure
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={skipMisc}
              onChange={(e) => setSkipMisc(e.target.checked)}
            />
            Leave out lines with no weight (freight, supplies)
          </label>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Partly shipped structures always list their parts so the customer can
          see which pieces went and which are still to come.
        </p>
        <label className="mt-3 block text-sm font-semibold text-navy">
          Note to the customer (printed under the summary)
          <textarea
            value={note}
            onChange={(e) => changeNote(e.target.value)}
            rows={2}
            placeholder="e.g. Remaining pieces are scheduled to ship the week of 10/26."
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-800"
          />
        </label>
      </section>

      {(jobLoading || (jobId && !loaded)) && !error && (
        <p className="text-sm text-slate-600 print:hidden">Loading…</p>
      )}
      {!jobLoading && !jobId && (
        <p className="text-sm text-slate-600">
          Open this from a job on the Dashboard to see its shipping report.
        </p>
      )}

      {loaded && (
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm print:rounded-none print:border-0 print:p-0 print:shadow-none">
          <div className="mb-3 flex items-center gap-4 border-b-2 border-navy pb-3">
            <img src="/logo.png" alt="" className="h-14 w-auto" />
            <div className="flex-1">
              <h2 className="text-xl font-bold text-navy">
                Shipping Status Report
              </h2>
              <p className="text-sm">{jobLine(job)}</p>
            </div>
            <p className="text-right text-xs text-slate-600">
              As of {printedOn}
            </p>
          </div>

          {groups.length === 0 ? (
            <p className="text-sm text-slate-600">
              No structures for this job yet.
            </p>
          ) : (
            <>
              <table className="mb-3 w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-navy text-white">
                    <th className={th}>Status</th>
                    <th className={`${th} text-right`}>Structures</th>
                    <th className={`${th} text-right`}>Weight</th>
                  </tr>
                </thead>
                <tbody>
                  {(Object.keys(LABEL) as Status[]).map((s) => (
                    <tr key={s} className="border-b border-slate-300">
                      <td className={td}>{LABEL[s]}</td>
                      <td className={`${td} text-right tabular-nums`}>
                        {count(s)}
                      </td>
                      <td className={`${td} text-right tabular-nums`}>
                        {lb(weightOf(s))}
                      </td>
                    </tr>
                  ))}
                  <tr className="font-bold">
                    <td className={td}>All structures</td>
                    <td className={`${td} text-right tabular-nums`}>
                      {groups.length}
                    </td>
                    <td className={`${td} text-right tabular-nums`}>
                      {lb(groups.reduce((n, g) => n + g.weight, 0))}
                    </td>
                  </tr>
                </tbody>
              </table>
              <p className="mb-4 text-xs text-slate-600">
                {shippedParts} of {totalParts} parts have shipped. A part is
                shown as shipped once it has been picked or invoiced.
              </p>
              {note.trim() && (
                <p className="mb-4 rounded-md border border-slate-300 bg-slate-50 p-3 text-sm whitespace-pre-wrap">
                  {note.trim()}
                </p>
              )}

              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-navy text-white">
                    <th className={th}>Structure / description</th>
                    <th className={th}>UOM</th>
                    <th className={th}>Plant</th>
                    <th className={th}>Pick date</th>
                    <th className={`${th} text-center`}>Picked</th>
                    <th className={`${th} text-right`}>Wt.</th>
                    <th className={th}>Invoice date</th>
                  </tr>
                </thead>
                <tbody>
                  {shownGroups.map((g) => {
                    const open = parts || g.status === "partly";
                    return (
                      <Fragment key={g.structure}>
                        <tr className="break-inside-avoid border-t-2 border-slate-400 bg-slate-100 font-semibold">
                          <td className={td} colSpan={5}>
                            {g.structure}
                            <span
                              className={`ml-3 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${COLOR[g.status]}`}
                            >
                              {LABEL[g.status]}
                              {g.status === "partly"
                                ? ` · ${g.done} of ${g.lines.length} parts`
                                : ""}
                            </span>
                          </td>
                          <td className={`${td} text-right tabular-nums`}>
                            {lb(g.weight)}
                          </td>
                          <td className={td}></td>
                        </tr>
                        {open &&
                          g.lines.map((l, i) => {
                            const done = isShipped(l);
                            return (
                              <tr
                                key={i}
                                className={`border-b border-slate-200 text-xs ${
                                  done ? "" : "text-slate-500"
                                }`}
                              >
                                <td className={`${td} pl-6`}>
                                  {l.description || "(part)"}
                                </td>
                                <td className={td}>{l.uom}</td>
                                <td className={td}>{l.plant_id}</td>
                                <td className={td}>{us(l.pick_date)}</td>
                                <td
                                  className={`${td} text-center font-bold ${
                                    done ? "text-emerald-700" : ""
                                  }`}
                                >
                                  {done ? "✔" : "—"}
                                </td>
                                <td className={`${td} text-right tabular-nums`}>
                                  {Number(l.weight) > 0
                                    ? lb(Number(l.weight))
                                    : ""}
                                </td>
                                <td className={td}>{us(l.invoice_date)}</td>
                              </tr>
                            );
                          })}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </section>
      )}
    </main>
  );
}
