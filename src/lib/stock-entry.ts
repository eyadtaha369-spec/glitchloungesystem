// Shared helpers for stock/procurement entry screens: purchase-unit
// conversion and the "does this look wrong?" sanity checks. Backends only
// ever store quantities in the material's own base unit, so everything a
// person types in another unit (kg, L, dozen, a pack of N) is converted
// HERE, before submit, and the person sees the converted number first.

export interface PurchaseUnitOption {
  id: string;
  label: string;
  // Base units per ONE purchase unit. null = the person types it (custom pack).
  factor: number | null;
}

const GRAM = new Set(["g", "gm", "gms", "gr", "gram", "grams", "جم", "جرام", "غرام"]);
const KILO = new Set(["kg", "kgs", "kilo", "kilogram", "كجم", "كيلو"]);
const ML = new Set(["ml", "mL", "milliliter", "millilitre", "مل"].map((u) => u.toLowerCase()));
const LITER = new Set(["l", "lt", "ltr", "liter", "litre", "لتر"]);
const PIECE = new Set(["pcs", "pc", "piece", "pieces", "unit", "units", "each", "عدد", "قطعة", "حبة"]);

export function normalizeUnit(unit: string): string {
  return (unit || "").trim().toLowerCase();
}

export function purchaseUnitOptions(baseUnit: string): PurchaseUnitOption[] {
  const u = normalizeUnit(baseUnit);
  const base: PurchaseUnitOption = { id: "base", label: baseUnit || "unit", factor: 1 };
  const opts: PurchaseUnitOption[] = [base];
  if (GRAM.has(u)) opts.push({ id: "kg", label: "kg", factor: 1000 });
  else if (ML.has(u)) opts.push({ id: "l", label: "L", factor: 1000 });
  else if (PIECE.has(u)) opts.push({ id: "dozen", label: "dozen (12)", factor: 12 });
  opts.push({ id: "pack", label: "pack / box / carton…", factor: null });
  return opts;
}

// Tiny quantities of a small unit are the classic "typed 5 meaning 5 kg" slip.
export function isSmallBaseUnit(unit: string): boolean {
  const u = normalizeUnit(unit);
  return GRAM.has(u) || ML.has(u);
}

export function fmtQty(n: number): string {
  if (!isFinite(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: 3 });
}
export function fmtCost(n: number): string {
  if (!isFinite(n)) return "—";
  const digits = Math.abs(n) < 1 ? 4 : 2;
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: digits });
}

export const SANITY = {
  maxQty: 5000, // entered quantity, in the unit the person typed
  priceHigh: 4, // new cost/base-unit more than 4x the usual (i.e. +300%)
  priceLow: 0.25, // ...or less than a quarter of it
  maxTotal: 20000, // EGP for one entry
  tinySmallUnit: 50, // < 50 gm/ml in the base unit: "did you mean kg/L?"
};

export interface SanityInput {
  materialName: string;
  baseUnit: string;
  enteredQty: number;
  enteredUnitLabel: string;
  enteredUnitIsBase: boolean;
  baseQty: number;
  costPerBase: number;
  usualCostPerBase: number; // material.lastPurchaseCost || material.unitCost, 0 if unknown
  total: number;
}

export function sanityWarnings(i: SanityInput): string[] {
  const w: string[] = [];
  if (i.enteredQty > SANITY.maxQty) {
    w.push(`Quantity ${fmtQty(i.enteredQty)} ${i.enteredUnitLabel} is very large (over ${fmtQty(SANITY.maxQty)}). Check you didn't type the price here.`);
  }
  if (i.usualCostPerBase > 0 && i.costPerBase > 0) {
    const ratio = i.costPerBase / i.usualCostPerBase;
    if (ratio > SANITY.priceHigh) {
      w.push(`Cost per ${i.baseUnit} is EGP ${fmtCost(i.costPerBase)} — ${Math.round((ratio - 1) * 100)}% above the usual EGP ${fmtCost(i.usualCostPerBase)}.`);
    } else if (ratio < SANITY.priceLow) {
      w.push(`Cost per ${i.baseUnit} is EGP ${fmtCost(i.costPerBase)} — far below the usual EGP ${fmtCost(i.usualCostPerBase)}.`);
    }
  }
  if (i.total > SANITY.maxTotal) {
    w.push(`Total EGP ${fmtCost(i.total)} is unusually large for one entry.`);
  }
  if (i.enteredUnitIsBase && isSmallBaseUnit(i.baseUnit) && i.baseQty > 0 && i.baseQty < SANITY.tinySmallUnit) {
    w.push(`Only ${fmtQty(i.baseQty)} ${i.baseUnit} will be added. If you bought ${fmtQty(i.baseQty)} kg/L, change the unit — otherwise POS will show Out of Stock.`);
  }
  return w;
}
