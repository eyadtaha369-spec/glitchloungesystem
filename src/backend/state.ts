import { createServerFn } from "@tanstack/react-start";
import { callAppsScript } from "./appsScript";
import { requireUser, requireAdmin } from "./session";
import * as biz from "./business";
import type { AppState, StockItem, MenuItem } from "@/lib/types";

async function loadState(): Promise<AppState> {
  const res = await callAppsScript<{ state: AppState | null }>("getState");
  const state = res.state;
  const looksUninitialized =
    !state ||
    ((state.rooms?.length ?? 0) === 0 &&
      (state.stock?.length ?? 0) === 0 &&
      (state.menu?.length ?? 0) === 0);
  if (looksUninitialized) {
    // Self-heal: this happens if the Sheet's AppState cell was never
    // seeded, got corrupted, or an old Apps Script deployment returned
    // an empty object. Persist real defaults so it doesn't keep happening.
    const fresh = biz.defaultAppState();
    await saveState(fresh);
    return fresh;
  }
  return state;
}
async function saveState(state: AppState): Promise<void> {
  await callAppsScript("setState", { state });
}

export const getStateFn = createServerFn({ method: "GET" }).handler(async () => {
  await requireUser();
  return loadState();
});

export const startRoomFn = createServerFn({ method: "POST" })
  .validator((d: { roomId: string }) => d)
  .handler(async ({ data }) => {
    await requireUser();
    const state = biz.startRoom(await loadState(), data.roomId);
    await saveState(state);
    return state;
  });

export const endRoomFn = createServerFn({ method: "POST" })
  .validator((d: { roomId: string; splitBill: boolean }) => d)
  .handler(async ({ data }) => {
    await requireUser();
    const { session, state } = biz.endRoom(await loadState(), data.roomId, data.splitBill);
    if (session) await saveState(state);
    return { session, state };
  });

export const addOrderFn = createServerFn({ method: "POST" })
  .validator((d: { roomId: string; menuItemId: string; qty: number }) => d)
  .handler(async ({ data }) => {
    await requireUser();
    const result = biz.addOrder(await loadState(), data.roomId, data.menuItemId, data.qty);
    if (result.ok) await saveState(result.state);
    return result;
  });

export const setRoomRateFn = createServerFn({ method: "POST" })
  .validator((d: { roomId: string; rate: number }) => d)
  .handler(async ({ data }) => {
    await requireAdmin();
    const state = biz.setRoomRate(await loadState(), data.roomId, data.rate);
    await saveState(state);
    return state;
  });

export const updateStockItemFn = createServerFn({ method: "POST" })
  .validator((d: { id: string; patch: Partial<StockItem> }) => d)
  .handler(async ({ data }) => {
    await requireAdmin();
    const state = biz.updateStockItem(await loadState(), data.id, data.patch);
    await saveState(state);
    return state;
  });

export const addStockItemFn = createServerFn({ method: "POST" })
  .validator((d: { item: Omit<StockItem, "used"> }) => d)
  .handler(async ({ data }) => {
    await requireAdmin();
    const state = biz.addStockItem(await loadState(), data.item);
    await saveState(state);
    return state;
  });

export const deleteStockItemFn = createServerFn({ method: "POST" })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    await requireAdmin();
    const state = biz.deleteStockItem(await loadState(), data.id);
    await saveState(state);
    return state;
  });

export const addMenuItemFn = createServerFn({ method: "POST" })
  .validator((d: { item: MenuItem }) => d)
  .handler(async ({ data }) => {
    await requireAdmin();
    const state = biz.addMenuItem(await loadState(), data.item);
    await saveState(state);
    return state;
  });

export const deleteMenuItemFn = createServerFn({ method: "POST" })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    await requireAdmin();
    const state = biz.deleteMenuItem(await loadState(), data.id);
    await saveState(state);
    return state;
  });

export const setActualCashFn = createServerFn({ method: "POST" })
  .validator((d: { amount: number }) => d)
  .handler(async ({ data }) => {
    await requireUser();
    const state = biz.setActualCash(await loadState(), data.amount);
    await saveState(state);
    return state;
  });
