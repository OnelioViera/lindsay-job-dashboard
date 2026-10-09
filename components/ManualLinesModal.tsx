"use client";

import { useState } from "react";
import { getSupabase } from "@/lib/supabase";

// Same fields as a Titan line, for jobs that are not (or not yet) in Titan.
type Draft = {
  structure: string;
  priority: string;
  product: string;
  description: string;
  plant: string;
  dep: string;
  sch: string;
  ready: string;
  pro: string;
  pick: string;
  weight: string;
  uom: string;
  qty: string;
};

const blank = (from?: Draft): Draft => ({
  structure: from?.structure ?? "",
  priority: from?.priority ?? "",
  product: "",
  description: "",
  plant: from?.plant ?? "",
  dep: from?.dep ?? "",
  sch: "",
  ready: "",
  pro: "",
  pick: "",
  weight: "",
  uom: "EA",
  qty: "1",
});

const num = (s: string) => {
  const t = s.replace(/,/g, "").trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};

const isBlank = (d: Draft) =>
  !d.structure.trim() &&
  !d.product.trim() &&
  !d.description.trim() &&
  !d.weight.trim();

export default function ManualLinesModal({
  jobId,
  onClose,
  onDone,
}: {
  jobId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [rows, setRows] = useState<Draft[]>([blank()]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = (i: number, k: keyof Draft, v: string) =>
    setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)));

  const used = rows.filter((d) => !isBlank(d));
  const problem = (() => {
    for (const d of used) {
      if (!d.structure.trim()) return "Every line needs a Structure.";
      for (const k of ["priority", "weight", "qty"] as const)
        if (Number.isNaN(num(d[k]))) return `“${d[k]}” is not a number.`;
    }
    return null;
  })();

  const save = async () => {
    if (used.length === 0 || problem) return;
    setBusy(true);
    setErr(null);
    const supabase = getSupabase();
    const { data: top, error: te } = await supabase
      .from("titan_lines")
      .select("sort_order")
      .eq("job_id", jobId)
      .order("sort_order", { ascending: false })
      .limit(1);
    if (te) {
      setErr(te.message);
      setBusy(false);
      return;
    }
    const start = ((top?.[0]?.sort_order as number | undefined) ?? -1) + 1;
    const batch = crypto.randomUUID();
    const recs = used.map((d, i) => ({
      job_id: jobId,
      import_batch: batch,
      sort_order: start + i,
      structure: d.structure.trim(),
      priority: num(d.priority),
      product: d.product.trim() || null,
      description: d.description.trim() || null,
      plant_id: d.plant.trim() || null,
      production_dep: d.dep.trim() || null,
      sch_date: d.sch || null,
      ready_date: d.ready || null,
      pro_date: d.pro || null,
      pick_date: d.pick || null,
      weight: num(d.weight),
      uom: d.uom.trim() || null,
      qty: num(d.qty),
    }));
    const { error } = await supabase.from("titan_lines").insert(recs);
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    onDone();
  };

  const cell =
    "w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-sm focus:border-navy focus:outline-none";
  const th = "px-1 pb-1 text-left text-xs font-semibold text-navy";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 print:hidden">
      <div className="flex max-h-[90vh] w-full max-w-[96rem] flex-col rounded-xl bg-white p-5 shadow-xl">
        <h2 className="text-lg font-semibold text-navy">Add lines by hand</h2>
        <p className="mt-1 text-sm text-slate-600">
          Same columns as the Titan sheet. A structure with several pieces gets
          one line per piece (use “Add line to same structure”). If the job is
          pasted from Titan later, matching lines are updated instead of
          duplicated, and lines Titan doesn’t have are kept.
        </p>

        <div className="mt-3 flex-1 overflow-auto">
          <table className="min-w-[1500px] border-separate border-spacing-y-1 text-sm">
            <thead>
              <tr>
                <th className={th}>Structure*</th>
                <th className={th}>Pri</th>
                <th className={th}>Product</th>
                <th className={th}>Description</th>
                <th className={th}>Plant ID</th>
                <th className={th}>Production Dep</th>
                <th className={th}>Scheduled</th>
                <th className={th}>Ready</th>
                <th className={th}>Production</th>
                <th className={th}>Pick</th>
                <th className={th}>Wt. (lb)</th>
                <th className={th}>UOM</th>
                <th className={th}>QO</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((d, i) => (
                <tr key={i} className="align-top">
                  <td className="w-36 pr-1">
                    <input
                      value={d.structure}
                      onChange={(e) => set(i, "structure", e.target.value)}
                      className={cell}
                      autoFocus={i === 0}
                    />
                  </td>
                  <td className="w-14 pr-1">
                    <input
                      value={d.priority}
                      onChange={(e) => set(i, "priority", e.target.value)}
                      inputMode="numeric"
                      className={cell}
                    />
                  </td>
                  <td className="w-40 pr-1">
                    <input
                      value={d.product}
                      onChange={(e) => set(i, "product", e.target.value)}
                      className={cell}
                    />
                  </td>
                  <td className="pr-1">
                    <input
                      value={d.description}
                      onChange={(e) => set(i, "description", e.target.value)}
                      className={cell}
                    />
                  </td>
                  <td className="w-24 pr-1">
                    <input
                      value={d.plant}
                      onChange={(e) => set(i, "plant", e.target.value)}
                      className={cell}
                    />
                  </td>
                  <td className="w-28 pr-1">
                    <input
                      value={d.dep}
                      onChange={(e) => set(i, "dep", e.target.value)}
                      className={cell}
                    />
                  </td>
                  {(["sch", "ready", "pro", "pick"] as const).map((k) => (
                    <td key={k} className="w-36 pr-1">
                      <input
                        type="date"
                        value={d[k]}
                        onChange={(e) => set(i, k, e.target.value)}
                        className={cell}
                      />
                    </td>
                  ))}
                  <td className="w-24 pr-1">
                    <input
                      value={d.weight}
                      onChange={(e) => set(i, "weight", e.target.value)}
                      inputMode="decimal"
                      className={cell}
                    />
                  </td>
                  <td className="w-16 pr-1">
                    <input
                      value={d.uom}
                      onChange={(e) => set(i, "uom", e.target.value)}
                      className={cell}
                    />
                  </td>
                  <td className="w-14 pr-1">
                    <input
                      value={d.qty}
                      onChange={(e) => set(i, "qty", e.target.value)}
                      inputMode="decimal"
                      className={cell}
                    />
                  </td>
                  <td className="whitespace-nowrap">
                    <button
                      onClick={() =>
                        setRows((r) => [
                          ...r.slice(0, i + 1),
                          blank(d),
                          ...r.slice(i + 1),
                        ])
                      }
                      title="Add another piece of the same structure"
                      className="px-1 text-xs text-navy hover:underline"
                    >
                      + same structure
                    </button>
                    <button
                      onClick={() =>
                        setRows((r) =>
                          r.length === 1
                            ? [blank()]
                            : r.filter((_, j) => j !== i),
                        )
                      }
                      className="px-1 text-xs text-brand-red hover:underline"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {(err || problem) && (
          <p className="mt-2 text-sm text-brand-red">{err ?? problem}</p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            onClick={() => setRows((r) => [...r, blank()])}
            className="rounded-md border border-navy px-3 py-2 text-sm font-semibold text-navy hover:bg-slate-50"
          >
            + Add line
          </button>
          <span className="flex-1 text-sm text-slate-500">
            {used.length} line{used.length === 1 ? "" : "s"} ready to add
          </span>
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={() => void save()}
            disabled={busy || used.length === 0 || !!problem}
            className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy-dark disabled:opacity-40"
          >
            {busy ? "Adding…" : `Add ${used.length || ""} to the Tracker`}
          </button>
        </div>
      </div>
    </div>
  );
}
