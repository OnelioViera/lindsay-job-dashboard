"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";

export type Job = {
  id: string;
  job_number: string;
  location: string | null;
  customer: string | null;
  position?: number | null;
  archived?: boolean | null;
};

const KEY = "active-job-id";

/** Link to a page while carrying the chosen job along. */
export const withJob = (path: string, jobId: string | null | undefined) =>
  jobId ? `${path}?job=${jobId}` : path;

export function rememberJob(id: string) {
  try {
    localStorage.setItem(KEY, id);
  } catch {}
}

/** The job picked on the Dashboard (from ?job=… or the last one opened). */
export function useActiveJob() {
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let id = new URLSearchParams(window.location.search).get("job");
    if (!id) {
      try {
        id = localStorage.getItem(KEY);
      } catch {}
    }
    if (!id) {
      setLoading(false);
      return;
    }
    rememberJob(id);
    getSupabase()
      .from("jobs")
      .select("id, job_number, location, customer")
      .eq("id", id)
      .maybeSingle()
      .then(({ data }) => {
        setJob((data as Job | null) ?? null);
        setLoading(false);
      });
  }, []);

  return { job, loading };
}

/** One-line text for print headers. */
export const jobLine = (j: Job | null) =>
  j
    ? [
        `Job #${j.job_number}`,
        j.location && `Location: ${j.location}`,
        j.customer && `Customer: ${j.customer}`,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";
