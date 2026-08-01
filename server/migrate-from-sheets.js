// Pulls your REAL data from the live cloud Apps Script (Google Sheets)
// and writes it into the local database, replacing the tiny placeholder
// starter set.
//
// Usage:
//   CLOUD_URL=<your Apps Script web app URL> CLOUD_SECRET=<its secret> CLOUD_ADMIN_USER=<username> CLOUD_ADMIN_PASS=<password> node migrate-from-sheets.js
//
// Or put those four in server/.env instead of typing them every time.
//
// WHAT THIS MIGRATES: menu, rooms (names/rates), raw materials, current
// stock batches, suppliers, recurring expenses, and the LIST of accounts
// (usernames + roles only — passwords can never be migrated, since the
// cloud API deliberately never exposes password hashes; you'll recreate
// each account locally with create-account.js after this runs, same
// usernames, new passwords).
//
// WHAT THIS DOES NOT MIGRATE (yet): historical Sessions, Shifts, Ledger,
// ActivityLogs, VoidRequests, StaffOrders, RestockLog, BusinessDays.
// The app will work fully for NEW activity going forward; old reports
// just won't show pre-migration history. Ask if you want that added too.

require("dotenv").config();
const { getStateRaw_, setStateRaw_, appendObject_, db } = require("./db");

const CLOUD_URL = process.env.CLOUD_URL;
const CLOUD_SECRET = process.env.CLOUD_SECRET;
const CLOUD_ADMIN_USER = process.env.CLOUD_ADMIN_USER;
const CLOUD_ADMIN_PASS = process.env.CLOUD_ADMIN_PASS;

async function callCloud(action, extra = {}) {
  const res = await fetch(CLOUD_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ secret: CLOUD_SECRET, action, username: CLOUD_ADMIN_USER, password: CLOUD_ADMIN_PASS, ...extra }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`${action} failed: ${json.error}`);
  return json;
}

(async () => {
  if (!CLOUD_URL || !CLOUD_SECRET || !CLOUD_ADMIN_USER || !CLOUD_ADMIN_PASS) {
    console.log("Missing required settings. Set these in server/.env or as environment variables:");
    console.log("  CLOUD_URL=https://script.google.com/.../exec");
    console.log("  CLOUD_SECRET=<your live APPS_SCRIPT_SECRET>");
    console.log("  CLOUD_ADMIN_USER=<a real admin username on the live site>");
    console.log("  CLOUD_ADMIN_PASS=<that admin's password>");
    process.exit(1);
  }

  console.log("Connecting to your live cloud data...");
  const login = await callCloud("login");
  if (!login.ok || login.role !== "admin") {
    console.log("Login failed or account is not an admin — cannot migrate. Check CLOUD_ADMIN_USER/CLOUD_ADMIN_PASS.");
    process.exit(1);
  }
  console.log(`Logged in as ${login.username} (${login.role}). Pulling data...`);

  const [stateRes, materialsRes, batchesRes, suppliersRes, expensesRes, accountsRes] = await Promise.all([
    callCloud("getState"),
    callCloud("getRawMaterials"),
    callCloud("getBatches"),
    callCloud("getSuppliers"),
    callCloud("getRecurringExpenses"),
    callCloud("getAccounts"),
  ]);

  const cloudState = stateRes.state;
  console.log(`Menu: ${cloudState.menu.length} items | Rooms: ${cloudState.rooms.length} | Materials: ${materialsRes.items.length} | Batches: ${batchesRes.items.length} | Suppliers: ${suppliersRes.items.length} | Accounts: ${accountsRes.accounts.length}`);

  // ---- Write into local AppState blob: menu + rooms, keep everything
  // else fresh/local (no active shift carried over, activity feed empty) ----
  const localRaw = getStateRaw_();
  const localState = localRaw ? JSON.parse(localRaw) : {};
  const merged = Object.assign({}, localState, {
    menu: cloudState.menu,
    rooms: cloudState.rooms,
    orderCounter: cloudState.orderCounter || 0,
    fraudThresholdPercent: cloudState.fraudThresholdPercent,
    activeShiftId: null,
    businessDayId: null,
    activity: [],
    cashRecords: [],
    actualCashInput: 0,
  });
  setStateRaw_(JSON.stringify(merged));
  console.log("✓ Menu and rooms migrated.");

  // ---- Raw materials + batches ----
  db.exec("DELETE FROM RawMaterials");
  db.exec("DELETE FROM Batches");
  materialsRes.items.forEach((m) => appendObject_("RawMaterials", m));
  batchesRes.items.forEach((b) => appendObject_("Batches", b));
  console.log("✓ Raw materials and stock batches migrated.");

  // ---- Suppliers + recurring expenses ----
  db.exec("DELETE FROM Suppliers");
  db.exec("DELETE FROM RecurringExpenses");
  suppliersRes.items.forEach((s) => appendObject_("Suppliers", s));
  expensesRes.items.forEach((e) => appendObject_("RecurringExpenses", e));
  console.log("✓ Suppliers and recurring expenses migrated.");

  console.log("\n=== DONE ===");
  console.log("\nAccounts that existed on the live site (passwords could NOT be");
  console.log("migrated — recreate each one below with a NEW password):\n");
  accountsRes.accounts.forEach((a) => {
    console.log(`  node create-account.js ${a.username} <new-password> ${a.role}`);
  });
  console.log("\nRestart the server (npm start) to pick up the migrated data.");
})().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
