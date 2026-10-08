// Works out what changed between the lines already stored for a job and a freshly pasted
// Titan sheet, so an import can update only what changed instead of replacing everything.
// Lines have no unique id in Titan, so a line is identified by Structure + Product +
// Description (repeats are paired up in sheet order).
import type { ParsedRow } from "./titan";

export type DbLine = {
  id: string;
  import_batch: string;
  sort_order: number;
  priority: number | null;
  structure: string;
  description: string | null;
  plant_id: string | null;
  production_dep: string | null;
  sch_date: string | null;
  ready_date: string | null;
  pro_date: string | null;
  pick_date: string | null;
  weight: number | null;
  uom: string | null;
  product: string | null;
  qty: number | null;
};

export type Change = { label: string; from: string; to: string };

export type MergePlan = {
  /** Pasted lines that are not in the app yet. */
  inserts: { index: number; row: ParsedRow }[];
  /** Lines already in the app whose stored values differ from the paste. */
  updates: { line: DbLine; index: number; row: ParsedRow }[];
  /** The user-visible differences for each updated structure line. */
  changed: {
    structure: string;
    description: string;
    changes: Change[];
  }[];
  unchanged: number;
  /** Lines in the app that this paste doesn't contain. */
  missing: DbLine[];
};

const norm = (s: string | null | undefined) =>
  (s ?? "").toString().replace(/\s+/g, " ").trim().toLowerCase();

const fullKey = (st: string, product: string | null, desc: string | null) =>
  `${norm(st)}|${norm(product)}|${norm(desc)}`;
const looseKey = (st: string, desc: string | null) =>
  `${norm(st)}|${norm(desc)}`;

const isoToUs = (d: string | null) => {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${Number(m)}/${Number(day)}/${y}`;
};
const txt = (v: string | null | undefined) => (v && v.trim() ? v.trim() : "—");
const numTxt = (v: number | null) => (v === null ? "—" : String(v));

const same = (a: string | null | undefined, b: string | null | undefined) =>
  norm(a) === norm(b);
const sameNum = (a: number | null, b: number | null) =>
  (a === null && b === null) ||
  (a !== null && b !== null && Number(a) === Number(b));

// What a stored line holds for each pasted field, so columns missing from a paste can keep it.
const stored = (l: DbLine): Partial<Record<keyof ParsedRow, unknown>> => ({
  priority: l.priority,
  description: l.description ?? "",
  plantId: l.plant_id ?? "",
  productionDep: l.production_dep ?? "",
  schDate: l.sch_date,
  readyDate: l.ready_date,
  proDate: l.pro_date,
  pickDate: l.pick_date,
  weight: l.weight,
  uom: l.uom ?? "",
  product: l.product ?? "",
  qty: l.qty,
});

export function planMerge(
  existing: DbLine[],
  pasted: ParsedRow[],
  absent: (keyof ParsedRow)[] = [],
): MergePlan {
  const sorted = [...existing].sort((a, b) => a.sort_order - b.sort_order);

  const full = new Map<string, DbLine[]>();
  for (const l of sorted) {
    const k = fullKey(l.structure, l.product, l.description);
    (full.get(k) ?? full.set(k, []).get(k)!).push(l);
  }

  const used = new Set<string>();
  const match: (DbLine | null)[] = pasted.map((r) => {
    const q = full.get(fullKey(r.structure, r.product, r.description));
    const line = q?.shift();
    if (line) used.add(line.id);
    return line ?? null;
  });

  // Lines stored before the Product column existed have no product; pair those by
  // Structure + Description instead.
  const loose = new Map<string, DbLine[]>();
  for (const l of sorted) {
    if (used.has(l.id) || norm(l.product) !== "") continue;
    const k = looseKey(l.structure, l.description);
    (loose.get(k) ?? loose.set(k, []).get(k)!).push(l);
  }
  pasted.forEach((r, i) => {
    if (match[i]) return;
    const line = loose.get(looseKey(r.structure, r.description))?.shift();
    if (line) {
      match[i] = line;
      used.add(line.id);
    }
  });

  const plan: MergePlan = {
    inserts: [],
    updates: [],
    changed: [],
    unchanged: 0,
    missing: sorted.filter((l) => !used.has(l.id)),
  };

  pasted.forEach((pr, index) => {
    const l = match[index];
    if (!l) {
      plan.inserts.push({ index, row: pr });
      return;
    }
    // Columns that weren't in the paste keep what the app already has.
    const r: ParsedRow = { ...pr };
    for (const f of absent) {
      if (f in stored(l)) (r as Record<string, unknown>)[f] = stored(l)[f];
    }
    // A pick date typed in by hand survives a paste where Titan has none yet.
    if (!r.pickDate && l.pick_date) r.pickDate = l.pick_date;

    const changes: Change[] = [];
    const add = (label: string, from: string, to: string, differs: boolean) => {
      if (differs) changes.push({ label, from, to });
    };
    add(
      "Priority",
      numTxt(l.priority),
      numTxt(r.priority),
      !sameNum(l.priority, r.priority),
    );
    add(
      "Plant ID",
      txt(l.plant_id),
      txt(r.plantId),
      !same(l.plant_id, r.plantId),
    );
    add(
      "Production Dept",
      txt(l.production_dep),
      txt(r.productionDep),
      !same(l.production_dep, r.productionDep),
    );
    add(
      "Scheduled Date",
      isoToUs(l.sch_date),
      isoToUs(r.schDate),
      (l.sch_date ?? null) !== (r.schDate ?? null),
    );
    add(
      "Ready Date",
      isoToUs(l.ready_date),
      isoToUs(r.readyDate),
      (l.ready_date ?? null) !== (r.readyDate ?? null),
    );
    add(
      "Pick Date",
      isoToUs(l.pick_date),
      isoToUs(r.pickDate),
      (l.pick_date ?? null) !== (r.pickDate ?? null),
    );
    add(
      "Weight",
      numTxt(l.weight),
      numTxt(r.weight),
      !sameNum(l.weight, r.weight),
    );
    add("UOM", txt(l.uom), txt(r.uom), !same(l.uom, r.uom));

    // Stored but not shown as a change: keep these in step quietly.
    const quiet =
      (l.pro_date ?? null) !== (r.proDate ?? null) ||
      !sameNum(l.qty, r.qty) ||
      norm(l.product) !== norm(r.product) ||
      l.sort_order !== index;

    if (changes.length > 0) {
      plan.changed.push({
        structure: r.structure,
        description: r.description,
        changes,
      });
    }
    if (changes.length > 0 || quiet)
      plan.updates.push({ line: l, index, row: r });
    if (changes.length === 0) plan.unchanged++;
  });

  return plan;
}
