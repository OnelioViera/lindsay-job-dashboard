export type Row = {
  id: string;
  sort_order: number;
  priority: number | null;
  structure: string;
  description: string | null;
  plant_id: string | null;
  production_dep: string | null;
  sch_date: string | null;
  ready_date: string | null;
  pro_date: string | null;
  pick_date: string | null;
  weight: number | null;
  uom: string | null;
  product: string | null;
  qty: number | null;
};

export type FilterKey = "scheduled_pour" | "scheduled_delivery";

// Scheduled Date  = scheduled to pour
// Ready Date      = scheduled for completion
// Pick Date       = scheduled for delivery
export const FILTERS: {
  key: FilterKey;
  label: string;
  test: (r: Row) => boolean;
}[] = [
  {
    key: "scheduled_pour",
    label: "Scheduled to pour",
    test: (r) => !!r.sch_date && !r.pick_date,
  },
  {
    key: "scheduled_delivery",
    label: "Scheduled for delivery",
    test: (r) => !!r.pick_date,
  },
];
