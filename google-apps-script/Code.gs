/**
 * GLITCH Lounge Manager — Apps Script backend.
 *
 * Every mutation (start room, add order, checkout, open/close shift, etc.)
 * is handled ENTIRELY inside a single locked doPost call: read state, apply
 * the change, write state back — all atomically. This is deliberate: if the
 * read and write happened as two separate round trips, two near-simultaneous
 * actions could read stale data and silently clobber each other's writes.
 *
 * Whenever you edit this file, you must create a NEW deployment version
 * (Deploy -> Manage deployments -> pencil icon -> Version: New version -> Deploy)
 * for changes to take effect on the live URL. Just saving is not enough.
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
  return {
    rooms: rooms, stock: stock, menu: menu, sessions: [], activity: [], cashRecords: [],
    actualCashInput: 0, shifts: [], activeShiftId: null,
  };
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

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

// ---------- Business logic (pure-ish functions over the state object) ----------

function pushActivity_(state, message) {
  state.activity = [
    { id: "a-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6), ts: Date.now(), message: message },
    ...state.activity,
  ].slice(0, 100);
  return state;
}

function bizSetRoomRate_(state, roomId, rate) {
  state.rooms = state.rooms.map((r) => (r.id === roomId ? Object.assign({}, r, { hourlyRate: rate }) : r));
  return state;
}

function bizStartRoom_(state, roomId) {
  if (!state.activeShiftId) return { ok: false, error: "No active shift — open a shift before starting a room.", state: state };
  const room = state.rooms.find((r) => r.id === roomId);
  if (!room || room.status === "active") return { ok: true, state: state };
  const now = Date.now();
  state.rooms = state.rooms.map((r) =>
    r.id === roomId ? Object.assign({}, r, { status: "active", startedAt: now, orders: [] }) : r
  );
  pushActivity_(state, room.name + " session started");
  return { ok: true, state: state };
}

function bizCanFulfill_(state, menuItemId, qty) {
  const item = state.menu.find((m) => m.id === menuItemId);
  if (!item) return false;
  return item.ingredients.every((ing) => {
    const stk = state.stock.find((s) => s.id === ing.stockId);
    if (!stk) return false;
    return stk.initialStock - stk.used >= ing.qty * qty;
  });
}

function bizAddOrder_(state, roomId, menuItemId, qty) {
  if (!state.activeShiftId) return { ok: false, error: "No active shift — open a shift before taking orders.", state: state };
  const item = state.menu.find((m) => m.id === menuItemId);
  if (!item) return { ok: false, error: "Item not found", state: state };
  if (!bizCanFulfill_(state, menuItemId, qty)) {
    return { ok: false, error: "Insufficient stock for " + item.name + "!", state: state };
  }
  state.stock = state.stock.map((stk) => {
    const ing = item.ingredients.find((i) => i.stockId === stk.id);
    if (!ing) return stk;
    return Object.assign({}, stk, { used: stk.used + ing.qty * qty });
  });
  const room = state.rooms.find((r) => r.id === roomId);
  state.rooms = state.rooms.map((r) => {
    if (r.id !== roomId) return r;
    const existing = r.orders.find((o) => o.menuItemId === menuItemId);
    const newOrders = existing
      ? r.orders.map((o) => (o.menuItemId === menuItemId ? Object.assign({}, o, { qty: o.qty + qty }) : o))
      : r.orders.concat([{ menuItemId: menuItemId, name: item.name, qty: qty, price: item.price }]);
    return Object.assign({}, r, { orders: newOrders });
  });
  pushActivity_(state, (room ? room.name : "Room") + " added " + qty + "x " + item.name);
  return { ok: true, state: state };
}

// Sets an order line to an EXACT qty (not incremented). qty <= 0 removes the
// line entirely. Adjusts stock.used by the delta, refunding stock if the
// qty went down. Lets a cashier/admin fix a mis-added item before checkout.
function bizSetOrderLineQty_(state, roomId, menuItemId, qty) {
  const room = state.rooms.find((r) => r.id === roomId);
  if (!room) return { ok: false, error: "Room not found", state: state };
  const line = room.orders.find((o) => o.menuItemId === menuItemId);
  if (!line) return { ok: false, error: "Item not on this check", state: state };
  const item = state.menu.find((m) => m.id === menuItemId);
  const oldQty = line.qty;
  const newQty = Math.max(0, Math.floor(qty));
  const delta = newQty - oldQty;

  if (delta > 0 && item && !bizCanFulfill_(state, menuItemId, delta)) {
    return { ok: false, error: "Insufficient stock to increase " + item.name, state: state };
  }

  if (item) {
    state.stock = state.stock.map((stk) => {
      const ing = item.ingredients.find((i) => i.stockId === stk.id);
      if (!ing) return stk;
      return Object.assign({}, stk, { used: Math.max(0, stk.used + ing.qty * delta) });
    });
  }

  state.rooms = state.rooms.map((r) => {
    if (r.id !== roomId) return r;
    const orders = newQty <= 0
      ? r.orders.filter((o) => o.menuItemId !== menuItemId)
      : r.orders.map((o) => (o.menuItemId === menuItemId ? Object.assign({}, o, { qty: newQty }) : o));
    return Object.assign({}, r, { orders: orders });
  });

  pushActivity_(
    state,
    room.name + ": " + (newQty <= 0 ? "removed " + line.name : "set " + line.name + " to x" + newQty),
  );
  return { ok: true, state: state };
}

function bizEndRoom_(state, roomId, splitBill, paymentMethod) {
  const room = state.rooms.find((r) => r.id === roomId);
  if (!room || room.status !== "active" || !room.startedAt) return { session: null, state: state };
  const endedAt = Date.now();
  const durationSec = Math.max(1, Math.floor((endedAt - room.startedAt) / 1000));
  const timeCost = (durationSec / 3600) * room.hourlyRate;
  const ordersCost = room.orders.reduce((a, o) => a + o.qty * o.price, 0);
  const total = timeCost + ordersCost;
  const session = {
    id: "sess-" + endedAt,
    roomId: room.id,
    roomName: room.name,
    startedAt: room.startedAt,
    endedAt: endedAt,
    durationSec: durationSec,
    timeCost: timeCost,
    orders: room.orders,
    ordersCost: ordersCost,
    total: total,
    splitBill: !!splitBill,
    paymentMethod: paymentMethod === "visa" ? "visa" : "cash",
    shiftId: state.activeShiftId || null,
  };
  state.rooms = state.rooms.map((r) =>
    r.id === roomId ? Object.assign({}, r, { status: "available", startedAt: null, orders: [] }) : r
  );
  state.sessions = [session].concat(state.sessions);
  pushActivity_(state, room.name + " checked out - $" + total.toFixed(2) + " collected (" + session.paymentMethod + ")");
  return { session: session, state: state };
}

function bizUpdateStockItem_(state, id, patch) {
  state.stock = state.stock.map((x) => (x.id === id ? Object.assign({}, x, patch) : x));
  return state;
}
function bizAddStockItem_(state, item) {
  state.stock = state.stock.concat([Object.assign({}, item, { used: 0 })]);
  return state;
}
function bizDeleteStockItem_(state, id) {
  state.stock = state.stock.filter((x) => x.id !== id);
  return state;
}
function bizRestockAll_(state) {
  state.stock = state.stock.map((x) => Object.assign({}, x, { used: 0 }));
  return pushActivity_(state, "Stock fully restocked");
}
function bizAddMenuItem_(state, item) {
  state.menu = state.menu.concat([item]);
  return state;
}
function bizUpdateMenuItem_(state, id, patch) {
  state.menu = state.menu.map((x) => (x.id === id ? Object.assign({}, x, patch) : x));
  return state;
}
function bizDeleteMenuItem_(state, id) {
  state.menu = state.menu.filter((x) => x.id !== id);
  return state;
}
function bizSetActualCash_(state, n) {
  state.actualCashInput = n;
  return state;
}

// ---------- Shifts ----------

function bizOpenShift_(state, username, openingBalance) {
  if (state.activeShiftId) return { ok: false, error: "A shift is already open", state: state };
  const id = "shift-" + Date.now();
  const shift = {
    id: id,
    cashierUsername: username,
    openedAt: Date.now(),
    closedAt: null,
    openingBalance: openingBalance || 0,
    closingActualCash: null,
    expectedCash: null,
    discrepancy: null,
    forced: false,
  };
  state.shifts = [shift].concat(state.shifts);
  state.activeShiftId = id;
  state.actualCashInput = 0;
  pushActivity_(state, username + " opened a shift (opening balance $" + (openingBalance || 0).toFixed(2) + ")");
  return { ok: true, state: state };
}

// Closes the currently active shift. `forced` = true means this came from
// the admin emergency-reset path rather than a cashier's normal End Shift.
function bizCloseActiveShift_(state, actualCash, forced) {
  if (!state.activeShiftId) return { ok: false, error: "No active shift to close", state: state };
  const shiftId = state.activeShiftId;
  const shiftSessions = state.sessions.filter((s) => s.shiftId === shiftId);
  const expectedCash = shiftSessions
    .filter((s) => s.paymentMethod === "cash")
    .reduce((a, s) => a + s.total, 0);
  const closingActualCash = typeof actualCash === "number" ? actualCash : (state.actualCashInput || 0);
  const discrepancy = closingActualCash - expectedCash;

  state.shifts = state.shifts.map((sh) =>
    sh.id === shiftId
      ? Object.assign({}, sh, {
          closedAt: Date.now(),
          closingActualCash: closingActualCash,
          expectedCash: expectedCash,
          discrepancy: discrepancy,
          forced: !!forced,
        })
      : sh
  );
  state.activeShiftId = null;
  state.actualCashInput = 0;
  pushActivity_(
    state,
    (forced ? "Admin force-closed shift" : "Shift closed") +
      " — expected $" + expectedCash.toFixed(2) + ", counted $" + closingActualCash.toFixed(2),
  );
  return { ok: true, state: state };
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
  lock.waitLock(30000);
  try {
    switch (body.action) {
      case "login":
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
        requireRole_(body.username, ["admin", "cashier"]);
        return json_({ state: getState_() });

      // ---- Atomic business actions: read + mutate + write in ONE locked call ----

      case "setRoomRate": {
        requireRole_(body.username, ["admin"]);
        const state = bizSetRoomRate_(getState_(), body.roomId, body.rate);
        setState_(state);
        return json_({ state: state });
      }
      case "startRoom": {
        requireRole_(body.username, ["admin", "cashier"]);
        const result = bizStartRoom_(getState_(), body.roomId);
        if (result.ok) setState_(result.state);
        return json_({ ok: result.ok, error: result.error || null, state: result.state });
      }
      case "endRoom": {
        requireRole_(body.username, ["admin", "cashier"]);
        const result = bizEndRoom_(getState_(), body.roomId, body.splitBill, body.paymentMethod);
        if (result.session) setState_(result.state);
        return json_({ session: result.session, state: result.state });
      }
      case "addOrder": {
        requireRole_(body.username, ["admin", "cashier"]);
        const result = bizAddOrder_(getState_(), body.roomId, body.menuItemId, body.qty);
        if (result.ok) setState_(result.state);
        return json_({ ok: result.ok, error: result.error || null, state: result.state });
      }
      case "setOrderLineQty": {
        requireRole_(body.username, ["admin", "cashier"]);
        const result = bizSetOrderLineQty_(getState_(), body.roomId, body.menuItemId, body.qty);
        if (result.ok) setState_(result.state);
        return json_({ ok: result.ok, error: result.error || null, state: result.state });
      }
      case "updateStockItem": {
        requireRole_(body.username, ["admin"]);
        const state = bizUpdateStockItem_(getState_(), body.id, body.patch);
        setState_(state);
        return json_({ state: state });
      }
      case "addStockItem": {
        requireRole_(body.username, ["admin"]);
        const state = bizAddStockItem_(getState_(), body.item);
        setState_(state);
        return json_({ state: state });
      }
      case "deleteStockItem": {
        requireRole_(body.username, ["admin"]);
        const state = bizDeleteStockItem_(getState_(), body.id);
        setState_(state);
        return json_({ state: state });
      }
      case "restockAll": {
        requireRole_(body.username, ["admin"]);
        const state = bizRestockAll_(getState_());
        setState_(state);
        return json_({ state: state });
      }
      case "addMenuItem": {
        requireRole_(body.username, ["admin"]);
        const state = bizAddMenuItem_(getState_(), body.item);
        setState_(state);
        return json_({ state: state });
      }
      case "updateMenuItem": {
        requireRole_(body.username, ["admin"]);
        const state = bizUpdateMenuItem_(getState_(), body.id, body.patch);
        setState_(state);
        return json_({ state: state });
      }
      case "deleteMenuItem": {
        requireRole_(body.username, ["admin"]);
        const state = bizDeleteMenuItem_(getState_(), body.id);
        setState_(state);
        return json_({ state: state });
      }
      case "setActualCash": {
        requireRole_(body.username, ["admin", "cashier"]);
        const state = bizSetActualCash_(getState_(), body.amount);
        setState_(state);
        return json_({ state: state });
      }
      case "openShift": {
        requireRole_(body.username, ["admin", "cashier"]);
        const result = bizOpenShift_(getState_(), body.username, body.openingBalance);
        if (result.ok) setState_(result.state);
        return json_({ ok: result.ok, error: result.error || null, state: result.state });
      }
      case "endShift": {
        requireRole_(body.username, ["admin", "cashier"]);
        const result = bizCloseActiveShift_(getState_(), body.actualCash, false);
        if (result.ok) setState_(result.state);
        return json_({ ok: result.ok, error: result.error || null, state: result.state });
      }
      case "forceEndShift": {
        // Emergency override — admin only. Closes whatever shift is active
        // right now (if any) so the live counters go back to zero, without
        // requiring the cashier to be present to confirm a cash count.
        requireRole_(body.username, ["admin"]);
        const state = getState_();
        if (!state.activeShiftId) return json_({ ok: true, state: state });
        const result = bizCloseActiveShift_(state, body.actualCash, true);
        setState_(result.state);
        return json_({ ok: true, state: result.state });
      }

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
  return { sheet: sheet, rows: values.slice(1) };
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
  const rowIndex = idx + 2;
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
        const parsed = JSON.parse(values[i][1]);
        // Backfill fields for states saved before shifts existed.
        if (!parsed.shifts) parsed.shifts = [];
        if (parsed.activeShiftId === undefined) parsed.activeShiftId = null;
        return parsed;
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
