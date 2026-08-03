import { createServerFn } from "@tanstack/react-start";
import { callAppsScript } from "./appsScript";
import { requireUser, requireAdmin } from "./session";
import type { AppState, MenuItem, Session, PaymentMethod, BusinessDay } from "@/lib/types";

export const getStateFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireUser();
  // Apps Script's own getState_() already falls back to real defaults if
  // the Sheet cell is missing or corrupted, so no extra client-side repair
  // step is needed here.
  const res = await callAppsScript<{ state: AppState }>("getState", { username: user.username });
  return res.state;
});

export const startRoomFn = createServerFn({ method: "POST" })
  .validator((d: { roomId: string; rateMode?: "single" | "multi" }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return callAppsScript<{ ok: boolean; error?: string; state: AppState }>("startRoom", {
      ...data,
      username: user.username,
    });
  });

export const logWasteMarketingFn = createServerFn({ method: "POST" })
  .validator((d: { roomId: string; reason: string; note?: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return callAppsScript<{ ok: boolean; error?: string; state: AppState }>("logWasteMarketing", { ...data, username: user.username });
  });

export const endRoomFn = createServerFn({ method: "POST" })
  .validator((d: {
    roomId: string; splitBill: boolean; paymentMethod: PaymentMethod; cashAmount?: number; secondaryAmount?: number; frozenAt?: number;
    timeDiscountType?: "fixed" | "percent"; timeDiscountValue?: number;
    ordersDiscountType?: "fixed" | "percent"; ordersDiscountValue?: number;
  }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return callAppsScript<{ session: Session | null; error?: string; state: AppState }>("endRoom", {
      ...data,
      username: user.username,
    });
  });

export const pauseRoomFn = createServerFn({ method: "POST" })
  .validator((d: { roomId: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return callAppsScript<{ ok: boolean; error?: string; state: AppState }>("pauseRoom", { ...data, username: user.username });
  });

export const resumeRoomFn = createServerFn({ method: "POST" })
  .validator((d: { roomId: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return callAppsScript<{ ok: boolean; error?: string; state: AppState }>("resumeRoom", { ...data, username: user.username });
  });

export const addOrderFn = createServerFn({ method: "POST" })
  .validator((d: { roomId: string; menuItemId: string; qty: number }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return callAppsScript<{ ok: boolean; error?: string; state: AppState }>("addOrder", {
      ...data,
      username: user.username,
    });
  });

// Sets an order line to an exact qty (used to fix a mis-added item before
// checkout); qty <= 0 removes the line entirely.
export const setOrderLineQtyFn = createServerFn({ method: "POST" })
  .validator((d: { roomId: string; menuItemId: string; qty: number }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return callAppsScript<{ ok: boolean; error?: string; state: AppState }>("setOrderLineQty", {
      ...data,
      username: user.username,
    });
  });

// Sets/clears the barista prep note bound to one specific order line
// (e.g. "Extra Sugar", "Skimmed Milk") — pure metadata, no stock effect.
export const setOrderLineNoteFn = createServerFn({ method: "POST" })
  .validator((d: { roomId: string; menuItemId: string; notes: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return callAppsScript<{ ok: boolean; error?: string; state: AppState }>("setOrderLineNote", {
      ...data,
      username: user.username,
    });
  });

export const setRoomRateFn = createServerFn({ method: "POST" })
  .validator((d: { roomId: string; singleRate: number; multiRate: number }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    const res = await callAppsScript<{ state: AppState }>("setRoomRate", { ...data, username: user.username });
    return res.state;
  });

export const renameRoomFn = createServerFn({ method: "POST" })
  .validator((d: { roomId: string; name: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    return callAppsScript<{ ok: boolean; error?: string; state: AppState }>("renameRoom", { ...data, username: user.username });
  });

// NOTE: raw stock is no longer edited directly here. It's a computed view
// derived from Raw Materials + FIFO Batches (see finance.ts) — managed via
// the Setup page (materials/suppliers) and the Procurement page (logging
// real purchases), not ad-hoc quantity edits.

export const addMenuItemFn = createServerFn({ method: "POST" })
  .validator((d: { item: MenuItem }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    const res = await callAppsScript<{ state: AppState }>("addMenuItem", { ...data, username: user.username });
    return res.state;
  });

export const updateMenuItemFn = createServerFn({ method: "POST" })
  .validator((d: { id: string; patch: Partial<MenuItem> }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    const res = await callAppsScript<{ state: AppState }>("updateMenuItem", { ...data, username: user.username });
    return res.state;
  });

export const deleteMenuItemFn = createServerFn({ method: "POST" })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    const res = await callAppsScript<{ state: AppState }>("deleteMenuItem", { ...data, username: user.username });
    return res.state;
  });

export const setActualCashFn = createServerFn({ method: "POST" })
  .validator((d: { amount: number }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const res = await callAppsScript<{ state: AppState }>("setActualCash", { ...data, username: user.username });
    return res.state;
  });

// ---------- Cross-zone transfer & interactive split ----------

export const transferZoneFn = createServerFn({ method: "POST" })
  .validator((d: { sourceId: string; targetId: string; rateMode?: "single" | "multi" }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return callAppsScript<{ ok: boolean; error?: string; state: AppState }>("transferZone", {
      ...data,
      username: user.username,
    });
  });

export const logSplitInterfaceOpenedFn = createServerFn({ method: "POST" })
  .validator((d: { roomId: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return callAppsScript<{ ok: boolean }>("logSplitInterfaceOpened", { ...data, username: user.username });
  });

export const splitBillFn = createServerFn({ method: "POST" })
  .validator((d: {
    roomId: string;
    mode: "items" | "amount";
    items?: { menuItemId: string; qty: number }[];
    customAmount?: number;
    paymentMethod: PaymentMethod;
    cashAmount?: number;
    secondaryAmount?: number;
    discountType?: "fixed" | "percent";
    discountValue?: number;
  }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return callAppsScript<{ ok: boolean; error?: string; session?: Session; state: AppState }>("splitBill", {
      ...data,
      username: user.username,
    });
  });

// ---------- Shifts ----------

export const openShiftFn = createServerFn({ method: "POST" })
  .validator((d: { openingBalance: number; lat?: number; lng?: number }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return callAppsScript<{ ok: boolean; error?: string; state: AppState }>("openShift", {
      ...data,
      username: user.username,
    });
  });

export const endShiftFn = createServerFn({ method: "POST" })
  .validator((d: { actualCash: number; lat?: number; lng?: number }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return callAppsScript<{ ok: boolean; error?: string; state: AppState }>("endShift", {
      ...data,
      username: user.username,
    });
  });

// Emergency override — admin only. Force-closes whatever shift is active
// right now so the live dashboard counters reset to zero, without needing
// the cashier present to confirm a cash count.
export const forceEndShiftFn = createServerFn({ method: "POST" })
  .validator((d: { actualCash?: number }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    const res = await callAppsScript<{ ok: boolean; state: AppState }>("forceEndShift", {
      ...data,
      username: user.username,
    });
    return res.state;
  });

// 24/7 Business Day lifecycle — closing freezes/aggregates every shift
// since the last close (which may span multiple shifts, including past
// midnight) into the Financial Ledger, then opens fresh for the next one.
export const closeBusinessDayFn = createServerFn({ method: "POST" }).handler(async () => {
  const user = await requireAdmin();
  return callAppsScript<{ ok: boolean; error?: string; state: AppState }>("closeBusinessDay", { username: user.username });
});

export const getBusinessDaysFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireAdmin();
  const res = await callAppsScript<{ items: BusinessDay[] }>("getBusinessDays", { username: user.username });
  return res.items;
});

// Go-Live Data Wipe — Super Admin only, irreversible. Requires the admin's
// OWN password again as a safeguard against an unattended session.
export const resetForProductionFn = createServerFn({ method: "POST" })
  .validator((d: { password: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    return callAppsScript<{ ok: boolean; error?: string; state: AppState }>("resetForProduction", {
      username: user.username,
      password: data.password,
    });
  });

export const resetInventoryFn = createServerFn({ method: "POST" })
  .validator((d: { password: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    return callAppsScript<{ ok: boolean; error?: string; state: AppState }>("resetInventory", {
      username: user.username,
      password: data.password,
    });
  });

// Sequential Kitchen Ticket numbering — resets to #1 each shift.
export const nextKotNumberFn = createServerFn({ method: "POST" })
  .validator((d: { shiftId: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return callAppsScript<{ ok: boolean; error?: string; number?: number }>("nextKotNumber", { ...data, username: user.username });
  });

// Flexible Time Extension — INCREASE ONLY, enforced server-side too, not
// just in the UI.
export const extendRoomTimeFn = createServerFn({ method: "POST" })
  .validator((d: { roomId: string; deltaSec: number }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return callAppsScript<{ ok: boolean; error?: string; state: AppState }>("extendRoomTime", { ...data, username: user.username });
  });
