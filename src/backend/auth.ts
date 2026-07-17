import { createServerFn } from "@tanstack/react-start";
import { callAppsScript } from "./appsScript";
import { getCurrentUser, setCurrentUser, clearCurrentUser } from "./session";
import type { Role } from "@/lib/types";

export const sessionFn = createServerFn({ method: "GET" }).handler(async () => {
  return getCurrentUser();
});

export const loginFn = createServerFn({ method: "POST" })
  .validator((d: { username: string; password: string }) => d)
  .handler(async ({ data }) => {
    const res = await callAppsScript<{ ok: boolean; username?: string; role?: Role }>("login", {
      username: data.username,
      password: data.password,
    });
    if (!res.ok || !res.username || !res.role) {
      return { ok: false as const };
    }
    await setCurrentUser({ username: res.username, role: res.role });
    return { ok: true as const, username: res.username, role: res.role };
  });

export const logoutFn = createServerFn({ method: "POST" }).handler(async () => {
  await clearCurrentUser();
  return { ok: true };
});
