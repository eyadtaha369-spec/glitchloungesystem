import { createServerFn } from "@tanstack/react-start";
import { callAppsScript } from "./appsScript";
import { requireUser, requireAdmin } from "./session";
import type { AppState, MenuItem, Session, PaymentMethod } from "@/lib/types";

export const getStateFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireUser();
  // Apps Script's own getState_() already falls back to real defaults if
  // the Sheet cell is missing or corrupted, so no extra client-side repair
  // step is needed here.
  const res = await callAppsScript<{ state: AppState }>("getState", { username: user.username });
  return res.state;
});

export const startRoomFn = createServerFn({ method: "POST" })
  .validator((d: { roomId: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return callAppsScript<{ ok: boolean; error?: string; state: AppState }>("startRoom", {
      ...data,
      username: user.username,
    });
  });

export const endRoomFn = createServerFn({ method: "POST" })
  .validator((d: { roomId: string; splitBill: boolean; paymentMethod: PaymentMethod }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return callAppsScript<{ session: Session | null; state: AppState }>("endRoom", {
      ...data,
      username: user.username,
    });
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

export const setRoomRateFn = createServerFn({ method: "POST" })
  .validator((d: { roomId: string; rate: number }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    const res = await callAppsScript<{ state: AppState }>("setRoomRate", { ...data, username: user.username });
    return res.state;
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

// ---------- Shifts ----------

export const openShiftFn = createServerFn({ method: "POST" })
  .validator((d: { openingBalance: number }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return callAppsScript<{ ok: boolean; error?: string; state: AppState }>("openShift", {
      ...data,
      username: user.username,
    });
  });

export const endShiftFn = createServerFn({ method: "POST" })
  .validator((d: { actualCash: number }) => d)
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
