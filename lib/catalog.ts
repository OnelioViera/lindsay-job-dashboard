// Purchased ring & cover price list (cost only; weight in lb each).
export type CatalogItem = {
  type: string;
  name: string;
  cost: number;
  weight: number;
};

export const CATALOG: CatalogItem[] = [
  { type: "R&C", name: "4x22 1/4 Reversible", cost: 219.0, weight: 187 },
  { type: "R&C", name: "4x24 Waste Water", cost: 256.0, weight: 242 },
  {
    type: "R&C",
    name: "4x24 Bolt & Gasketed (DF 1256B)",
    cost: 325.0,
    weight: 259,
  },
  {
    type: "R&C",
    name: "4x24 Liftmate BG WW Hinged/Gasketed",
    cost: 613.0,
    weight: 400,
  },
  {
    type: "R&C",
    name: "4X30 Castings Inc. MH-550-30",
    cost: 598.84,
    weight: 400,
  },
  { type: "R&C", name: "4x32 (DF-1296)", cost: 347.0, weight: 540 },
  {
    type: "R&C",
    name: "5x26 Deeter 1156 SVSD Standard",
    cost: 281.0,
    weight: 311,
  },
  {
    type: "R&C",
    name: "5x26 Deeter 1156 Reversible",
    cost: 335.0,
    weight: 311,
  },
  {
    type: "R&C",
    name: "5x26 Deeter 1156 Reversible Grate Lid",
    cost: 335.0,
    weight: 344,
  },
  { type: "R&C", name: "5x26 Bolted and Gasketed", cost: 570.0, weight: 344 },
  {
    type: "R&C",
    name: "5x32 3 piece Aluminum Frost Proof",
    cost: 925.0,
    weight: 344,
  },
  { type: "R&C", name: "5x36 CSU Inverted Electric", cost: 574.0, weight: 500 },
  { type: "R&C", name: "5x36 CSU Water", cost: 625.0, weight: 580 },
  {
    type: "R&C",
    name: "5x36 D&L A-1425 with 24 inner",
    cost: 703.0,
    weight: 580,
  },
  {
    type: "R&C",
    name: "6x24 EJ 00104049L02 Bolted and Gasketed",
    cost: 574.42,
    weight: 242,
  },
  { type: "R&C", name: "6x30 Liftmate BG", cost: 708.0, weight: 500 },
  {
    type: "R&C",
    name: "7.5x34 R-1758-C Frost proof",
    cost: 2322.0,
    weight: 450,
  },
  { type: "R&C", name: "22x8 R1500", cost: 994.0, weight: 280 },
  { type: "R&C", name: "8x24 Frost Proof", cost: 504.0, weight: 500 },
  { type: "R&C", name: "8x24 Deeter 1258", cost: 274.0, weight: 286 },
  {
    type: "R&C",
    name: "8x24 Denver Spec G-2075 and G-2077 riser rings with D&L A-1161",
    cost: 512.0,
    weight: 454,
  },
  { type: "R&C", name: "8x24 EJ 2420", cost: 400.96, weight: 286 },
  {
    type: "R&C",
    name: "8x24 Deeter 1258-B Bolted & Gasketed",
    cost: 325.0,
    weight: 259,
  },
  {
    type: "R&C",
    name: "8x24 EJ 2420 Bolted & Gasketed",
    cost: 490.96,
    weight: 286,
  },
  { type: "R&C", name: "8x30 EJ 2508", cost: 838.0, weight: 344 },
  { type: "R&C", name: "8x32 Neenah R-1798", cost: 400.0, weight: 344 },
  { type: "R&C", name: "8x30 D&L A-1360-02", cost: 590.0, weight: 344 },
];
