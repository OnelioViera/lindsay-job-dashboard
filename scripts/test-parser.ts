import { readFileSync } from "node:fs";
import { parseTitan } from "../lib/titan.ts";

const file = process.argv[2] ?? "/root/.claude/uploads/44669155-1829-58a0-9f99-dedbb26f9cb1/59328ac0-attachment.txt";
const r = parseTitan(readFileSync(file, "utf8"));
console.log("rows:", r.rows.length, "structures:", r.structureCount, "warnings:", r.warnings);
const n = (k: keyof (typeof r.rows)[number]) => r.rows.filter((x) => x[k] !== null && x[k] !== "").length;
console.log({ sch: n("schDate"), ready: n("readyDate"), pro: n("proDate"), pick: n("pickDate"), weight: n("weight"), dep: n("productionDep"), plant: n("plantId"), uom: n("uom"), pri: n("priority") });
for (const i of [0, 7, 8, 12, 13, 14]) console.log(i, r.rows[i]);
console.log("last", r.rows[r.rows.length - 1]);
