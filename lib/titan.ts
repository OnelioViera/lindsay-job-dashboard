// Parser for the Titan production export (tab-separated, Excel-style quoting).
// Self-contained on purpose so it can be tested with plain Node.

export type ParsedRow = {
  priority: number | null;
  structure: string;
  description: string;
  plantId: string;
  productionDep: string;
  schDate: string | null; // Scheduled Date
  readyDate: string | null; // Ready Date
  proDate: string | null; // Production Date
  pickDate: string | null; // Pick Date
  weight: number | null;
  uom: string;
  product: string;
  qty: number | null; // QO (quantity ordered)
};

export type ParseResult = {
  rows: ParsedRow[];
  structureCount: number;
  warnings: string[];
};

/** Split tab-separated text into rows, honoring "quoted ""fields""" that may contain tabs/newlines. */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const src = text.replace(/^﻿/, "");

  while (i < src.length) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === "") {
      inQuotes = true;
      i++;
    } else if (ch === "\t") {
      row.push(field);
      field = "";
      i++;
    } else if (ch === "\r") {
      i++;
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
    } else {
      field += ch;
      i++;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function num(v: string | undefined): number | null {
  if (!v) return null;
  const n = parseFloat(v.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** "9/30/2026 12:17:24 PM" or "9/30/2026" -> "2026-09-30" */
export function toIsoDate(v: string | undefined): string | null {
  if (!v) return null;
  const m = v.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

export function parseTitan(text: string): ParseResult {
  const warnings: string[] = [];
  const table = parseTsv(text).filter((r) => r.some((c) => c.trim() !== ""));
  if (table.length < 2) {
    return {
      rows: [],
      structureCount: 0,
      warnings: [
        "Nothing to import — paste the full Titan sheet including the header row.",
      ],
    };
  }

  const header = table[0].map(norm);
  const col = (...names: string[]) => {
    for (const n of names) {
      const idx = header.indexOf(norm(n));
      if (idx >= 0) return idx;
    }
    return -1;
  };

  const c = {
    pri: col("Pri", "Priority"),
    structure: col("Structure", "Structure ID"),
    description: col("Description"),
    plant: col("Plant ID", "Plant"),
    dep: col("Production Dep", "Production Department"),
    sch: col("Sch_Date", "Scheduled Date"),
    ready: col("Ready_Date", "Ready Date"),
    pro: col("Pro_Date", "Production Date"),
    pick: col("Pick Date", "Pick_Date"),
    weight: col("Wt.", "Weight"),
    uom: col("UOM"),
    product: col("Product"),
    qty: col("QO", "Qty"),
  };

  if (c.structure < 0) {
    return {
      rows: [],
      structureCount: 0,
      warnings: [
        'Could not find a "Structure" column. Make sure the header row is included in what you paste.',
      ],
    };
  }

  const labels: Record<keyof typeof c, string> = {
    pri: "Pri",
    structure: "Structure",
    description: "Description",
    plant: "Plant ID",
    dep: "Production Dep",
    sch: "Sch_Date",
    ready: "Ready_Date",
    pro: "Pro_Date",
    pick: "Pick Date",
    weight: "Wt.",
    uom: "UOM",
    product: "Product",
    qty: "QO",
  };
  const missing = (Object.keys(c) as (keyof typeof c)[])
    .filter((k) => c[k] < 0)
    .map((k) => labels[k]);
  if (missing.length > 0) {
    warnings.push(
      `These columns weren't found in the paste and will be blank: ${missing.join(", ")}.`,
    );
  }

  const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");

  const rows: ParsedRow[] = [];
  let blankStructure = 0;
  for (const r of table.slice(1)) {
    let structure = get(r, c.structure);
    if (!structure) {
      structure = "(No Structure)";
      blankStructure++;
    }
    const pri = get(r, c.pri);
    rows.push({
      priority: pri !== "" && Number.isFinite(Number(pri)) ? Number(pri) : null,
      structure,
      description: get(r, c.description),
      plantId: get(r, c.plant),
      productionDep: get(r, c.dep),
      schDate: toIsoDate(get(r, c.sch)),
      readyDate: toIsoDate(get(r, c.ready)),
      proDate: toIsoDate(get(r, c.pro)),
      pickDate: toIsoDate(get(r, c.pick)),
      weight: num(get(r, c.weight)),
      uom: get(r, c.uom),
      product: get(r, c.product),
      qty: num(get(r, c.qty)),
    });
  }

  if (blankStructure > 0) {
    warnings.push(
      `${blankStructure} line(s) had no Structure and were labelled "(No Structure)".`,
    );
  }

  return {
    rows,
    structureCount: new Set(rows.map((r) => r.structure)).size,
    warnings,
  };
}
