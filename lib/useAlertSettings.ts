"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { DEFAULT_ALERTS, type AlertSettings } from "@/lib/alerts";

/** The person's alert settings and dismissals (read only): online if saved, else this computer. */
export function useAlertSettings() {
  const [settings, setSettings] = useState<AlertSettings>(DEFAULT_ALERTS);
  const [dismissed, setDismissed] = useState<Record<string, string>>({});
  useEffect(() => {
    void (async () => {
      let s: Partial<AlertSettings> | null = null;
      let d: Record<string, string> | null = null;
      const { data, error } = await getSupabase()
        .from("user_settings")
        .select("alerts, dismissed")
        .maybeSingle();
      if (!error && data) {
        s = data.alerts as Partial<AlertSettings>;
        d = data.dismissed as Record<string, string>;
      } else {
        try {
          s = JSON.parse(localStorage.getItem("alert-settings") ?? "null");
          d = JSON.parse(localStorage.getItem("alert-dismissed") ?? "null");
        } catch {}
      }
      if (s) setSettings({ ...DEFAULT_ALERTS, ...s });
      if (d) setDismissed(d);
    })();
  }, []);
  return { settings, dismissed };
}
