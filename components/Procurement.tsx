"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase";
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

// Order lines keep their own copy of name/cost/weight. Editing a component in the list
// updates the matching lines in the order that is open (catalogId links them); deleting
// a component never removes lines from an order.
type Extra = {
  id: string;
  catalogId?: string;
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

// The order (per job) and the component list are saved in Supabase, so every computer sees the same data.
async function pushCatalogRemote(items: CatItem[]): Promise<string | null> {
  const { error } = await getSupabase()
    .from("procurement_catalog")
    .upsert({ id: "main", items, updated_at: new Date().toISOString() });
  return error ? error.message : null;
}

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

  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [syncError, setSyncError] = useState<string | null>(null);
  const dirty = useRef(false); // unsaved local changes to this job's order
  const loadedFor = useRef<string | null>(null);

  const failText = (m: string) =>
    /procurement_|relation|does not exist/i.test(m)
      ? `${m} — run the updated supabase/schema.sql in Supabase first.`
      : m;

  const loadOrder = useCallback(async () => {
    if (!jobId) return;
    const { data, error } = await getSupabase()
      .from("procurement_orders")
      .select("po_number, vendor, notes, lines")
      .eq("job_id", jobId)
      .maybeSingle();
    if (error) {
      setSyncError(failText(error.message));
      return;
    }
    setSyncError(null);
    loadedFor.current = jobId;
    if (data) {
      dirty.current = false;
      setPoNumber(data.po_number ?? "");
      setVendor(data.vendor ?? "");
      setNotes(data.notes ?? "");
      setExtras((data.lines ?? []) as Extra[]);
      return;
    }
    // Nothing saved online yet: move over an order saved earlier in this browser.
    try {
      const v = localStorage.getItem(storeKey);
      if (v) {
        const saved = JSON.parse(v) as (Extra & { catalogIdx?: number })[];
        const lines = saved.map((e) =>
          e.name !== undefined ? e : { ...e, ...CATALOG[e.catalogIdx ?? 0] },
        );
        if (lines.length > 0) {
          dirty.current = true;
          setExtras(lines);
        }
      }
    } catch {}
  }, [jobId, storeKey]);

  useEffect(() => {
    if (jobLoading) return;
    loadedFor.current = null;
    dirty.current = false;
    setExtras([]);
    setPoNumber("");
    setVendor("");
    setNotes("");
    setSaveState("idle");
    void loadOrder();
  }, [jobLoading, loadOrder]);

  // Save the order a moment after any change.
  useEffect(() => {
    if (!dirty.current || !jobId || loadedFor.current !== jobId) return;
    setSaveState("saving");
    const t = setTimeout(async () => {
      const { error } = await getSupabase().from("procurement_orders").upsert({
        job_id: jobId,
        po_number: poNumber,
        vendor,
        notes,
        lines: extras,
        updated_at: new Date().toISOString(),
      });
      if (error) {
        setSaveState("error");
        setSyncError(failText(error.message));
      } else {
        dirty.current = false;
        setSaveState("saved");
        setSyncError(null);
      }
    }, 600);
    return () => clearTimeout(t);
  }, [extras, poNumber, vendor, notes, jobId]);

  // Coming back to this tab (e.g. from another computer's changes): load the latest.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible" && !dirty.current)
        void loadOrder();
    };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [loadOrder]);

  const loadCatalog = useCallback(async () => {
    const { data, error } = await getSupabase()
      .from("procurement_catalog")
      .select("items")
      .eq("id", "main")
      .maybeSingle();
    if (error) {
      setSyncError(failText(error.message));
      return;
    }
    if (data?.items) {
      setCatalog(data.items as CatItem[]);
      return;
    }
    // Nothing saved online yet: move over a list edited earlier in this browser.
    try {
      const c = localStorage.getItem(CAT_STORE);
      if (c) {
        const items = JSON.parse(c) as CatItem[];
        setCatalog(items);
        const m = await pushCatalogRemote(items);
        if (m) setSyncError(failText(m));
      }
    } catch {}
  }, []);
  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const saveExtras = (next: Extra[]) => {
    dirty.current = true;
    setExtras(next);
  };
  const saveCatalog = (next: CatItem[]) => {
    setCatalog(next);
    void pushCatalogRemote(next).then((m) => {
      if (m) setSyncError(failText(m));
    });
  };
  const addExtra = () => {
    const item = catalog.find((c) => c.id === pick);
    if (!item || pickQty < 1) return;
    saveExtras([
      ...extras,
      {
        id: crypto.randomUUID(),
        catalogId: item.id,
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
  // Reorder order lines: drag the ⋮⋮ handle, or use the ▲ ▼ buttons.
  const [dragExtra, setDragExtra] = useState<string | null>(null);
  const [overExtra, setOverExtra] = useState<string | null>(null);
  const moveExtra = (id: string, toId: string) => {
    const from = extras.findIndex((e) => e.id === id);
    const to = extras.findIndex((e) => e.id === toId);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...extras];
    const [m] = next.splice(from, 1);
    next.splice(to, 0, m);
    saveExtras(next);
  };
  const nudgeExtra = (id: string, dir: -1 | 1) => {
    const i = extras.findIndex((e) => e.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= extras.length) return;
    moveExtra(id, extras[j].id);
  };
  // Reorder the component list (also the order of the dropdown).
  const [dragCat, setDragCat] = useState<string | null>(null);
  const [overCat, setOverCat] = useState<string | null>(null);
  const moveCat = (id: string, toId: string) => {
    const from = catalog.findIndex((c) => c.id === id);
    const to = catalog.findIndex((c) => c.id === toId);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...catalog];
    const [m] = next.splice(from, 1);
    next.splice(to, 0, m);
    saveCatalog(next);
  };
  const nudgeCat = (id: string, dir: -1 | 1) => {
    const i = catalog.findIndex((c) => c.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= catalog.length) return;
    moveCat(id, catalog[j].id);
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
    const old = catalog.find((c) => c.id === editId);
    const next = {
      type: edit.type.trim() || "R&C",
      name: edit.name.trim(),
      cost,
      weight: Number.isFinite(weight) ? weight : 0,
    };
    // Lines already in this order that came from this component follow the edit
    // (older lines without a link are matched by their previous type + name).
    if (old && editId)
      saveExtras(
        extras.map((e) =>
          e.catalogId === editId ||
          (!e.catalogId && e.type === old.type && e.name === old.name)
            ? { ...e, ...next, catalogId: editId }
            : e,
        ),
      );
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

      {syncError && (
        <div className="mb-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 print:hidden">
          {syncError}
        </div>
      )}
      <p className="mb-2 text-right text-xs text-slate-500 print:hidden">
        {saveState === "saving"
          ? "Saving…"
          : saveState === "saved"
            ? "Saved — available on every computer"
            : saveState === "error"
              ? "Not saved"
              : ""}
      </p>

      <section className="mb-4 grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-3 print:hidden">
        <label className="text-sm">
          <span className="font-medium text-navy">PO number</span>
          <input
            value={poNumber}
            onChange={(e) => {
              dirty.current = true;
              setPoNumber(e.target.value);
            }}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
          />
        </label>
        <label className="text-sm">
          <span className="font-medium text-navy">Vendor</span>
          <input
            value={vendor}
            onChange={(e) => {
              dirty.current = true;
              setVendor(e.target.value);
            }}
            placeholder="e.g. Deeter"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
          />
        </label>
        <label className="text-sm sm:col-span-3">
          <span className="font-medium text-navy">Notes</span>
          <input
            value={notes}
            onChange={(e) => {
              dirty.current = true;
              setNotes(e.target.value);
            }}
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
                    <th className="w-20 px-2 py-1.5" />
                    <th className="px-2 py-1.5">Type</th>
                    <th className="px-2 py-1.5">Name</th>
                    <th className="px-2 py-1.5">Cost</th>
                    <th className="px-2 py-1.5">Weight (lb)</th>
                    <th className="px-2 py-1.5" />
                  </tr>
                </thead>
                <tbody>
                  {catalog.map((c, idx) => {
                    const handle = (
                      <td className="px-2 py-1.5 whitespace-nowrap">
                        <span
                          draggable
                          title="Drag to reorder"
                          onDragStart={(ev) => {
                            ev.dataTransfer.effectAllowed = "move";
                            ev.dataTransfer.setData("text/plain", c.id);
                            const tr = (
                              ev.currentTarget as HTMLElement
                            ).closest("tr");
                            if (tr) ev.dataTransfer.setDragImage(tr, 0, 0);
                            setDragCat(c.id);
                          }}
                          onDragEnd={() => {
                            setDragCat(null);
                            setOverCat(null);
                          }}
                          className="cursor-grab px-1 text-slate-400 select-none active:cursor-grabbing"
                          aria-hidden
                        >
                          ⋮⋮
                        </span>
                        <button
                          onClick={() => nudgeCat(c.id, -1)}
                          disabled={idx === 0}
                          aria-label="Move up"
                          className="px-0.5 text-xs text-navy disabled:opacity-25"
                        >
                          ▲
                        </button>
                        <button
                          onClick={() => nudgeCat(c.id, 1)}
                          disabled={idx === catalog.length - 1}
                          aria-label="Move down"
                          className="px-0.5 text-xs text-navy disabled:opacity-25"
                        >
                          ▼
                        </button>
                      </td>
                    );
                    const rowProps = {
                      onDragOver: (ev: React.DragEvent) => {
                        if (!dragCat) return;
                        ev.preventDefault();
                        if (overCat !== c.id) setOverCat(c.id);
                      },
                      onDrop: (ev: React.DragEvent) => {
                        ev.preventDefault();
                        if (dragCat) moveCat(dragCat, c.id);
                        setDragCat(null);
                        setOverCat(null);
                      },
                      className: `border-t border-slate-200 ${
                        dragCat === c.id
                          ? "opacity-40"
                          : overCat === c.id && dragCat
                            ? "bg-slate-100 outline-2 outline-navy"
                            : ""
                      }`,
                    };
                    return editId === c.id ? (
                      <tr key={c.id} {...rowProps}>
                        {handle}
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
                      <tr key={c.id} {...rowProps}>
                        {handle}
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
                    );
                  })}
                  <tr className="border-t-2 border-slate-300 bg-slate-50">
                    <td />
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
                <th className="w-16 px-2 py-2 print:hidden" />
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
              {extraRows.map((e, idx) => (
                <tr
                  key={e.id}
                  onDragOver={(ev) => {
                    if (!dragExtra) return;
                    ev.preventDefault();
                    if (overExtra !== e.id) setOverExtra(e.id);
                  }}
                  onDrop={(ev) => {
                    ev.preventDefault();
                    if (dragExtra) moveExtra(dragExtra, e.id);
                    setDragExtra(null);
                    setOverExtra(null);
                  }}
                  className={`border-b border-slate-200 ${
                    dragExtra === e.id
                      ? "opacity-40"
                      : overExtra === e.id && dragExtra
                        ? "bg-slate-100 outline-2 outline-navy"
                        : ""
                  }`}
                >
                  <td className="px-2 py-1.5 whitespace-nowrap print:hidden">
                    <span
                      draggable
                      title="Drag to reorder"
                      onDragStart={(ev) => {
                        ev.dataTransfer.effectAllowed = "move";
                        ev.dataTransfer.setData("text/plain", e.id);
                        const tr = (ev.currentTarget as HTMLElement).closest(
                          "tr",
                        );
                        if (tr) ev.dataTransfer.setDragImage(tr, 0, 0);
                        setDragExtra(e.id);
                      }}
                      onDragEnd={() => {
                        setDragExtra(null);
                        setOverExtra(null);
                      }}
                      className="cursor-grab px-1 text-slate-400 select-none active:cursor-grabbing"
                      aria-hidden
                    >
                      ⋮⋮
                    </span>
                    <button
                      onClick={() => nudgeExtra(e.id, -1)}
                      disabled={idx === 0}
                      aria-label="Move up"
                      className="px-0.5 text-xs text-navy disabled:opacity-25"
                    >
                      ▲
                    </button>
                    <button
                      onClick={() => nudgeExtra(e.id, 1)}
                      disabled={idx === extraRows.length - 1}
                      aria-label="Move down"
                      className="px-0.5 text-xs text-navy disabled:opacity-25"
                    >
                      ▼
                    </button>
                  </td>
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
                <td className="print:hidden" />
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
