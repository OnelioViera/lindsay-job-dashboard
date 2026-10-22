"use client";

// Structures not yet released for production: no line of the structure has a Scheduled
// (pour) date. Lists their Titan lines so the list can be printed or sent.

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { jobLine, useActiveJob, withJob } from "@/lib/jobs";
import { hasDeliveredCols, hasExtPrice } from "@/lib/priceColumn";
import UserBadge from "./UserBadge";

type Line = {
  structure: string;
  description: string | null;
  uom: string | null;
  plant_id: string | null;
  production_dep: string | null;
  sch_date: string | null;
  pick_date: string | null;
  picked?: boolean | null;
  invoice_date?: string | null;
  weight: number | null;
  ext_price?: number | null;
};

const lb = (n: number) => `${Math.round(n).toLocaleString("en-US")} lb`;
const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const natural = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true });
const th = "px-2 py-1.5 text-left";
const td = "px-2 py-1.5";

export default function NotReleased() {
  const { job, loading: jobLoading } = useActiveJob();
  const jobId = job?.id ?? null;
  const [lines, setLines] = useState<Line[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasPrice, setHasPrice] = useState(false);
  const [showPrice, setShowPrice] = useState(false);
  const [showDep, setShowDep] = useState(true);
  const [parts, setParts] = useState(true);
  const [out, setOut] = useState<Set<string>>(new Set());
  // Same word list as the Shipping report (stored with its options) so both reports agree.
  const [hideWords, setHideWords] = useState<string[]>([]);
  const [wordIn, setWordIn] = useState("");
  useEffect(() => {
    try {
      const o = JSON.parse(localStorage.getItem("shipping-opts") ?? "{}");
      if (Array.isArray(o.hideWords)) setHideWords(o.hideWords);
    } catch {}
  }, []);
  const saveWords = (w: string[]) => {
    setHideWords(w);
    try {
      const o = JSON.parse(localStorage.getItem("shipping-opts") ?? "{}");
      localStorage.setItem(
        "shipping-opts",
        JSON.stringify({ ...o, hideWords: w }),
      );
    } catch {}
  };

  useEffect(() => {
    if (!jobId) return;
    try {
      const v = localStorage.getItem(`notreleased-out:${jobId}`);
      setOut(new Set(v ? JSON.parse(v) : []));
    } catch {}
  }, [jobId]);
  const saveOut = (n: Set<string>) => {
    setOut(n);
    try {
      localStorage.setItem(`notreleased-out:${jobId}`, JSON.stringify([...n]));
    } catch {}
  };

  useEffect(() => {
    if (!jobId) return;
    let dead = false;
    (async () => {
      const sb = getSupabase();
      const p = await hasExtPrice();
      const d = await hasDeliveredCols();
      setHasPrice(p);
      const all: Line[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error: e } = await sb
          .from("titan_lines")
          .select(
            "structure, description, uom, plant_id, production_dep, sch_date, pick_date, weight" +
              (p ? ", ext_price" : "") +
              (d ? ", picked, invoice_date" : ""),
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
      const a = by.get(l.structure) ?? [];
      a.push(l);
      by.set(l.structure, a);
    }
    return (
      [...by.entries()]
        // Released = scheduled to pour, or already picked / invoiced / given a pick date.
        .filter(
          ([, ls]) =>
            !ls.some(
              (l) => l.sch_date || l.pick_date || l.picked || l.invoice_date,
            ),
        )
        .map(([structure, ls]) => {
          const desc =
            ls.find(
              (l) => !(l.uom ?? "").trim() && (l.description ?? "").trim(),
            )?.description ?? "";
          const ps = ls.filter(
            (l) => (l.uom ?? "").trim() && (l.description ?? "").trim(),
          );
          return {
            structure,
            desc,
            ps,
            weight: ps.reduce((n, x) => n + (Number(x.weight) || 0), 0),
            price: ps.reduce((n, x) => n + (Number(x.ext_price) || 0), 0),
          };
        })
        .filter((g) => g.ps.length > 0)
        .sort((a, b) => natural(a.structure, b.structure))
    );
  }, [lines, hideWords]);

  const inc = groups.filter((g) => !out.has(g.structure));
  const flip = (k: string) => {
    const n = new Set(out);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    saveOut(n);
  };
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
          <h1 className="text-2xl font-bold text-navy">Not released report</h1>
          <p className="text-sm text-slate-600">
            Structures not yet scheduled to pour (not released for production).
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
          disabled={inc.length === 0}
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

      <section className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm print:hidden">
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={parts}
              onChange={(e) => setParts(e.target.checked)}
            />
            List the parts of each structure
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={showDep}
              onChange={(e) => setShowDep(e.target.checked)}
            />
            Show production dept
          </label>
          {hasPrice && (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={showPrice}
                onChange={(e) => setShowPrice(e.target.checked)}
              />
              Show ExtPrice
            </label>
          )}
          <button
            onClick={() => saveOut(new Set())}
            className="rounded-md border border-navy px-3 py-1 font-semibold text-navy hover:bg-slate-50"
          >
            Select all
          </button>
          <button
            onClick={() => saveOut(new Set(groups.map((g) => g.structure)))}
            className="rounded-md border border-slate-300 px-3 py-1 hover:bg-slate-50"
          >
            Select none
          </button>
        </div>
        <div className="mt-3 text-sm">
          <span className="font-semibold text-navy">
            Hide lines containing:
          </span>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {["Freight", "Joint Seal", "Crete Stik", "Joint Wrap", "Boot"]
              .concat(
                hideWords.filter(
                  (w) =>
                    ![
                      "freight",
                      "joint seal",
                      "crete stik",
                      "joint wrap",
                      "boot",
                    ].includes(w.toLowerCase()),
                ),
              )
              .map((w) => {
                const on = hideWords.some(
                  (x) => x.toLowerCase() === w.toLowerCase(),
                );
                return (
                  <button
                    key={w}
                    onClick={() =>
                      saveWords(
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
              })}
            <input
              value={wordIn}
              onChange={(e) => setWordIn(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && wordIn.trim()) {
                  saveWords([...hideWords, wordIn.trim()]);
                  setWordIn("");
                }
              }}
              placeholder="Type a word + Enter"
              className="rounded-md border border-slate-300 px-2 py-1 text-xs"
            />
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Shared with the Shipping report, so both show the same weights.
          </p>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Untick a structure to leave it off the printout.{" "}
          {groups.length - inc.length} left out.
        </p>
      </section>

      {(jobLoading || (jobId && !loaded)) && !error && (
        <p className="text-sm text-slate-600 print:hidden">Loading…</p>
      )}
      {loaded && (
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm print:rounded-none print:border-0 print:p-0 print:shadow-none">
          <div className="mb-3 flex items-center gap-4 border-b-2 border-navy pb-3">
            <img src="/logo.png" alt="" className="h-14 w-auto" />
            <div className="flex-1">
              <h2 className="text-xl font-bold text-navy">
                Not Released for Production
              </h2>
              <p className="text-sm">{jobLine(job)}</p>
            </div>
            <p className="text-right text-xs text-slate-600">
              As of {printedOn}
              <br />
              {inc.length} structure{inc.length === 1 ? "" : "s"} ·{" "}
              {lb(inc.reduce((n, g) => n + g.weight, 0))}
              {showPrice && ` · ${usd(inc.reduce((n, g) => n + g.price, 0))}`}
            </p>
          </div>
          {groups.length === 0 ? (
            <p className="text-sm text-slate-600">
              Every structure has a scheduled pour date.
            </p>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-navy text-white">
                  <th className={`${th} w-8 print:hidden`}></th>
                  <th className={th}>Structure / description</th>
                  <th className={th}>UOM</th>
                  <th className={th}>Plant</th>
                  {showDep && <th className={th}>Prod. dept</th>}
                  <th className={`${th} text-right`}>Wt.</th>
                  {showPrice && (
                    <th className={`${th} text-right`}>ExtPrice</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => {
                  const off = out.has(g.structure);
                  return (
                    <Fragment key={g.structure}>
                      <tr
                        className={`break-inside-avoid border-t-2 border-slate-400 bg-slate-100 font-semibold ${off ? "print:hidden opacity-40" : ""}`}
                      >
                        <td className={`${td} print:hidden`}>
                          <input
                            type="checkbox"
                            checked={!off}
                            onChange={() => flip(g.structure)}
                          />
                        </td>
                        <td className={td} colSpan={2 + (showDep ? 2 : 1)}>
                          {g.structure}
                          {g.desc && (
                            <span className="ml-2 text-xs font-normal text-slate-600">
                              {g.desc}
                            </span>
                          )}
                        </td>
                        <td className={`${td} text-right tabular-nums`}>
                          {lb(g.weight)}
                        </td>
                        {showPrice && (
                          <td className={`${td} text-right tabular-nums`}>
                            {usd(g.price)}
                          </td>
                        )}
                      </tr>
                      {parts &&
                        g.ps.map((l, i) => (
                          <tr
                            key={i}
                            className={`border-b border-slate-200 text-xs ${off ? "print:hidden opacity-40" : ""}`}
                          >
                            <td className={`${td} print:hidden`}></td>
                            <td className={`${td} pl-6`}>{l.description}</td>
                            <td className={td}>{l.uom}</td>
                            <td className={td}>{l.plant_id}</td>
                            {showDep && (
                              <td className={td}>{l.production_dep}</td>
                            )}
                            <td className={`${td} text-right tabular-nums`}>
                              {Number(l.weight) > 0 ? lb(Number(l.weight)) : ""}
                            </td>
                            {showPrice && (
                              <td className={`${td} text-right tabular-nums`}>
                                {l.ext_price ? usd(Number(l.ext_price)) : ""}
                              </td>
                            )}
                          </tr>
                        ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      )}
    </main>
  );
}
