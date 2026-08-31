// Periodically mirrors this local server's data up to the cloud, in
// the background, without ever blocking or slowing down anything the
// café's cashier is doing. This is what makes it safe for the café's
// app to talk to its own local server for speed (instant order
// confirmation) while still letting the owner's phone / the web app
// see roughly-current data a short while later.
//
// Entirely OPT-IN via env vars — if CLOUD_SYNC_URL isn't set, this
// module does nothing at all, so existing local-only setups are
// completely unaffected.
//
// Deliberately fire-and-forget: a failed sync (no internet, cloud
// temporarily unreachable) is logged and silently retried on the next
// tick — it never throws, never crashes the server, and never affects
// any response already being sent to the café's own app.

const SYNC_URL = process.env.CLOUD_SYNC_URL || null;
const SYNC_SECRET = process.env.CLOUD_SYNC_SECRET || null;
const SYNC_INTERVAL_MS = Number(process.env.CLOUD_SYNC_INTERVAL_MS) || 30000;

let lastSyncStatus = { ok: null, at: null, error: null };

function getLastSyncStatus() {
  return lastSyncStatus;
}

async function runCloudSync(buildExportSnapshot_) {
  if (!SYNC_URL || !SYNC_SECRET) return; // sync not configured — no-op

  try {
    const snapshot = buildExportSnapshot_();
    const res = await fetch(SYNC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: SYNC_SECRET,
        action: "autoSyncFromLocal",
        tables: snapshot.tables,
        appState: snapshot.appState,
        accounts: snapshot.accounts,
      }),
    });
    const text = await res.text();
    const result = JSON.parse(text);
    if (!result.ok) throw new Error(result.error || "Cloud rejected the sync");
    lastSyncStatus = { ok: true, at: Date.now(), error: null };
  } catch (err) {
    lastSyncStatus = { ok: false, at: Date.now(), error: err instanceof Error ? err.message : String(err) };
    // Deliberately just a log line, not a thrown error — a sync
    // failure must never affect the café's own local operations,
    // which is the entire point of this being a background job.
    console.error("[cloud-sync] Failed to push to cloud (will retry next cycle):", lastSyncStatus.error);
  }
}

function scheduleCloudSync(buildExportSnapshot_) {
  if (!SYNC_URL || !SYNC_SECRET) {
    console.log("[cloud-sync] CLOUD_SYNC_URL/CLOUD_SYNC_SECRET not set — background cloud sync is OFF. This device stays purely local-only.");
    return;
  }
  console.log("[cloud-sync] Background sync ENABLED — pushing to the cloud every " + Math.round(SYNC_INTERVAL_MS / 1000) + "s.");
  void runCloudSync(buildExportSnapshot_); // one immediately, don't wait a full interval for the first push
  setInterval(() => void runCloudSync(buildExportSnapshot_), SYNC_INTERVAL_MS);
}

module.exports = { scheduleCloudSync, getLastSyncStatus };
