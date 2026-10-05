"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/** Goes back to the page you came from (that page restores where you left off). */
export default function BackButton() {
  const router = useRouter();
  const [canGoBack, setCanGoBack] = useState(false);
  useEffect(() => {
    setCanGoBack(window.history.length > 1);
  }, []);
  return (
    <button
      onClick={() => router.back()}
      disabled={!canGoBack}
      title="Back to the page you were just on"
      className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-white disabled:opacity-40"
    >
      ← Back
    </button>
  );
}
