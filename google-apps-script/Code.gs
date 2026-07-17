/**
 * GLITCH Lounge Manager — Apps Script backend.
 *
 * Setup (one time):
 * 1. Open your Google Sheet -> Extensions -> Apps Script.
 * 2. Delete any starter code, paste this whole file in as Code.gs.
 * 3. Project Settings (gear icon) -> Script Properties -> add a property named
 *    SECRET with a long random value. Use the SAME value as APPS_SCRIPT_SECRET
 *    in Vercel's environment variables.
 * 4. Select function "initSheets" in the dropdown at the top -> Run.
 *    (First run will ask you to authorize — approve it.) This creates the
 *    Accounts and AppState tabs with the default admin/cashier logins and
 *    starter lounge data.
 * 5. Deploy -> New deployment -> type "Web app".
 *      Execute as: Me
 *      Who has access: Anyone
 *    Deploy, then copy the Web App URL — that's your APPS_SCRIPT_URL.
 * 6. In Vercel, set env vars APPS_SCRIPT_URL and APPS_SCRIPT_SECRET, then redeploy.
 *
 * Whenever you edit this file in the Apps Script editor, you must create a
 * NEW deployment version (Deploy -> Manage deployments -> edit -> New version)
 * for changes to take effect on the live URL.
 *
 * SECURITY NOTE: every request must now include a `username` field (the
 * logged-in user's username) alongside `secret`. Account-management actions
 * (add/update/delete/list accounts) are restricted server-side to users
 * whose role in the Accounts sheet is "admin" — the client's claimed role
 * is never trusted, only what's actually stored in the sheet for that
 * username.
 */

const ACCOUNTS_SHEET = "Accounts";
const STATE_SHEET = "AppState";

function getSecret_() {
  return PropertiesService.getScriptProperties().getProperty("SECRET");
}

function sha256Hex_(text) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return bytes.map(function (b) {
    const v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? "0" + v : v;
  }).join("");
}

function getSheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  return sheet;
}

function initSheets() {
  const accounts = getSheet_(ACCOUNTS_SHEET);
  accounts.clear();
  accounts.appendRow(["username", "password_hash", "role"]);
  accounts.appendRow(["admin", sha256Hex_("admin123"), "admin"]);
  accounts.appendRow(["cashier1", sha256Hex_("cashier123"), "cashier"]);

  const state = getSheet_(STATE_SHEET);
  state.clear();
  state.appendRow(["key", "value"]);
  state.appendRow(["app", JSON.stringify(defaultAppState_())]);
}

