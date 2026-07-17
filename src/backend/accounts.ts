import { createServerFn } from "@tanstack/react-start";
import { callAppsScript } from "./appsScript";
import { requireAdmin } from "./session";
import { setCurrentUser } from "./session";
import type { PublicAccount, Role } from "@/lib/types";

export const getAccountsFn = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const res = await callAppsScript<{ accounts: PublicAccount[] }>("getAccounts");
  return res.accounts;
});

export const addAccountFn = createServerFn({ method: "POST" })
  .validator((d: { username: string; password: string; role: Role }) => d)
  .handler(async ({ data }) => {
    await requireAdmin();
    return callAppsScript<{ ok: boolean; error?: string }>("addAccount", data);
  });

export const updateAccountFn = createServerFn({ method: "POST" })
  .validator((d: { originalUsername: string; username?: string; password?: string; role?: Role }) => d)
  .handler(async ({ data }) => {
    const me = await requireAdmin();
    const res = await callAppsScript<{ ok: boolean; error?: string }>("updateAccount", data);
    // Keep the admin's own session in sync if they just renamed/re-roled themselves.
    if (res.ok && data.originalUsername === me.username) {
      await setCurrentUser({
        username: data.username?.trim() || me.username,
        role: data.role ?? me.role,
      });
    }
    return res;
  });

export const deleteAccountFn = createServerFn({ method: "POST" })
  .validator((d: { username: string }) => d)
  .handler(async ({ data }) => {
    await requireAdmin();
    return callAppsScript<{ ok: boolean; error?: string }>("deleteAccount", data);
  });
