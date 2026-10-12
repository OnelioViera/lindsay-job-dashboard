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

export const PRICE_SQL =
  "alter table public.titan_lines add column if not exists ext_price numeric;";

export const fmtMoney = (n: number | null | undefined) =>
  n === null || n === undefined
    ? ""
    : n.toLocaleString("en-US", { style: "currency", currency: "USD" });
