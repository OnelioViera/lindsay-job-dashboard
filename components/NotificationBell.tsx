"use client";

import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { rememberJob, withJob } from "@/lib/jobs";
import { todayIso } from "@/lib/metrics";
import {
  DEFAULT_ALERTS,
  addDays,
  buildAlerts,
  daysBetween,
  type Alert,
  type AlertLine,
  type AlertSettings,
} from "@/lib/alerts";

type JobInfo = { id: string; job_number: string; location: string | null };
type Dismissed = Record<string, string>; // key -> "forever" or the date it comes back

const PAGE = 1000;
const LS_SET = "alert-settings";
const LS_DIS = "alert-dismissed";

const us = (d: string) => {
  const [, m, day] = d.split("-");
  return `${Number(m)}/${Number(day)}`;
};
const dow = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { weekday: "short" });

const KIND_LABEL = {
  delivery: "Delivery",
  pour: "Pour",
  overdue: "Ready, no pick date",
} as const;

/** The bell in the top bar: upcoming deliveries and pours, and structures waiting in the yard. */
export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<AlertLine[]>([]);
  const [jobs, setJobs] = useState<Record<string, JobInfo>>({});
  const [settings, setSettings] = useState<AlertSettings>(DEFAULT_ALERTS);
  const [dismissed, setDismissed] = useState<Dismissed>({});
  const [note, setNote] = useState<string | null>(null);
  const [today, setToday] = useState(todayIso());
  const ready = useRef(false);
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const supabase = getSupabase();
    setToday(todayIso());
    const { data: js } = await supabase
      .from("jobs")
      .select("id, job_number, location, archived");
    const active = (
      (js ?? []) as (JobInfo & { archived: boolean | null })[]
    ).filter((j) => !j.archived);
    setJobs(Object.fromEntries(active.map((j) => [j.id, j])));
    const ids = new Set(active.map((j) => j.id));

    const all: AlertLine[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("titan_lines")
        .select("job_id, structure, sch_date, ready_date, pick_date")
        .range(from, from + PAGE - 1);
      if (error || !data) break;
      all.push(...(data as AlertLine[]).filter((l) => ids.has(l.job_id)));
      if (data.length < PAGE) break;
    }
    setLines(all);
  }, []);

  // Settings and dismissals: online when the table exists, otherwise this computer.
  const loadSettings = useCallback(async () => {
    let s: Partial<AlertSettings> | null = null;
    let d: Dismissed | null = null;
    const { data, error } = await getSupabase()
      .from("user_settings")
      .select("alerts, dismissed")
      .maybeSingle();
    if (error) {
      setNote(
        "Alert settings are saved on this computer only. Run supabase/notifications.sql in Supabase to save them with your login.",
      );
    }
    if (!error && data) {
      s = data.alerts as Partial<AlertSettings>;
      d = data.dismissed as Dismissed;
    } else {
      try {
        s = JSON.parse(localStorage.getItem(LS_SET) ?? "null");
        d = JSON.parse(localStorage.getItem(LS_DIS) ?? "null");
      } catch {}
    }
    if (s) setSettings({ ...DEFAULT_ALERTS, ...s });
    if (d) setDismissed(d);
    ready.current = true;
  }, []);

  useEffect(() => {
    void loadSettings();
    void load();
    const t = setInterval(() => void load(), 5 * 60 * 1000);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [load, loadSettings]);

  // Save settings / dismissals shortly after they change.
  useEffect(() => {
    if (!ready.current) return;
    const t = setTimeout(async () => {
      try {
        localStorage.setItem(LS_SET, JSON.stringify(settings));
        localStorage.setItem(LS_DIS, JSON.stringify(dismissed));
      } catch {}
      const { error } = await getSupabase()
        .from("user_settings")
        .upsert({ alerts: settings, dismissed }, { onConflict: "user_id" });
      if (!error) setNote(null);
    }, 600);
    return () => clearTimeout(t);
  }, [settings, dismissed]);

  // Close when clicking elsewhere.
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const alerts = useMemo(
    () =>
      buildAlerts(lines, settings, today).filter((a) => {
        const d = dismissed[a.key];
        return !d || (d !== "forever" && today >= d);
      }),
    [lines, settings, dismissed, today],
  );

  const hide = (a: Alert, forever: boolean) =>
    setDismissed((cur) => ({
      ...cur,
      [a.key]: forever ? "forever" : addDays(today, 1),
    }));

  const num = (k: keyof AlertSettings, v: string) =>
    setSettings((s) => ({
      ...s,
      [k]: Math.max(0, Math.min(60, Math.floor(Number(v) || 0))),
    }));

  const when = (a: Alert) =>
    a.kind === "overdue"
      ? `waiting up to ${a.oldest} day${a.oldest === 1 ? "" : "s"}`
      : a.date === today
        ? "today"
        : daysBetween(today, a.date!) === 1
          ? `tomorrow (${dow(a.date!)} ${us(a.date!)})`
          : `${dow(a.date!)} ${us(a.date!)}`;

  const printAlerts = () => {
    setOpen(false);
    const root = document.documentElement;
    root.classList.add("printing-alerts");
    const done = () => {
      root.classList.remove("printing-alerts");
      window.removeEventListener("afterprint", done);
    };
    window.addEventListener("afterprint", done);
    setTimeout(() => window.print(), 100);
  };

  const urgent = alerts.some((a) => a.kind === "overdue" || a.date === today);
  const field =
    "w-14 rounded border border-slate-300 px-1.5 py-1 text-sm text-slate-900";

  return (
    <div ref={box} className="relative print:hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notifications${alerts.length ? `, ${alerts.length} alerts` : ""}`}
        title="Upcoming deliveries, pours and structures waiting in the yard"
        className="relative rounded-md border border-slate-300 bg-white px-3 py-2 text-navy hover:bg-slate-50"
      >
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {alerts.length > 0 && (
          <span
            className={`absolute -top-1.5 -right-1.5 min-w-5 rounded-full px-1 text-center text-xs font-bold text-white ${urgent ? "bg-brand-red" : "bg-navy"}`}
          >
            {alerts.length}
          </span>
        )}
      </button>

      {typeof document !== "undefined" &&
        createPortal(
          <div id="alerts-print" className="hidden">
            <h1 className="text-xl font-bold text-navy">
              Lindsay Precast · Alerts
            </h1>
            <p className="mb-3 text-sm">
              Printed {dow(today)} {us(today)}/{today.slice(0, 4)} · deliveries{" "}
              {settings.deliveryOn
                ? `next ${settings.deliveryDays} days`
                : "off"}
              , pours{" "}
              {settings.pourOn ? `next ${settings.pourDays} days` : "off"},
              ready with no pick date{" "}
              {settings.overdueOn ? `${settings.overdueDays}+ days` : "off"}
            </p>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-slate-800 text-left">
                  <th className="py-1 pr-2">Alert</th>
                  <th className="py-1 pr-2">When</th>
                  <th className="py-1 pr-2">Job</th>
                  <th className="py-1">Structures</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((a) => {
                  const job = jobs[a.jobId];
                  return (
                    <tr
                      key={a.key}
                      className="border-b border-slate-300 align-top"
                    >
                      <td className="py-1 pr-2 font-semibold">
                        {KIND_LABEL[a.kind]}
                      </td>
                      <td className="py-1 pr-2">{when(a)}</td>
                      <td className="py-1 pr-2">
                        #{job?.job_number ?? "?"}
                        {job?.location ? ` · ${job.location}` : ""}
                      </td>
                      <td className="py-1">
                        ({a.structures.length}) {a.structures.join(", ")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>,
          document.body,
        )}

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[26rem] max-w-[92vw] rounded-xl border border-slate-200 bg-white text-slate-900 shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <p className="font-semibold text-navy">Alerts</p>
            <div className="flex gap-3">
              <button
                onClick={printAlerts}
                disabled={alerts.length === 0}
                className="text-xs text-navy hover:underline disabled:opacity-40"
              >
                Print alerts
              </button>
              <button
                onClick={() => void load()}
                className="text-xs text-slate-500 hover:underline"
              >
                Refresh
              </button>
            </div>
          </div>

          <div className="max-h-[60vh] overflow-y-auto">
            {alerts.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-slate-500">
                Nothing needs attention right now.
              </p>
            )}
            {alerts.map((a) => {
              const job = jobs[a.jobId];
              const red = a.kind === "overdue" || a.date === today;
              return (
                <div
                  key={a.key}
                  className="border-b border-slate-100 px-4 py-3 text-sm"
                >
                  <div className="flex items-start gap-2">
                    <a
                      href={withJob("/structures", a.jobId)}
                      onClick={(e) => {
                        if (e.metaKey || e.ctrlKey || e.shiftKey) return;
                        e.preventDefault();
                        // Open that job's Tracker showing just this alert's structures.
                        try {
                          sessionStorage.setItem(
                            "tracker-focus",
                            JSON.stringify({
                              jobId: a.jobId,
                              structures: a.structures,
                            }),
                          );
                        } catch {}
                        rememberJob(a.jobId);
                        setOpen(false);
                        window.location.assign(withJob("/structures", a.jobId));
                      }}
                      className="flex-1 hover:underline"
                    >
                      <span
                        className={`font-semibold ${red ? "text-brand-red" : "text-navy"}`}
                      >
                        {KIND_LABEL[a.kind]} · {when(a)}
                      </span>
                      <span className="block text-slate-700">
                        Job #{job?.job_number ?? "?"}
                        {job?.location ? ` · ${job.location}` : ""}
                      </span>
                      <span className="block text-xs text-slate-600">
                        {a.structures.length} structure
                        {a.structures.length === 1 ? "" : "s"}:{" "}
                        {a.structures.slice(0, 6).join(", ")}
                        {a.structures.length > 6
                          ? ` +${a.structures.length - 6} more`
                          : ""}
                      </span>
                    </a>
                    <div className="flex shrink-0 flex-col items-end gap-1 text-xs text-slate-500">
                      <button
                        onClick={() => hide(a, false)}
                        className="hover:underline"
                      >
                        Snooze
                      </button>
                      <button
                        onClick={() => hide(a, true)}
                        className="hover:underline"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <details className="border-t border-slate-200 px-4 py-3 text-sm">
            <summary className="cursor-pointer font-medium text-navy">
              Alert settings
            </summary>
            <div className="mt-3 space-y-2">
              {(
                [
                  ["deliveryOn", "deliveryDays", "Deliveries", "days ahead"],
                  ["pourOn", "pourDays", "Pours", "days ahead"],
                  [
                    "overdueOn",
                    "overdueDays",
                    "Ready, no pick date for",
                    "or more days",
                  ],
                ] as const
              ).map(([on, n, label, unit]) => (
                <label key={on} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={settings[on]}
                    onChange={(e) =>
                      setSettings((s) => ({ ...s, [on]: e.target.checked }))
                    }
                  />
                  <span className="w-44">{label}</span>
                  <input
                    value={settings[n]}
                    onChange={(e) => num(n, e.target.value)}
                    inputMode="numeric"
                    disabled={!settings[on]}
                    className={field}
                  />
                  <span className="text-slate-500">{unit}</span>
                </label>
              ))}
              <p className="text-xs text-slate-500">
                Anything due today, and anything overdue, always shows.
              </p>
              {Object.keys(dismissed).length > 0 && (
                <button
                  onClick={() => setDismissed({})}
                  className="text-xs text-navy hover:underline"
                >
                  Bring back dismissed and snoozed alerts
                </button>
              )}
              {note && <p className="text-xs text-amber-700">{note}</p>}
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
