"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { parseTitan, type ParsedRow } from "@/lib/titan";
import { planMerge, type DbLine } from "@/lib/merge";

const PAGE = 1000;
const COLS =
  "id, import_batch, sort_order, priority, structure, description, plant_id, production_dep, sch_date, ready_date, pro_date, pick_date, weight, uom, product, qty";

const record = (r: ParsedRow, index: number) => ({
  sort_order: index,
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
});

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
  const [existing, setExisting] = useState<DbLine[] | null>(null);
  const [removeMissing, setRemoveMissing] = useState(false);

  // What this job already has, so a paste can be compared against it.
  useEffect(() => {
    (async () => {
      const all: DbLine[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await getSupabase()
          .from("titan_lines")
          .select(COLS)
          .eq("job_id", jobId)
          .order("sort_order", { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) {
          setError(error.message);
          setExisting([]);
          return;
        }
        all.push(...((data ?? []) as DbLine[]));
        if (!data || data.length < PAGE) break;
      }
      setExisting(all);
    })();
  }, [jobId]);

  const parsed = useMemo(() => (text.trim() ? parseTitan(text) : null), [text]);
  const plan = useMemo(
    () =>
      parsed && parsed.rows.length > 0 && existing
        ? planMerge(existing, parsed.rows, parsed.absent)
        : null,
    [parsed, existing],
  );

  const firstImport = !!existing && existing.length === 0;
  const removals = removeMissing && plan ? plan.missing.length : 0;
  const nothingToDo =
    !!plan &&
    plan.inserts.length === 0 &&
    plan.updates.length === 0 &&
    removals === 0;

  const doImport = async () => {
    if (!plan) return;
    setBusy(true);
    setError(null);
    const supabase = getSupabase();
    const batch = crypto.randomUUID();

    // 1) New lines first, under their own batch id so a failure can be rolled back.
    for (let i = 0; i < plan.inserts.length; i += 200) {
      const chunk = plan.inserts.slice(i, i + 200).map((x) => ({
        ...record(x.row, x.index),
        job_id: jobId,
        import_batch: batch,
      }));
      const { error } = await supabase.from("titan_lines").insert(chunk);
      if (error) {
        await supabase
          .from("titan_lines")
          .delete()
          .eq("job_id", jobId)
          .eq("import_batch", batch);
        setError(error.message);
        setBusy(false);
        return;
      }
    }

    // 2) Update only the lines whose values changed.
    for (let i = 0; i < plan.updates.length; i += 200) {
      const chunk = plan.updates.slice(i, i + 200).map((u) => ({
        id: u.line.id,
        job_id: jobId,
        import_batch: u.line.import_batch,
        ...record(u.row, u.index),
      }));
      const { error } = await supabase
        .from("titan_lines")
        .upsert(chunk, { onConflict: "id" });
      if (error) {
        setError(
          `${error.message} — nothing was removed. Paste again to retry; lines already updated are skipped.`,
        );
        setBusy(false);
        return;
      }
    }

    // 3) Only if asked: drop lines that are no longer in Titan.
    if (removeMissing && plan.missing.length > 0) {
      const ids = plan.missing.map((l) => l.id);
      for (let i = 0; i < ids.length; i += 100) {
        const { error } = await supabase
          .from("titan_lines")
          .delete()
          .in("id", ids.slice(i, i + 100));
        if (error) {
          setError(`Updated, but couldn't remove old lines: ${error.message}`);
          setBusy(false);
          return;
        }
      }
    }

    setBusy(false);
    onDone();
  };

  const stat = (n: number, label: string, tone = "text-navy") => (
    <div className="rounded-md bg-white px-3 py-2 text-center shadow-sm">
      <div className={`text-xl font-bold ${tone}`}>{n}</div>
      <div className="text-xs text-slate-600">{label}</div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 print:hidden">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl bg-white shadow-xl">
        <div className="border-b border-slate-200 p-5">
          <h2 className="text-lg font-semibold text-navy">Import from Titan</h2>
          <p className="mt-1 text-sm text-slate-600">
            In the Titan spreadsheet, select everything (including the header
            row), copy, and paste it below. Lines that are already in this job
            are matched up and only the ones that changed are updated. New lines
            are added, and nothing is duplicated or deleted.
          </p>
        </div>

        <div className="flex-1 overflow-auto p-5">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste Titan spreadsheet here (Ctrl+V / Cmd+V)…"
            className="h-40 w-full resize-none rounded-md border border-slate-300 p-3 font-mono text-xs focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/20"
          />

          {parsed && parsed.rows.length > 0 && !existing && (
            <p className="mt-4 text-sm text-slate-600">
              Comparing with what is already saved…
            </p>
          )}

          {parsed && parsed.rows.length > 0 && plan && (
            <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm">
              <p className="font-medium text-navy">
                Found {parsed.rows.length} lines across {parsed.structureCount}{" "}
                structures in the paste.
              </p>

              {firstImport ? (
                <p className="mt-2 text-slate-700">
                  This job has no lines yet, so all {plan.inserts.length} will
                  be added.
                </p>
              ) : (
                <>
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {stat(plan.changed.length, "updated")}
                    {stat(plan.inserts.length, "new")}
                    {stat(plan.unchanged, "unchanged", "text-slate-600")}
                    {stat(
                      plan.missing.length,
                      "not in this paste",
                      plan.missing.length ? "text-amber-700" : "text-slate-600",
                    )}
                  </div>

                  {plan.changed.length > 0 && (
                    <div className="mt-3">
                      <p className="mb-1 font-medium text-slate-800">
                        What changed
                      </p>
                      <ul className="max-h-48 divide-y divide-slate-200 overflow-auto rounded-md border border-slate-200 bg-white">
                        {plan.changed.map((c, i) => (
                          <li key={i} className="px-3 py-1.5">
                            <span className="font-semibold text-navy">
                              {c.structure}
                            </span>{" "}
                            <span className="text-slate-500">
                              {c.description}
                            </span>
                            <div className="text-xs text-slate-700">
                              {c.changes.map((x) => (
                                <span key={x.label} className="mr-3">
                                  {x.label}: {x.from} → <b>{x.to}</b>
                                </span>
                              ))}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {plan.missing.length > 0 && (
                    <label className="mt-3 flex items-start gap-2 text-slate-700">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={removeMissing}
                        onChange={(e) => setRemoveMissing(e.target.checked)}
                      />
                      <span>
                        Also remove the {plan.missing.length} line
                        {plan.missing.length === 1 ? "" : "s"} no longer in
                        Titan (by default they are kept).
                      </span>
                    </label>
                  )}

                  {nothingToDo && (
                    <p className="mt-3 font-medium text-green-700">
                      Already up to date. This paste matches what is saved.
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          {parsed?.warnings.map((w) => (
            <p key={w} className="mt-2 text-sm text-amber-800">
              {w}
            </p>
          ))}

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
            disabled={busy || !plan || nothingToDo}
            className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy-dark disabled:opacity-50"
          >
            {busy
              ? "Importing…"
              : !plan
                ? "Import"
                : firstImport
                  ? `Import ${plan.inserts.length} lines`
                  : `Apply: ${plan.changed.length} updated, ${plan.inserts.length} new${removals ? `, ${removals} removed` : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}
