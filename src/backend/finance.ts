import { createServerFn } from "@tanstack/react-start";
import { callAppsScript } from "./appsScript";
import { requireUser, requireAdmin } from "./session";
import type { RawMaterial, Supplier, RecurringExpense, LedgerEntry, AppState, RestockLogEntry, WasteInvoice, WasteInvoiceReason, SupplierLedgerEntry } from "@/lib/types";

// ---------- Raw materials ----------
export const getRawMaterialsFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireUser();
  const res = await callAppsScript<{ items: RawMaterial[] }>("getRawMaterials", { username: user.username });
  return res.items;
});
export const addRawMaterialFn = createServerFn({ method: "POST" })
  .validator((d: { name: string; unit: string; minStockAlert: number; unitCost?: number; openingStock?: number; category?: string; storageLocation?: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    return callAppsScript<{ ok: boolean; item: RawMaterial; state?: AppState }>("addRawMaterial", { ...data, username: user.username });
  });

export const bulkAddRawMaterialsFn = createServerFn({ method: "POST" })
  .validator((d: { rows: { name: string; unit: string; openingStock?: number; unitCost?: number; minStockAlert?: number; category?: string }[] }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    return callAppsScript<{ ok: boolean; added: number; skipped: string[]; state: AppState }>("bulkAddRawMaterials", { ...data, username: user.username });
  });

// Manual stock adjustment — Waste / Stock Count Correction / Opening
// Balance. Fully audited server-side (activity log + ledger for waste).
export const adjustStockFn = createServerFn({ method: "POST" })
  .validator((d: { materialId: string; deltaQty: number; reason: "waste" | "correction" | "opening_balance"; note?: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    return callAppsScript<{ ok: boolean; error?: string; state: AppState }>("adjustStock", { ...data, username: user.username });
  });

// Direct Value Override for the Inventory Edit modal — the entered number
// becomes the exact current stock. The SERVER computes its own delta
// against the live remaining at save time (not a delta pre-computed on
// the client), so it can never go stale if real consumption happens
// between opening the modal and hitting Save.
export const setAbsoluteStockFn = createServerFn({ method: "POST" })
  .validator((d: { materialId: string; targetQty: number; note?: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    return callAppsScript<{ ok: boolean; error?: string; before?: number; after?: number; delta?: number; state: AppState }>("setAbsoluteStock", { ...data, username: user.username });
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

// Raw-material Waste Invoice — distinct from Wasted/Marketing (which
// wastes finished MENU ITEMS off the virtual table). This wastes a raw
// material directly: spoiled beans, an expired carton of milk.
export const submitWasteInvoiceFn = createServerFn({ method: "POST" })
  .validator((d: { materialId: string; wastedQty: number; reason: WasteInvoiceReason; note?: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return callAppsScript<{ ok: boolean; error?: string; invoice?: WasteInvoice; state?: AppState }>("submitWasteInvoice", { ...data, username: user.username });
  });

export const getWasteInvoicesFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireUser();
  const res = await callAppsScript<{ items: WasteInvoice[] }>("getWasteInvoices", { username: user.username });
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
    return callAppsScript<{ ok: boolean; error?: string; state?: AppState }>("updateRawMaterial", { ...data, username: user.username });
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
    paymentStatus: "paid" | "unpaid";
    paymentSource?: "cash_drawer" | "out_of_pocket" | "bank_transfer";
    shiftId?: string | null;
    receiptBase64?: string;
    receiptMimeType?: string;
  }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return callAppsScript<{ ok: boolean; error?: string; status?: string }>("submitPurchase", {
      ...data,
      username: user.username,
    });
  });

export const submitExpenseFn = createServerFn({ method: "POST" })
  .validator((d: {
    itemName: string;
    category?: string;
    amount: number;
    notes?: string;
    supplierId?: string;
    paymentStatus: "paid" | "unpaid";
    paymentSource?: "cash_drawer" | "out_of_pocket" | "bank_transfer";
    shiftId?: string | null;
    receiptBase64?: string;
    receiptMimeType?: string;
  }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return callAppsScript<{ ok: boolean; error?: string; status?: string; entry?: LedgerEntry }>("submitExpense", {
      ...data,
      username: user.username,
    });
  });

export const getUnpaidExpensesFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireUser();
  const res = await callAppsScript<{ items: LedgerEntry[] }>("getUnpaidExpenses", { username: user.username });
  return res.items;
});

export const settleExpenseFn = createServerFn({ method: "POST" })
  .validator((d: { ledgerId: string; paymentSource: "cash_drawer" | "out_of_pocket" | "bank_transfer" }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return callAppsScript<{ ok: boolean; error?: string }>("settleExpense", { ...data, username: user.username });
  });

export const submitPurchaseInvoiceFn = createServerFn({ method: "POST" })
  .validator((d: {
    supplierId: string;
    supplierName: string;
    invoiceDate?: number;
    paymentType: "cash" | "deferred";
    paymentSource?: "cash_drawer" | "out_of_pocket" | "bank_transfer";
    items: { materialId: string; qty: number; unitPrice: number }[];
    shiftId?: string | null;
  }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return callAppsScript<{ ok: boolean; error?: string; invoiceId?: string; totalAmount?: number; itemCount?: number; state?: AppState }>(
      "submitPurchaseInvoice", { ...data, username: user.username },
    );
  });

export const recordSupplierPaymentFn = createServerFn({ method: "POST" })
  .validator((d: {
    supplierId: string;
    amount: number;
    paymentSource: "cash_drawer" | "out_of_pocket" | "bank_transfer";
    note?: string;
    shiftId?: string | null;
  }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return callAppsScript<{ ok: boolean; error?: string; paymentId?: string }>("recordSupplierPayment", { ...data, username: user.username });
  });

export const getSupplierBalancesFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireUser();
  const res = await callAppsScript<{ balances: Record<string, number> }>("getSupplierBalances", { username: user.username });
  return res.balances;
});

