"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CATALOG } from "@/lib/catalog";
import JobBanner from "./JobBanner";
import { jobLine, useActiveJob, withJob } from "@/lib/jobs";

type CatItem = {
  id: string;
  type: string;
  name: string;
  cost: number;
  weight: number;
};

// Order lines keep their own copy of name/cost/weight, so editing or deleting a
// component in the list never changes an order that is already built.
type Extra = {
  id: string;
  type: string;
  name: string;
  cost: number;
  weight: number;
  qty: number;
  structure: string;
};

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const STORE = "procurement-extras";
const CAT_STORE = "procurement-catalog";

const seedCatalog = (): CatItem[] =>
  CATALOG.map((c, i) => ({ ...c, id: `seed-${i}` }));

export default function Procurement() {
  const { job, loading: jobLoading } = useActiveJob();
  const [poNumber, setPoNumber] = useState("");
  const [vendor, setVendor] = useState("");
  const [notes, setNotes] = useState("");
  const [extras, setExtras] = useState<Extra[]>([]);
  const [catalog, setCatalog] = useState<CatItem[]>(seedCatalog);
  const [pick, setPick] = useState("");
  const [pickQty, setPickQty] = useState(1);
  const [pickStructure, setPickStructure] = useState("");
  const [managing, setManaging] = useState(false);
  const [draft, setDraft] = useState({
    type: "R&C",
    name: "",
    cost: "",
    weight: "",
  });
  const [editId, setEditId] = useState<string | null>(null);
  const [edit, setEdit] = useState({
    type: "",
    name: "",
    cost: "",
    weight: "",
  });

  const jobId = job?.id ?? null;
  const storeKey = `${STORE}:${jobId ?? "none"}`;

  useEffect(() => {
    if (jobLoading) return;
    setExtras([]);
    try {
      const v = localStorage.getItem(storeKey);
      if (v) {
        const saved = JSON.parse(v) as (Extra & { catalogIdx?: number })[];
        setExtras(
          saved.map((e) =>
            e.name !== undefined
              ? e
              : {
                  ...e,
                  ...CATALOG[e.catalogIdx ?? 0],
                },
          ),
        );
      }
    } catch {}
  }, [storeKey, jobLoading]);

  useEffect(() => {
    try {
      const c = localStorage.getItem(CAT_STORE);
      if (c) setCatalog(JSON.parse(c));
    } catch {}
  }, []);
  const saveExtras = (next: Extra[]) => {
    setExtras(next);
    try {
      localStorage.setItem(storeKey, JSON.stringify(next));
    } catch {}
  };
  const saveCatalog = (next: CatItem[]) => {
    setCatalog(next);
    try {
      localStorage.setItem(CAT_STORE, JSON.stringify(next));
    } catch {}
  };
  const addExtra = () => {
    const item = catalog.find((c) => c.id === pick);
    if (!item || pickQty < 1) return;
    saveExtras([
      ...extras,
      {
        id: crypto.randomUUID(),
        type: item.type,
        name: item.name,
        cost: item.cost,
        weight: item.weight,
        qty: pickQty,
        structure: pickStructure.trim(),
      },
    ]);
    setPickQty(1);
    setPickStructure("");
  };
  const patchExtra = (id: string, patch: Partial<Extra>) =>
    saveExtras(extras.map((e) => (e.id === id ? { ...e, ...patch } : e)));

  const addComponent = () => {
    const cost = Number(draft.cost);
    const weight = Number(draft.weight || 0);
    if (!draft.name.trim() || !Number.isFinite(cost)) return;
    saveCatalog([
      ...catalog,
      {
        id: crypto.randomUUID(),
        type: draft.type.trim() || "R&C",
        name: draft.name.trim(),
        cost,
        weight: Number.isFinite(weight) ? weight : 0,
      },
    ]);
    setDraft({ type: draft.type, name: "", cost: "", weight: "" });
  };
  const startEdit = (c: CatItem) => {
    setEditId(c.id);
    setEdit({
      type: c.type,
      name: c.name,
      cost: String(c.cost),
      weight: String(c.weight),
    });
  };
  const saveEdit = () => {
    const cost = Number(edit.cost);
    const weight = Number(edit.weight || 0);
    if (!edit.name.trim() || !Number.isFinite(cost)) return;
    saveCatalog(
      catalog.map((c) =>
        c.id === editId
          ? {
              ...c,
              type: edit.type.trim() || "R&C",
              name: edit.name.trim(),
              cost,
              weight: Number.isFinite(weight) ? weight : 0,
            }
          : c,
      ),
    );
    setEditId(null);
  };
  const deleteComponent = (c: CatItem) => {
    if (!window.confirm(`Delete "${c.type} ${c.name}" from the list?`)) return;
    saveCatalog(catalog.filter((x) => x.id !== c.id));
    if (pick === c.id) setPick("");
  };
  const extraRows = extras;
  const extraCost = extras.reduce((n, e) => n + e.cost * e.qty, 0);
  const extraWeight = extras.reduce((n, e) => n + e.weight * e.qty, 0);

  const today = new Date().toLocaleDateString("en-US");

  return (
    <main className="mx-auto max-w-5xl p-4 print:max-w-none print:p-0">
      <header className="mb-5 flex flex-wrap items-center gap-4 print:hidden">
        <img src="/logo.png" alt="Lindsay Precast" className="h-20 w-auto" />
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-navy">Procurement order</h1>
          <p className="text-sm text-slate-600">
            Components to order for this job.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/"
            className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-white"
          >
            ← Dashboard
          </Link>
          <Link
            href={withJob("/structures", job?.id)}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-white"
          >
            Structure Tracker
          </Link>
          <button
            onClick={() => window.print()}
            disabled={extraRows.length === 0}
            className="rounded-md bg-brand-red px-4 py-2 text-sm font-semibold text-white hover:bg-brand-red-dark disabled:opacity-50"
          >
            Print / Save PDF
          </button>
        </div>
      </header>

      <JobBanner job={job} loading={jobLoading} />

      <section className="mb-4 grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-3 print:hidden">
        <label className="text-sm">
          <span className="font-medium text-navy">PO number</span>
          <input
            value={poNumber}
            onChange={(e) => setPoNumber(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
          />
        </label>
        <label className="text-sm">
          <span className="font-medium text-navy">Vendor</span>
          <input
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
            placeholder="e.g. Deeter"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
          />
        </label>
        <label className="text-sm sm:col-span-3">
          <span className="font-medium text-navy">Notes</span>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
          />
        </label>
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3 sm:col-span-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-navy">Add Components</p>
            <button
              onClick={() => setManaging((m) => !m)}
              className="text-sm font-medium text-navy underline"
            >
              {managing ? "Done editing list" : "Edit component list"}
            </button>
          </div>
          <div className="flex flex-wrap items-end gap-2 text-sm">
            <select
              value={pick}
              onChange={(e) => setPick(e.target.value)}
              className="min-w-64 flex-1 rounded-md border border-slate-300 px-3 py-2"
            >
              <option value="">Choose a component…</option>
              {catalog.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.type} {c.name} — {money(c.cost)} · {c.weight} lb
                </option>
              ))}
            </select>
            <label>
              <span className="mr-1">Qty</span>
              <input
                type="number"
                min={1}
                value={pickQty}
                onChange={(e) => setPickQty(Number(e.target.value))}
                className="w-20 rounded-md border border-slate-300 px-2 py-2"
              />
            </label>
            <input
              value={pickStructure}
              onChange={(e) => setPickStructure(e.target.value)}
              placeholder="Structure / job (optional)"
              className="w-56 rounded-md border border-slate-300 px-3 py-2"
            />
            <button
              onClick={addExtra}
              disabled={pick === ""}
              className="rounded-md bg-navy px-4 py-2 font-semibold text-white hover:bg-navy-dark disabled:opacity-50"
            >
              Add to order
            </button>
          </div>

          {managing && (
            <div className="mt-3 overflow-x-auto rounded-md border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-slate-100 text-left">
                  <tr>
                    <th className="px-2 py-1.5">Type</th>
                    <th className="px-2 py-1.5">Name</th>
                    <th className="px-2 py-1.5">Cost</th>
                    <th className="px-2 py-1.5">Weight (lb)</th>
                    <th className="px-2 py-1.5" />
                  </tr>
                </thead>
                <tbody>
                  {catalog.map((c) =>
                    editId === c.id ? (
                      <tr key={c.id} className="border-t border-slate-200">
                        <td className="px-2 py-1">
                          <input
                            value={edit.type}
                            onChange={(e) =>
                              setEdit({ ...edit, type: e.target.value })
                            }
                            className="w-20 rounded-md border border-slate-300 px-2 py-1.5"
                          />
                        </td>
                        <td className="px-2 py-1">
                          <input
                            value={edit.name}
                            onChange={(e) =>
                              setEdit({ ...edit, name: e.target.value })
                            }
                            className="w-full min-w-56 rounded-md border border-slate-300 px-2 py-1.5"
                          />
                        </td>
                        <td className="px-2 py-1">
                          <input
                            type="number"
                            step="0.01"
                            value={edit.cost}
                            onChange={(e) =>
                              setEdit({ ...edit, cost: e.target.value })
                            }
                            className="w-28 rounded-md border border-slate-300 px-2 py-1.5"
                          />
                        </td>
                        <td className="px-2 py-1">
                          <input
                            type="number"
                            value={edit.weight}
                            onChange={(e) =>
                              setEdit({ ...edit, weight: e.target.value })
                            }
                            className="w-24 rounded-md border border-slate-300 px-2 py-1.5"
                          />
                        </td>
                        <td className="px-2 py-1 text-right whitespace-nowrap">
                          <button
                            onClick={saveEdit}
                            className="mr-3 font-medium text-navy hover:underline"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditId(null)}
                            className="hover:underline"
                          >
                            Cancel
                          </button>
                        </td>
                      </tr>
                    ) : (
                      <tr key={c.id} className="border-t border-slate-200">
                        <td className="px-2 py-1.5">{c.type}</td>
                        <td className="px-2 py-1.5">{c.name}</td>
                        <td className="px-2 py-1.5">{money(c.cost)}</td>
                        <td className="px-2 py-1.5">{c.weight}</td>
                        <td className="px-2 py-1.5 text-right whitespace-nowrap">
                          <button
                            onClick={() => startEdit(c)}
                            className="mr-3 font-medium text-navy hover:underline"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => deleteComponent(c)}
                            className="text-brand-red hover:underline"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ),
                  )}
                  <tr className="border-t-2 border-slate-300 bg-slate-50">
                    <td className="px-2 py-1">
                      <input
                        value={draft.type}
                        onChange={(e) =>
                          setDraft({ ...draft, type: e.target.value })
                        }
                        className="w-20 rounded-md border border-slate-300 px-2 py-1.5"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        value={draft.name}
                        onChange={(e) =>
                          setDraft({ ...draft, name: e.target.value })
                        }
                        placeholder="New component name"
                        className="w-full min-w-56 rounded-md border border-slate-300 px-2 py-1.5"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        type="number"
                        step="0.01"
                        value={draft.cost}
                        onChange={(e) =>
                          setDraft({ ...draft, cost: e.target.value })
                        }
                        placeholder="Cost"
                        className="w-28 rounded-md border border-slate-300 px-2 py-1.5"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        type="number"
                        value={draft.weight}
                        onChange={(e) =>
                          setDraft({ ...draft, weight: e.target.value })
                        }
                        placeholder="Weight"
                        className="w-24 rounded-md border border-slate-300 px-2 py-1.5"
                      />
                    </td>
                    <td className="px-2 py-1 text-right">
                      <button
                        onClick={addComponent}
                        disabled={!draft.name.trim() || draft.cost === ""}
                        className="rounded-md bg-navy px-3 py-1.5 font-semibold text-white disabled:opacity-50"
                      >
                        Add
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <div className="hidden items-center gap-4 border-b-2 border-navy pb-3 print:flex">
        <img src="/logo.png" alt="Lindsay Precast" className="h-16 w-auto" />
        <div className="flex-1">
          <h1 className="text-xl font-bold text-navy">Procurement Order</h1>
          {job && (
            <p className="text-sm font-semibold text-slate-800">
              {jobLine(job)}
            </p>
          )}
          <p className="text-xs text-slate-600">
            {today}
            {poNumber && ` · PO ${poNumber}`}
            {vendor && ` · Vendor: ${vendor}`}
          </p>
          {notes && <p className="text-xs text-slate-600">{notes}</p>}
        </div>
      </div>

      {extraRows.length > 0 && (
        <>
          <h2 className="mt-4 mb-2 text-lg font-semibold text-navy">
            Components
          </h2>
          <table className="w-full border-collapse text-sm">
            <thead className="bg-navy text-left text-white">
              <tr>
                <th className="px-3 py-2">Item</th>
                <th className="px-3 py-2">Structure / job</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2 text-right">Unit cost</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2 text-right">Weight</th>
                <th className="px-3 py-2 print:hidden" />
              </tr>
            </thead>
            <tbody>
              {extraRows.map((e) => (
                <tr key={e.id} className="border-b border-slate-200">
                  <td className="px-3 py-1.5">
                    {e.type} {e.name}
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      value={e.structure}
                      onChange={(ev) =>
                        patchExtra(e.id, { structure: ev.target.value })
                      }
                      placeholder="—"
                      className="w-full rounded border border-slate-200 px-2 py-1 print:hidden"
                    />
                    <span className="hidden print:inline">{e.structure}</span>
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <input
                      type="number"
                      min={1}
                      value={e.qty}
                      onChange={(ev) =>
                        patchExtra(e.id, { qty: Number(ev.target.value) })
                      }
                      className="w-16 rounded border border-slate-200 px-2 py-1 text-right print:hidden"
                    />
                    <span className="hidden print:inline">{e.qty}</span>
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <input
                      type="number"
                      step="0.01"
                      value={e.cost}
                      onChange={(ev) =>
                        patchExtra(e.id, { cost: Number(ev.target.value) })
                      }
                      className="w-24 rounded border border-slate-200 px-2 py-1 text-right print:hidden"
                    />
                    <span className="hidden print:inline">{money(e.cost)}</span>
                  </td>
                  <td className="px-3 py-1.5 text-right font-semibold">
                    {money(e.cost * e.qty)}
                  </td>
                  <td className="px-3 py-1.5 text-right whitespace-nowrap">
                    {(e.weight * e.qty).toLocaleString()} lb
                  </td>
                  <td className="px-3 py-1.5 text-right print:hidden">
                    <button
                      onClick={() =>
                        saveExtras(extras.filter((x) => x.id !== e.id))
                      }
                      className="text-brand-red hover:underline"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className="px-3 py-2" colSpan={4}>
                  Total
                </td>
                <td className="px-3 py-2 text-right">{money(extraCost)}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  {extraWeight.toLocaleString()} lb
                </td>
                <td className="print:hidden" />
              </tr>
            </tbody>
          </table>
        </>
      )}

      {extraRows.length === 0 && (
        <p className="mt-4 rounded-md border border-slate-200 bg-white p-6 text-slate-600 print:hidden">
          No components yet. Choose one above and click Add to order.
        </p>
      )}
    </main>
  );
}
