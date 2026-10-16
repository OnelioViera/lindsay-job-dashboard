// Job logistics: delivery schedule, truckloads and yard risks, built from the Titan lines
// plus anything added by hand. All the arithmetic lives here so the report always adds up.

export const DEFAULT_LIMIT = 55000; // lb per truckload

export type LLine = {
  structure: string;
  description: string | null;
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

/** One item per structure: weight is the sum of the Weight shown on each of its lines. */
export function buildItems(
  lines: LLine[],
  manual: ManualItem[],
  costs: Costs = {},
): LItem[] {
  const by = new Map<string, LItem>();
  for (const l of lines) {
    const w = Number(l.weight) || 0; // the Weight shown on each Tracker line
    const it = by.get(l.structure) ?? {
      key: l.structure,
      name: l.structure,
      description: l.description ?? "",
      weight: 0,
      cost: 0,
      titanCost: 0,
      sch: null,
      ready: null,
      pick: null,
      manual: false,
    };
    it.weight += w;
    it.titanCost += Number(l.ext_price) || 0;
    if (l.sch_date && (!it.sch || l.sch_date > it.sch)) it.sch = l.sch_date;
    // Ready only when every line is ready: use the latest Ready Date.
    if (l.ready_date && (!it.ready || l.ready_date > it.ready))
      it.ready = l.ready_date;
    if (l.pick_date && (!it.pick || l.pick_date < it.pick))
      it.pick = l.pick_date;
    by.set(l.structure, it);
  }
  const items = [...by.values()];
  for (const it of items) {
    const typed = (costs[it.key] ?? "").trim();
    it.cost = typed !== "" ? parseCost(typed) : it.titanCost;
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
    total: items.length,
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
