import { createServerFn } from "@tanstack/react-start";
import { callAppsScript } from "./appsScript";
import { requireUser, requireAdmin } from "./session";
import type { AppState, StockItem, MenuItem, Session } from "@/lib/types";

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
    const res = await callAppsScript<{ state: AppState }>("startRoom", { ...data, username: user.username });
    return res.state;
  });

export const endRoomFn = createServerFn({ method: "POST" })
  .validator((d: { roomId: string; splitBill: boolean }) => d)
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

export const setRoomRateFn = createServerFn({ method: "POST" })
  .validator((d: { roomId: string; rate: number }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    const res = await callAppsScript<{ state: AppState }>("setRoomRate", { ...data, username: user.username });
    return res.state;
  });

export const updateStockItemFn = createServerFn({ method: "POST" })
  .validator((d: { id: string; patch: Partial<StockItem> }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    const res = await callAppsScript<{ state: AppState }>("updateStockItem", { ...data, username: user.username });
    return res.state;
  });

export const addStockItemFn = createServerFn({ method: "POST" })
  .validator((d: { item: Omit<StockItem, "used"> }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    const res = await callAppsScript<{ state: AppState }>("addStockItem", { ...data, username: user.username });
    return res.state;
  });

export const deleteStockItemFn = createServerFn({ method: "POST" })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    const res = await callAppsScript<{ state: AppState }>("deleteStockItem", { ...data, username: user.username });
    return res.state;
  });

export const restockAllFn = createServerFn({ method: "POST" }).handler(async () => {
  const user = await requireAdmin();
  const res = await callAppsScript<{ state: AppState }>("restockAll", { username: user.username });
  return res.state;
});

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
