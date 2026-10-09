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
};

export type ManualItem = {
  id: string;
  name: string;
  description: string;
  qty: number;
  weight: number; // lb each
  pick: string; // delivery date, YYYY-MM-DD
};

export type LItem = {
  key: string;
  name: string;
  description: string;
  weight: number; // total lb
  ready: string | null;
  pick: string | null;
  manual: boolean;
};

export type Load = { items: LItem[]; weight: number; over: boolean };
export type Day = {
  date: string;
  items: LItem[];
  weight: number;
  loads: Load[];
};

export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const natural = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true });

/** One item per structure: weight is the sum of its lines (weight x quantity). */
export function buildItems(lines: LLine[], manual: ManualItem[]): LItem[] {
  const by = new Map<string, LItem>();
  for (const l of lines) {
    const w = (Number(l.weight) || 0) * (Number(l.qty) || 1);
    const it = by.get(l.structure) ?? {
      key: l.structure,
      name: l.structure,
      description: l.description ?? "",
      weight: 0,
      ready: null,
      pick: null,
      manual: false,
    };
    it.weight += w;
    // Ready only when every line is ready: use the latest Ready Date.
    if (l.ready_date && (!it.ready || l.ready_date > it.ready))
      it.ready = l.ready_date;
    if (l.pick_date && (!it.pick || l.pick_date < it.pick))
      it.pick = l.pick_date;
    by.set(l.structure, it);
  }
  const items = [...by.values()];
  for (const m of manual) {
    items.push({
      key: `manual-${m.id}`,
      name: m.name || "(added by hand)",
      description: m.description,
      weight: (Number(m.weight) || 0) * (Number(m.qty) || 1),
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
      loads: packLoads(its, limit),
    }));

  return {
    total: items.length,
    totalWeight: items.reduce((n, i) => n + i.weight, 0),
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
