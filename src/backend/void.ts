import { createServerFn } from "@tanstack/react-start";
import { callAppsScript } from "./appsScript";
import { requireUser, requireAdmin } from "./session";
import type { AppState, VoidReason, VoidRequest } from "@/lib/types";

// Cashiers have no authority to void independently — server-side role
// checks decide whether this auto-approves (admin) or lands `pending`
// (cashier), regardless of what the client sends.
export const requestVoidFn = createServerFn({ method: "POST" })
  .validator((d: {
    roomId: string; menuItemId: string; qty: number; reason: VoidReason; waiterName: string;
    approvingAdminUsername?: string; approvingAdminPassword?: string;
    // Offline/Unapproved Void Routing: no admin available at all, remove
    // the item immediately and route it for mandatory post-hoc review.
    routeUnapproved?: boolean;
  }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return callAppsScript<{ ok: boolean; error?: string; request?: VoidRequest; state: AppState }>("requestVoid", {
      ...data,
      username: user.username,
    });
  });

export const reconcileUnapprovedVoidFn = createServerFn({ method: "POST" })
  .validator((d: { voidId: string; action: "approve" | "flag_discrepancy"; note?: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    return callAppsScript<{ ok: boolean; error?: string }>("reconcileUnapprovedVoid", { ...data, username: user.username });
  });

// Generic on-the-spot admin authorization (manager-key-style override) —
// confirms these credentials belong to a real admin right now, without
// creating a session. Used to let a cashier get instant approval for a
// cancellation instead of waiting in the pending-approval queue.
export const verifyAdminAuthFn = createServerFn({ method: "POST" })
  .validator((d: { adminUsername: string; adminPassword: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return callAppsScript<{ ok: boolean; adminUsername: string | null }>("verifyAdminAuth", {
      ...data,
      username: user.username,
    });
  });

export const getVoidRequestsFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireAdmin();
  const res = await callAppsScript<{ items: VoidRequest[] }>("getVoidRequests", { username: user.username });
  return res.items;
});

export const approveVoidFn = createServerFn({ method: "POST" })
  .validator((d: { voidId: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    return callAppsScript<{ ok: boolean; error?: string; state?: AppState }>("approveVoid", { ...data, username: user.username });
  });

export const denyVoidFn = createServerFn({ method: "POST" })
  .validator((d: { voidId: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    return callAppsScript<{ ok: boolean }>("denyVoid", { ...data, username: user.username });
  });

export const setFraudThresholdFn = createServerFn({ method: "POST" })
  .validator((d: { percent: number }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    const res = await callAppsScript<{ state: AppState }>("setFraudThreshold", { ...data, username: user.username });
    return res.state;
  });

export const setGeofenceConfigFn = createServerFn({ method: "POST" })
  .validator((d: { enabled: boolean; lat: number; lng: number; radiusMeters: number }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    const res = await callAppsScript<{ state: AppState }>("setGeofenceConfig", { ...data, username: user.username });
    return res.state;
  });
