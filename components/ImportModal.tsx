"use client";

import { useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { parseTitan } from "@/lib/titan";

export default function ImportModal({
  jobId,
  onClose,
  onDone,
}: {
  jobId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => (text.trim() ? parseTitan(text) : null), [text]);

  const withDate = (k: "schDate" | "readyDate" | "proDate" | "pickDate") =>
    parsed ? parsed.rows.filter((r) => r[k]).length : 0;

  const doImport = async () => {
    if (!parsed || parsed.rows.length === 0) return;
    setBusy(true);
    setError(null);

    const supabase = getSupabase();
    const batch = crypto.randomUUID();
    const records = parsed.rows.map((r, i) => ({
      job_id: jobId,
      import_batch: batch,
      sort_order: i,
      priority: r.priority,
      structure: r.structure,
      description: r.description || null,
      plant_id: r.plantId || null,
      production_dep: r.productionDep || null,
      sch_date: r.schDate,
      ready_date: r.readyDate,
      pro_date: r.proDate,
      pick_date: r.pickDate,
      weight: r.weight,
      uom: r.uom || null,
      product: r.product || null,
      qty: r.qty,
    }));

    // 1) Insert the new snapshot under a fresh batch id.
    for (let i = 0; i < records.length; i += 200) {
      const { error } = await supabase
        .from("titan_lines")
        .insert(records.slice(i, i + 200));
      if (error) {
        // Roll back the partial batch; the previous data is untouched.
        await supabase.from("titan_lines").delete().eq("import_batch", batch);
        setError(error.message);
        setBusy(false);
        return;
      }
    }

    // 2) Only after everything landed, remove the previous snapshot.
    const { error: cleanupError } = await supabase
      .from("titan_lines")
      .delete()
      .eq("job_id", jobId)
      .neq("import_batch", batch);
    if (cleanupError) {
      setError(
        `Imported, but couldn't clear the old data: ${cleanupError.message}`,
      );
      setBusy(false);
      return;
    }

    setBusy(false);
    onDone();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 print:hidden">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl bg-white shadow-xl">
        <div className="border-b border-slate-200 p-5">
          <h2 className="text-lg font-semibold text-navy">Import from Titan</h2>
          <p className="mt-1 text-sm text-slate-600">
            In the Titan spreadsheet, select everything (including the header
            row), copy, and paste it below. Each import replaces what is
            currently in this job's tracker with this fresh copy of Titan.
          </p>
        </div>

        <div className="flex-1 overflow-auto p-5">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste Titan spreadsheet here (Ctrl+V / Cmd+V)…"
            className="h-48 w-full resize-none rounded-md border border-slate-300 p-3 font-mono text-xs focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/20"
          />

          {parsed && (
            <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm">
              {parsed.rows.length > 0 && (
                <>
                  <p className="font-medium text-navy">
                    Found {parsed.rows.length} lines across{" "}
                    {parsed.structureCount} structures.
                  </p>
                  <ul className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-slate-700 sm:grid-cols-4">
                    <li>{withDate("schDate")} with Scheduled Date</li>
                    <li>{withDate("readyDate")} with Ready Date</li>
                    <li>{withDate("pickDate")} with Pick Date</li>
                  </ul>
                </>
              )}
              {parsed.warnings.map((w) => (
                <p key={w} className="mt-2 text-amber-800">
                  {w}
                </p>
              ))}
            </div>
          )}

          {error && (
            <p className="mt-3 text-sm text-brand-red">
              Import failed: {error}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 p-4">
          <button
            onClick={onClose}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={doImport}
            disabled={busy || !parsed || parsed.rows.length === 0}
            className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy-dark disabled:opacity-50"
          >
            {busy
              ? "Importing…"
              : parsed?.rows.length
                ? `Import ${parsed.rows.length} lines`
                : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}
