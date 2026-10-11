// Upcoming-schedule alerts for the notification bell. Everything counts structures (a structure
// counts once, however many Titan lines it has).

export type AlertSettings = {
  deliveryOn: boolean;
  deliveryDays: number; // warn this many days ahead (today and overdue always show)
  pourOn: boolean;
  pourDays: number;
  overdueOn: boolean;
  overdueDays: number; // ready with no pick date for at least this many days
};

export const DEFAULT_ALERTS: AlertSettings = {
  deliveryOn: true,
  deliveryDays: 3,
  pourOn: true,
  pourDays: 2,
  overdueOn: true,
  overdueDays: 3,
};

export type AlertLine = {
  job_id: string;
  structure: string;
  sch_date: string | null;
  ready_date: string | null;
  pick_date: string | null;
};

export type AlertKind = "delivery" | "pour" | "overdue";

export type Alert = {
  key: string; // identifies this exact alert so a dismissal sticks until it changes
  kind: AlertKind;
  jobId: string;
  date: string | null; // the delivery/pour date; null for overdue
  structures: string[];
  oldest: number; // overdue only: longest wait, in days
};

const natural = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true });

export const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const daysBetween = (a: string, b: string) =>
  Math.round(
    (new Date(`${b}T00:00:00`).getTime() -
      new Date(`${a}T00:00:00`).getTime()) /
      86400000,
  );

export function buildAlerts(
  lines: AlertLine[],
  s: AlertSettings,
  today: string,
): Alert[] {
  type S = {
    sch: string | null;
    ready: string | null;
    pick: string | null;
  };
  const by = new Map<string, Map<string, S>>(); // job -> structure -> dates
  for (const l of lines) {
    const job = by.get(l.job_id) ?? by.set(l.job_id, new Map()).get(l.job_id)!;
    const st = job.get(l.structure) ?? { sch: null, ready: null, pick: null };
    if (l.sch_date && (!st.sch || l.sch_date < st.sch)) st.sch = l.sch_date;
    if (l.ready_date && (!st.ready || l.ready_date > st.ready))
      st.ready = l.ready_date;
    if (l.pick_date && (!st.pick || l.pick_date < st.pick))
      st.pick = l.pick_date;
    job.set(l.structure, st);
  }

  const out: Alert[] = [];
  const push = (
    kind: AlertKind,
    jobId: string,
    date: string | null,
    names: string[],
    oldest = 0,
  ) => {
    const structures = names.sort(natural);
    out.push({
      key: `${kind}|${jobId}|${date ?? "overdue"}|${structures.join(",")}`,
      kind,
      jobId,
      date,
      structures,
      oldest,
    });
  };

  for (const [jobId, structs] of by) {
    const deliv = new Map<string, string[]>();
    const pour = new Map<string, string[]>();
    const late: string[] = [];
    let oldest = 0;
    const dEnd = addDays(today, s.deliveryDays);
    const pEnd = addDays(today, s.pourDays);
    for (const [name, st] of structs) {
      if (st.pick) {
        if (s.deliveryOn && st.pick >= today && st.pick <= dEnd)
          (deliv.get(st.pick) ?? deliv.set(st.pick, []).get(st.pick)!).push(
            name,
          );
        continue; // a picked structure is no longer waiting on anything
      }
      if (s.pourOn && st.sch && st.sch >= today && st.sch <= pEnd)
        (pour.get(st.sch) ?? pour.set(st.sch, []).get(st.sch)!).push(name);
      if (s.overdueOn && st.ready && st.ready <= today) {
        const waited = daysBetween(st.ready, today);
        if (waited >= s.overdueDays) {
          late.push(name);
          oldest = Math.max(oldest, waited);
        }
      }
    }
    for (const [d, n] of deliv) push("delivery", jobId, d, n);
    for (const [d, n] of pour) push("pour", jobId, d, n);
    if (late.length > 0) push("overdue", jobId, null, late, oldest);
  }

  const rank = { overdue: 0, delivery: 1, pour: 2 } as const;
  return out.sort(
    (a, b) =>
      (a.date ?? "").localeCompare(b.date ?? "") || rank[a.kind] - rank[b.kind],
  );
}

export const ALERT_KIND_LABEL: Record<AlertKind, string> = {
  delivery: "Delivery",
  pour: "Pour",
  overdue: "Ready, no pick date",
};

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Plain-words timing for an alert, e.g. "tomorrow (Mon 10/12)". */
export function alertWhen(a: Alert, today: string): string {
  if (a.kind === "overdue")
    return `waiting up to ${a.oldest} day${a.oldest === 1 ? "" : "s"}`;
  const d = a.date!;
  const [, m, day] = d.split("-");
  const label = `${DOW[new Date(`${d}T00:00:00`).getDay()]} ${Number(m)}/${Number(day)}`;
  if (d === today) return "today";
  return daysBetween(today, d) === 1 ? `tomorrow (${label})` : label;
}
