import { getSupabase } from "@/lib/supabase";

// Titan's ExtPrice is kept in titan_lines.ext_price (supabase/ext_price.sql). Until that column
// exists the app keeps working without it, so every read/write asks this first.
let cached: Promise<boolean> | null = null;

export function hasExtPrice(): Promise<boolean> {
  if (!cached) {
    cached = (async () => {
      const { error } = await getSupabase()
        .from("titan_lines")
        .select("ext_price")
        .limit(1);
      return !error;
    })();
  }
  return cached;
}

// Picked check mark and invoice date (supabase/delivered.sql).
let cachedDelivered: Promise<boolean> | null = null;

export function hasDeliveredCols(): Promise<boolean> {
  if (!cachedDelivered) {
    cachedDelivered = (async () => {
      const { error } = await getSupabase()
        .from("titan_lines")
        .select("picked, invoice_date")
        .limit(1);
      return !error;
    })();
  }
  return cachedDelivered;
}

export const DELIVERED_COLS = "picked, invoice_date";

export const PRICE_SQL =
  "alter table public.titan_lines add column if not exists ext_price numeric;";

export const fmtMoney = (n: number | null | undefined) =>
  n === null || n === undefined
    ? ""
    : n.toLocaleString("en-US", { style: "currency", currency: "USD" });
