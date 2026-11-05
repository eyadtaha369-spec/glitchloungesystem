import type { LedgerEntry } from "./types";

// Same exclusion rule used throughout Reports.tsx — waste/comp voids,
// staff consumption, unpaid entries, and supplier-debt settlements are
// never real same-period operational spend.
const WASTE_LEDGER_CATEGORIES = new Set([
  "Operational Waste / Damaged Goods",
  "Customer Satisfaction Waste",
  "Marketing & Hospitality (Comps)",
  "Unapproved Void — Pending Reconciliation",
]);
export function isOperationalExpense(l: LedgerEntry): boolean {
  return (
    l.direction === "outflow" &&
    l.type !== "sale" &&
    l.type !== "supplierPayment" &&
    l.category !== "Staff Consumption Expense" &&
    l.status === "approved" &&
    l.paymentStatus !== "unpaid" &&
    !WASTE_LEDGER_CATEGORIES.has(l.category) &&
    // Wasted/Marketing virtual-table log (Rooms.tsx) -- ingredient cost
    // only, already left stock when the item was ordered, never real
    // cash spend this period. See the matching exclusion in Reports.tsx.
    l.category !== "Marketing / Waste Expense"
  );
}