export const getSupplierLedgerFn = createServerFn({ method: "POST" })
  .validator((d: { supplierId: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return callAppsScript<{ ok: boolean; error?: string; ledger?: { entries: SupplierLedgerEntry[]; currentBalance: number } }>(
      "getSupplierLedger", { ...data, username: user.username },
    );
  });

export const deletePurchaseFn = createServerFn({ method: "POST" })
  .validator((d: { ledgerId: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return callAppsScript<{ ok: boolean; error?: string; state?: AppState }>("deletePurchase", { ...data, username: user.username });
  });

export const updatePurchaseFn = createServerFn({ method: "POST" })
  .validator((d: { ledgerId: string; description?: string; category?: string; supplierId?: string; qty?: number; unitCost?: number }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return callAppsScript<{ ok: boolean; error?: string; state?: AppState }>("updatePurchase", { ...data, username: user.username });
  });

export const deleteSupplierInvoiceFn = createServerFn({ method: "POST" })
  .validator((d: { invoiceId: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return callAppsScript<{ ok: boolean; error?: string; state?: AppState }>("deleteSupplierInvoice", { ...data, username: user.username });
  });

// One-time migration: exports everything from THIS system (the café's
// local server, which is what process.env.APPS_SCRIPT_URL points to
// when this runs from the offline build) and pushes it directly to a
// DIFFERENT URL — the actual cloud deployment — which the admin
// provides here, since it's not the same URL this build normally
// talks to. Two separate requests, not the usual single callAppsScript
// round-trip.
export const migrateToCloudFn = createServerFn({ method: "POST" })
  .validator((d: { password: string; cloudUrl: string; cloudSecret: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();

    let exportRes: {
      ok: boolean; error?: string; tables?: Record<string, unknown[]>; appState?: unknown;
      accounts?: { username: string; passwordHash: string; role: string }[]; exportedAt?: number;
    };
    try {
      exportRes = await callAppsScript<{
        ok: boolean; error?: string; tables?: Record<string, unknown[]>; appState?: unknown;
        accounts?: { username: string; passwordHash: string; role: string }[]; exportedAt?: number;
      }>("exportAllData", { username: user.username, password: data.password });
    } catch (e) {
      // Most likely cause: this device is currently in CLOUD mode, so
      // this request went to the cloud instead of the local database —
      // and the cloud has no exportAllData action at all (only the
      // local server does), producing exactly this kind of failure.
      return {
        ok: false as const,
        error: (e instanceof Error ? e.message : "Export failed") + " — make sure this device is running in LOCAL mode (run.vbs, not run-cloud.vbs) before migrating, since this step reads from the local database.",
        step: "export" as const,
      };
    }

    if (!exportRes.ok) return { ok: false as const, error: exportRes.error ?? "Export failed", step: "export" as const };


    let importRes: { ok: boolean; error?: string; tableSummary?: Record<string, number>; accountsAdded?: number };
    try {
      const res = await fetch(data.cloudUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          secret: data.cloudSecret,
          tables: exportRes.tables,
          appState: exportRes.appState,
          accounts: exportRes.accounts,
          username: user.username,
          password: data.password,
          confirmPhrase: "MIGRATE FROM CAFE",
          action: "importAllData",
        }),
        redirect: "follow",
      });
      const text = await res.text();
      importRes = JSON.parse(text);
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "Could not reach the cloud URL — check it's correct and reachable.", step: "import" as const };
    }

    if (!importRes.ok) return { ok: false as const, error: importRes.error ?? "Import failed on the cloud side", step: "import" as const };

    return { ok: true as const, tableSummary: importRes.tableSummary ?? {}, accountsAdded: importRes.accountsAdded ?? 0 };
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
export const resetMenuAndRecipesFn = createServerFn({ method: "POST" })
  .validator((d: { password: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    return callAppsScript<{
      ok: boolean; error?: string; materialsCreated: number; itemsCreated: number; unresolved: string[]; state: AppState;
    }>("resetMenuAndRecipes", { username: user.username, password: data.password });
  });
