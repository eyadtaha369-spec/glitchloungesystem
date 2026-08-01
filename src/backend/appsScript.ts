// Server-only. This file must never be imported from client code — it holds the
// shared secret used to authenticate with the Google Apps Script web app.
// The secret lives only in Vercel env vars and only this server ever sends it.

export async function callAppsScript<T = unknown>(
  action: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  const url = process.env.APPS_SCRIPT_URL;
  const secret = process.env.APPS_SCRIPT_SECRET;
  if (!url || !secret) {
    throw new Error("APPS_SCRIPT_URL and APPS_SCRIPT_SECRET env vars must be set in Vercel.");
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    // IMPORTANT: `action` must be spread LAST. Some payloads legitimately
    // have their own field also called "action" (e.g. reconcileUnapprovedVoid's
    // {action: "approve" | "flag_discrepancy"}), which is a completely
    // different thing from the dispatch action name below it — but with
    // ...payload spread after `action`, that field silently overwrote the
    // real dispatch name, sending e.g. "approve" as the action instead of
    // "reconcileUnapprovedVoid". Spreading payload first and `action` last
    // guarantees the real dispatch name always wins.
    body: JSON.stringify({ secret, ...payload, action }),
    redirect: "follow",
  });

  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Apps Script returned non-JSON (status ${res.status}): ${text.slice(0, 300)}`);
  }
  if (!res.ok || json?.error) {
    throw new Error(String(json?.error ?? `Apps Script error (status ${res.status})`));
  }
  return json as T;
}
