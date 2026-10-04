"use client";

import Link from "next/link";
import type { Job } from "@/lib/jobs";

export default function JobBanner({
  job,
  loading,
}: {
  job: Job | null;
  loading: boolean;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-1 rounded-xl border border-navy/20 bg-white px-4 py-3 text-sm shadow-sm print:hidden">
      {job ? (
        <>
          <span>
            <span className="text-slate-500">Job #</span>{" "}
            <strong className="text-navy">{job.job_number}</strong>
          </span>
          <span>
            <span className="text-slate-500">Location</span>{" "}
            <strong className="text-navy">{job.location || "—"}</strong>
          </span>
          <span>
            <span className="text-slate-500">Customer</span>{" "}
            <strong className="text-navy">{job.customer || "—"}</strong>
          </span>
        </>
      ) : (
        <span className="text-slate-600">
          {loading ? "Loading job…" : "No job selected."}
        </span>
      )}
      <Link href="/" className="ml-auto font-medium text-navy underline">
        {job ? "Change job" : "Pick a job on the Dashboard"}
      </Link>
    </div>
  );
}
