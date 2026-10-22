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
  // Lines whose structure or description contains any of these words are left out.
  const [hideWords, setHideWords] = useState<string[]>([]);
  const [wordIn, setWordIn] = useState("");
  const [note, setNote] = useState("");
  // Structures / parts unticked here stay on screen (greyed) but are left off the printout.
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!jobId) return;
    try {
      const v = localStorage.getItem(`shipping-excluded:${jobId}`);
      setExcluded(new Set(v ? JSON.parse(v) : []));
    } catch {}
  }, [jobId]);
  const saveExcluded = (next: Set<string>) => {
    setExcluded(next);
    try {
      localStorage.setItem(
        `shipping-excluded:${jobId}`,
        JSON.stringify([...next]),
      );
    } catch {}
  };
  const flip = (key: string) => {
    const next = new Set(excluded);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    saveExcluded(next);
  };

  useEffect(() => {
    try {
      const v = localStorage.getItem("shipping-opts");
      if (v) {
        const o = JSON.parse(v);
        if (o.show) setShow((s) => ({ ...s, ...o.show }));
        if (typeof o.parts === "boolean") setParts(o.parts);
        if (typeof o.skipMisc === "boolean") setSkipMisc(o.skipMisc);
        if (Array.isArray(o.hideWords)) setHideWords(o.hideWords);
      }
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(
        "shipping-opts",
        JSON.stringify({ show, parts, skipMisc, hideWords }),
      );
    } catch {}
  }, [show, parts, skipMisc, hideWords]);
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
    const by = new Map<string, { l: Line; id: string }[]>();
    const seen = new Map<string, number>();
    const descs = new Map<string, string>();
    for (const l of lines) {
      // A line with no unit of measure is the structure's description
      // (e.g. 60"ID Storm Manhole), not a part that gets delivered.
      if (!(l.uom ?? "").trim()) {
        const d = (l.description ?? "").trim();
        if (d && !descs.has(l.structure)) descs.set(l.structure, d);
        continue;
      }
      const n = seen.get(l.structure) ?? 0;
      seen.set(l.structure, n + 1);
      // "Misc" = lines with no weight (freight charges, bill & hold, supplies).
      if (skipMisc && !(Number(l.weight) > 0)) continue;
      const hay = `${l.structure} ${l.description ?? ""}`.toLowerCase();
      if (hideWords.some((w) => hay.includes(w.toLowerCase()))) continue;
      const arr = by.get(l.structure) ?? [];
      arr.push({ l, id: `${l.structure}#${n}` });
      by.set(l.structure, arr);
    }
    const w = (xs: Line[]) =>
      xs.reduce((n, x) => n + (Number(x.weight) || 0), 0);
    return [...by.entries()]
      .map(([structure, all]) => {
        // Only the parts that are ticked count toward the status and totals.
        const ls = all.filter((x) => !excluded.has(x.id)).map((x) => x.l);
        const done = ls.filter(isShipped).length;
        const status: Status =
          done === 0 ? "not" : done === ls.length ? "shipped" : "partly";
        return {
          structure,
          desc: descs.get(structure) ?? "",
          all,
          lines: ls,
          done,
          status,
          out: excluded.has(structure) || ls.length === 0,
          weight: w(ls),
        };
      })
      .sort((a, b) => natural(a.structure, b.structure));
  }, [lines, skipMisc, excluded, hideWords]);

  const inGroups = groups.filter((g) => !g.out);
  const count = (s: Status) => inGroups.filter((g) => g.status === s).length;
  const weightOf = (s: Status) =>
    inGroups.filter((g) => g.status === s).reduce((n, g) => n + g.weight, 0);
  const shippedParts = inGroups.reduce((n, g) => n + g.done, 0);
  const totalParts = inGroups.reduce((n, g) => n + g.lines.length, 0);
  const shownGroups = groups.filter((g) => g.out || show[g.status]);
  const printable = inGroups.filter((g) => show[g.status]).length;
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
          disabled={printable === 0}
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
        <div className="mt-3 text-sm">
          <span className="font-semibold text-navy">
            Hide lines containing:
          </span>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {["Freight", "Joint Seal", "Crete Stik", "Joint Wrap", "Boot"].map(
              (w) => {
                const on = hideWords.some(
                  (x) => x.toLowerCase() === w.toLowerCase(),
                );
                return (
                  <button
                    key={w}
                    onClick={() =>
                      setHideWords(
                        on
                          ? hideWords.filter(
                              (x) => x.toLowerCase() !== w.toLowerCase(),
                            )
                          : [...hideWords, w],
                      )
                    }
                    className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                      on
                        ? "border-navy bg-navy text-white"
                        : "border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    {on ? "✓ " : ""}
                    {w}
                  </button>
                );
              },
            )}
            {hideWords
              .filter(
                (w) =>
                  ![
                    "freight",
                    "joint seal",
                    "crete stik",
                    "joint wrap",
                    "boot",
                  ].includes(w.toLowerCase()),
              )
              .map((w) => (
                <button
                  key={w}
                  onClick={() => setHideWords(hideWords.filter((x) => x !== w))}
                  className="rounded-full border border-navy bg-navy px-3 py-1 text-xs font-semibold text-white"
                  title="Click to remove"
                >
                  ✓ {w} ✕
                </button>
              ))}
            <input
              value={wordIn}
              onChange={(e) => setWordIn(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && wordIn.trim()) {
                  setHideWords([...hideWords, wordIn.trim()]);
                  setWordIn("");
                }
              }}
              placeholder="Type a word + Enter"
              className="rounded-md border border-slate-300 px-2 py-1 text-xs"
            />
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Matching lines (and a structure named that, like “Freight”) are
            removed from the screen, the printout and the totals.
          </p>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Partly shipped structures always list their parts so the customer can
          see which pieces went and which are still to come.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <span className="font-semibold text-navy">
            Structures and parts to print:
          </span>
          <button
            onClick={() => saveExcluded(new Set())}
            className="rounded-md border border-navy px-3 py-1 font-semibold text-navy hover:bg-slate-50"
          >
            Select all
          </button>
          <button
            onClick={() =>
              saveExcluded(new Set(groups.map((g) => g.structure)))
            }
            className="rounded-md border border-slate-300 px-3 py-1 hover:bg-slate-50"
          >
            Select none
          </button>
          <span className="text-xs text-slate-500">
            Tick the box beside a structure, or beside a single part, in the
            list below. Unticked rows turn grey and are left off the printout
            and the totals. {groups.filter((g) => g.out).length} left out.
          </span>
        </div>
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
                      {inGroups.length}
                    </td>
                    <td className={`${td} text-right tabular-nums`}>
                      {lb(inGroups.reduce((n, g) => n + g.weight, 0))}
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
                    <th className={`${th} w-8 print:hidden`}></th>
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
                    const hide = g.out ? "print:hidden opacity-40" : "";
                    return (
                      <Fragment key={g.structure}>
                        <tr
                          className={`break-inside-avoid border-t-2 border-slate-400 bg-slate-100 font-semibold ${hide}`}
                        >
                          <td className={`${td} print:hidden`}>
                            <input
                              type="checkbox"
                              checked={!excluded.has(g.structure)}
                              onChange={() => flip(g.structure)}
                              title="Include this structure in the printout"
                            />
                          </td>
                          <td className={td} colSpan={5}>
                            {g.structure}
                            {g.desc && (
                              <span className="ml-2 text-xs font-normal text-slate-600">
                                {g.desc}
                              </span>
                            )}
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
                          g.all.map(({ l, id }) => {
                            const done = isShipped(l);
                            const off = g.out || excluded.has(id);
                            return (
                              <tr
                                key={id}
                                className={`border-b border-slate-200 text-xs ${
                                  done ? "" : "text-slate-500"
                                } ${off ? "print:hidden opacity-40" : ""}`}
                              >
                                <td className={`${td} print:hidden`}>
                                  <input
                                    type="checkbox"
                                    checked={!excluded.has(id)}
                                    onChange={() => flip(id)}
                                    title="Include this part in the printout"
                                  />
                                </td>
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
