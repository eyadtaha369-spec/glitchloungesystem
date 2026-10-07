import { createServerFn } from "@tanstack/react-start";
import { callAppsScript } from "./appsScript";
import { requireUser, requireAdmin } from "./session";
import type { RawMaterial, Supplier, RecurringExpense, LedgerEntry, AppState, RestockLogEntry, WasteInvoice, WasteInvoiceReason, SupplierLedgerEntry, PaymentSource } from "@/lib/types";

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
  .validator((d: { materialId: string; actualStock: number; reason?: string }) => d)
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
    paymentSource?: "cash_drawer" | "out_of_pocket" | "monthly_payment";
    // خيارات طريقة الخصم — only meaningful alongside out_of_pocket; a
    // Monthly Payment source is always monthly scope on its own, and
    // the server forces "daily_shift" for a Cash Drawer purchase
    // regardless of what's sent here, same as recordSupplierPayment_.
    expenseScope?: "daily_shift" | "monthly";
    shiftId?: string | null;
    receiptBase64?: string;
    receiptMimeType?: string;
    // Admin-only: backdate this purchase into an already-closed shift
    // instead of the current active one, mirroring submitBackdatedExpense.
    targetShiftId?: string;
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
    paymentSource?: "cash_drawer" | "out_of_pocket" | "monthly_payment";
    shiftId?: string | null;
    receiptBase64?: string;
    receiptMimeType?: string;
    // Optional Inventory Sync: ties this general/daily expense to an
    // actual Raw Material purchase (e.g. buying a cleaning supply or
    // an ingredient off-the-books via petty cash), updating stock the
    // same way a Daily/Stocked Purchase does. When present, the
    // server derives `amount` as qty * unitCost itself -- see
    // handleSubmitExpense_/submitExpense's own Inventory Sync block.
    materialId?: string;
    qty?: number;
    unitCost?: number;
  }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return callAppsScript<{ ok: boolean; error?: string; status?: string; entry?: LedgerEntry }>("submitExpense", {
      ...data,
      username: user.username,
    });
  });

