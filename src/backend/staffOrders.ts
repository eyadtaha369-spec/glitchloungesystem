import { createServerFn } from "@tanstack/react-start";
import { callAppsScript } from "./appsScript";
import { requireUser, requireAdmin } from "./session";
import type { AppState, StaffOrder } from "@/lib/types";

// Standard menu prices are used for costing/inventory purposes, but the
// amount is routed to a Staff Consumption EXPENSE — never retail revenue,
// never a Session, never touches a room/table.
export const submitStaffOrderFn = createServerFn({ method: "POST" })
  .validator((d: { staffName: string; items: { menuItemId: string; qty: number }[] }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return callAppsScript<{ ok: boolean; error?: string; staffOrder?: StaffOrder; state: AppState }>("submitStaffOrder", {
      ...data,
      username: user.username,
    });
  });

export const getStaffOrdersFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireAdmin();
  const res = await callAppsScript<{ items: StaffOrder[] }>("getStaffOrders", { username: user.username });
  return res.items;
});

// Closes an active room/table as a Staff Order instead of a paid
// checkout — routes through the exact same Staff Consumption Expense
// mechanism as submitStaffOrderFn above, just triggered from an
// in-progress room/table rather than the standalone Staff Orders page.
export const endRoomAsStaffOrderFn = createServerFn({ method: "POST" })
  .validator((d: { roomId: string; staffName: string; frozenAt?: number }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return callAppsScript<{ ok: boolean; error?: string; staffOrder?: StaffOrder; state: AppState }>("endRoomAsStaffOrder", {
      ...data,
      username: user.username,
    });
  });
