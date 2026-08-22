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

  // TEMPORARY DIAGNOSTIC — printed to the SERVER's own terminal window
  // (the one running "npm run dev"), not the browser console. This
  // shows exactly what value Node actually has for this variable right
  // now, removing all guesswork about whether .env is really being
  // read. Safe to leave visible short-term; remove once the actual
  // connection issue is confirmed resolved.
  console.log(`[callAppsScript] action="${action}" using APPS_SCRIPT_URL="${url}"`);

  let res: Response;
  try {
    res = await fetch(url, {
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
  } catch (err) {
    // Node's fetch wraps the ACTUAL reason (DNS failure, connection
    // refused, a bad/expired TLS certificate, a timeout, a proxy
    // rejecting the request) inside a generic "fetch failed" message,
    // with the real cause nested one level down in `err.cause` — which
    // is exactly what gets lost when only the top-level message is
    // shown. Surfacing it here means the browser console shows the
    // actual reason directly, instead of requiring a separate hunt
    // through the dev server's own raw terminal output.
    const cause = err instanceof Error && "cause" in err ? (err as any).cause : undefined;
    const causeText = cause ? ` — ${cause.code || cause.message || String(cause)}` : "";
    throw new Error(`Could not reach the backend at ${url}: ${err instanceof Error ? err.message : String(err)}${causeText}`);
  }

  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Apps Script returned non-JSON (status ${res.status}): ${text.slice(0, 300)}`);
  }
  // Only throw for genuine dispatch/transport failures — a non-2xx HTTP
  // status, or a top-level {error: "..."} with NO "ok" field at all
  // (Unknown action, forbidden, an uncaught exception inside doPost).
  // Many action handlers intentionally return a normal, gracefully-
  // handled {ok: false, error: "..."} object for validation failures
  // (missing payment source, insufficient stock, etc.) — throwing here
  // for those turns every such response into an uncaught exception
  // instead of a value the caller's `if (!res.ok)` check can see,
  // which silently skips right past a component's error-display logic
  // entirely (the promise rejects instead of resolving, so neither the
  // success nor the error branch below the await ever runs).
  if (!res.ok || (json?.error !== undefined && json?.ok === undefined)) {
    throw new Error(String(json?.error ?? `Apps Script error (status ${res.status})`));
  }
  return json as T;
}
