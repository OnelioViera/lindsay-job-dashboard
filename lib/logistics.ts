// Job logistics: delivery schedule, truckloads and yard risks, built from the Titan lines
// plus anything added by hand. All the arithmetic lives here so the report always adds up.

export const DEFAULT_LIMIT = 55000; // lb per truckload

export type LLine = {
  structure: string;
  description: string | null;
  ready_date: string | null;
  pick_date: string | null;
  weight: number | null;
  qty: number | null;
  ext_price?: number | null; // Titan ExtPrice for the line
  load_no?: string | null; // Titan Load (the real truck)
  qty_pro?: number | null; // produced
  qty_shp?: number | null; // shipped
  ship_date?: string | null;
  unit_yards?: number | null;
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
  yards: number; // total Unit Yards from Titan
  nLines: number; // lines that count (quantity above zero)
  shippedLines: number; // lines Titan shows as shipped
  producedLines: number; // lines Titan shows as produced
  shipDate: string | null; // latest ship date
  loadNos: string[]; // Titan load numbers its lines are on
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
  yards: number;
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
      yards: 0,
      nLines: 0,
      shippedLines: 0,
      producedLines: 0,
      shipDate: null,
      loadNos: [],
      ready: null,
      pick: null,
      manual: false,
    };
    it.weight += w;
    it.yards += Number(l.unit_yards) || 0;
    if (l.qty === null || l.qty === undefined || Number(l.qty) > 0) {
      it.nLines++;
      const q = Number(l.qty) || 0;
      if (Number(l.qty_shp) > 0 && (q === 0 || Number(l.qty_shp) >= q))
        it.shippedLines++;
      if (Number(l.qty_pro) > 0 && (q === 0 || Number(l.qty_pro) >= q))
        it.producedLines++;
    }
    if (l.ship_date && (!it.shipDate || l.ship_date > it.shipDate))
      it.shipDate = l.ship_date;
    const ln = (l.load_no ?? "").trim();
    if (ln && !it.loadNos.includes(ln)) it.loadNos.push(ln);
    it.titanCost += Number(l.ext_price) || 0;
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
      yards: 0,
      nLines: 0,
      shippedLines: 0,
      producedLines: 0,
      shipDate: null,
      loadNos: [],
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
  shipped: LItem[]; // every line shipped (per Titan)
  partlyShipped: LItem[]; // some lines shipped, not all
  totalYards: number;
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
  const shipped: LItem[] = [];
  for (const it of items) {
    if (it.nLines > 0 && it.shippedLines >= it.nLines) shipped.push(it);
    else if (it.pick) (it.pick < today ? picked : scheduled).push(it);
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
      yards: its.reduce((n, i) => n + i.yards, 0),
      loads: packLoads(its, limit),
    }));

  return {
    total: items.length,
    totalWeight: items.reduce((n, i) => n + i.weight, 0),
    totalCost: items.reduce((n, i) => n + i.cost, 0),
    totalYards: items.reduce((n, i) => n + i.yards, 0),
    shipped,
    partlyShipped: items.filter(
      (i) => i.shippedLines > 0 && i.shippedLines < i.nLines,
    ),
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

export type TitanLoad = {
  loadNo: string;
  pick: string | null; // earliest pick date on the load
  structures: { name: string; weight: number; lines: number }[];
  weight: number;
  yards: number;
  cost: number; // Titan ExtPrice added up
  shipped: boolean; // every line on the load shows a ship quantity
  over: boolean;
};

/** The real trucks: one entry per Titan Load number, with what is on it. */
export function buildTitanLoads(lines: LLine[], limit: number): TitanLoad[] {
  const by = new Map<string, TitanLoad & { shp: number; n: number }>();
  for (const l of lines) {
    const no = (l.load_no ?? "").trim();
    if (!no) continue;
    const ld = by.get(no) ?? {
      loadNo: no,
      pick: null,
      structures: [],
      weight: 0,
      yards: 0,
      cost: 0,
      shipped: false,
      over: false,
      shp: 0,
      n: 0,
    };
    const w = Number(l.weight) || 0;
    ld.weight += w;
    ld.yards += Number(l.unit_yards) || 0;
    ld.cost += Number(l.ext_price) || 0;
    ld.n++;
    if (Number(l.qty_shp) > 0) ld.shp++;
    if (l.pick_date && (!ld.pick || l.pick_date < ld.pick))
      ld.pick = l.pick_date;
    const st = ld.structures.find((x) => x.name === l.structure);
    if (st) {
      st.weight += w;
      st.lines++;
    } else ld.structures.push({ name: l.structure, weight: w, lines: 1 });
    by.set(no, ld);
  }
  return [...by.values()]
    .map(({ shp, n, ...ld }) => ({
      ...ld,
      structures: ld.structures.sort((a, b) => natural(a.name, b.name)),
      shipped: n > 0 && shp >= n,
      over: ld.weight > limit,
    }))
    .sort(
      (a, b) =>
        (a.pick ?? "9999").localeCompare(b.pick ?? "9999") ||
        natural(a.loadNo, b.loadNo),
    );
}