// Admin-only: assign an expense to an already-CLOSED shift instead of the
// currently active one. Backend recalculates that shift's expected
// cash/discrepancy (bizRecalculateClosedShift_) and persists the result, plus
// logs a red-risk audit entry -- see server/index.js's submitBackdatedExpense
// and google-apps-script/Code.gs's matching case for the full logic.
export const submitBackdatedExpenseFn = createServerFn({ method: "POST" })
  .validator((d: {
    itemName: string;
    category?: string;
    amount: number;
    notes?: string;
    supplierId?: string;
    paymentStatus: "paid" | "unpaid";
    paymentSource?: "cash_drawer" | "out_of_pocket" | "monthly_payment";
    targetShiftId: string;
    receiptBase64?: string;
    receiptMimeType?: string;
    // Optional Inventory Sync — same as submitExpenseFn above.
    materialId?: string;
    qty?: number;
    unitCost?: number;
  }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return callAppsScript<{ ok: boolean; error?: string; entry?: LedgerEntry; shift?: any }>("submitBackdatedExpense", {
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
  .validator((d: { ledgerId: string; paymentSource: "cash_drawer" | "out_of_pocket" | "monthly_payment" }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return callAppsScript<{ ok: boolean; error?: string }>("settleExpense", { ...data, username: user.username });
  });

export const submitPurchaseInvoiceFn = createServerFn({ method: "POST" })
  .validator((d: {
    supplierId: string;
    supplierName: string;
    // Plain "YYYY-MM-DD" (preferred — anchored at Cairo noon server-side
    // via resolveDateInput_/cairoMiddayTimestamp_) or a legacy numeric
    // epoch ms, for backward compatibility.
    invoiceDate?: string | number;
    paymentType: "cash" | "deferred";
    paymentSource?: "cash_drawer" | "out_of_pocket" | "monthly_payment";
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
    paymentSource: "cash_drawer" | "out_of_pocket" | "monthly_payment";
    // خصم من إيراد اليوم (شيفت حالي) vs خصم من إيراد/أرباح الشهر —
    // see recordSupplierPayment_ in Code.gs for the full reasoning.
    expenseScope: "daily_shift" | "monthly";
    note?: string;
    shiftId?: string | null;
    // Optional — a specific outstanding deferred invoice this payment
    // is settling, folded into the description for the paper trail.
    invoiceId?: string | null;
    // Plain "yyyy-MM-dd" the admin picked (defaults to today, backdatable).
    // Anchored at Cairo noon server-side and used as the generated
    // expense's own expenseDate -- see recordSupplierPayment_ in Code.gs.
    paymentDate?: string;
  }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return callAppsScript<{ ok: boolean; error?: string; paymentId?: string }>("recordSupplierPayment", { ...data, username: user.username });
  });

// السلف والخصومات الشهرية — a staff/supplier advance or monthly loan.
// Admin-only (money given out directly, not a routine purchase) and
// deliberately independent of any shift/drawer — see
// recordStaffAdvance_ in Code.gs for the full reasoning.
export const recordStaffAdvanceFn = createServerFn({ method: "POST" })
  .validator((d: { recipientName: string; amount: number; reason?: string; date?: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    return callAppsScript<{ ok: boolean; error?: string; ledgerId?: string }>("recordStaffAdvance", { ...data, username: user.username });
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
    const user = await requireAdmin();
    return callAppsScript<{ ok: boolean; error?: string; state?: AppState }>("deleteSupplierInvoice", { ...data, username: user.username });
  });

// Admin-only, requires the exact confirmation phrase plus password —
// bypasses the "stock already used" safety check the normal delete
// enforces. See bizForceDeleteSupplierInvoice_ for the full reasoning.
export const forceDeleteSupplierInvoiceFn = createServerFn({ method: "POST" })
  .validator((d: { invoiceId: string; confirmText: string; password: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    return callAppsScript<{ ok: boolean; error?: string; state?: AppState }>("forceDeleteSupplierInvoice", { ...data, username: user.username });
  });

export const clearExpensesLedgerFn = createServerFn({ method: "POST" })
  .validator((d: { confirmText: string; password: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    return callAppsScript<{ ok: boolean; error?: string; count?: number; totalCleared?: number; state?: AppState }>("clearExpensesLedger", { ...data, username: user.username });
  });

export const addFixedMonthlyCostFn = createServerFn({ method: "POST" })
  .validator((d: {
    description: string;
    // Required unless materialId is given, in which case the total is
    // always derived server-side as qty * unitCost instead.
    amount?: number;
    category?: string;
    notes?: string;
    ts?: number;
    // Optional Inventory Sync -- see addFixedMonthlyCost_ in Code.gs.
    materialId?: string;
    qty?: number;
    unitCost?: number;
  }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    return callAppsScript<{ ok: boolean; error?: string; item?: LedgerEntry }>("addFixedMonthlyCost", { ...data, username: user.username });
  });

export const updateFixedMonthlyCostFn = createServerFn({ method: "POST" })
  .validator((d: { id: string; patch: { description?: string; amount?: number; category?: string; ts?: number } }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    return callAppsScript<{ ok: boolean; error?: string }>("updateFixedMonthlyCost", { ...data, username: user.username });
  });

export const deleteFixedMonthlyCostFn = createServerFn({ method: "POST" })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    return callAppsScript<{ ok: boolean; error?: string }>("deleteFixedMonthlyCost", { ...data, username: user.username });
  });

// Admin-only: edit the amount/category/description/payment source of an
// already-recorded expense (normal or backdated) from Reports.tsx's
// Expenses History table. Backend re-recalculates the owning shift's
// expected cash/discrepancy if that shift is already closed.
export const editExpenseFn = createServerFn({ method: "POST" })
  .validator((d: { id: string; patch: { amount?: number; category?: string; description?: string; paymentSource?: PaymentSource; expenseDate?: string } }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    return callAppsScript<{ ok: boolean; error?: string; entry?: LedgerEntry; recalculated?: { expectedCash: number; discrepancy: number } | null }>("editExpense", { ...data, username: user.username });
  });

// Admin-only, password-confirmed data repair: re-derives expenseDate for
// every Ledger entry whose current OR corrected business-day label falls
// in [fromDate, toDate], using the exact same Cairo-timezone logic every
// new expense already gets at creation (expenseDateForShift_). For
// entries that already carry the right label, nothing changes. Built
// specifically for retroactively correcting entries logged before that
// Cairo-timezone fix shipped — e.g. the Sept 29/30 month-end boundary —
// without touching unrelated history or supplier invoices (which use an
// explicit admin-picked invoice date on purpose).
export const backfillExpenseDatesFn = createServerFn({ method: "POST" })
  .validator((d: { fromDate: string; toDate: string; confirmText: string; password: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    return callAppsScript<{
      ok: boolean;
      error?: string;
      count?: number;
      corrections?: { id: string; description: string; amount: number; shiftId: string | null; from: string | null; to: string }[];
    }>("backfillExpenseDates", { ...data, username: user.username });
  });

// Admin-only, password-confirmed data repair for supplier debt payments
// recorded before the "critical accounting mismatch" fix shipped —
// backfills a missing expenseDate, relabels any old-format category to
// the current fixed "Supplier Debt Payment / سداد فاتورة آجل" string,
// and backfills the linkedPaymentId back-reference Purchase History's
// delete action relies on. See resyncSupplierPaymentExpenses_ in
// Code.gs for the full reasoning.
export const resyncSupplierPaymentExpensesFn = createServerFn({ method: "POST" })
  .validator((d: { confirmText: string; password: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    return callAppsScript<{
      ok: boolean;
      error?: string;
      count?: number;
      corrections?: { id: string; description: string; amount: number; fromExpenseDate: string | null; toExpenseDate: string | null; fromCategory: string; toCategory: string }[];
    }>("resyncSupplierPaymentExpenses", { ...data, username: user.username });
  });

// Admin-only: permanently delete an already-recorded expense (normal or
// backdated). Same shift-recalculation behavior as editExpenseFn.
export const deleteExpenseFn = createServerFn({ method: "POST" })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    return callAppsScript<{ ok: boolean; error?: string; recalculated?: { expectedCash: number; discrepancy: number } | null }>("deleteExpense", { ...data, username: user.username });
  });

export const updateSupplierInvoiceFn = createServerFn({ method: "POST" })
  .validator((d: {
    invoiceId: string;
    items?: { id: string; qty: number; unitPrice: number }[];
    // Plain "YYYY-MM-DD" (preferred) or a legacy numeric epoch ms.
    invoiceDate?: string | number; paymentType?: "cash" | "deferred"; paymentSource?: string; description?: string;
    supplierId?: string; supplierName?: string; referenceNumber?: string;
  }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    return callAppsScript<{ ok: boolean; error?: string; state?: AppState }>("updateSupplierInvoice", { ...data, username: user.username });
  });

export const deleteSupplierPaymentFn = createServerFn({ method: "POST" })
  .validator((d: { paymentId: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    return callAppsScript<{ ok: boolean; error?: string; state?: AppState }>("deleteSupplierPayment", { ...data, username: user.username });
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

    // Deliberately hardcoded, NOT process.env.APPS_SCRIPT_URL — that
    // variable is shared between local and cloud mode (both
    // start-local.bat and start-cloud.bat read the exact same .env
    // file), so it could be pointing at the cloud already by the time
    // someone runs this migration. The export step needs the LOCAL
    // database specifically, regardless of which mode this device is
    // currently configured for — hardcoding the address it always
    // needs removes that whole class of confusion.
    const LOCAL_SERVER_URL = "http://127.0.0.1:4000/";

    let exportRes: {
      ok: boolean; error?: string; tables?: Record<string, unknown[]>; appState?: unknown;
      accounts?: { username: string; passwordHash: string; role: string }[]; exportedAt?: number;
    };
    try {
      const exportHttpRes = await fetch(LOCAL_SERVER_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          secret: process.env.GLITCH_LOCAL_SECRET || "change-me-local-secret",
          action: "exportAllData",
          username: user.username,
          password: data.password,
        }),
      });
      const exportText = await exportHttpRes.text();
      exportRes = JSON.parse(exportText);
    } catch (e) {
      return {
        ok: false as const,
        error: (e instanceof Error ? e.message : "Export failed") + " — make sure the local server (server folder, port 4000) is actually running on this device.",
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
