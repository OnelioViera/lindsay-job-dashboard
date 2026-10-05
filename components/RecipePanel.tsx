"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";

type Cat = { id: string; type: string; name: string };
type Pick = {
  structure: string;
  product: string | null;
  description: string | null;
};
type RecipeLine = { catalogId: string; qty: number };
type Recipe = { id: string; product: string; lines: RecipeLine[] };
export type NewLine = { catalogId: string; qty: number; structure: string };

const norm = (s: string | null | undefined) =>
  (s ?? "").toUpperCase().replace(/\s+/g, "");

// A "recipe" lists the components one structure of a product needs. Picking structures then
// fills the order from the recipes of their Product codes.
export default function RecipePanel({
  picks,
  catalog,
  onAdd,
}: {
  picks: Pick[];
  catalog: Cat[];
  onAdd: (lines: NewLine[]) => void;
}) {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [managing, setManaging] = useState(false);
  const [mult, setMult] = useState<Record<string, number>>({});
  const [combine, setCombine] = useState(false);
  const [editing, setEditing] = useState<{
    id: string | null;
    product: string;
    lines: RecipeLine[];
  } | null>(null);

  const catById = useMemo(
    () => new Map(catalog.map((c) => [c.id, c])),
    [catalog],
  );
  const label = (id: string) => {
    const c = catById.get(id);
    return c ? `${c.type} ${c.name}` : "(component no longer in the list)";
  };

  const load = useCallback(async () => {
    const { data, error } = await getSupabase()
      .from("procurement_recipes")
      .select("items")
      .eq("id", "main")
      .maybeSingle();
    if (error) {
      setErr(
        /procurement_recipes|relation/.test(error.message)
          ? `${error.message} — run the updated supabase/schema.sql in Supabase first.`
          : error.message,
      );
      return;
    }
    setErr(null);
    setRecipes((data?.items ?? []) as Recipe[]);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const persist = async (next: Recipe[]) => {
    setRecipes(next);
    const { error } = await getSupabase().from("procurement_recipes").upsert({
      id: "main",
      items: next,
      updated_at: new Date().toISOString(),
    });
    if (error) setErr(error.message);
  };

  const recipeFor = (product: string | null) =>
    recipes.find((r) => norm(r.product) === norm(product));

  // Components this set of structures needs.
  const generated = useMemo(() => {
    const out: NewLine[] = [];
    for (const p of picks) {
      const r = recipeFor(p.product);
      if (!r) continue;
      const m = mult[p.structure] ?? 1;
      for (const l of r.lines)
        if (catById.has(l.catalogId) && l.qty > 0 && m > 0)
          out.push({
            catalogId: l.catalogId,
            qty: l.qty * m,
            structure: p.structure,
          });
    }
    if (!combine) return out;
    const by = new Map<string, NewLine>();
    for (const l of out) {
      const cur = by.get(l.catalogId);
      if (cur) {
        cur.qty += l.qty;
        cur.structure += `, ${l.structure}`;
      } else by.set(l.catalogId, { ...l });
    }
    return [...by.values()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picks, recipes, mult, combine, catById]);

  const missing = picks.filter((p) => !recipeFor(p.product));
  const input =
    "rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-navy focus:outline-none";

  const startNew = (product = "") =>
    setEditing({
      id: null,
      product,
      lines: [
        { catalogId: "", qty: 1 },
        { catalogId: "", qty: 1 },
        { catalogId: "", qty: 1 },
      ],
    });

  const saveEditing = () => {
    if (!editing || !editing.product.trim()) return;
    const lines = editing.lines.filter((l) => l.catalogId && l.qty > 0);
    if (lines.length === 0) return;
    const rec: Recipe = {
      id: editing.id ?? crypto.randomUUID(),
      product: editing.product.trim(),
      lines,
    };
    const next = editing.id
      ? recipes.map((r) => (r.id === editing.id ? rec : r))
      : [...recipes.filter((r) => norm(r.product) !== norm(rec.product)), rec];
    void persist(next);
    setEditing(null);
  };

  return (
    <div className="mt-3 border-t border-slate-200 pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => {
            setPreviewing((v) => !v);
            setManaging(false);
          }}
          className="rounded-md bg-navy px-3 py-1.5 text-sm font-semibold text-white hover:bg-navy-dark"
        >
          Calculate components for these structures
        </button>
        <button
          onClick={() => {
            setManaging((v) => !v);
            setPreviewing(false);
          }}
          className="text-sm font-medium text-navy underline"
        >
          {managing ? "Done with recipes" : `Edit recipes (${recipes.length})`}
        </button>
      </div>
      {err && <p className="mt-2 text-sm text-red-700">{err}</p>}

      {previewing && (
        <div className="mt-3 rounded-md border border-slate-200 p-3">
          {recipes.length === 0 && (
            <p className="mb-2 text-sm text-slate-600">
              No recipes yet. A recipe says which components one structure of a
              Product needs. Click “Create recipe” on a row (or Edit recipes) to
              add the first one.
            </p>
          )}
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="px-2 py-1.5">Structure ID</th>
                <th className="px-2 py-1.5">Product</th>
                <th className="px-2 py-1.5">Qty</th>
                <th className="px-2 py-1.5">Components</th>
              </tr>
            </thead>
            <tbody>
              {picks.map((p) => {
                const r = recipeFor(p.product);
                return (
                  <tr
                    key={p.structure}
                    className="border-t border-slate-200 align-top"
                  >
                    <td className="px-2 py-1.5 font-semibold text-navy">
                      {p.structure}
                    </td>
                    <td className="px-2 py-1.5">{p.product}</td>
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        min={1}
                        value={mult[p.structure] ?? 1}
                        onChange={(e) =>
                          setMult({
                            ...mult,
                            [p.structure]: Number(e.target.value),
                          })
                        }
                        className={`${input} w-16`}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      {r ? (
                        <>
                          {r.lines.map((l, i) => (
                            <div key={i}>
                              {l.qty * (mult[p.structure] ?? 1)} ×{" "}
                              {label(l.catalogId)}
                            </div>
                          ))}
                          <button
                            onClick={() => {
                              setPreviewing(false);
                              setManaging(true);
                              setEditing({
                                id: r.id,
                                product: r.product,
                                lines: [
                                  ...r.lines.map((x) => ({ ...x })),
                                  { catalogId: "", qty: 1 },
                                ],
                              });
                            }}
                            className="mt-1 text-xs font-medium text-navy underline"
                          >
                            Add or change components for this product
                          </button>
                        </>
                      ) : (
                        <span className="text-brand-red">
                          No recipe for this product{" "}
                          <button
                            onClick={() => {
                              setPreviewing(false);
                              setManaging(true);
                              startNew(p.product ?? "");
                            }}
                            className="font-medium underline"
                          >
                            Create recipe
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={combine}
                onChange={(e) => setCombine(e.target.checked)}
              />
              Combine the same component into one line
            </label>
            <button
              onClick={() => {
                onAdd(generated);
                setPreviewing(false);
              }}
              disabled={generated.length === 0}
              className="rounded-md bg-brand-red px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-red-dark disabled:opacity-50"
            >
              Add {generated.length} line{generated.length === 1 ? "" : "s"} to
              order
            </button>
            {missing.length > 0 && (
              <span className="text-sm text-slate-600">
                {missing.length} structure
                {missing.length === 1 ? " has" : "s have"} no recipe and will be
                left out.
              </span>
            )}
          </div>
        </div>
      )}

      {managing && (
        <div className="mt-3 rounded-md border border-slate-200 p-3">
          {recipes.length > 0 && (
            <table className="mb-3 w-full text-left text-sm">
              <thead className="bg-slate-100 text-slate-700">
                <tr>
                  <th className="px-2 py-1.5">Product</th>
                  <th className="px-2 py-1.5">Components per structure</th>
                  <th className="px-2 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {recipes.map((r) => (
                  <tr
                    key={r.id}
                    className="border-t border-slate-200 align-top"
                  >
                    <td className="px-2 py-1.5 font-semibold text-navy">
                      {r.product}
                    </td>
                    <td className="px-2 py-1.5">
                      {r.lines.map((l, i) => (
                        <div key={i}>
                          {l.qty} × {label(l.catalogId)}
                        </div>
                      ))}
                    </td>
                    <td className="px-2 py-1.5 text-right whitespace-nowrap">
                      <button
                        onClick={() =>
                          setEditing({
                            id: r.id,
                            product: r.product,
                            lines: r.lines.map((l) => ({ ...l })),
                          })
                        }
                        className="mr-3 font-medium text-navy hover:underline"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => {
                          if (
                            window.confirm(
                              `Delete the recipe for ${r.product}?`,
                            )
                          )
                            void persist(recipes.filter((x) => x.id !== r.id));
                        }}
                        className="text-brand-red hover:underline"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {editing ? (
            <div className="rounded-md bg-slate-50 p-3">
              <p className="mb-2 text-sm font-semibold text-navy">
                {editing.id ? "Edit recipe" : "New recipe"}
              </p>
              <label className="text-sm">
                <span className="font-medium text-navy">
                  Product code (exactly as in Titan)
                </span>
                <input
                  list="recipe-products"
                  value={editing.product}
                  onChange={(e) =>
                    setEditing({ ...editing, product: e.target.value })
                  }
                  placeholder="e.g. TYPE13/16DBLCOMBO"
                  className={`${input} mt-1 block w-full max-w-sm`}
                />
                <datalist id="recipe-products">
                  {[
                    ...new Set(picks.map((p) => p.product).filter(Boolean)),
                  ].map((p) => (
                    <option key={p!} value={p!} />
                  ))}
                </datalist>
              </label>
              <p className="mt-3 mb-1 text-sm font-medium text-navy">
                Components for ONE structure of this product
              </p>
              {editing.lines.map((l, i) => (
                <div key={i} className="mb-2 flex flex-wrap items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    value={l.qty}
                    onChange={(e) => {
                      const lines = [...editing.lines];
                      lines[i] = { ...l, qty: Number(e.target.value) };
                      setEditing({ ...editing, lines });
                    }}
                    className={`${input} w-16`}
                  />
                  <span className="text-sm">×</span>
                  <select
                    value={l.catalogId}
                    onChange={(e) => {
                      const lines = [...editing.lines];
                      lines[i] = { ...l, catalogId: e.target.value };
                      // Picking in the last row opens a fresh row, so you can keep adding.
                      if (e.target.value && i === lines.length - 1)
                        lines.push({ catalogId: "", qty: 1 });
                      setEditing({ ...editing, lines });
                    }}
                    className={`${input} min-w-64 flex-1`}
                  >
                    <option value="">Choose a component…</option>
                    {catalog.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.type} {c.name}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() =>
                      setEditing({
                        ...editing,
                        lines: editing.lines.filter((_, k) => k !== i),
                      })
                    }
                    className="text-sm text-brand-red hover:underline"
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                onClick={() =>
                  setEditing({
                    ...editing,
                    lines: [...editing.lines, { catalogId: "", qty: 1 }],
                  })
                }
                className="rounded-md border border-navy px-3 py-1 text-sm font-medium text-navy hover:bg-white"
              >
                + Add another component
              </button>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={saveEditing}
                  disabled={
                    !editing.product.trim() ||
                    !editing.lines.some((l) => l.catalogId && l.qty > 0)
                  }
                  className="rounded-md bg-navy px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
                >
                  Save recipe
                </button>
                <button
                  onClick={() => setEditing(null)}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-white"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => startNew()}
              className="rounded-md border border-navy px-3 py-1.5 text-sm font-semibold text-navy hover:bg-white"
            >
              + New recipe
            </button>
          )}
        </div>
      )}
    </div>
  );
}
