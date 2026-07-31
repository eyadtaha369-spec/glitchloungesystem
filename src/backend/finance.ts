import { createServerFn } from "@tanstack/react-start";
import { callAppsScript } from "./appsScript";
import { requireUser, requireAdmin } from "./session";
import type { RawMaterial, Supplier, RecurringExpense, LedgerEntry, AppState, RestockLogEntry } from "@/lib/types";

// ---------- Raw materials ----------
export const getRawMaterialsFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireUser();
  const res = await callAppsScript<{ items: RawMaterial[] }>("getRawMaterials", { username: user.username });
  return res.items;
});
export const addRawMaterialFn = createServerFn({ method: "POST" })
  .validator((d: { name: string; unit: string; minStockAlert: number; unitCost?: number }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    return callAppsScript<{ ok: boolean; item: RawMaterial }>("addRawMaterial", { ...data, username: user.username });
  });

// Manual stock adjustment — Waste / Stock Count Correction / Opening
// Balance. Fully audited server-side (activity log + ledger for waste).
export const adjustStockFn = createServerFn({ method: "POST" })
  .validator((d: { materialId: string; deltaQty: number; reason: "waste" | "correction" | "opening_balance"; note?: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    return callAppsScript<{ ok: boolean; error?: string; state: AppState }>("adjustStock", { ...data, username: user.username });
  });

// Adjust/Restock with automatic carryover: whatever's still remaining
// folds into one fresh batch alongside the new quantity, and "consumed
// since restock" resets to 0. unitCost is optional — omit to keep the
// material's current cost price.
export const restockMaterialFn = createServerFn({ method: "POST" })
  .validator((d: { materialId: string; qtyAdded: number; unitCost?: number }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return callAppsScript<{ ok: boolean; error?: string; state: AppState }>("restockMaterial", { ...data, username: user.username });
  });

export const getRestockLogFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireUser();
  const res = await callAppsScript<{ items: RestockLogEntry[] }>("getRestockLog", { username: user.username });
  return res.items;
});

// Manually counted physical stock — for discrepancy/variance tracking
// against the system-calculated remaining figure.
export const setActualStockFn = createServerFn({ method: "POST" })
  .validator((d: { materialId: string; actualStock: number }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return callAppsScript<{ ok: boolean; error?: string; variance?: number; state: AppState }>("setActualStock", { ...data, username: user.username });
  });

export const updateRawMaterialFn = createServerFn({ method: "POST" })
  .validator((d: { id: string; patch: Partial<RawMaterial> }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    return callAppsScript<{ ok: boolean }>("updateRawMaterial", { ...data, username: user.username });
  });
export const deleteRawMaterialFn = createServerFn({ method: "POST" })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    return callAppsScript<{ ok: boolean }>("deleteRawMaterial", { ...data, username: user.username });
  });

// ---------- Suppliers ----------
export const getSuppliersFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireUser();
  const res = await callAppsScript<{ items: Supplier[] }>("getSuppliers", { username: user.username });
  return res.items;
});
export const addSupplierFn = createServerFn({ method: "POST" })
  .validator((d: { name: string; contact: string; category: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    return callAppsScript<{ ok: boolean; item: Supplier }>("addSupplier", { ...data, username: user.username });
  });
export const updateSupplierFn = createServerFn({ method: "POST" })
  .validator((d: { id: string; patch: Partial<Supplier> }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    return callAppsScript<{ ok: boolean }>("updateSupplier", { ...data, username: user.username });
  });
export const deleteSupplierFn = createServerFn({ method: "POST" })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    return callAppsScript<{ ok: boolean }>("deleteSupplier", { ...data, username: user.username });
  });

// ---------- Recurring expense templates ----------
export const getRecurringExpensesFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireAdmin();
  const res = await callAppsScript<{ items: RecurringExpense[] }>("getRecurringExpenses", { username: user.username });
  return res.items;
});
export const addRecurringExpenseFn = createServerFn({ method: "POST" })
  .validator((d: { name: string; amount: number; active: boolean }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    return callAppsScript<{ ok: boolean; item: RecurringExpense }>("addRecurringExpense", { ...data, username: user.username });
  });
export const updateRecurringExpenseFn = createServerFn({ method: "POST" })
  .validator((d: { id: string; patch: Partial<RecurringExpense> }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    return callAppsScript<{ ok: boolean }>("updateRecurringExpense", { ...data, username: user.username });
  });
export const deleteRecurringExpenseFn = createServerFn({ method: "POST" })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    return callAppsScript<{ ok: boolean }>("deleteRecurringExpense", { ...data, username: user.username });
  });
export const logRecurringExpensePaymentFn = createServerFn({ method: "POST" })
  .validator((d: { name: string; amount: number; description?: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    return callAppsScript<{ ok: boolean; entry: LedgerEntry }>("logRecurringExpensePayment", { ...data, username: user.username });
  });

// ---------- Procurement (purchase submission) ----------
// Photo is mandatory. Cashier submissions land as `pending` with zero
// effect on stock/cash until an admin approves them; admin submissions
// are auto-approved.
export const submitPurchaseFn = createServerFn({ method: "POST" })
  .validator((d: {
    purchaseType: "stockedBatch" | "dailyFresh" | "midShiftPurchase";
    materialId: string;
    qty: number;
    unitCost: number;
    supplierId?: string;
    category?: string;
    description?: string;
    paymentSource: "cash_drawer" | "out_of_pocket" | "bank_transfer";
    shiftId?: string | null;
    receiptBase64: string;
    receiptMimeType: string;
  }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return callAppsScript<{ ok: boolean; error?: string; status?: string }>("submitPurchase", {
      ...data,
      username: user.username,
    });
  });

// ---------- Ledger / approvals (admin) ----------
export const getLedgerFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireAdmin();
  const res = await callAppsScript<{ items: LedgerEntry[] }>("getLedger", { username: user.username });
  return res.items;
});
export const getPendingApprovalsFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireAdmin();
  const res = await callAppsScript<{ items: LedgerEntry[] }>("getPendingApprovals", { username: user.username });
  return res.items;
});
export const approvePurchaseFn = createServerFn({ method: "POST" })
  .validator((d: { ledgerId: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    return callAppsScript<{ ok: boolean; error?: string }>("approvePurchase", { ...data, username: user.username });
  });
export const rejectPurchaseFn = createServerFn({ method: "POST" })
  .validator((d: { ledgerId: string; reason?: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    return callAppsScript<{ ok: boolean }>("rejectPurchase", { ...data, username: user.username });
  });

// One-time (idempotent) full menu + recipe catalog import — additive,
// matches existing items/materials by name so it never duplicates.
export const importMenuCatalogFn = createServerFn({ method: "POST" }).handler(async () => {
  const user = await requireAdmin();
  return callAppsScript<{
    ok: boolean; materialsAdded: number; materialsPriced: number; itemsAdded: number; itemsUpdated: number;
    itemsWithoutRecipe: string[]; state: AppState;
  }>("importMenuCatalog", { username: user.username });
});
