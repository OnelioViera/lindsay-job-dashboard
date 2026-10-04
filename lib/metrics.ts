// Structure-level job metrics. A structure has many lines, so everything here counts structures:
// - scheduled to pour = at least one line has a Scheduled Date
// - ready             = at least one line has a Ready Date
// - picked            = at least one line has a Pick Date
// - pour overdue      = Scheduled Date has passed and no line has a Ready Date yet
// - ready overdue     = Ready Date has passed and no line has a Pick Date yet

export type MetricLine = {
  structure: string;
  sch_date: string | null;
  ready_date: string | null;
  pick_date: string | null;
};

export type QuickKey =
  | "notScheduled"
  | "scheduled"
  | "ready"
  | "picked"
  | "pourOverdue"
  | "readyOverdue";

export const QUICK_LABELS: Record<QuickKey, string> = {
  notScheduled: "Not scheduled to pour",
  scheduled: "Scheduled to pour",
  ready: "With a Ready Date",
  picked: "With a Pick Date",
  pourOverdue: "Pour date passed, not ready",
  readyOverdue: "Ready date passed, not picked",
};

export type JobMetrics = {
  total: number;
  sets: Record<QuickKey, Set<string>>;
  nextReady: string | null;
  nextPick: string | null;
};

// Local-time YYYY-MM-DD.
export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function analyze(lines: MetricLine[], today = todayIso()): JobMetrics {
  type S = {
    sch: boolean;
    firstSch: string | null;
    ready: boolean;
    firstReady: string | null;
    pick: boolean;
  };
  const by = new Map<string, S>();
  let nextReady: string | null = null;
  let nextPick: string | null = null;
  const min = (a: string | null, b: string) => (a === null || b < a ? b : a);

  for (const l of lines) {
    const s = by.get(l.structure) ?? {
      sch: false,
      firstSch: null,
      ready: false,
      firstReady: null,
      pick: false,
    };
    if (l.sch_date) {
      s.sch = true;
      s.firstSch = min(s.firstSch, l.sch_date);
    }
    if (l.ready_date) {
      s.ready = true;
      s.firstReady = min(s.firstReady, l.ready_date);
      if (l.ready_date >= today) nextReady = min(nextReady, l.ready_date);
    }
    if (l.pick_date) {
      s.pick = true;
      if (l.pick_date >= today) nextPick = min(nextPick, l.pick_date);
    }
    by.set(l.structure, s);
  }

  const sets: Record<QuickKey, Set<string>> = {
    notScheduled: new Set(),
    scheduled: new Set(),
    ready: new Set(),
    picked: new Set(),
    pourOverdue: new Set(),
    readyOverdue: new Set(),
  };
  for (const [name, s] of by) {
    if (s.sch) sets.scheduled.add(name);
    else sets.notScheduled.add(name);
    if (s.ready) sets.ready.add(name);
    if (s.pick) sets.picked.add(name);
    if (s.firstSch && s.firstSch < today && !s.ready)
      sets.pourOverdue.add(name);
    if (s.firstReady && s.firstReady < today && !s.pick)
      sets.readyOverdue.add(name);
  }
  return { total: by.size, sets, nextReady, nextPick };
}

export const fmtShort = (d: string | null) => {
  if (!d) return "";
  const [, m, day] = d.split("-");
  return `${Number(m)}/${Number(day)}`;
};