function defaultAppState_() {
  const stock = [
    { id: "coffee", name: "Coffee Beans", unit: "g", initialStock: 2000, used: 0, minStock: 300 },
    { id: "milk", name: "Milk", unit: "ml", initialStock: 5000, used: 0, minStock: 800 },
    { id: "sugar", name: "Sugar", unit: "g", initialStock: 1500, used: 0, minStock: 200 },
    { id: "cups", name: "Paper Cups", unit: "pcs", initialStock: 200, used: 0, minStock: 40 },
    { id: "soda", name: "Soda Cans", unit: "pcs", initialStock: 100, used: 0, minStock: 20 },
    { id: "chips", name: "Potato Chips", unit: "pcs", initialStock: 80, used: 0, minStock: 15 },
  ];
  const menu = [
    { id: "latte", name: "Latte", price: 4.5, ingredients: [{ stockId: "coffee", qty: 18 }, { stockId: "milk", qty: 200 }, { stockId: "cups", qty: 1 }] },
    { id: "espresso", name: "Espresso", price: 3.0, ingredients: [{ stockId: "coffee", qty: 18 }, { stockId: "cups", qty: 1 }] },
    { id: "soda-drink", name: "Soda", price: 2.5, ingredients: [{ stockId: "soda", qty: 1 }] },
    { id: "chips-snack", name: "Chips", price: 2.0, ingredients: [{ stockId: "chips", qty: 1 }] },
  ];
  const rooms = [];
  for (let i = 1; i <= 8; i++) {
    rooms.push({ id: "room-" + i, name: "Room " + i, isVip: false, hourlyRate: 5, status: "available", startedAt: null, orders: [] });
  }
  rooms.push({ id: "room-vip", name: "VIP", isVip: true, hourlyRate: 10, status: "available", startedAt: null, orders: [] });
  return { rooms: rooms, stock: stock, menu: menu, sessions: [], activity: [], cashRecords: [], actualCashInput: 0 };
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---------- Role enforcement ----------
// Looks up the CALLER's role from the Accounts sheet itself — never trusts
// a role value the client claims to have. Throws if the username doesn't
// exist or doesn't have an allowed role.
function requireRole_(username, allowedRoles) {
  if (!username) throw new Error("Missing username");
  const { rows } = accountsRows_();
  const row = rows.find((r) => r[0] === username);
  if (!row) throw new Error("Unknown user: " + username);
  const actualRole = row[2];
  if (allowedRoles.indexOf(actualRole) === -1) {
    throw new Error("Forbidden: '" + username + "' has role '" + actualRole + "', requires " + allowedRoles.join(" or "));
  }
  return actualRole;
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ error: "Invalid JSON body" });
  }

  if (!body.secret || body.secret !== getSecret_()) {
    return json_({ error: "forbidden" });
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    switch (body.action) {
      case "login":
        // No role check — this IS the role check (anyone with valid creds can log in)
        return json_(login_(body.username, body.password));

      case "getAccounts":
        requireRole_(body.username, ["admin"]);
        return json_({ accounts: getAccounts_() });

      case "addAccount":
        requireRole_(body.username, ["admin"]);
        return json_(addAccount_(body.newUsername, body.newPassword, body.newRole));

      case "updateAccount":
     requireRole_(body.username, ["admin"]);
      return json_(updateAccount_(body.originalUsername, {
    username: body.username_new,
    password: body.password,
    role: body.role,
  }));
        
  

      case "deleteAccount":
        requireRole_(body.username, ["admin"]);
        return json_(deleteAccount_(body.targetUsername));

      case "getState":
        // Any logged-in user (admin or cashier) can read state
        requireRole_(body.username, ["admin", "cashier"]);
        return json_({ state: getState_() });

      case "setState":
        // Any logged-in user can write state (checkout, add orders, etc.)
        // NOTE: this does not yet distinguish WHICH part of the state changed —
        // see the note below the code about splitting this into granular actions
        // if you need e.g. "only admins can edit menu prices."
        requireRole_(body.username, ["admin", "cashier"]);
        setState_(body.state);
        return json_({ ok: true });

      default:
        return json_({ error: "Unknown action" });
    }
  } catch (err) {
    return json_({ error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// ---------- Accounts ----------
function accountsRows_() {
  const sheet = getSheet_(ACCOUNTS_SHEET);
  const values = sheet.getDataRange().getValues();
  return { sheet: sheet, rows: values.slice(1) }; // skip header
}

function login_(username, password) {
  const { rows } = accountsRows_();
  const hash = sha256Hex_(String(password || ""));
  for (const row of rows) {
    if (row[0] === username && row[1] === hash) {
      return { ok: true, username: row[0], role: row[2] };
    }
  }
  return { ok: false };
}

function getAccounts_() {
  const { rows } = accountsRows_();
  return rows.filter((r) => r[0]).map((r) => ({ username: r[0], role: r[2] }));
}

function addAccount_(username, password, role) {
  if (!username || !password || !role) return { ok: false, error: "Missing fields" };
  const { sheet, rows } = accountsRows_();
  if (rows.some((r) => r[0] === username)) return { ok: false, error: "Username already exists" };
  sheet.appendRow([username, sha256Hex_(password), role]);
  return { ok: true };
}

function updateAccount_(originalUsername, patch) {
  const { sheet, rows } = accountsRows_();
  const idx = rows.findIndex((r) => r[0] === originalUsername);
  if (idx === -1) return { ok: false, error: "Account not found" };
  const existing = rows[idx];
  const nextUsername = (patch.username && patch.username.trim()) || existing[0];
  if (nextUsername !== existing[0] && rows.some((r) => r[0] === nextUsername)) {
    return { ok: false, error: "Username already exists" };
  }
  const nextHash = patch.password && patch.password.length > 0 ? sha256Hex_(patch.password) : existing[1];
  const nextRole = patch.role || existing[2];
  const rowIndex = idx + 2; // +1 header, +1 1-indexed
  sheet.getRange(rowIndex, 1, 1, 3).setValues([[nextUsername, nextHash, nextRole]]);
  return { ok: true };
}

function deleteAccount_(username) {
  const { sheet, rows } = accountsRows_();
  const idx = rows.findIndex((r) => r[0] === username);
  if (idx === -1) return { ok: false, error: "Account not found" };
  sheet.deleteRow(idx + 2);
  return { ok: true };
}

// ---------- App state ----------
function getState_() {
  const sheet = getSheet_(STATE_SHEET);
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (values[i][0] === "app") {
      try {
        return JSON.parse(values[i][1]);
      } catch (e) {
        return defaultAppState_();
      }
    }
  }
  return defaultAppState_();
}

function setState_(state) {
  const sheet = getSheet_(STATE_SHEET);
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (values[i][0] === "app") {
      sheet.getRange(i + 1, 2).setValue(JSON.stringify(state));
      return;
    }
  }
  sheet.appendRow(["app", JSON.stringify(state)]);
}
