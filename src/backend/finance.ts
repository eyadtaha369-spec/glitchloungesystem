import { createServerFn } from "@tanstack/react-start";
import { callAppsScript } from "./appsScript";
import { requireUser, requireAdmin } from "./session";
import type { RawMaterial, Supplier, RecurringExpense, LedgerEntry, AppState } from "@/lib/types";

// ---------- Raw materials ----------
export const getRawMaterialsFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireUser();
  const res = await callAppsScript<{ items: RawMaterial[] }>("getRawMaterials", { username: user.username });
  return res.items;
});
export const addRawMaterialFn = createServerFn({ method: "POST" })
  .validator((d: { name: string; unit: string; minStockAlert: number }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    return callAppsScript<{ ok: boolean; item: RawMaterial }>("addRawMaterial", { ...data, username: user.username });
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
    paidFromDrawer: boolean;
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
