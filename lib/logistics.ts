// Job logistics: delivery schedule, truckloads and yard risks, built from the Titan lines
// plus anything added by hand. All the arithmetic lives here so the report always adds up.

export const DEFAULT_LIMIT = 55000; // lb per truckload

export type LLine = {
  structure: string;
  description: string | null;
  plant_id?: string | null;
  sch_date?: string | null;
  ready_date: string | null;
  pick_date: string | null;
  weight: number | null;
  qty: number | null;
  ext_price?: number | null; // Titan ExtPrice for the line
};

export type ManualItem = {
  id: string;
  name: string;
  description: string;
  qty: number;
  weight: number; // lb each
  pick: string; // delivery date, YYYY-MM-DD
  cost?: number; // $ each
};

/** Cost typed per structure, keyed by Structure ID (kept as text so "12." can be typed). */
export type Costs = Record<string, string>;

export const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

const parseCost = (t: string | undefined) => {
  const n = Number((t ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

export type LItem = {
  key: string;
  name: string;
  description: string;
  weight: number; // total lb
  cost: number; // total $ (typed cost, else the Titan prices added up)
  titanCost: number; // total $ from Titan ExtPrice
  sch: string | null;
  ready: string | null;
  pick: string | null;
  manual: boolean;
  plants: Record<string, { weight: number; titan: number; cost: number }>;
  pieces: Piece[]; // the Tracker lines (parts) that make up this item
};

export type Piece = {
  description: string;
  plant: string;
  weight: number;
  cost: number;
};

export type Load = { items: LItem[]; weight: number; over: boolean };
export type Day = {
  date: string;
  items: LItem[];
  weight: number;
  cost: number;
  loads: Load[];
};

export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const natural = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true });

/**
 * One item per structure: weight is the sum of the Weight shown on each of its lines.
 * With `split`, a structure whose lines have different pick dates (or some with and some
 * without) becomes one item per pick date, so only the parts that actually have a delivery
 * date are scheduled and the rest stay in the yard / not-ready lists.
 */
export function buildItems(
  lines: LLine[],
  manual: ManualItem[],
  costs: Costs = {},
  split = false,
): LItem[] {
  const by = new Map<string, LItem>();
  const lineTitan = new Map<string, number>(); // per structure, for cost shares
  const lineWeight = new Map<string, number>();
  for (const l of lines) {
    lineTitan.set(
      l.structure,
      (lineTitan.get(l.structure) ?? 0) + (Number(l.ext_price) || 0),
    );
    lineWeight.set(
      l.structure,
      (lineWeight.get(l.structure) ?? 0) + (Number(l.weight) || 0),
    );
  }
  const pieceTitan = new Map<Piece, number>();
  for (const l of lines) {
    const w = Number(l.weight) || 0; // the Weight shown on each Tracker line
    const gk = split ? `${l.structure}\u0000${l.pick_date ?? ""}` : l.structure;
    const it = by.get(gk) ?? {
      key: split && l.pick_date ? `${l.structure}@${l.pick_date}` : l.structure,
      name: l.structure,
      description: l.description ?? "",
      weight: 0,
      cost: 0,
      titanCost: 0,
      sch: null,
      ready: null,
      pick: null,
      manual: false,
      plants: {},
      pieces: [],
    };
    it.weight += w;
    const pl = (l.plant_id ?? "").trim() || "No plant";
    const pe = (it.plants[pl] ??= { weight: 0, titan: 0, cost: 0 });
    pe.weight += w;
    pe.titan += Number(l.ext_price) || 0;
    it.titanCost += Number(l.ext_price) || 0;
    const piece: Piece = {
      description: l.description ?? "",
      plant: pl,
      weight: w,
      cost: 0,
    };
    pieceTitan.set(piece, Number(l.ext_price) || 0);
    it.pieces.push(piece);
    if (l.sch_date && (!it.sch || l.sch_date > it.sch)) it.sch = l.sch_date;
    // Ready only when every line is ready: use the latest Ready Date.
    if (l.ready_date && (!it.ready || l.ready_date > it.ready))
      it.ready = l.ready_date;
    if (l.pick_date && (!it.pick || l.pick_date < it.pick))
      it.pick = l.pick_date;
    by.set(gk, it);
  }
  const items = [...by.values()];
  for (const it of items) {
    const typed = (costs[it.name] ?? "").trim();
    if (typed === "") it.cost = it.titanCost;
    else {
      // A cost typed for the whole structure is shared out by Titan price, else by weight.
      const tt = lineTitan.get(it.name) ?? 0;
      const tw = lineWeight.get(it.name) ?? 0;
      const share = !split
        ? 1
        : tt > 0
          ? it.titanCost / tt
          : tw > 0
            ? it.weight / tw
            : 1;
      it.cost = parseCost(typed) * share;
    }
    // Split the structure's cost between plants: by Titan price, else by weight.
    const ps = Object.values(it.plants);
    const tt = ps.reduce((a, x) => a + x.titan, 0);
    const tw = ps.reduce((a, x) => a + x.weight, 0);
    for (const x of ps) {
      // Titan's ExtPrice added up for each plant; only when Titan has no prices
      // does a typed cost get spread by weight.
      x.cost =
        tt > 0
          ? x.titan
          : it.cost *
            (ps.length === 1 ? 1 : tw > 0 ? x.weight / tw : 1 / ps.length);
    }
    // Each part's own cost: its Titan price, else its share of the item's cost by weight.
    for (const pc of it.pieces)
      pc.cost =
        it.titanCost > 0
          ? (pieceTitan.get(pc) ?? 0)
          : it.weight > 0
            ? it.cost * (pc.weight / it.weight)
            : 0;
  }
  for (const m of manual) {
    items.push({
      key: `manual-${m.id}`,
      name: m.name || "(added by hand)",
      description: m.description,
      weight: (Number(m.weight) || 0) * (Number(m.qty) || 1),
      cost: (Number(m.cost) || 0) * (Number(m.qty) || 1),
      titanCost: 0,
      sch: null,
      ready: null,
      pick: m.pick || null,
      manual: true,
      plants: {},
      pieces: [],
    });
  }
  return items.sort((a, b) => natural(a.name, b.name));
}

/** First-fit-decreasing: heaviest first, each into the first load with room. */
export function packLoads(items: LItem[], limit: number): Load[] {
  const loads: Load[] = [];
  for (const it of [...items].sort((a, b) => b.weight - a.weight)) {
    if (it.weight > limit) {
      loads.push({ items: [it], weight: it.weight, over: true });
      continue;
    }
    const fit = loads.find((l) => !l.over && l.weight + it.weight <= limit);
    if (fit) {
      fit.items.push(it);
      fit.weight += it.weight;
    } else loads.push({ items: [it], weight: it.weight, over: false });
  }
  return loads;
}

export type Report = {
  total: number;
  totalWeight: number;
  totalCost: number;
  picked: LItem[]; // pick date already passed
  scheduled: LItem[]; // pick date today or later
  yard: (LItem & { waiting: number })[]; // ready, no pick date
  notReady: LItem[]; // no pick date and not ready yet
  days: Day[]; // upcoming deliveries by date
  early: LItem[]; // pick date earlier than ready date
  overLimit: LItem[];
};

const daysBetween = (a: string, b: string) =>
  Math.round(
    (new Date(`${b}T00:00:00`).getTime() -
      new Date(`${a}T00:00:00`).getTime()) /
      86400000,
  );

export function buildReport(
  items: LItem[],
  limit: number,
  today = todayIso(),
): Report {
  const picked: LItem[] = [];
  const scheduled: LItem[] = [];
  const yard: (LItem & { waiting: number })[] = [];
  const notReady: LItem[] = [];
  for (const it of items) {
    if (it.pick) (it.pick < today ? picked : scheduled).push(it);
    else if (it.ready && it.ready <= today)
      yard.push({ ...it, waiting: daysBetween(it.ready, today) });
    else notReady.push(it);
  }
  yard.sort((a, b) => b.waiting - a.waiting || natural(a.name, b.name));

  const byDate = new Map<string, LItem[]>();
  for (const it of scheduled)
    (byDate.get(it.pick!) ?? byDate.set(it.pick!, []).get(it.pick!)!).push(it);
  const days: Day[] = [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, its]) => ({
      date,
      items: its.sort((a, b) => natural(a.name, b.name)),
      weight: its.reduce((n, i) => n + i.weight, 0),
      cost: its.reduce((n, i) => n + i.cost, 0),
      loads: packLoads(its, limit),
    }));

  return {
    total: new Set(items.map((i) => i.name + (i.manual ? i.key : ""))).size,
    totalWeight: items.reduce((n, i) => n + i.weight, 0),
    totalCost: items.reduce((n, i) => n + i.cost, 0),
    picked,
    scheduled,
    yard,
    notReady,
    days,
    early: items.filter((i) => i.pick && i.ready && i.pick < i.ready),
    overLimit: items.filter((i) => i.weight > limit),
  };
}

export const sumW = (xs: { weight: number }[]) =>
  xs.reduce((n, i) => n + i.weight, 0);

export const sumC = (xs: { cost: number }[]) =>
  xs.reduce((n, i) => n + i.cost, 0);
