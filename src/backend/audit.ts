import { createServerFn } from "@tanstack/react-start";
import { callAppsScript } from "./appsScript";
import { requireAdmin } from "./session";
import type { AuditLogEntry } from "@/lib/types";

// Read-only by design — there is deliberately no update/delete server
// function for activity logs anywhere in this backend.
export const getActivityLogsFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireAdmin();
  const res = await callAppsScript<{ items: AuditLogEntry[] }>("getActivityLogs", { username: user.username });
  return res.items;
});
