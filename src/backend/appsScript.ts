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
    body: JSON.stringify({ secret, action, ...payload }),
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
