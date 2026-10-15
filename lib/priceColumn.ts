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

// Load number, quantities produced/shipped, ship date and yardage (supabase/logistics_titan.sql).
let cachedExtras: Promise<boolean> | null = null;

export function hasTitanExtras(): Promise<boolean> {
  if (!cachedExtras) {
    cachedExtras = (async () => {
      const { error } = await getSupabase()
        .from("titan_lines")
        .select("load_no, qty_pro, qty_shp, ship_date, unit_yards")
        .limit(1);
      return !error;
    })();
  }
  return cachedExtras;
}

export const EXTRA_COLS = "load_no, qty_pro, qty_shp, ship_date, unit_yards";

export const PRICE_SQL =
  "alter table public.titan_lines add column if not exists ext_price numeric;";

export const fmtMoney = (n: number | null | undefined) =>
  n === null || n === undefined
    ? ""
    : n.toLocaleString("en-US", { style: "currency", currency: "USD" });
