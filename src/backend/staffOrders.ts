import { createServerFn } from "@tanstack/react-start";
import { callAppsScript } from "./appsScript";
import { requireUser, requireAdmin } from "./session";
import type { AppState, StaffOrder, StaffMember } from "@/lib/types";

// Standard menu prices are used for costing/inventory purposes, but the
// amount is routed to a Staff Consumption EXPENSE — never retail revenue,
// never a Session, never touches a room/table. staffId (when present)
// scopes the free tea/coffee allowance to that staff member's own
// per-shift usage — omit it for a walk-in/unregistered staff order,
// which simply never qualifies for the allowance.
export const submitStaffOrderFn = createServerFn({ method: "POST" })
  .validator((d: { staffId?: string; staffName: string; items: { menuItemId: string; qty: number }[] }) => d)
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
// Deliberately has no staffId/allowance concept — per explicit
// confirmation, the free tea/coffee allowance only applies on the
// standalone Staff Orders page.
export const endRoomAsStaffOrderFn = createServerFn({ method: "POST" })
  .validator((d: { roomId: string; staffName: string; frozenAt?: number }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return callAppsScript<{ ok: boolean; error?: string; staffOrder?: StaffOrder; state: AppState }>("endRoomAsStaffOrder", {
      ...data,
      username: user.username,
    });
  });

export const getStaffMembersFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireUser();
  const res = await callAppsScript<{ items: StaffMember[] }>("getStaffMembers", { username: user.username });
  return res.items;
});

export const addStaffMemberFn = createServerFn({ method: "POST" })
  .validator((d: { name: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    return callAppsScript<{ ok: boolean; error?: string; item?: StaffMember }>("addStaffMember", { ...data, username: user.username });
  });

export const updateStaffMemberFn = createServerFn({ method: "POST" })
  .validator((d: { id: string; patch: Partial<Pick<StaffMember, "name" | "active">> }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    return callAppsScript<{ ok: boolean }>("updateStaffMember", { ...data, username: user.username });
  });

export const deleteStaffMemberFn = createServerFn({ method: "POST" })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    return callAppsScript<{ ok: boolean }>("deleteStaffMember", { ...data, username: user.username });
  });

