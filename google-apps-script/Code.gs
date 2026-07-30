/**
 * GLITCH Lounge Manager — Apps Script backend.
 *
 * Two storage strategies are used deliberately:
 *  - AppState (rooms/stock-view/menu/sessions/shifts) stays as one JSON
 *    blob in a single cell — it's small and bounded.
 *  - RawMaterials / Suppliers / RecurringExpenses / Batches / Ledger are
 *    real rows in their own sheet tabs. A financial ledger grows forever,
 *    and a single Sheet cell caps out at 50,000 characters — row storage
 *    is the only sane way to keep an ever-growing ledger.
 *
 * FIFO costing: raw material purchases are logged as Batches (qty + unit
 * cost + purchase date). When a room is checked out, ingredient usage for
 * everything ordered is consumed from the OLDEST batch with stock left
 * first, and the actual cost paid for those units becomes the session's
 * COGS. Stock is NOT deducted at order-add time — only reserved (checked
 * against pending orders across all rooms) — so editing a live order
 * before checkout never needs to "refund" anything.
 *
 * Anti-theft: any purchase/expense a CASHIER submits is logged as
 * `pending` and has ZERO effect on inventory or cash until an admin
 * explicitly approves it. Admin-submitted entries are auto-approved.
 * A receipt photo (uploaded to Drive) is mandatory to submit at all.
 *
 * Whenever you edit this file, you must create a NEW deployment version
 * (Deploy -> Manage deployments -> pencil icon -> Version: New version -> Deploy)
 * for changes to take effect on the live URL. Just saving is not enough.
 */

const ACCOUNTS_SHEET = "Accounts";
const STATE_SHEET = "AppState";
const RECEIPTS_FOLDER = "GLITCH Receipts";

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

function newId_(prefix) {
  return prefix + "-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7);
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

  ["RawMaterials", "Suppliers", "RecurringExpenses", "Batches", "Ledger", "VoidRequests", "ActivityLogs", "Sessions", "Shifts", "StaffOrders"].forEach(function (name) {
    const sheet = getSheet_(name);
    sheet.clear();
    sheet.appendRow(sheetObjectHeaders_(name));
  });

  // Seed raw materials matching the old built-in stock list, and a couple
  // of starter batches so the shop has usable stock on first run.
  const materials = [
    { id: "coffee", name: "Coffee Beans", unit: "g", minStockAlert: 300 },
    { id: "milk", name: "Milk", unit: "ml", minStockAlert: 800 },
    { id: "sugar", name: "Sugar", unit: "g", minStockAlert: 200 },
    { id: "cups", name: "Paper Cups", unit: "pcs", minStockAlert: 40 },
    { id: "soda", name: "Soda Cans", unit: "pcs", minStockAlert: 20 },
    { id: "chips", name: "Potato Chips", unit: "pcs", minStockAlert: 15 },
  ];
  materials.forEach(function (m) { appendObject_("RawMaterials", m); });

  const now = Date.now();
  const starterBatches = [
    { id: newId_("batch"), materialId: "coffee", supplierId: null, qtyPurchased: 2000, qtyRemaining: 2000, unitCost: 0.02, purchasedAt: now, source: "stockedBatch" },
    { id: newId_("batch"), materialId: "milk", supplierId: null, qtyPurchased: 5000, qtyRemaining: 5000, unitCost: 0.01, purchasedAt: now, source: "stockedBatch" },
    { id: newId_("batch"), materialId: "sugar", supplierId: null, qtyPurchased: 1500, qtyRemaining: 1500, unitCost: 0.01, purchasedAt: now, source: "stockedBatch" },
    { id: newId_("batch"), materialId: "cups", supplierId: null, qtyPurchased: 200, qtyRemaining: 200, unitCost: 0.5, purchasedAt: now, source: "stockedBatch" },
    { id: newId_("batch"), materialId: "soda", supplierId: null, qtyPurchased: 100, qtyRemaining: 100, unitCost: 0.8, purchasedAt: now, source: "stockedBatch" },
    { id: newId_("batch"), materialId: "chips", supplierId: null, qtyPurchased: 80, qtyRemaining: 80, unitCost: 0.6, purchasedAt: now, source: "stockedBatch" },
  ];
  starterBatches.forEach(function (b) { appendObject_("Batches", b); });
}

function defaultAppState_() {
  const menu = [
    { id: "latte", name: "Latte", price: 4.5, category: "Hot Drinks", ingredients: [{ stockId: "coffee", qty: 18 }, { stockId: "milk", qty: 200 }, { stockId: "cups", qty: 1 }] },
    { id: "espresso", name: "Espresso", price: 3.0, category: "Hot Drinks", ingredients: [{ stockId: "coffee", qty: 18 }, { stockId: "cups", qty: 1 }] },
    { id: "soda-drink", name: "Soda", price: 2.5, category: "Soft Drinks", ingredients: [{ stockId: "soda", qty: 1 }] },
    { id: "chips-snack", name: "Chips", price: 2.0, category: "Extras", ingredients: [{ stockId: "chips", qty: 1 }] },
  ];
  const rooms = [];
  for (let i = 1; i <= 8; i++) {
    rooms.push({ id: "room-" + i, name: "Room " + i, isVip: false, hourlyRate: 0, singleRate: 5, multiRate: 8, rateMode: null, status: "available", startedAt: null, orders: [], zone: "room", splitInvoiceNumber: null, transferredFrom: null, isOwnerTable: false, isPaused: false, pausedAt: null, pausedDurationSec: 0 });
  }
  rooms.push({ id: "room-vip", name: "VIP", isVip: true, hourlyRate: 0, singleRate: 10, multiRate: 15, rateMode: null, status: "available", startedAt: null, orders: [], zone: "room", splitInvoiceNumber: null, transferredFrom: null, isOwnerTable: false, isPaused: false, pausedAt: null, pausedDurationSec: 0 });
  for (let i = 1; i <= 4; i++) {
    rooms.push({ id: "lounge-" + i, name: "Lounge Table " + i, isVip: false, hourlyRate: 0, singleRate: 0, multiRate: 0, rateMode: null, status: "available", startedAt: null, orders: [], zone: "lounge", splitInvoiceNumber: null, transferredFrom: null, isOwnerTable: false, isPaused: false, pausedAt: null, pausedDurationSec: 0 });
  }
  for (let i = 1; i <= 6; i++) {
    rooms.push({ id: "owner-" + i, name: "Owner Table " + i, isVip: false, hourlyRate: 0, singleRate: 0, multiRate: 0, rateMode: null, status: "available", startedAt: null, orders: [], zone: "lounge", splitInvoiceNumber: null, transferredFrom: null, isOwnerTable: true, isPaused: false, pausedAt: null, pausedDurationSec: 0 });
  }
  return {
    rooms: rooms, menu: menu, sessions: [], activity: [], cashRecords: [],
    actualCashInput: 0, shifts: [], activeShiftId: null, fraudThresholdPercent: 2,
    geofenceEnabled: false, cafeLat: 0, cafeLng: 0, geofenceRadiusMeters: 50,
  };
}

// Great-circle distance in meters between two lat/lng points.
function haversineMeters_(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = function (d) { return (d * Math.PI) / 180; };
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Returns an error string if the coords fail the geofence check, else null.
// Skipped entirely if the admin hasn't enabled/configured a real location yet.
function checkGeofence_(state, lat, lng) {
  if (!state.geofenceEnabled) return null;
  if (typeof lat !== "number" || typeof lng !== "number") {
    return "Location is required to open or close a shift.";
  }
  const distance = haversineMeters_(state.cafeLat, state.cafeLng, lat, lng);
  if (distance > state.geofenceRadiusMeters) {
    return "Access Denied: You must be physically present at the venue to open/close a shift.";
  }
  return null;
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

// ---------- Generic row-object storage for the financial sheets ----------

function sheetObjectHeaders_(name) {
  const map = {
    RawMaterials: ["id", "name", "unit", "minStockAlert"],
    Suppliers: ["id", "name", "contact", "category"],
    RecurringExpenses: ["id", "name", "amount", "active"],
    Batches: ["id", "materialId", "supplierId", "qtyPurchased", "qtyRemaining", "unitCost", "purchasedAt", "source"],
    Ledger: ["id", "ts", "amount", "direction", "type", "category", "description", "supplierId", "staffUsername", "status", "receiptUrl", "paidFromDrawer", "shiftId", "materialId", "qty", "unitCost"],
    VoidRequests: ["id", "ts", "roomId", "roomName", "menuItemId", "itemName", "qty", "unitPrice", "billValue", "reason", "status", "cashierUsername", "waiterName", "shiftId", "approvedBy", "approvedAt", "cogs", "applied", "applyError"],
    ActivityLogs: ["id", "ts", "actorUsername", "actorRole", "actionType", "location", "riskLevel", "description", "before", "after", "shiftId"],
    Sessions: ["id", "roomId", "roomName", "startedAt", "endedAt", "durationSec", "timeCost", "orders", "ordersCost", "total", "cogs", "discountAmount", "discountLabel", "splitBill", "paymentMethod", "cashAmount", "visaAmount", "instapayAmount", "shiftId"],
    Shifts: ["id", "cashierUsername", "openedAt", "closedAt", "openingBalance", "closingActualCash", "expectedCash", "discrepancy", "forced", "openedLat", "openedLng", "closedLat", "closedLng"],
    StaffOrders: ["id", "ts", "staffName", "items", "totalAmount", "cogs", "processedBy", "shiftId"],
  };
  return map[name];
}

// Sessions carry an `orders` array, which the generic row helpers can't
// serialize on their own — JSON-encode/decode just that one field. A
// single session's own JSON is small (one order list), nowhere near the
// per-cell limit that broke the old single-blob-holds-everything design.
function sessionToRow_(s) {
  return {
    id: s.id, roomId: s.roomId, roomName: s.roomName, startedAt: s.startedAt, endedAt: s.endedAt,
    durationSec: s.durationSec, timeCost: s.timeCost, orders: JSON.stringify(s.orders || []),
    ordersCost: s.ordersCost, total: s.total, cogs: s.cogs,
    discountAmount: s.discountAmount || 0, discountLabel: s.discountLabel || null,
    splitBill: !!s.splitBill,
    paymentMethod: s.paymentMethod, cashAmount: s.cashAmount, visaAmount: s.visaAmount,
    instapayAmount: s.instapayAmount, shiftId: s.shiftId,
  };
}
function rowToSession_(r) {
  let orders = [];
  try { orders = JSON.parse(r.orders || "[]"); } catch (e) { orders = []; }
  return Object.assign({}, r, {
    orders: orders, splitBill: !!r.splitBill,
    discountAmount: Number(r.discountAmount) || 0, discountLabel: r.discountLabel || null,
  });
}
function readSessions_() {
  return readObjects_("Sessions").map(rowToSession_).sort((a, b) => b.endedAt - a.endedAt);
}
function appendSessionRow_(s) {
  appendObject_("Sessions", sessionToRow_(s));
}
function readShifts_() {
  return readObjects_("Shifts")
    .map(function (r) { return Object.assign({}, r, { forced: !!r.forced }); })
    .sort(function (a, b) { return b.openedAt - a.openedAt; });
}
function staffOrderToRow_(o) {
  return {
    id: o.id, ts: o.ts, staffName: o.staffName, items: JSON.stringify(o.items || []),
    totalAmount: o.totalAmount, cogs: o.cogs, processedBy: o.processedBy, shiftId: o.shiftId,
  };
}
function rowToStaffOrder_(r) {
  let items = [];
  try { items = JSON.parse(r.items || "[]"); } catch (e) { items = []; }
  return Object.assign({}, r, { items: items });
}
function readStaffOrders_() {
  return readObjects_("StaffOrders").map(rowToStaffOrder_).sort(function (a, b) { return b.ts - a.ts; });
}

// Each void reason carries its own inventory/ledger consequence, per spec.
// "Wrong Input" never touches inventory (nothing was made yet). The other
// three consume ingredients via FIFO — the item WAS made — and route the
// resulting cost to a distinct admin-visible ledger category rather than
// counting it as lost menu-price revenue (which was never earned).
const VOID_REASONS = {
  wrongInput: { label: "Wrong Input (Before Preparation)", deductsInventory: false, ledgerCategory: null },
  spilled: { label: "Spilled / Damaged by Staff", deductsInventory: true, ledgerCategory: "Operational Waste / Damaged Goods" },
  customerRejected: { label: "Customer Rejected (Taste/Quality)", deductsInventory: true, ledgerCategory: "Customer Satisfaction Waste" },
  complimentary: { label: "Complimentary / VIP Gift (Free)", deductsInventory: true, ledgerCategory: "Marketing & Hospitality (Comps)" },
};

function ensureHeaders_(sheet, headers) {
  if (sheet.getLastRow() === 0) sheet.appendRow(headers);
}

function readObjects_(sheetName) {
  const headers = sheetObjectHeaders_(sheetName);
  const sheet = getSheet_(sheetName);
  ensureHeaders_(sheet, headers);
  const values = sheet.getDataRange().getValues();
  const rows = values.slice(1);
  return rows.filter((r) => r[0] !== "" && r[0] !== null).map((r) => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = r[i] === "" ? null : r[i]; });
    return obj;
  });
}

function appendObject_(sheetName, obj) {
  const headers = sheetObjectHeaders_(sheetName);
  const sheet = getSheet_(sheetName);
  ensureHeaders_(sheet, headers);
  sheet.appendRow(headers.map((h) => (obj[h] === undefined || obj[h] === null ? "" : obj[h])));
}

function findRowIndexById_(sheet, id) {
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (values[i][0] === id) return i + 1; // 1-indexed sheet row
  }
  return -1;
}

function updateObjectById_(sheetName, id, patch) {
  const headers = sheetObjectHeaders_(sheetName);
  const sheet = getSheet_(sheetName);
  const rowIdx = findRowIndexById_(sheet, id);
  if (rowIdx === -1) return false;
  const current = sheet.getRange(rowIdx, 1, 1, headers.length).getValues()[0];
  const merged = headers.map((h, i) => (patch[h] !== undefined ? (patch[h] === null ? "" : patch[h]) : current[i]));
  sheet.getRange(rowIdx, 1, 1, headers.length).setValues([merged]);
  return true;
}

function deleteObjectById_(sheetName, id) {
  const sheet = getSheet_(sheetName);
  const rowIdx = findRowIndexById_(sheet, id);
  if (rowIdx === -1) return false;
  sheet.deleteRow(rowIdx);
  return true;
}

// ---------- Receipts (Google Drive) ----------

function receiptsFolder_() {
  const folders = DriveApp.getFoldersByName(RECEIPTS_FOLDER);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(RECEIPTS_FOLDER);
}

// Deliberately NOT under the script lock — Drive I/O is slow and shouldn't
// stall unrelated requests (room orders, logins, etc.) while it runs.
function uploadReceipt_(base64Data, mimeType, filename) {
  const folder = receiptsFolder_();
  const blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType || "image/jpeg", filename);
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}

// ---------- Activity Log — The Black Box ----------
// Write-Once, Read-Many. There is no updateActivityLog / deleteActivityLog
// function anywhere in this file, and there must never be one — that
// omission IS the immutability guarantee at the application level. (A
// person with direct edit access to the underlying Google Sheet could
// still hand-edit a cell; that's a limitation of Sheets as a datastore,
// not something any app-level code can prevent.)
const ACTION_RISK = {
  LOGIN_SUCCESS: "green", LOGIN_FAILED: "red",
  START_SHIFT: "green", END_SHIFT: "green", FORCE_END_SHIFT: "yellow",
  GEOFENCE_DENIED: "red",
  ROOM_STARTED: "green", ITEM_ADDED: "green", ITEM_QTY_CHANGED: "green", ITEM_NOTE_SET: "green",
  ROOM_PAUSED: "green", ROOM_RESUMED: "green",
  CHECKOUT: "green", CHECKOUT_SPLIT_BILL: "yellow",
  VOID_REQUESTED: "red", VOID_APPROVED: "red", VOID_DENIED: "yellow",
  EXPENSE_LOGGED: "yellow", EXPENSE_APPROVED: "yellow", EXPENSE_REJECTED: "yellow",
  RECURRING_EXPENSE_PAID: "yellow",
  ROOM_RATE_CHANGED: "red", MENU_PRICE_CHANGED: "red",
  SESSION_TRANSFERRED: "yellow", SPLIT_INTERFACE_OPENED: "yellow", SESSION_SPLIT: "yellow",
  ACCOUNT_CREATED: "yellow", ACCOUNT_ROLE_CHANGED: "red", ACCOUNT_PASSWORD_CHANGED: "yellow", ACCOUNT_DELETED: "red",
  RAW_MATERIAL_COST_CONTEXT: "yellow", SUPPLIER_CHANGED: "yellow", STOCK_ADJUSTED: "yellow",
  MENU_CATALOG_IMPORTED: "yellow", STAFF_ORDER_LOGGED: "yellow",
  FRAUD_THRESHOLD_CHANGED: "yellow", GEOFENCE_CONFIG_CHANGED: "yellow",
};
function riskFor_(actionType) {
  return ACTION_RISK[actionType] || "green";
}

// `before`/`after` should be small plain objects (or omitted) — they get
// JSON.stringify'd here. `location` is free text: a room name, shift id,
// or similar human-readable context for where the action happened.
function logActivity_(params) {
  appendObject_("ActivityLogs", {
    id: newId_("log"),
    ts: params.ts || Date.now(),
    actorUsername: params.actorUsername || "unknown",
    actorRole: params.actorRole || "unknown",
    actionType: params.actionType,
    location: params.location || "",
    riskLevel: params.riskLevel || riskFor_(params.actionType),
    description: params.description || "",
    before: params.before !== undefined ? JSON.stringify(params.before) : "",
    after: params.after !== undefined ? JSON.stringify(params.after) : "",
    shiftId: params.shiftId || null,
  });
}

// Best-effort role lookup for logging purposes (doesn't throw on unknown user).
function roleForUsername_(username) {
  const { rows } = accountsRows_();
  const row = rows.find((r) => r[0] === username);
  return row ? row[2] : "unknown";
}

// ---------- Business logic (pure-ish functions over the state object) ----------

function pushActivity_(state, message) {
  state.activity = [
    { id: "a-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6), ts: Date.now(), message: message },
    ...state.activity,
  ].slice(0, 100);
  return state;
}

function bizSetRoomRate_(state, roomId, singleRate, multiRate) {
  state.rooms = state.rooms.map((r) => (r.id === roomId ? Object.assign({}, r, { singleRate: singleRate, multiRate: multiRate }) : r));
  return state;
}

function bizRenameRoom_(state, roomId, name) {
  const trimmed = (name || "").trim();
  if (!trimmed) return { ok: false, error: "Name cannot be empty", state: state };
  state.rooms = state.rooms.map((r) => (r.id === roomId ? Object.assign({}, r, { name: trimmed }) : r));
  return { ok: true, state: state };
}

function bizStartRoom_(state, roomId, rateMode) {
  if (!state.activeShiftId) return { ok: false, error: "No active shift — open a shift before starting a room.", state: state };
  const room = state.rooms.find((r) => r.id === roomId);
  if (!room || room.status === "active") return { ok: true, state: state };
  let hourlyRate = 0;
  let mode = null;
  if (room.zone === "room") {
    if (rateMode !== "single" && rateMode !== "multi") {
      return { ok: false, error: "Select a Single or Multi rate to start this room.", state: state };
    }
    hourlyRate = rateMode === "single" ? room.singleRate : room.multiRate;
    mode = rateMode;
  }
  const now = Date.now();
  state.rooms = state.rooms.map((r) =>
    r.id === roomId ? Object.assign({}, r, { status: "active", startedAt: now, orders: [], hourlyRate: hourlyRate, rateMode: mode }) : r
  );
  pushActivity_(state, room.name + " session started" + (mode ? " (" + mode + " @ $" + hourlyRate + "/hr)" : ""));
  return { ok: true, state: state };
}

// Sum of qtyRemaining across every batch of a material — the raw physical
// stock on hand, untouched by orders that haven't been checked out yet.
function materialRemaining_(batches, materialId) {
  return batches.filter((b) => b.materialId === materialId).reduce((a, b) => a + (Number(b.qtyRemaining) || 0), 0);
}

// Ingredient qty already committed to orders sitting in ALL currently
// active rooms (not yet checked out, so batches haven't been touched yet).
function materialReserved_(rooms, menu, materialId) {
  let total = 0;
  rooms.forEach((room) => {
    room.orders.forEach((o) => {
      const item = menu.find((m) => m.id === o.menuItemId);
      if (!item) return;
      item.ingredients.forEach((ing) => {
        if (ing.stockId === materialId) total += ing.qty * o.qty;
      });
    });
  });
  return total;
}

function bizCanFulfill_(state, batches, menuItemId, addQty) {
  const item = state.menu.find((m) => m.id === menuItemId);
  if (!item) return false;
  return item.ingredients.every((ing) => {
    const remaining = materialRemaining_(batches, ing.stockId);
    const reserved = materialReserved_(state.rooms, state.menu, ing.stockId);
    return remaining - reserved - ing.qty * addQty >= -1e-9;
  });
}

function bizAddOrder_(state, batches, roomId, menuItemId, qty) {
  if (!state.activeShiftId) return { ok: false, error: "No active shift — open a shift before taking orders.", state: state };
  const item = state.menu.find((m) => m.id === menuItemId);
  if (!item) return { ok: false, error: "Item not found", state: state };
  if (!bizCanFulfill_(state, batches, menuItemId, qty)) {
    return { ok: false, error: "Insufficient stock for " + item.name + "!", state: state };
  }
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

// Sets an order line to an EXACT qty (0 removes it). Increasing re-checks
// availability against reservations; decreasing is always allowed since
// nothing was ever deducted from batches yet.
function bizSetOrderLineQty_(state, batches, roomId, menuItemId, qty) {
  const room = state.rooms.find((r) => r.id === roomId);
  if (!room) return { ok: false, error: "Room not found", state: state };
  const line = room.orders.find((o) => o.menuItemId === menuItemId);
  if (!line) return { ok: false, error: "Item not on this check", state: state };
  const item = state.menu.find((m) => m.id === menuItemId);
  const newQty = Math.max(0, Math.floor(qty));
  const delta = newQty - line.qty;

  if (delta > 0 && item && !bizCanFulfill_(state, batches, menuItemId, delta)) {
    return { ok: false, error: "Insufficient stock to increase " + item.name, state: state };
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

// Sets/clears the barista prep note on a specific order line (e.g. "Extra
// Sugar", "Skimmed Milk"). Pure metadata — no stock or pricing effect.
function bizSetOrderLineNote_(state, roomId, menuItemId, notes) {
  const room = state.rooms.find((r) => r.id === roomId);
  if (!room) return { ok: false, error: "Room not found", state: state };
  const line = room.orders.find((o) => o.menuItemId === menuItemId);
  if (!line) return { ok: false, error: "Item not on this check", state: state };
  const trimmed = (notes || "").trim();
  state.rooms = state.rooms.map((r) => {
    if (r.id !== roomId) return r;
    return Object.assign({}, r, {
      orders: r.orders.map((o) => (o.menuItemId === menuItemId ? Object.assign({}, o, { notes: trimmed }) : o)),
    });
  });
  return { ok: true, state: state };
}

// Consumes qtyNeeded of a material from the OLDEST batch with stock left
// first (true FIFO), mutating `batches` in place. Returns the real cost of
// what was consumed and which batch ids changed (so only those get written
// back to the sheet).
function consumeFifo_(batches, materialId, qtyNeeded) {
  const relevant = batches
    .filter((b) => b.materialId === materialId && b.qtyRemaining > 0)
    .sort((a, b) => a.purchasedAt - b.purchasedAt);
  let remaining = qtyNeeded;
  let cost = 0;
  const touched = [];
  for (const b of relevant) {
    if (remaining <= 0) break;
    const take = Math.min(b.qtyRemaining, remaining);
    b.qtyRemaining = Math.round((b.qtyRemaining - take) * 1e6) / 1e6;
    cost += take * b.unitCost;
    remaining -= take;
    touched.push(b.id);
  }
  return { cost: cost, shortfall: remaining, touched: touched };
}

const PAYMENT_METHODS = ["cash", "visa", "mixed_cash_visa", "mixed_cash_instapay"];

// Effective elapsed seconds since the room started, EXCLUDING all paused
// time (past pauses already accumulated in pausedDurationSec, plus the
// currently-in-progress pause if it's paused right now). This is the ONE
// place duration is computed from, so pausing genuinely stops billing
// everywhere: checkout, transfers, and split payments alike.
function effectiveDurationSec_(room, atTime) {
  if (!room.startedAt) return 0;
  const raw = (atTime - room.startedAt) / 1000;
  const pausedSoFar = (room.pausedDurationSec || 0) + (room.isPaused && room.pausedAt ? (atTime - room.pausedAt) / 1000 : 0);
  return Math.max(0, raw - pausedSoFar);
}

function bizPauseRoom_(state, roomId) {
  const room = state.rooms.find((r) => r.id === roomId);
  if (!room) return { ok: false, error: "Room not found", state: state };
  if (room.status !== "active") return { ok: false, error: "Room is not active", state: state };
  if (room.isPaused) return { ok: true, state: state };
  state.rooms = state.rooms.map((r) => (r.id === roomId ? Object.assign({}, r, { isPaused: true, pausedAt: Date.now() }) : r));
  pushActivity_(state, room.name + " session paused");
  return { ok: true, state: state };
}

function bizResumeRoom_(state, roomId) {
  const room = state.rooms.find((r) => r.id === roomId);
  if (!room) return { ok: false, error: "Room not found", state: state };
  if (!room.isPaused) return { ok: true, state: state };
  const now = Date.now();
  const addedPause = room.pausedAt ? (now - room.pausedAt) / 1000 : 0;
  state.rooms = state.rooms.map((r) =>
    r.id === roomId ? Object.assign({}, r, { isPaused: false, pausedAt: null, pausedDurationSec: (r.pausedDurationSec || 0) + addedPause }) : r
  );
  pushActivity_(state, room.name + " session resumed");
  return { ok: true, state: state };
}

function bizEndRoom_(state, batches, roomId, splitBill, paymentMethod, cashAmountInput, secondaryAmountInput, frozenAt) {
  const room = state.rooms.find((r) => r.id === roomId);
  if (!room || room.status !== "active" || !room.startedAt) return { session: null, state: state, touchedBatchIds: [], error: null };
  // If the client froze the moment "End Order" was clicked, honor that
  // instead of Date.now() — otherwise the customer would keep accruing
  // time charges for however long the cashier takes to fill in payment
  // details. Clamp to a sane range (can't be before the room started or
  // in the future) so a bad/stale value can't be exploited either way.
  const now = Date.now();
  const endedAt = (typeof frozenAt === "number" && frozenAt >= room.startedAt && frozenAt <= now) ? frozenAt : now;
  const durationSec = Math.max(1, Math.floor(effectiveDurationSec_(room, endedAt)));
  const timeCost = (durationSec / 3600) * room.hourlyRate;
  const ordersCost = room.orders.reduce((a, o) => a + o.qty * o.price, 0);
  const preDiscountTotal = timeCost + ordersCost;
  // Owners Tables get an automatic, non-negotiable 25% discount on every
  // checkout — itemized on the receipt, never silently folded into prices.
  const discountAmount = room.isOwnerTable ? Math.round(preDiscountTotal * 0.25 * 100) / 100 : 0;
  const discountLabel = room.isOwnerTable ? "Owner Discount (25%)" : null;
  const total = preDiscountTotal - discountAmount;

  const method = PAYMENT_METHODS.indexOf(paymentMethod) === -1 ? "cash" : paymentMethod;
  let cashAmount = 0, visaAmount = 0, instapayAmount = 0;
  if (method === "cash") {
    cashAmount = total;
  } else if (method === "visa") {
    visaAmount = total;
  } else {
    // Mixed: cash + (visa or instapay). Server-side safety guard — the
    // split MUST sum to exactly the ticket total, or checkout is refused.
    const c = Number(cashAmountInput) || 0;
    const s = Number(secondaryAmountInput) || 0;
    if (s > total + 0.01) {
      return {
        session: null, state: state, touchedBatchIds: [],
        error: (method === "mixed_cash_visa" ? "Visa" : "InstaPay") + " amount ($" + s.toFixed(2) + ") can't exceed the ticket total ($" + total.toFixed(2) + ").",
      };
    }
    if (Math.abs(c + s - total) > 0.01) {
      return {
        session: null, state: state, touchedBatchIds: [],
        error: "Cash + " + (method === "mixed_cash_visa" ? "Visa" : "InstaPay") + " must equal the ticket total ($" +
          total.toFixed(2) + "). You entered $" + (c + s).toFixed(2) + ".",
      };
    }
    cashAmount = c;
    if (method === "mixed_cash_visa") visaAmount = s; else instapayAmount = s;
  }

  // FIFO-consume ingredients for everything ordered, computing real COGS.
  let cogs = 0;
  const touchedBatchIds = [];
  room.orders.forEach((o) => {
    const item = state.menu.find((m) => m.id === o.menuItemId);
    if (!item) return;
    item.ingredients.forEach((ing) => {
      const res = consumeFifo_(batches, ing.stockId, ing.qty * o.qty);
      cogs += res.cost;
      touchedBatchIds.push(...res.touched);
    });
  });

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
    cogs: cogs,
    discountAmount: discountAmount,
    discountLabel: discountLabel,
    splitBill: !!splitBill,
    paymentMethod: method,
    cashAmount: cashAmount,
    visaAmount: visaAmount,
    instapayAmount: instapayAmount,
    shiftId: state.activeShiftId || null,
  };
  state.rooms = state.rooms.map((r) =>
    r.id === roomId ? Object.assign({}, r, { status: "available", startedAt: null, orders: [] }) : r
  );
  // NOTE: the session is NOT added to state.sessions here anymore — it's
  // persisted directly to the dedicated Sessions sheet by the "endRoom"
  // doPost handler (appendSessionRow_), since sessions no longer live in
  // this blob at all (see getState_/setState_ for why).
  const paymentLabel = method === "mixed_cash_visa" ? "Cash $" + cashAmount.toFixed(2) + " + Visa $" + visaAmount.toFixed(2)
    : method === "mixed_cash_instapay" ? "Cash $" + cashAmount.toFixed(2) + " + InstaPay $" + instapayAmount.toFixed(2)
    : method;
  pushActivity_(state, room.name + " checked out - $" + total.toFixed(2) + " collected (" + paymentLabel + ")");
  return { session: session, state: state, touchedBatchIds: Array.from(new Set(touchedBatchIds)), error: null };
}

function bizSetActualCash_(state, n) {
  state.actualCashInput = n;
  return state;
}

// ---------- Cross-Zone Transfer (Room -> Lounge Table) ----------
// Freezes the room's time charge as of THIS exact second (it does not
// keep running once the customer leaves the physical room), folds it in
// as a line item on the target table, merges over any remaining orders,
// and frees the room for the next customer. Works in ANY direction between
// rooms and lounge tables:
//  - Room source: timer stops, elapsed charge freezes as a line item.
//  - Lounge source: no timer, orders just migrate as-is.
//  - Room target: must start fresh (can't merge into an already-active
//    room), and requires a Single/Multi rate selection to start its timer.
//  - Lounge target: no rate needed, can merge into an available OR
//    already-active table.
function bizTransferZone_(state, sourceId, targetId, rateMode) {
  const source = state.rooms.find((r) => r.id === sourceId);
  if (!source) return { ok: false, error: "Source not found", state: state };
  if (source.zone === "split") return { ok: false, error: "Cannot transfer a split invoice — check it out independently instead.", state: state };
  if (source.status !== "active") return { ok: false, error: "Source is not active", state: state };
  const target = state.rooms.find((r) => r.id === targetId);
  if (!target) return { ok: false, error: "Target not found", state: state };
  if (target.id === source.id) return { ok: false, error: "Source and target must be different", state: state };
  if (target.zone === "split") return { ok: false, error: "Cannot transfer into a split invoice", state: state };
  if (target.zone === "room" && target.status === "active") {
    return { ok: false, error: target.name + " already has an active session", state: state };
  }
  if (target.zone === "room" && rateMode !== "single" && rateMode !== "multi") {
    return { ok: false, error: "Select a Single or Multi rate to start " + target.name, state: state };
  }

  const now = Date.now();
  let durationSec = 0;
  let roomCharge = 0;
  if (source.zone === "room" && source.startedAt) {
    durationSec = Math.max(1, Math.floor(effectiveDurationSec_(source, now)));
    roomCharge = (durationSec / 3600) * source.hourlyRate;
  }

  state.rooms = state.rooms.map((r) => {
    if (r.id === sourceId) {
      return Object.assign({}, r, {
        status: "available", startedAt: null, orders: [],
        hourlyRate: 0, rateMode: r.zone === "room" ? null : r.rateMode,
      });
    }
    if (r.id === targetId) {
      let orders = r.orders.slice();
      if (roomCharge > 0) {
        orders = orders.concat([{
          menuItemId: "transfer-charge-" + source.id + "-" + now,
          name: "Room Charge (" + source.name + ")",
          qty: 1, price: roomCharge,
        }]);
      }
      source.orders.forEach((o) => {
        const existing = orders.find((x) => x.menuItemId === o.menuItemId);
        orders = existing
          ? orders.map((x) => (x.menuItemId === o.menuItemId ? Object.assign({}, x, { qty: x.qty + o.qty }) : x))
          : orders.concat([o]);
      });
      const patch = { orders: orders, transferredFrom: source.name };
      if (r.zone === "room") {
        const rate = rateMode === "single" ? r.singleRate : r.multiRate;
        Object.assign(patch, { status: "active", startedAt: now, hourlyRate: rate, rateMode: rateMode });
      } else {
        Object.assign(patch, { status: "active", startedAt: r.startedAt || now });
      }
      return Object.assign({}, r, patch);
    }
    return r;
  });

  pushActivity_(
    state,
    source.name + " transferred to " + target.name +
      (roomCharge > 0 ? " ($" + roomCharge.toFixed(2) + " room charge)" : "") +
      (target.zone === "room" ? " — started " + rateMode : ""),
  );
  return {
    ok: true, state: state, roomCharge: roomCharge, roomName: source.name, tableName: target.name,
    durationSec: durationSec, targetZone: target.zone,
  };
}

// In-Place Bill Splitting: takes a partial payment against an active
// room/table's CURRENT live bill — either specific {menuItemId, qty} lines,
// or a raw custom EGP amount not tied to any item — and settles it as its
// own completed Session (own receipt, own payment method, own COGS/ledger
// entry) immediately. Nothing new appears on the dashboard: the source
// keeps its same id, same timer (if a room), same zone. Only its live
// order list shrinks by whatever was just paid for.
function bizSplitBill_(state, batches, roomId, mode, items, customAmount, paymentMethod, cashAmountInput, secondaryAmountInput) {
  const room = state.rooms.find((r) => r.id === roomId);
  if (!room) return { ok: false, error: "Table/Room not found", state: state };
  if (room.status !== "active") return { ok: false, error: "Table/Room is not active", state: state };

  const method = PAYMENT_METHODS.indexOf(paymentMethod) === -1 ? "cash" : paymentMethod;
  let splitOrders = [];
  let splitTotal = 0;
  let cogs = 0;
  const touchedBatchIds = [];

  if (mode === "items") {
    if (!items || items.length === 0) return { ok: false, error: "No items selected to split", state: state };
    for (const req of items) {
      const line = room.orders.find((o) => o.menuItemId === req.menuItemId);
      if (!line || line.qty < req.qty || req.qty <= 0) {
        return { ok: false, error: "Invalid item/qty to split", state: state };
      }
    }
    items.forEach((req) => {
      const line = room.orders.find((o) => o.menuItemId === req.menuItemId);
      splitOrders.push(Object.assign({}, line, { qty: req.qty }));
      splitTotal += req.qty * line.price;
      const menuItem = state.menu.find((m) => m.id === req.menuItemId);
      if (menuItem) {
        menuItem.ingredients.forEach((ing) => {
          const res = consumeFifo_(batches, ing.stockId, ing.qty * req.qty);
          cogs += res.cost;
          touchedBatchIds.push.apply(touchedBatchIds, res.touched);
        });
      }
    });
    // Deduct the paid quantities from the table's live order — this alone
    // is what lowers its remaining balance, no separate field needed.
    state.rooms = state.rooms.map((r) => {
      if (r.id !== roomId) return r;
      const orders = r.orders.map((o) => {
        const ex = items.find((i) => i.menuItemId === o.menuItemId);
        if (!ex) return o;
        const newQty = o.qty - ex.qty;
        return newQty <= 0 ? null : Object.assign({}, o, { qty: newQty });
      }).filter((o) => o !== null);
      return Object.assign({}, r, { orders: orders });
    });
  } else if (mode === "amount") {
    const amt = Number(customAmount) || 0;
    if (amt <= 0) return { ok: false, error: "Enter a valid split amount", state: state };
    const durationSec = room.startedAt ? Math.max(1, Math.floor(effectiveDurationSec_(room, Date.now()))) : 0;
    const timeCostNow = room.hourlyRate ? (durationSec / 3600) * room.hourlyRate : 0;
    const ordersCostNow = room.orders.reduce((a, o) => a + o.qty * o.price, 0);
    const currentTotal = timeCostNow + ordersCostNow;
    if (amt > currentTotal + 0.01) {
      return { ok: false, error: "Split amount ($" + amt.toFixed(2) + ") exceeds the remaining balance ($" + currentTotal.toFixed(2) + ")", state: state };
    }
    splitTotal = amt;
    splitOrders = [{ menuItemId: "partial-payment", name: "Partial Payment", qty: 1, price: amt }];
    // A negative synthetic credit line is what actually lowers the table's
    // displayed/eventual total for an amount not tied to specific items —
    // the exact same pattern already used for the frozen room-transfer
    // charge, just negative.
    state.rooms = state.rooms.map((r) =>
      r.id === roomId
        ? Object.assign({}, r, { orders: r.orders.concat([{ menuItemId: "split-credit-" + Date.now(), name: "Partial Payment Applied", qty: 1, price: -amt }]) })
        : r
    );
  } else {
    return { ok: false, error: "Invalid split mode", state: state };
  }

  // Owners Tables get the same automatic 25% discount on split sub-bills
  // as a full checkout — itemized on the split receipt too.
  const preDiscountSplitTotal = splitTotal;
  const discountAmount = room.isOwnerTable ? Math.round(preDiscountSplitTotal * 0.25 * 100) / 100 : 0;
  const discountLabel = room.isOwnerTable ? "Owner Discount (25%)" : null;
  splitTotal = preDiscountSplitTotal - discountAmount;

  let cashAmount = 0, visaAmount = 0, instapayAmount = 0;
  if (method === "cash") {
    cashAmount = splitTotal;
  } else if (method === "visa") {
    visaAmount = splitTotal;
  } else {
    const c = Number(cashAmountInput) || 0;
    const s = Number(secondaryAmountInput) || 0;
    if (s > splitTotal + 0.01) {
      return {
        ok: false,
        error: (method === "mixed_cash_visa" ? "Visa" : "InstaPay") + " amount ($" + s.toFixed(2) + ") can't exceed the sub-bill total ($" + splitTotal.toFixed(2) + ").",
        state: state,
      };
    }
    if (Math.abs(c + s - splitTotal) > 0.01) {
      return {
        ok: false,
        error: "Cash + " + (method === "mixed_cash_visa" ? "Visa" : "InstaPay") + " must equal the split total ($" + splitTotal.toFixed(2) + ").",
        state: state,
      };
    }
    cashAmount = c;
    if (method === "mixed_cash_visa") visaAmount = s; else instapayAmount = s;
  }

  const now = Date.now();
  const splitSession = {
    id: "split-" + now,
    roomId: room.id,
    roomName: room.name + " (Split)",
    startedAt: now,
    endedAt: now,
    durationSec: 0,
    timeCost: 0,
    orders: splitOrders,
    ordersCost: preDiscountSplitTotal,
    total: splitTotal,
    cogs: cogs,
    discountAmount: discountAmount,
    discountLabel: discountLabel,
    splitBill: true,
    paymentMethod: method,
    cashAmount: cashAmount,
    visaAmount: visaAmount,
    instapayAmount: instapayAmount,
    shiftId: state.activeShiftId || null,
  };

  pushActivity_(state, "Split payment of $" + splitTotal.toFixed(2) + " taken on " + room.name + " (" + method + ")");
  return { ok: true, state: state, touchedBatchIds: Array.from(new Set(touchedBatchIds)), splitSession: splitSession };
}

// ---------- Void workflow ----------

// Actually executes a void: reduces (or removes) the qty on the room's LIVE
// order, and — if the reason requires it — consumes ingredients via FIFO
// right now, since they were physically used making the item. Returns the
// touched batch ids so only those get written back.
function applyVoid_(state, batches, req) {
  const room = state.rooms.find((r) => r.id === req.roomId);
  if (!room) return { ok: false, error: "Room not found", state: state, touchedBatchIds: [] };
  const line = room.orders.find((o) => o.menuItemId === req.menuItemId);
  if (!line || line.qty < req.qty) {
    return { ok: false, error: "Item is no longer on the order as requested (checked out or already modified)", state: state, touchedBatchIds: [] };
  }

  state.rooms = state.rooms.map((r) => {
    if (r.id !== req.roomId) return r;
    const newQty = line.qty - req.qty;
    const orders = newQty <= 0
      ? r.orders.filter((o) => o.menuItemId !== req.menuItemId)
      : r.orders.map((o) => (o.menuItemId === req.menuItemId ? Object.assign({}, o, { qty: newQty }) : o));
    return Object.assign({}, r, { orders: orders });
  });

  const reasonCfg = VOID_REASONS[req.reason];
  let cogs = 0;
  const touchedBatchIds = [];
  if (reasonCfg && reasonCfg.deductsInventory) {
    const item = state.menu.find((m) => m.id === req.menuItemId);
    if (item) {
      item.ingredients.forEach((ing) => {
        const res = consumeFifo_(batches, ing.stockId, ing.qty * req.qty);
        cogs += res.cost;
        touchedBatchIds.push.apply(touchedBatchIds, res.touched);
      });
    }
  }

  pushActivity_(state, "VOID (" + (reasonCfg ? reasonCfg.label : req.reason) + "): " + req.qty + "x " + req.itemName + " — " + room.name);
  return { ok: true, state: state, cogs: cogs, touchedBatchIds: Array.from(new Set(touchedBatchIds)) };
}

function writeBatchesBack_(batches, touchedBatchIds) {
  touchedBatchIds.forEach(function (id) {
    const b = batches.find(function (x) { return x.id === id; });
    if (b) updateObjectById_("Batches", id, { qtyRemaining: b.qtyRemaining });
  });
}

function pendingVoidCountForShift_(shiftId) {
  if (!shiftId) return 0;
  return readObjects_("VoidRequests").filter((v) => v.shiftId === shiftId && v.status === "pending").length;
}

// ---------- Shifts ----------

function bizOpenShift_(state, username, openingBalance, lat, lng) {
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
    openedLat: typeof lat === "number" ? lat : null,
    openedLng: typeof lng === "number" ? lng : null,
    closedLat: null,
    closedLng: null,
  };
  appendObject_("Shifts", shift);
  state.activeShiftId = id;
  state.actualCashInput = 0;
  pushActivity_(state, username + " opened a shift (opening balance $" + (openingBalance || 0).toFixed(2) + ")");
  return { ok: true, state: state };
}

// Expected Cash = Opening Balance + Cash Sales - Approved drawer-paid
// expenses logged against this shift. `forced` = true means this came
// from the admin emergency-reset path rather than a cashier's normal End
// Shift.
function bizCloseActiveShift_(state, sessions, ledger, shifts, actualCash, forced, lat, lng) {
  if (!state.activeShiftId) return { ok: false, error: "No active shift to close", state: state };
  const shiftId = state.activeShiftId;
  const shift = shifts.find((sh) => sh.id === shiftId);
  const shiftSessions = sessions.filter((s) => s.shiftId === shiftId);
  const cashSales = shiftSessions.reduce((a, s) => a + (Number(s.cashAmount) || 0), 0);
  const drawerExpenses = ledger
    .filter((l) => l.shiftId === shiftId && l.status === "approved" && l.paidFromDrawer && l.direction === "outflow")
    .reduce((a, l) => a + Number(l.amount), 0);
  const expectedCash = (shift ? shift.openingBalance : 0) + cashSales - drawerExpenses;
  const closingActualCash = typeof actualCash === "number" ? actualCash : (state.actualCashInput || 0);
  const discrepancy = closingActualCash - expectedCash;

  updateObjectById_("Shifts", shiftId, {
    closedAt: Date.now(),
    closingActualCash: closingActualCash,
    expectedCash: expectedCash,
    discrepancy: discrepancy,
    forced: !!forced,
    closedLat: typeof lat === "number" ? lat : null,
    closedLng: typeof lng === "number" ? lng : null,
  });
  state.activeShiftId = null;
  state.actualCashInput = 0;
  pushActivity_(
    state,
    (forced ? "Admin force-closed shift" : "Shift closed") +
      " — expected $" + expectedCash.toFixed(2) + ", counted $" + closingActualCash.toFixed(2),
  );
  return {
    ok: true, state: state,
    closedShift: { id: shiftId, expectedCash: expectedCash, closingActualCash: closingActualCash, discrepancy: discrepancy },
  };
}

// ---------- Staff Orders & Consumption ----------
// Standard menu prices are used (for costing/inventory consistency), but
// the amount is routed to a Staff Consumption EXPENSE, never counted as
// retail sales revenue — this never touches state.rooms or Sessions.
function bizSubmitStaffOrder_(state, batches, staffName, items) {
  const trimmedName = (staffName || "").trim();
  if (!trimmedName) return { ok: false, error: "Staff member name is required", state: state };
  if (!items || items.length === 0) return { ok: false, error: "No items selected", state: state };

  let totalAmount = 0;
  const orderLines = [];
  for (const req of items) {
    const menuItem = state.menu.find((m) => m.id === req.menuItemId);
    if (!menuItem) return { ok: false, error: "Item not found", state: state };
    if (!req.qty || req.qty <= 0) return { ok: false, error: "Invalid quantity for " + menuItem.name, state: state };
    const insufficientIng = menuItem.ingredients.find((ing) => {
      const remaining = materialRemaining_(batches, ing.stockId);
      const reserved = materialReserved_(state.rooms, state.menu, ing.stockId);
      return remaining - reserved - ing.qty * req.qty < -1e-9;
    });
    if (insufficientIng) return { ok: false, error: "Insufficient stock for " + menuItem.name, state: state };
    orderLines.push({ menuItemId: req.menuItemId, name: menuItem.name, qty: req.qty, price: menuItem.price });
    totalAmount += req.qty * menuItem.price;
  }

  let cogs = 0;
  const touchedBatchIds = [];
  orderLines.forEach((line) => {
    const menuItem = state.menu.find((m) => m.id === line.menuItemId);
    menuItem.ingredients.forEach((ing) => {
      const res = consumeFifo_(batches, ing.stockId, ing.qty * line.qty);
      cogs += res.cost;
      touchedBatchIds.push.apply(touchedBatchIds, res.touched);
    });
  });

  const staffOrder = {
    id: newId_("staff"), ts: Date.now(), staffName: trimmedName, items: orderLines,
    totalAmount: totalAmount, cogs: cogs, processedBy: null, shiftId: state.activeShiftId || null,
  };
  pushActivity_(state, "Staff order: " + trimmedName + " — $" + totalAmount.toFixed(2) + " (" + orderLines.length + " item(s))");
  return { ok: true, state: state, touchedBatchIds: Array.from(new Set(touchedBatchIds)), staffOrder: staffOrder };
}

// ---------- Manual Stock Adjustment (admin) ----------
// Positive delta: logs a new batch (an administrative addition — Opening
// Balance or a correction that found MORE stock than expected). Negative
// delta: consumes existing batches via FIFO, same as a sale would (Waste,
// or a correction that found LESS than expected). Either way this is
// fully audited via the Activity Log, and Waste additionally posts to the
// financial ledger as a real cost.
function adjustStock_(materialId, deltaQty, reason, note, username) {
  const batches = readObjects_("Batches");
  const before = batches.filter((b) => b.materialId === materialId).reduce((a, b) => a + Number(b.qtyRemaining), 0);
  let cost = 0;
  if (deltaQty > 0) {
    appendObject_("Batches", {
      id: newId_("batch"), materialId: materialId, supplierId: null,
      qtyPurchased: deltaQty, qtyRemaining: deltaQty, unitCost: 0,
      purchasedAt: Date.now(), source: "dailyFresh",
    });
  } else if (deltaQty < 0) {
    const res = consumeFifo_(batches, materialId, Math.abs(deltaQty));
    cost = res.cost;
    writeBatchesBack_(batches, res.touched);
  }
  const after = before + deltaQty;

  if (reason === "waste" && deltaQty < 0 && cost > 0) {
    appendObject_("Ledger", {
      id: newId_("ledg"), ts: Date.now(), amount: cost, direction: "outflow", type: "manualAdjustment",
      category: "Operational Waste / Damaged Goods", description: "Manual stock adjustment: " + (note || "waste"),
      supplierId: null, staffUsername: username, status: "approved", receiptUrl: null,
      paidFromDrawer: false, shiftId: null, materialId: materialId, qty: Math.abs(deltaQty), unitCost: null,
    });
  }

  return { ok: true, before: before, after: after, cost: cost };
}

// ---------- Derived "stock" view for backward-compat with the UI's low
// -stock alerts (initialStock = ever purchased, used = ever consumed) ----
function computeStockView_(materials, batches) {
  return materials.map((m) => {
    const matBatches = batches.filter((b) => b.materialId === m.id);
    const initialStock = matBatches.reduce((a, b) => a + Number(b.qtyPurchased), 0);
    const remaining = matBatches.reduce((a, b) => a + Number(b.qtyRemaining), 0);
    return {
      id: m.id,
      name: m.name,
      unit: m.unit,
      initialStock: initialStock,
      used: initialStock - remaining,
      minStock: m.minStockAlert,
    };
  });
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

  // Handled outside the lock — receipt upload to Drive is slow I/O and
  // shouldn't stall unrelated requests while it runs.
  if (body.action === "submitPurchase") {
    return handleSubmitPurchase_(body);
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    switch (body.action) {
      case "login": {
        const result = login_(body.username, body.password);
        if (result.ok) {
          logActivity_({
            actorUsername: result.username, actorRole: result.role, actionType: "LOGIN_SUCCESS",
            description: result.username + " (" + result.role + ") logged in",
          });
        } else {
          logActivity_({
            actorUsername: body.username, actorRole: "unknown", actionType: "LOGIN_FAILED",
            description: "Failed login attempt for username '" + body.username + "'",
          });
        }
        return json_(result);
      }

      case "getAccounts":
        requireRole_(body.username, ["admin"]);
        return json_({ accounts: getAccounts_() });

      case "addAccount": {
        requireRole_(body.username, ["admin"]);
        const result = addAccount_(body.newUsername, body.newPassword, body.newRole);
        if (result.ok) {
          logActivity_({
            actorUsername: body.username, actorRole: "admin", actionType: "ACCOUNT_CREATED",
            description: "Created account '" + body.newUsername + "' with role " + body.newRole,
            after: { username: body.newUsername, role: body.newRole },
          });
        }
        return json_(result);
      }

      case "updateAccount": {
        requireRole_(body.username, ["admin"]);
        const accountsBefore = getAccounts_();
        const before = accountsBefore.find((a) => a.username === body.originalUsername);
        const result = updateAccount_(body.originalUsername, {
          username: body.username_new,
          password: body.password,
          role: body.role,
        });
        if (result.ok) {
          const roleChanged = before && body.role && before.role !== body.role;
          logActivity_({
            actorUsername: body.username, actorRole: "admin",
            actionType: roleChanged ? "ACCOUNT_ROLE_CHANGED" : (body.password ? "ACCOUNT_PASSWORD_CHANGED" : "ACCOUNT_ROLE_CHANGED"),
            description: "Updated account '" + body.originalUsername + "'" + (roleChanged ? " — role changed to " + body.role : "") + (body.password ? " — password changed" : ""),
            before: before, after: { username: body.username_new || body.originalUsername, role: body.role || (before && before.role) },
          });
        }
        return json_(result);
      }

      case "deleteAccount": {
        requireRole_(body.username, ["admin"]);
        const before = getAccounts_().find((a) => a.username === body.targetUsername);
        const result = deleteAccount_(body.targetUsername);
        if (result.ok) {
          logActivity_({
            actorUsername: body.username, actorRole: "admin", actionType: "ACCOUNT_DELETED",
            description: "Deleted account '" + body.targetUsername + "'",
            before: before,
          });
        }
        return json_(result);
      }

      case "getState": {
        requireRole_(body.username, ["admin", "cashier"]);
        return json_({ state: withStockView_(getState_()) });
      }

      // ---- Atomic business actions: read + mutate + write in ONE locked call ----

      case "setRoomRate": {
        requireRole_(body.username, ["admin"]);
        const state0 = getState_();
        const before = state0.rooms.find((r) => r.id === body.roomId);
        const state = bizSetRoomRate_(state0, body.roomId, body.singleRate, body.multiRate);
        setState_(state);
        logActivity_({
          actorUsername: body.username, actorRole: "admin", actionType: "ROOM_RATE_CHANGED",
          location: before ? before.name : body.roomId,
          description: (before ? before.name : body.roomId) + " rates changed to Single $" + body.singleRate + "/hr, Multi $" + body.multiRate + "/hr",
          before: before ? { singleRate: before.singleRate, multiRate: before.multiRate } : null,
          after: { singleRate: body.singleRate, multiRate: body.multiRate },
        });
        return json_({ state: withStockView_(state) });
      }
      case "renameRoom": {
        requireRole_(body.username, ["admin"]);
        const state0 = getState_();
        const before = state0.rooms.find((r) => r.id === body.roomId);
        const result = bizRenameRoom_(state0, body.roomId, body.name);
        if (!result.ok) return json_({ ok: false, error: result.error, state: withStockView_(state0) });
        setState_(result.state);
        logActivity_({
          actorUsername: body.username, actorRole: "admin", actionType: "ROOM_RATE_CHANGED",
          location: before ? before.name : body.roomId,
          description: "Renamed '" + (before ? before.name : body.roomId) + "' to '" + body.name + "'",
          before: before ? { name: before.name } : null,
          after: { name: body.name },
        });
        return json_({ ok: true, state: withStockView_(result.state) });
      }
      case "startRoom": {
        requireRole_(body.username, ["admin", "cashier"]);
        const result = bizStartRoom_(getState_(), body.roomId, body.rateMode);
        if (result.ok) {
          setState_(result.state);
          const room = result.state.rooms.find((r) => r.id === body.roomId);
          logActivity_({
            actorUsername: body.username, actorRole: roleForUsername_(body.username), actionType: "ROOM_STARTED",
            location: room ? room.name : body.roomId, shiftId: result.state.activeShiftId,
            description: (room ? room.name : body.roomId) + " session started" + (room && room.rateMode ? " (" + room.rateMode + " @ $" + room.hourlyRate + "/hr)" : ""),
          });
        }
        return json_({ ok: result.ok, error: result.error || null, state: withStockView_(result.state) });
      }
      case "pauseRoom": {
        requireRole_(body.username, ["admin", "cashier"]);
        const state0 = getState_();
        const before = state0.rooms.find((r) => r.id === body.roomId);
        const result = bizPauseRoom_(state0, body.roomId);
        if (!result.ok) return json_({ ok: false, error: result.error, state: withStockView_(result.state) });
        setState_(result.state);
        logActivity_({
          actorUsername: body.username, actorRole: roleForUsername_(body.username), actionType: "ROOM_PAUSED",
          location: before ? before.name : body.roomId, shiftId: result.state.activeShiftId,
          description: (before ? before.name : body.roomId) + " session paused",
        });
        return json_({ ok: true, state: withStockView_(result.state) });
      }
      case "resumeRoom": {
        requireRole_(body.username, ["admin", "cashier"]);
        const state0 = getState_();
        const before = state0.rooms.find((r) => r.id === body.roomId);
        const result = bizResumeRoom_(state0, body.roomId);
        if (!result.ok) return json_({ ok: false, error: result.error, state: withStockView_(result.state) });
        setState_(result.state);
        logActivity_({
          actorUsername: body.username, actorRole: roleForUsername_(body.username), actionType: "ROOM_RESUMED",
          location: before ? before.name : body.roomId, shiftId: result.state.activeShiftId,
          description: (before ? before.name : body.roomId) + " session resumed",
        });
        return json_({ ok: true, state: withStockView_(result.state) });
      }
      case "endRoom": {
        requireRole_(body.username, ["admin", "cashier"]);
        const batches = readObjects_("Batches");
        const result = bizEndRoom_(getState_(), batches, body.roomId, body.splitBill, body.paymentMethod, body.cashAmount, body.secondaryAmount, body.frozenAt);
        if (result.error) {
          return json_({ session: null, error: result.error, state: withStockView_(result.state) });
        }
        if (result.session) {
          setState_(result.state);
          appendSessionRow_(result.session);
          result.touchedBatchIds.forEach(function (id) {
            const b = batches.find(function (x) { return x.id === id; });
            if (b) updateObjectById_("Batches", id, { qtyRemaining: b.qtyRemaining });
          });
          // Log the sale in the permanent ledger.
          appendObject_("Ledger", {
            id: newId_("ledg"), ts: result.session.endedAt, amount: result.session.total, direction: "inflow",
            type: "sale", category: "Room Sale", description: result.session.roomName + " checkout",
            supplierId: null, staffUsername: body.username, status: "approved", receiptUrl: null,
            paidFromDrawer: result.session.cashAmount > 0, shiftId: result.session.shiftId,
            materialId: null, qty: null, unitCost: null,
          });
          logActivity_({
            actorUsername: body.username, actorRole: roleForUsername_(body.username),
            actionType: body.splitBill ? "CHECKOUT_SPLIT_BILL" : "CHECKOUT",
            location: result.session.roomName, shiftId: result.session.shiftId,
            description: result.session.roomName + " checked out — $" + result.session.total.toFixed(2) + " (" + result.session.paymentMethod + ")",
            before: { orders: result.session.orders },
            after: {
              total: result.session.total, cogs: result.session.cogs,
              cashAmount: result.session.cashAmount, visaAmount: result.session.visaAmount, instapayAmount: result.session.instapayAmount,
            },
          });
        }
        return json_({ session: result.session, state: withStockView_(result.state) });
      }
      case "addOrder": {
        requireRole_(body.username, ["admin", "cashier"]);
        const batches = readObjects_("Batches");
        const stateBefore = getState_();
        const roomBefore = stateBefore.rooms.find((r) => r.id === body.roomId);
        const qtyBefore = roomBefore ? (roomBefore.orders.find((o) => o.menuItemId === body.menuItemId) || {}).qty || 0 : 0;
        const result = bizAddOrder_(stateBefore, batches, body.roomId, body.menuItemId, body.qty);
        if (result.ok) {
          setState_(result.state);
          const roomAfter = result.state.rooms.find((r) => r.id === body.roomId);
          const lineAfter = roomAfter ? roomAfter.orders.find((o) => o.menuItemId === body.menuItemId) : null;
          logActivity_({
            actorUsername: body.username, actorRole: roleForUsername_(body.username), actionType: "ITEM_ADDED",
            location: roomAfter ? roomAfter.name : body.roomId, shiftId: result.state.activeShiftId,
            description: "Added " + body.qty + "x " + (lineAfter ? lineAfter.name : body.menuItemId) + " to " + (roomAfter ? roomAfter.name : body.roomId),
            before: { qty: qtyBefore }, after: { qty: lineAfter ? lineAfter.qty : null },
          });
        }
        return json_({ ok: result.ok, error: result.error || null, state: withStockView_(result.state) });
      }
      case "setOrderLineQty": {
        requireRole_(body.username, ["admin", "cashier"]);
        const batches = readObjects_("Batches");
        const stateBefore = getState_();
        const roomBefore = stateBefore.rooms.find((r) => r.id === body.roomId);
        const lineBefore = roomBefore ? roomBefore.orders.find((o) => o.menuItemId === body.menuItemId) : null;
        const result = bizSetOrderLineQty_(stateBefore, batches, body.roomId, body.menuItemId, body.qty);
        if (result.ok) {
          setState_(result.state);
          logActivity_({
            actorUsername: body.username, actorRole: roleForUsername_(body.username), actionType: "ITEM_QTY_CHANGED",
            location: roomBefore ? roomBefore.name : body.roomId, shiftId: result.state.activeShiftId,
            description: (lineBefore ? lineBefore.name : body.menuItemId) + " qty changed to " + body.qty + " on " + (roomBefore ? roomBefore.name : body.roomId),
            before: { qty: lineBefore ? lineBefore.qty : null }, after: { qty: body.qty },
          });
        }
        return json_({ ok: result.ok, error: result.error || null, state: withStockView_(result.state) });
      }
      case "setOrderLineNote": {
        requireRole_(body.username, ["admin", "cashier"]);
        const stateBefore = getState_();
        const roomBefore = stateBefore.rooms.find((r) => r.id === body.roomId);
        const lineBefore = roomBefore ? roomBefore.orders.find((o) => o.menuItemId === body.menuItemId) : null;
        const result = bizSetOrderLineNote_(stateBefore, body.roomId, body.menuItemId, body.notes);
        if (result.ok) {
          setState_(result.state);
          logActivity_({
            actorUsername: body.username, actorRole: roleForUsername_(body.username), actionType: "ITEM_NOTE_SET",
            location: roomBefore ? roomBefore.name : body.roomId, shiftId: result.state.activeShiftId,
            description: "Note set on " + (lineBefore ? lineBefore.name : body.menuItemId) + ": \"" + (body.notes || "") + "\"",
            before: { notes: lineBefore ? (lineBefore.notes || "") : "" }, after: { notes: body.notes || "" },
          });
        }
        return json_({ ok: result.ok, error: result.error || null, state: withStockView_(result.state) });
      }

      case "transferZone": {
        requireRole_(body.username, ["admin", "cashier"]);
        const result = bizTransferZone_(getState_(), body.sourceId, body.targetId, body.rateMode);
        if (result.ok) {
          setState_(result.state);
          logActivity_({
            actorUsername: body.username, actorRole: roleForUsername_(body.username), actionType: "SESSION_TRANSFERRED",
            location: result.roomName + " -> " + result.tableName, shiftId: result.state.activeShiftId,
            description: result.roomName + " transferred to " + result.tableName +
              (result.roomCharge > 0 ? " ($" + result.roomCharge.toFixed(2) + " frozen room charge, " + result.durationSec + "s elapsed)" : "") +
              (result.targetZone === "room" ? " — started " + body.rateMode : ""),
            before: { source: result.roomName, durationSec: result.durationSec },
            after: { target: result.tableName, roomCharge: result.roomCharge, rateMode: result.targetZone === "room" ? body.rateMode : null },
          });
        }
        return json_({ ok: result.ok, error: result.error || null, state: withStockView_(result.state) });
      }

      case "logSplitInterfaceOpened": {
        requireRole_(body.username, ["admin", "cashier"]);
        const state0 = getState_();
        const source = state0.rooms.find((r) => r.id === body.roomId);
        logActivity_({
          actorUsername: body.username, actorRole: roleForUsername_(body.username), actionType: "SPLIT_INTERFACE_OPENED",
          location: source ? source.name : body.roomId, shiftId: state0.activeShiftId,
          description: "Split interface opened for " + (source ? source.name : body.roomId),
        });
        return json_({ ok: true });
      }

      case "splitBill": {
        requireRole_(body.username, ["admin", "cashier"]);
        const batches = readObjects_("Batches");
        const result = bizSplitBill_(getState_(), batches, body.roomId, body.mode, body.items, body.customAmount, body.paymentMethod, body.cashAmount, body.secondaryAmount);
        if (!result.ok) {
          return json_({ ok: false, error: result.error, state: withStockView_(result.state) });
        }
        setState_(result.state);
        writeBatchesBack_(batches, result.touchedBatchIds);
        appendSessionRow_(result.splitSession);
        appendObject_("Ledger", {
          id: newId_("ledg"), ts: result.splitSession.endedAt, amount: result.splitSession.total, direction: "inflow",
          type: "sale", category: "Split Payment", description: result.splitSession.roomName + " split payment",
          supplierId: null, staffUsername: body.username, status: "approved", receiptUrl: null,
          paidFromDrawer: result.splitSession.cashAmount > 0, shiftId: result.splitSession.shiftId,
          materialId: null, qty: null, unitCost: null,
        });
        logActivity_({
          actorUsername: body.username, actorRole: roleForUsername_(body.username), actionType: "SESSION_SPLIT",
          location: result.splitSession.roomName, shiftId: result.splitSession.shiftId,
          description: "Split payment of $" + result.splitSession.total.toFixed(2) + " (" + body.mode + ", " + body.paymentMethod + ")",
          after: { total: result.splitSession.total, mode: body.mode, paymentMethod: body.paymentMethod },
        });
        return json_({ ok: true, session: result.splitSession, state: withStockView_(result.state) });
      }

      case "addMenuItem": {
        requireRole_(body.username, ["admin"]);
        const state = getState_();
        state.menu = state.menu.concat([body.item]);
        setState_(state);
        return json_({ state: withStockView_(state) });
      }
      case "updateMenuItem": {
        requireRole_(body.username, ["admin"]);
        const state = getState_();
        const before = state.menu.find((x) => x.id === body.id);
        state.menu = state.menu.map((x) => (x.id === body.id ? Object.assign({}, x, body.patch) : x));
        setState_(state);
        if (before && body.patch && typeof body.patch.price === "number" && body.patch.price !== before.price) {
          logActivity_({
            actorUsername: body.username, actorRole: "admin", actionType: "MENU_PRICE_CHANGED",
            description: before.name + " price changed from $" + before.price + " to $" + body.patch.price,
            before: { price: before.price }, after: { price: body.patch.price },
          });
        }
        return json_({ state: withStockView_(state) });
      }
      case "deleteMenuItem": {
        requireRole_(body.username, ["admin"]);
        const state = getState_();
        state.menu = state.menu.filter((x) => x.id !== body.id);
        setState_(state);
        return json_({ state: withStockView_(state) });
      }
      case "setActualCash": {
        requireRole_(body.username, ["admin", "cashier"]);
        const state = bizSetActualCash_(getState_(), body.amount);
        setState_(state);
        return json_({ state: withStockView_(state) });
      }
      case "openShift": {
        const role = requireRole_(body.username, ["admin", "cashier"]);
        const state0 = getState_();
        const geoErr = checkGeofence_(state0, body.lat, body.lng);
        if (geoErr) {
          logActivity_({
            actorUsername: body.username, actorRole: role, actionType: "GEOFENCE_DENIED",
            description: "Blocked shift START — " + geoErr + (typeof body.lat === "number" ? " (" + body.lat + "," + body.lng + ")" : " (no location)"),
          });
          return json_({ ok: false, error: geoErr, state: withStockView_(state0) });
        }
        const result = bizOpenShift_(state0, body.username, body.openingBalance, body.lat, body.lng);
        if (result.ok) {
          setState_(result.state);
          logActivity_({
            actorUsername: body.username, actorRole: role, actionType: "START_SHIFT",
            shiftId: result.state.activeShiftId,
            description: body.username + " started a shift (opening $" + (body.openingBalance || 0).toFixed(2) + ")",
            after: { openingBalance: body.openingBalance, lat: body.lat, lng: body.lng },
          });
        }
        return json_({ ok: result.ok, error: result.error || null, state: withStockView_(result.state) });
      }
      case "endShift": {
        const role = requireRole_(body.username, ["admin", "cashier"]);
        const state0 = getState_();
        const geoErr = checkGeofence_(state0, body.lat, body.lng);
        if (geoErr) {
          logActivity_({
            actorUsername: body.username, actorRole: role, actionType: "GEOFENCE_DENIED",
            shiftId: state0.activeShiftId,
            description: "Blocked shift END — " + geoErr + (typeof body.lat === "number" ? " (" + body.lat + "," + body.lng + ")" : " (no location)"),
          });
          return json_({ ok: false, error: geoErr, state: withStockView_(state0) });
        }
        const shiftIdBefore = state0.activeShiftId;
        const ledger = readObjects_("Ledger");
        const result = bizCloseActiveShift_(state0, readSessions_(), ledger, readShifts_(), body.actualCash, false, body.lat, body.lng);
        if (result.ok) {
          setState_(result.state);
          const closed = result.closedShift;
          logActivity_({
            actorUsername: body.username, actorRole: role, actionType: "END_SHIFT", shiftId: shiftIdBefore,
            description: body.username + " ended shift — expected $" + (closed ? closed.expectedCash.toFixed(2) : "?") + ", counted $" + (closed ? closed.closingActualCash.toFixed(2) : "?"),
            after: closed ? { expectedCash: closed.expectedCash, closingActualCash: closed.closingActualCash, discrepancy: closed.discrepancy, lat: body.lat, lng: body.lng } : null,
          });
        }
        return json_({ ok: result.ok, error: result.error || null, state: withStockView_(result.state) });
      }
      case "forceEndShift": {
        requireRole_(body.username, ["admin"]);
        const state = getState_();
        if (!state.activeShiftId) return json_({ ok: true, state: withStockView_(state) });
        const shiftIdBefore = state.activeShiftId;
        const ledger = readObjects_("Ledger");
        const result = bizCloseActiveShift_(state, readSessions_(), ledger, readShifts_(), body.actualCash, true);
        setState_(result.state);
        logActivity_({
          actorUsername: body.username, actorRole: "admin", actionType: "FORCE_END_SHIFT", shiftId: shiftIdBefore,
          description: "Admin force-closed shift " + shiftIdBefore,
        });
        return json_({ ok: true, state: withStockView_(result.state) });
      }

      // ---- Raw materials / suppliers / recurring expenses CRUD (admin) ----
      case "getRawMaterials":
        requireRole_(body.username, ["admin", "cashier"]);
        return json_({ items: readObjects_("RawMaterials") });

      case "submitStaffOrder": {
        requireRole_(body.username, ["admin", "cashier"]);
        const batches = readObjects_("Batches");
        const result = bizSubmitStaffOrder_(getState_(), batches, body.staffName, body.items);
        if (!result.ok) return json_({ ok: false, error: result.error, state: withStockView_(result.state) });
        setState_(result.state);
        writeBatchesBack_(batches, result.touchedBatchIds);
        result.staffOrder.processedBy = body.username;
        appendObject_("StaffOrders", staffOrderToRow_(result.staffOrder));
        appendObject_("Ledger", {
          id: newId_("ledg"), ts: result.staffOrder.ts, amount: result.staffOrder.totalAmount, direction: "outflow",
          type: "manualAdjustment", category: "Staff Consumption Expense",
          description: result.staffOrder.staffName + " — " + result.staffOrder.items.length + " item(s)",
          supplierId: null, staffUsername: body.username, status: "approved", receiptUrl: null,
          paidFromDrawer: false, shiftId: result.staffOrder.shiftId, materialId: null, qty: null, unitCost: null,
        });
        logActivity_({
          actorUsername: body.username, actorRole: roleForUsername_(body.username), actionType: "STAFF_ORDER_LOGGED",
          description: "Staff order for " + result.staffOrder.staffName + " — $" + result.staffOrder.totalAmount.toFixed(2),
          shiftId: result.staffOrder.shiftId,
          after: { staffName: result.staffOrder.staffName, totalAmount: result.staffOrder.totalAmount, items: result.staffOrder.items },
        });
        return json_({ ok: true, staffOrder: result.staffOrder, state: withStockView_(result.state) });
      }
      case "getStaffOrders":
        requireRole_(body.username, ["admin"]);
        return json_({ items: readStaffOrders_() });

      case "adjustStock": {
        requireRole_(body.username, ["admin"]);
        const materials = readObjects_("RawMaterials");
        const material = materials.find((m) => m.id === body.materialId);
        if (!material) return json_({ ok: false, error: "Material not found" });
        const delta = Number(body.deltaQty) || 0;
        if (delta === 0) return json_({ ok: false, error: "Enter a non-zero adjustment" });
        const result = adjustStock_(body.materialId, delta, body.reason, body.note, body.username);
        logActivity_({
          actorUsername: body.username, actorRole: "admin", actionType: "STOCK_ADJUSTED",
          description: (delta > 0 ? "+" : "") + delta + " " + material.unit + " of " + material.name +
            " (" + body.reason + (body.note ? ": " + body.note : "") + ")",
          before: { remaining: result.before }, after: { remaining: result.after, reason: body.reason, note: body.note || "" },
        });
        return json_({ ok: true, state: withStockView_(getState_()) });
      }

      case "addRawMaterial": {
        requireRole_(body.username, ["admin"]);
        const item = { id: newId_("mat"), name: body.name, unit: body.unit, minStockAlert: body.minStockAlert || 0 };
        appendObject_("RawMaterials", item);
        logActivity_({
          actorUsername: body.username, actorRole: "admin", actionType: "RAW_MATERIAL_COST_CONTEXT",
          description: "Added raw material '" + body.name + "'", after: item,
        });
        return json_({ ok: true, item: item });
      }
      case "updateRawMaterial": {
        requireRole_(body.username, ["admin"]);
        const before = readObjects_("RawMaterials").find((m) => m.id === body.id);
        const ok = updateObjectById_("RawMaterials", body.id, body.patch);
        if (ok) {
          logActivity_({
            actorUsername: body.username, actorRole: "admin", actionType: "RAW_MATERIAL_COST_CONTEXT",
            description: "Edited raw material '" + (before ? before.name : body.id) + "'",
            before: before, after: Object.assign({}, before, body.patch),
          });
        }
        return json_({ ok: ok });
      }
      case "deleteRawMaterial": {
        requireRole_(body.username, ["admin"]);
        const before = readObjects_("RawMaterials").find((m) => m.id === body.id);
        const ok = deleteObjectById_("RawMaterials", body.id);
        if (ok) {
          logActivity_({
            actorUsername: body.username, actorRole: "admin", actionType: "RAW_MATERIAL_COST_CONTEXT",
            description: "Deleted raw material '" + (before ? before.name : body.id) + "'", before: before,
          });
        }
        return json_({ ok: ok });
      }

      case "getSuppliers":
        requireRole_(body.username, ["admin", "cashier"]);
        return json_({ items: readObjects_("Suppliers") });
      case "addSupplier": {
        requireRole_(body.username, ["admin"]);
        const item = { id: newId_("sup"), name: body.name, contact: body.contact || "", category: body.category || "" };
        appendObject_("Suppliers", item);
        logActivity_({
          actorUsername: body.username, actorRole: "admin", actionType: "SUPPLIER_CHANGED",
          description: "Added supplier '" + body.name + "'", after: item,
        });
        return json_({ ok: true, item: item });
      }
      case "updateSupplier": {
        requireRole_(body.username, ["admin"]);
        const before = readObjects_("Suppliers").find((s) => s.id === body.id);
        const ok = updateObjectById_("Suppliers", body.id, body.patch);
        if (ok) {
          logActivity_({
            actorUsername: body.username, actorRole: "admin", actionType: "SUPPLIER_CHANGED",
            description: "Edited supplier '" + (before ? before.name : body.id) + "'",
            before: before, after: Object.assign({}, before, body.patch),
          });
        }
        return json_({ ok: ok });
      }
      case "deleteSupplier": {
        requireRole_(body.username, ["admin"]);
        const before = readObjects_("Suppliers").find((s) => s.id === body.id);
        const ok = deleteObjectById_("Suppliers", body.id);
        if (ok) {
          logActivity_({
            actorUsername: body.username, actorRole: "admin", actionType: "SUPPLIER_CHANGED",
            description: "Deleted supplier '" + (before ? before.name : body.id) + "'", before: before,
          });
        }
        return json_({ ok: ok });
      }

      case "getRecurringExpenses":
        requireRole_(body.username, ["admin"]);
        return json_({ items: readObjects_("RecurringExpenses") });
      case "addRecurringExpense": {
        requireRole_(body.username, ["admin"]);
        const item = { id: newId_("rec"), name: body.name, amount: body.amount || 0, active: body.active !== false };
        appendObject_("RecurringExpenses", item);
        return json_({ ok: true, item: item });
      }
      case "updateRecurringExpense":
        requireRole_(body.username, ["admin"]);
        return json_({ ok: updateObjectById_("RecurringExpenses", body.id, body.patch) });
      case "deleteRecurringExpense":
        requireRole_(body.username, ["admin"]);
        return json_({ ok: deleteObjectById_("RecurringExpenses", body.id) });

      // Admin logs an actual payment of a recurring expense (rent paid this
      // month, etc). Always auto-approved — this isn't a cashier-facing
      // anti-theft surface.
      case "logRecurringExpensePayment": {
        requireRole_(body.username, ["admin"]);
        const entry = {
          id: newId_("ledg"), ts: Date.now(), amount: body.amount, direction: "outflow",
          type: "recurringExpense", category: body.name || "Recurring Expense", description: body.description || "",
          supplierId: null, staffUsername: body.username, status: "approved", receiptUrl: body.receiptUrl || null,
          paidFromDrawer: false, shiftId: null, materialId: null, qty: null, unitCost: null,
        };
        appendObject_("Ledger", entry);
        logActivity_({
          actorUsername: body.username, actorRole: "admin", actionType: "RECURRING_EXPENSE_PAID",
          description: "Logged payment of $" + body.amount + " for '" + body.name + "'",
          after: { name: body.name, amount: body.amount },
        });
        return json_({ ok: true, entry: entry });
      }

      // ---- Ledger / approvals (admin) ----
      case "getLedger":
        requireRole_(body.username, ["admin"]);
        return json_({ items: readObjects_("Ledger") });
      case "getPendingApprovals":
        requireRole_(body.username, ["admin"]);
        return json_({ items: readObjects_("Ledger").filter((l) => l.status === "pending") });

      case "approvePurchase": {
        requireRole_(body.username, ["admin"]);
        const ledger = readObjects_("Ledger");
        const entry = ledger.find((l) => l.id === body.ledgerId);
        if (!entry) return json_({ ok: false, error: "Entry not found" });
        if (entry.status !== "pending") return json_({ ok: false, error: "Entry is not pending" });
        // Only NOW does the purchase actually inject inventory.
        if (entry.materialId && entry.qty) {
          appendObject_("Batches", {
            id: newId_("batch"), materialId: entry.materialId, supplierId: entry.supplierId,
            qtyPurchased: entry.qty, qtyRemaining: entry.qty, unitCost: entry.unitCost,
            purchasedAt: entry.ts, source: entry.type === "stockedBatch" ? "stockedBatch" : "dailyFresh",
          });
        }
        updateObjectById_("Ledger", entry.id, { status: "approved" });
        logActivity_({
          actorUsername: body.username, actorRole: "admin", actionType: "EXPENSE_APPROVED", shiftId: entry.shiftId,
          description: "Approved purchase of " + entry.qty + " " + entry.materialId + " ($" + entry.amount.toFixed(2) + "), submitted by " + entry.staffUsername,
          before: { status: "pending" }, after: { status: "approved" },
        });
        return json_({ ok: true });
      }
      case "rejectPurchase": {
        requireRole_(body.username, ["admin"]);
        const before = readObjects_("Ledger").find((l) => l.id === body.ledgerId);
        updateObjectById_("Ledger", body.ledgerId, { status: "rejected", description: (body.reason ? "[Rejected: " + body.reason + "] " : "[Rejected] ") });
        logActivity_({
          actorUsername: body.username, actorRole: "admin", actionType: "EXPENSE_REJECTED", shiftId: before ? before.shiftId : null,
          description: "Rejected purchase submitted by " + (before ? before.staffUsername : "?") + (body.reason ? " — " + body.reason : ""),
          before: { status: "pending" }, after: { status: "rejected" },
        });
        return json_({ ok: true });
      }

      // ---- Void workflow ----
      case "requestVoid": {
        const role = requireRole_(body.username, ["admin", "cashier"]);
        if (!VOID_REASONS[body.reason]) return json_({ ok: false, error: "Invalid void reason" });
        const state = getState_();
        const room = state.rooms.find((r) => r.id === body.roomId);
        if (!room) return json_({ ok: false, error: "Room not found" });
        const line = room.orders.find((o) => o.menuItemId === body.menuItemId);
        if (!line || line.qty < body.qty || body.qty <= 0) return json_({ ok: false, error: "Invalid quantity to void" });

        const req = {
          id: newId_("void"), ts: Date.now(), roomId: room.id, roomName: room.name,
          menuItemId: body.menuItemId, itemName: line.name, qty: body.qty, unitPrice: line.price,
          billValue: line.price * body.qty, reason: body.reason,
          status: role === "admin" ? "approved" : "pending",
          cashierUsername: body.username, waiterName: body.waiterName || "",
          shiftId: state.activeShiftId, approvedBy: role === "admin" ? body.username : null,
          approvedAt: role === "admin" ? Date.now() : null, cogs: null, applied: false, applyError: null,
        };

        if (role === "admin") {
          // Cashiers have no authority to void independently — but an
          // admin-initiated void executes immediately, same auto-approve
          // pattern as procurement.
          const batches = readObjects_("Batches");
          const result = applyVoid_(state, batches, req);
          if (result.ok) {
            req.cogs = result.cogs;
            req.applied = true;
            setState_(result.state);
            writeBatchesBack_(batches, result.touchedBatchIds);
            const reasonCfg = VOID_REASONS[body.reason];
            if (reasonCfg.deductsInventory && result.cogs > 0) {
              appendObject_("Ledger", {
                id: newId_("ledg"), ts: req.ts, amount: result.cogs, direction: "outflow", type: "manualAdjustment",
                category: reasonCfg.ledgerCategory, description: req.qty + "x " + req.itemName + " — " + room.name,
                supplierId: null, staffUsername: body.username, status: "approved", receiptUrl: null,
                paidFromDrawer: false, shiftId: state.activeShiftId, materialId: null, qty: null, unitCost: null,
              });
            }
          } else {
            req.applyError = result.error;
          }
        }
        // Pending (cashier) requests intentionally do NOT touch the room or
        // batches — the item stays fully on the live bill (and therefore in
        // Expected Drawer Cash) until an admin approves it.
        appendObject_("VoidRequests", req);
        const wasteClass = (body.reason === "spilled" || body.reason === "customerRejected") ? "Wasted" : "Non-Waste";
        logActivity_({
          actorUsername: body.username, actorRole: role, actionType: "VOID_REQUESTED",
          location: room.name, shiftId: state.activeShiftId,
          description: req.qty + "x " + req.itemName + " voided (" + VOID_REASONS[body.reason].label + ", " + wasteClass + ") — " + req.status,
          before: { qty: line.qty }, after: { voided: req.qty, status: req.status, reason: body.reason, wasteClass: wasteClass },
        });
        return json_({ ok: true, request: req, state: withStockView_(getState_()) });
      }

      case "getVoidRequests":
        requireRole_(body.username, ["admin"]);
        return json_({ items: readObjects_("VoidRequests") });

      case "approveVoid": {
        requireRole_(body.username, ["admin"]);
        const requests = readObjects_("VoidRequests");
        const req = requests.find((r) => r.id === body.voidId);
        if (!req) return json_({ ok: false, error: "Void request not found" });
        if (req.status === "approved") return json_({ ok: true, state: withStockView_(getState_()) });

        const state = getState_();
        const batches = readObjects_("Batches");
        const result = applyVoid_(state, batches, req);
        if (!result.ok) {
          updateObjectById_("VoidRequests", req.id, { applyError: result.error });
          return json_({ ok: false, error: result.error });
        }
        setState_(result.state);
        writeBatchesBack_(batches, result.touchedBatchIds);
        updateObjectById_("VoidRequests", req.id, {
          status: "approved", approvedBy: body.username, approvedAt: Date.now(),
          cogs: result.cogs, applied: true, applyError: null,
        });
        const reasonCfg = VOID_REASONS[req.reason];
        if (reasonCfg && reasonCfg.deductsInventory && result.cogs > 0) {
          appendObject_("Ledger", {
            id: newId_("ledg"), ts: Date.now(), amount: result.cogs, direction: "outflow", type: "manualAdjustment",
            category: reasonCfg.ledgerCategory, description: req.qty + "x " + req.itemName + " — " + req.roomName,
            supplierId: null, staffUsername: body.username, status: "approved", receiptUrl: null,
            paidFromDrawer: false, shiftId: req.shiftId, materialId: null, qty: null, unitCost: null,
          });
        }
        logActivity_({
          actorUsername: body.username, actorRole: "admin", actionType: "VOID_APPROVED",
          location: req.roomName, shiftId: req.shiftId,
          description: "Approved void of " + req.qty + "x " + req.itemName + " (originally requested by " + req.cashierUsername + ")",
          before: { status: "pending" }, after: { status: "approved", cogs: result.cogs },
        });
        return json_({ ok: true, state: withStockView_(result.state) });
      }

      case "denyVoid": {
        requireRole_(body.username, ["admin"]);
        const before = readObjects_("VoidRequests").find((r) => r.id === body.voidId);
        updateObjectById_("VoidRequests", body.voidId, { status: "denied", approvedBy: body.username, approvedAt: Date.now() });
        logActivity_({
          actorUsername: body.username, actorRole: "admin", actionType: "VOID_DENIED",
          location: before ? before.roomName : "", shiftId: before ? before.shiftId : null,
          description: "Denied void request" + (before ? " for " + before.qty + "x " + before.itemName + " (requested by " + before.cashierUsername + ")" : ""),
          before: { status: "pending" }, after: { status: "denied" },
        });
        return json_({ ok: true });
      }

      case "setFraudThreshold": {
        requireRole_(body.username, ["admin"]);
        const state = getState_();
        const before = state.fraudThresholdPercent;
        state.fraudThresholdPercent = Number(body.percent) || 0;
        setState_(state);
        logActivity_({
          actorUsername: body.username, actorRole: "admin", actionType: "FRAUD_THRESHOLD_CHANGED",
          description: "Fraud threshold changed from " + before + "% to " + state.fraudThresholdPercent + "%",
          before: { percent: before }, after: { percent: state.fraudThresholdPercent },
        });
        return json_({ state: withStockView_(state) });
      }

      case "setGeofenceConfig": {
        requireRole_(body.username, ["admin"]);
        const state = getState_();
        const before = { enabled: state.geofenceEnabled, lat: state.cafeLat, lng: state.cafeLng, radiusMeters: state.geofenceRadiusMeters };
        state.geofenceEnabled = !!body.enabled;
        state.cafeLat = Number(body.lat) || 0;
        state.cafeLng = Number(body.lng) || 0;
        state.geofenceRadiusMeters = Number(body.radiusMeters) || 50;
        setState_(state);
        logActivity_({
          actorUsername: body.username, actorRole: "admin", actionType: "GEOFENCE_CONFIG_CHANGED",
          description: "Geofence config updated — enabled=" + state.geofenceEnabled + ", radius=" + state.geofenceRadiusMeters + "m",
          before: before, after: { enabled: state.geofenceEnabled, lat: state.cafeLat, lng: state.cafeLng, radiusMeters: state.geofenceRadiusMeters },
        });
        return json_({ state: withStockView_(state) });
      }

      case "getActivityLogs":
        requireRole_(body.username, ["admin"]);
        return json_({ items: readObjects_("ActivityLogs") });

      case "importMenuCatalog": {
        requireRole_(body.username, ["admin"]);
        const result = importMenuCatalog_();
        logActivity_({
          actorUsername: body.username, actorRole: "admin", actionType: "MENU_CATALOG_IMPORTED",
          description: "Imported menu catalog — " + result.materialsAdded + " new materials, " +
            result.itemsAdded + " new items, " + result.itemsUpdated + " items updated" +
            (result.itemsWithoutRecipe.length ? " (" + result.itemsWithoutRecipe.length + " without a recipe: " + result.itemsWithoutRecipe.join(", ") + ")" : ""),
          after: { materialsAdded: result.materialsAdded, itemsAdded: result.itemsAdded, itemsUpdated: result.itemsUpdated, itemsWithoutRecipe: result.itemsWithoutRecipe },
        });
        return json_({
          ok: true, materialsAdded: result.materialsAdded, itemsAdded: result.itemsAdded,
          itemsUpdated: result.itemsUpdated, itemsWithoutRecipe: result.itemsWithoutRecipe,
          state: withStockView_(result.state),
        });
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

// ---------- Full Menu Catalog Import (one-time, additive, admin) ----------
// Materials: [name, unit, minStockAlert]. Units are inferred from the scale
// of the recipe amounts given (kg for solids/powders, L for liquids/syrups,
// pcs for whole countable items, "bunch"/"scoop" for the two special cases).
function menuCatalogMaterials_() {
  return [
    ["Soda Can Base", "pcs", 10], ["Mojito Syrup", "L", 1], ["Fresh Mint", "bunch", 5],
    ["Lemon Wedges", "pcs", 20], ["Berry Topping", "L", 1], ["Raspberry Topping", "L", 1],
    ["Passion Fruit Topping", "L", 1], ["Strawberry Topping", "L", 1], ["Blue Curaçao Syrup", "L", 1],
    ["Cherry Syrup", "L", 1], ["Mango Topping", "L", 1], ["Smoothie Base Mix", "L", 1],
    ["Watermelon Syrup", "L", 1], ["Mint Syrup", "L", 1], ["Sugar", "kg", 2],
    ["Passion Fruit Syrup", "L", 1], ["Mango Syrup", "L", 1], ["Strawberry Syrup", "L", 1],
    ["Fresh Lemon", "pcs", 15], ["Fresh Mango", "kg", 2], ["Fresh Strawberry", "kg", 2],
    ["Fresh Guava", "kg", 2], ["Milk", "L", 3], ["Fresh Banana", "pcs", 10],
    ["Fresh Kiwi", "pcs", 10], ["Kiwi Syrup", "L", 1], ["Honey", "kg", 1],
    ["Fresh Watermelon", "kg", 2], ["Pomegranate Syrup", "L", 1], ["Fresh Pomegranate", "kg", 2],
    ["Lemon Syrup", "L", 1], ["Yogurt", "kg", 2], ["Coffee Beans / Espresso Grounds", "kg", 1],
    ["Sugar Scoop", "scoop", 20], ["Condensed Milk", "kg", 1], ["Chocolate Sauce", "L", 1],
    ["Instant Coffee (Nescafe)", "kg", 1], ["Hazelnut Coffee Grounds", "kg", 1], ["Nutella", "kg", 1],
    ["Plain Coffee Grounds", "kg", 1], ["French Coffee Grounds", "kg", 1], ["Vanilla Syrup", "L", 1],
    ["Vanilla Ice Cream", "kg", 2], ["Whipped Cream", "L", 1], ["Chocolate Ice Cream", "kg", 2],
    ["Oreo Biscuits", "pcs", 20], ["Lotus Biscoff Spread", "kg", 1], ["Lotus Biscuits", "pcs", 20],
    ["Pistachio Butter / Paste", "kg", 1], ["Caramel Sauce", "kg", 1], ["Kinder Sauce", "kg", 1],
    ["Frappe Powder", "kg", 1], ["Hazelnut Syrup", "L", 1],
  ];
}

function menuCatalogRecipes_() {
  return {
    "Mix Berry Mojito": [["Soda Can Base", 1.0], ["Mojito Syrup", 0.01], ["Fresh Mint", 0.5], ["Lemon Wedges", 1.0], ["Berry Topping", 0.01], ["Raspberry Topping", 0.01]],
    "Passion Fruit Mojito": [["Soda Can Base", 1.0], ["Mojito Syrup", 0.01], ["Fresh Mint", 0.5], ["Passion Fruit Topping", 0.02], ["Lemon Wedges", 1.0]],
    "Strawberry Mojito": [["Soda Can Base", 1.0], ["Lemon Wedges", 1.0], ["Mojito Syrup", 0.01], ["Strawberry Topping", 0.02], ["Fresh Mint", 0.5]],
    "Blue Sky Mojito": [["Soda Can Base", 1.0], ["Mojito Syrup", 0.01], ["Fresh Mint", 0.5], ["Lemon Wedges", 1.0], ["Blue Curaçao Syrup", 0.02]],
    "Cherry Mojito": [["Soda Can Base", 1.0], ["Mojito Syrup", 0.01], ["Fresh Mint", 0.5], ["Lemon Wedges", 1.0], ["Cherry Syrup", 0.02]],
    "Mango Mojito": [["Soda Can Base", 1.0], ["Mojito Syrup", 0.01], ["Fresh Mint", 0.5], ["Lemon Wedges", 1.0], ["Mango Topping", 0.02]],
    "Watermelon Mint": [["Smoothie Base Mix", 0.06], ["Watermelon Syrup", 0.02], ["Mint Syrup", 0.01], ["Sugar", 0.01]],
    "Passion Fruit Smoothie": [["Smoothie Base Mix", 0.06], ["Passion Fruit Topping", 0.03], ["Passion Fruit Syrup", 0.01], ["Sugar", 0.01]],
    "Mango Smoothie": [["Smoothie Base Mix", 0.06], ["Mango Topping", 0.03], ["Mango Syrup", 0.01], ["Sugar", 0.01]],
    "Strawberry Smoothie": [["Smoothie Base Mix", 0.06], ["Strawberry Topping", 0.03], ["Strawberry Syrup", 0.01], ["Sugar", 0.01]],
    "Lemon Mint Smoothie": [["Smoothie Base Mix", 0.06], ["Fresh Lemon", 2.0], ["Mint Syrup", 0.02], ["Fresh Mint", 0.5], ["Sugar", 0.03]],
    "Mango": [["Fresh Mango", 0.15], ["Mango Topping", 0.03], ["Sugar", 0.02]],
    "Strawberry": [["Fresh Strawberry", 0.15], ["Strawberry Topping", 0.03], ["Sugar", 0.03]],
    "Guava": [["Fresh Guava", 0.15], ["Milk", 0.05], ["Sugar", 0.03]],
    "Banana": [["Fresh Banana", 2.0], ["Milk", 0.15], ["Sugar", 0.02]],
    "Kiwi": [["Fresh Kiwi", 2.0], ["Kiwi Syrup", 0.01], ["Honey", 0.02]],
    "Watermelon": [["Fresh Watermelon", 0.2], ["Watermelon Syrup", 0.01], ["Sugar", 0.01]],
    "Pomegranate": [["Fresh Pomegranate", 0.15], ["Pomegranate Syrup", 0.02], ["Sugar", 0.02]],
    "Lemon": [["Fresh Lemon", 3.0], ["Lemon Syrup", 0.01], ["Sugar", 0.04]],
    "Lemon Mint": [["Fresh Lemon", 3.0], ["Mint Syrup", 0.02], ["Fresh Mint", 0.5], ["Sugar", 0.04]],
    "Classic Yogurt": [["Yogurt", 1.0], ["Milk", 0.1], ["Honey", 0.02]],
    "Espresso": [["Coffee Beans / Espresso Grounds", 0.009], ["Sugar Scoop", 1.0]],
    "Espresso Double": [["Coffee Beans / Espresso Grounds", 0.018], ["Sugar Scoop", 1.0]],
    "Macchiato": [["Coffee Beans / Espresso Grounds", 0.009], ["Milk", 0.02], ["Sugar Scoop", 1.0]],
    "Macchiato Double": [["Coffee Beans / Espresso Grounds", 0.018], ["Milk", 0.02], ["Sugar Scoop", 1.0]],
    "Cappuccino": [["Coffee Beans / Espresso Grounds", 0.009], ["Milk", 0.18], ["Sugar Scoop", 1.0]],
    "Latte": [["Coffee Beans / Espresso Grounds", 0.009], ["Milk", 0.2], ["Sugar Scoop", 1.0]],
    "Spanish Latte": [["Coffee Beans / Espresso Grounds", 0.009], ["Condensed Milk", 0.03], ["Milk", 0.17], ["Sugar Scoop", 1.0]],
    "Mocha": [["Coffee Beans / Espresso Grounds", 0.009], ["Chocolate Sauce", 0.02], ["Milk", 0.18], ["Sugar Scoop", 1.0]],
    "Cortado": [["Coffee Beans / Espresso Grounds", 0.009], ["Milk", 0.08], ["Sugar Scoop", 1.0]],
    "Nescafe": [["Instant Coffee (Nescafe)", 0.008], ["Milk", 0.2], ["Sugar Scoop", 1.0]],
    "Hazelnut Coffee": [["Hazelnut Coffee Grounds", 0.015], ["Milk", 0.1], ["Sugar Scoop", 1.0]],
    "Nutella Coffee": [["Plain Coffee Grounds", 0.015], ["Nutella", 0.02], ["Milk", 0.1], ["Sugar Scoop", 1.0]],
    "French Coffee": [["French Coffee Grounds", 0.015], ["Milk", 0.1], ["Sugar Scoop", 1.0]],
    "Turkish Coffee": [["Coffee Beans / Espresso Grounds", 0.012], ["Sugar Scoop", 1.0]],
    "Turkish Coffee Double": [["Coffee Beans / Espresso Grounds", 0.024], ["Sugar Scoop", 1.0]],
    "Iced Latte": [["Coffee Beans / Espresso Grounds", 0.018], ["Milk", 0.18], ["Vanilla Syrup", 0.01], ["Sugar Scoop", 1.0]],
    "Iced Spanish Latte": [["Coffee Beans / Espresso Grounds", 0.018], ["Condensed Milk", 0.03], ["Milk", 0.15], ["Sugar Scoop", 1.0]],
    "Iced Mocha": [["Coffee Beans / Espresso Grounds", 0.018], ["Chocolate Sauce", 0.025], ["Milk", 0.15], ["Sugar Scoop", 1.0]],
    "Iced Cappuccino": [["Coffee Beans / Espresso Grounds", 0.018], ["Milk", 0.18], ["Vanilla Syrup", 0.01], ["Sugar Scoop", 1.0]],
    "Vanilla Shake": [["Vanilla Ice Cream", 0.12], ["Milk", 0.1], ["Whipped Cream", 0.02]],
    "Chocolate Shake": [["Chocolate Ice Cream", 0.12], ["Chocolate Sauce", 0.02], ["Milk", 0.1], ["Whipped Cream", 0.02]],
    "Mango Shake": [["Vanilla Ice Cream", 0.1], ["Mango Topping", 0.04], ["Milk", 0.1], ["Whipped Cream", 0.02]],
    "Strawberry Shake": [["Vanilla Ice Cream", 0.1], ["Strawberry Topping", 0.04], ["Milk", 0.1], ["Whipped Cream", 0.02]],
    "Mix Berry Shake": [["Vanilla Ice Cream", 0.1], ["Berry Topping", 0.02], ["Raspberry Topping", 0.02], ["Milk", 0.1], ["Whipped Cream", 0.02]],
    "Passion Fruit Shake": [["Vanilla Ice Cream", 0.1], ["Passion Fruit Topping", 0.04], ["Milk", 0.1], ["Whipped Cream", 0.02]],
    "Oreo Shake": [["Vanilla Ice Cream", 0.1], ["Oreo Biscuits", 3.0], ["Chocolate Sauce", 0.015], ["Milk", 0.1], ["Whipped Cream", 0.02]],
    "Nutella Shake": [["Vanilla Ice Cream", 0.1], ["Nutella", 0.035], ["Milk", 0.1], ["Whipped Cream", 0.02]],
    "Lotus Shake": [["Vanilla Ice Cream", 0.1], ["Lotus Biscoff Spread", 0.03], ["Lotus Biscuits", 1.0], ["Milk", 0.1], ["Whipped Cream", 0.02]],
    "Pistachio Shake": [["Vanilla Ice Cream", 0.1], ["Pistachio Butter / Paste", 0.03], ["Milk", 0.1], ["Whipped Cream", 0.02]],
    "Caramel Shake": [["Vanilla Ice Cream", 0.1], ["Caramel Sauce", 0.035], ["Milk", 0.1], ["Whipped Cream", 0.02]],
    "Kinder Shake": [["Vanilla Ice Cream", 0.1], ["Kinder Sauce", 0.035], ["Milk", 0.1], ["Whipped Cream", 0.02]],
    "Classic Frappe": [["Frappe Powder", 0.04], ["Instant Coffee (Nescafe)", 0.005], ["Milk", 0.15], ["Whipped Cream", 0.02]],
    "Nutella Frappe": [["Frappe Powder", 0.035], ["Nutella", 0.03], ["Instant Coffee (Nescafe)", 0.005], ["Milk", 0.15], ["Whipped Cream", 0.02]],
    "Lotus Frappe": [["Frappe Powder", 0.035], ["Lotus Biscoff Spread", 0.025], ["Lotus Biscuits", 1.0], ["Milk", 0.15], ["Whipped Cream", 0.02]],
    "Caramel Frappe": [["Frappe Powder", 0.035], ["Caramel Sauce", 0.03], ["Instant Coffee (Nescafe)", 0.005], ["Milk", 0.15], ["Whipped Cream", 0.02]],
    "Hazelnut Frappe": [["Frappe Powder", 0.035], ["Hazelnut Syrup", 0.02], ["Instant Coffee (Nescafe)", 0.005], ["Milk", 0.15], ["Whipped Cream", 0.02]],
  };
}

// [name, price, category]. Items with no known recipe (Date, Avocado, a few
// smoothies/mojitos, and all Desserts) get an empty ingredient list — they
// won't deduct stock or track COGS until real recipes are supplied.
function menuCatalogItems_() {
  return [
    ["Espresso", 35, "Coffee"], ["Espresso Double", 45, "Coffee"], ["Macchiato", 35, "Coffee"],
    ["Macchiato Double", 50, "Coffee"], ["Cappuccino", 60, "Coffee"], ["Latte", 60, "Coffee"],
    ["Spanish Latte", 65, "Coffee"], ["Mocha", 60, "Coffee"], ["Cortado", 50, "Coffee"],
    ["Nescafe", 60, "Coffee"], ["Hazelnut Coffee", 60, "Coffee"], ["Nutella Coffee", 65, "Coffee"],
    ["French Coffee", 45, "Coffee"], ["Turkish Coffee", 30, "Coffee"], ["Turkish Coffee Double", 35, "Coffee"],
    ["Classic Frappe", 70, "Coffee Frappe"], ["Nutella Frappe", 75, "Coffee Frappe"], ["Lotus Frappe", 75, "Coffee Frappe"],
    ["Caramel Frappe", 80, "Coffee Frappe"], ["Hazelnut Frappe", 90, "Coffee Frappe"],
    ["Iced Latte", 70, "Ice Coffee"], ["Iced Spanish Latte", 75, "Ice Coffee"], ["Iced Mocha", 75, "Ice Coffee"], ["Iced Cappuccino", 70, "Ice Coffee"],
    ["Vanilla Shake", 60, "Milkshake"], ["Chocolate Shake", 65, "Milkshake"], ["Mango Shake", 70, "Milkshake"],
    ["Strawberry Shake", 65, "Milkshake"], ["Mix Berry Shake", 65, "Milkshake"], ["Passion Fruit Shake", 65, "Milkshake"],
    ["Oreo Shake", 70, "Milkshake"], ["Nutella Shake", 75, "Milkshake"], ["Lotus Shake", 75, "Milkshake"],
    ["Pistachio Shake", 80, "Milkshake"], ["Caramel Shake", 75, "Milkshake"], ["Kinder Shake", 75, "Milkshake"],
    ["Mango", 65, "Fresh Juice"], ["Strawberry", 60, "Fresh Juice"], ["Guava", 60, "Fresh Juice"], ["Banana", 60, "Fresh Juice"],
    ["Kiwi", 70, "Fresh Juice"], ["Watermelon", 65, "Fresh Juice"], ["Pomegranate", 60, "Fresh Juice"], ["Lemon", 45, "Fresh Juice"],
    ["Lemon Mint", 55, "Fresh Juice"], ["Date", 70, "Fresh Juice"], ["Avocado", 80, "Fresh Juice"], ["Classic Yogurt", 60, "Fresh Juice"],
    ["Watermelon Mint", 70, "Frozen Fresh"], ["Passion Fruit Smoothie", 65, "Frozen Fresh"], ["Mango Smoothie", 70, "Frozen Fresh"],
    ["Strawberry Smoothie", 70, "Frozen Fresh"], ["Lemon Mint Smoothie", 60, "Frozen Fresh"], ["Mix Berry Smoothie", 65, "Frozen Fresh"],
    ["Peach Smoothie", 65, "Frozen Fresh"], ["Pina Colada", 75, "Frozen Fresh"],
    ["Classic Mojito", 60, "Mojito"], ["Mix Berry Mojito", 65, "Mojito"], ["Strawberry Mojito", 65, "Mojito"],
    ["Passion Fruit Mojito", 70, "Mojito"], ["Blue Sky Mojito", 75, "Mojito"], ["Mango Mojito", 70, "Mojito"],
    ["Cherry Mojito", 70, "Mojito"], ["Peach Mojito", 65, "Mojito"], ["Red Bull Mojito", 90, "Mojito"],
    ["Molten Cake", 70, "Desserts"], ["Cheesecake", 70, "Desserts"], ["Brownies", 65, "Desserts"],
    ["Waffle Nutella", 75, "Desserts"], ["Waffle Four Seasons", 85, "Desserts"],
  ];
}

function slugify_(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

// Additive + idempotent: matches existing materials/menu items by NAME so
// running this more than once (or after the placeholder seed) never
// duplicates anything — an existing item with a matching name gets its
// price/category/ingredients updated in place (same id, so past sessions
// referencing it stay intact); anything new gets appended.
function importMenuCatalog_() {
  const existingMaterials = readObjects_("RawMaterials");
  const materialIdByName = {};
  existingMaterials.forEach((m) => { materialIdByName[m.name.toLowerCase()] = m.id; });

  let materialsAdded = 0;
  menuCatalogMaterials_().forEach((row) => {
    const name = row[0], unit = row[1], minStockAlert = row[2];
    const key = name.toLowerCase();
    if (materialIdByName[key]) return;
    const id = "mat-" + slugify_(name);
    appendObject_("RawMaterials", { id: id, name: name, unit: unit, minStockAlert: minStockAlert });
    materialIdByName[key] = id;
    materialsAdded++;
  });

  const recipes = menuCatalogRecipes_();
  const state = getState_();
  const existingByName = {};
  state.menu.forEach((m, idx) => { existingByName[m.name.toLowerCase()] = idx; });

  let itemsAdded = 0, itemsUpdated = 0, itemsWithoutRecipe = [];
  menuCatalogItems_().forEach((row) => {
    const name = row[0], price = row[1], category = row[2];
    const recipeRows = recipes[name] || [];
    if (recipeRows.length === 0) itemsWithoutRecipe.push(name);
    const ingredients = recipeRows.map((r) => ({ stockId: materialIdByName[r[0].toLowerCase()], qty: r[1] }));
    const existingIdx = existingByName[name.toLowerCase()];
    if (existingIdx !== undefined) {
      const existing = state.menu[existingIdx];
      state.menu[existingIdx] = Object.assign({}, existing, { price: price, category: category, ingredients: ingredients });
      itemsUpdated++;
    } else {
      state.menu.push({ id: "item-" + slugify_(name), name: name, price: price, category: category, ingredients: ingredients });
      itemsAdded++;
    }
  });
  setState_(state);

  return {
    ok: true, materialsAdded: materialsAdded, itemsAdded: itemsAdded, itemsUpdated: itemsUpdated,
    itemsWithoutRecipe: itemsWithoutRecipe, state: state,
  };
}


function withStockView_(state) {
  if (!state) return state;
  const materials = readObjects_("RawMaterials");
  const batches = readObjects_("Batches");
  state.stock = computeStockView_(materials, batches);
  state.pendingVoidCountForActiveShift = pendingVoidCountForShift_(state.activeShiftId);
  // Sessions live in their own sheet now (see the 50,000-char single-cell
  // limit note in getState_/setState_ below) — always attach the current
  // set fresh, same pattern as stock.
  state.sessions = readSessions_();
  state.shifts = readShifts_();
  return state;
}

// Submitting a purchase/expense — a stocked batch delivery, a daily-fresh
// item, or a mid-shift purchase. Admin submissions are auto-approved
// (inventory + ledger effective immediately). Cashier submissions are
// `pending` and have NO effect until an admin approves them. A receipt
// photo is mandatory either way.
function handleSubmitPurchase_(body) {
  if (!body.secret || body.secret !== getSecret_()) return json_({ error: "forbidden" });
  let role;
  try {
    role = requireRole_(body.username, ["admin", "cashier"]);
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
  if (!body.receiptBase64) {
    return json_({ ok: false, error: "A receipt photo is required to submit a purchase." });
  }
  if (!body.materialId || !body.qty || !body.unitCost) {
    return json_({ ok: false, error: "Material, quantity, and cost are required." });
  }

  let receiptUrl;
  try {
    receiptUrl = uploadReceipt_(body.receiptBase64, body.receiptMimeType, "receipt-" + Date.now() + ".jpg");
  } catch (err) {
    return json_({ ok: false, error: "Receipt upload failed: " + String(err) });
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const amount = Number(body.qty) * Number(body.unitCost);
    const isAdmin = role === "admin";
    const entry = {
      id: newId_("ledg"),
      ts: Date.now(),
      amount: amount,
      direction: "outflow",
      type: body.purchaseType, // "stockedBatch" | "dailyFresh" | "midShiftPurchase"
      category: body.category || "Procurement",
      description: body.description || "",
      supplierId: body.supplierId || null,
      staffUsername: body.username,
      status: isAdmin ? "approved" : "pending",
      receiptUrl: receiptUrl,
      paidFromDrawer: body.paidFromDrawer !== false,
      shiftId: body.shiftId || null,
      materialId: body.materialId,
      qty: body.qty,
      unitCost: body.unitCost,
    };
    appendObject_("Ledger", entry);

    if (isAdmin) {
      // Auto-approved: inventory lands immediately.
      appendObject_("Batches", {
        id: newId_("batch"), materialId: body.materialId, supplierId: body.supplierId || null,
        qtyPurchased: body.qty, qtyRemaining: body.qty, unitCost: body.unitCost, purchasedAt: entry.ts,
        source: body.purchaseType === "stockedBatch" ? "stockedBatch" : "dailyFresh",
      });
    }

    logActivity_({
      actorUsername: body.username, actorRole: role, actionType: "EXPENSE_LOGGED", shiftId: entry.shiftId,
      description: (isAdmin ? "Logged & auto-approved" : "Submitted (pending)") + " " + body.purchaseType + ": " + body.qty + " " + body.materialId + " for $" + amount.toFixed(2),
      after: { status: entry.status, amount: amount, materialId: body.materialId, qty: body.qty },
    });

    return json_({ ok: true, status: entry.status, entry: entry });
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
        if (!parsed.shifts) parsed.shifts = [];
        if (parsed.activeShiftId === undefined) parsed.activeShiftId = null;
        if (typeof parsed.fraudThresholdPercent !== "number") parsed.fraudThresholdPercent = 2;
        if (typeof parsed.geofenceEnabled !== "boolean") parsed.geofenceEnabled = false;
        if (typeof parsed.cafeLat !== "number") parsed.cafeLat = 0;
        if (typeof parsed.cafeLng !== "number") parsed.cafeLng = 0;
        if (typeof parsed.geofenceRadiusMeters !== "number") parsed.geofenceRadiusMeters = 50;
        if (parsed.menu) {
          parsed.menu = parsed.menu.map(function (m) {
            return m.category ? m : Object.assign({}, m, { category: "Extras" });
          });
        }
        if (parsed.rooms) {
          parsed.rooms = parsed.rooms.map(function (r) {
            const withZone = r.zone ? r : Object.assign({}, r, { zone: "room", splitInvoiceNumber: null, transferredFrom: null });
            const withOwnerFlag = typeof withZone.isOwnerTable === "boolean" ? withZone : Object.assign({}, withZone, { isOwnerTable: false });
            const withPauseFields = typeof withOwnerFlag.isPaused === "boolean"
              ? withOwnerFlag
              : Object.assign({}, withOwnerFlag, { isPaused: false, pausedAt: null, pausedDurationSec: 0 });
            if (typeof withPauseFields.singleRate === "number") return withPauseFields;
            const legacyRate = typeof withPauseFields.hourlyRate === "number" ? withPauseFields.hourlyRate : 0;
            return Object.assign({}, withPauseFields, {
              singleRate: withPauseFields.zone === "room" ? (legacyRate || 5) : 0,
              multiRate: withPauseFields.zone === "room" ? (legacyRate ? legacyRate * 1.6 : 8) : 0,
              rateMode: withPauseFields.status === "active" && withPauseFields.zone === "room" ? "single" : null,
              hourlyRate: withPauseFields.status === "active" ? legacyRate : 0,
            });
          });
          const hasLounge = parsed.rooms.some(function (r) { return r.zone === "lounge" && !r.isOwnerTable; });
          if (!hasLounge) {
            for (let i = 1; i <= 4; i++) {
              parsed.rooms.push({ id: "lounge-" + i, name: "Lounge Table " + i, isVip: false, hourlyRate: 0, singleRate: 0, multiRate: 0, rateMode: null, status: "available", startedAt: null, orders: [], zone: "lounge", splitInvoiceNumber: null, transferredFrom: null, isOwnerTable: false, isPaused: false, pausedAt: null, pausedDurationSec: 0 });
            }
          }
          const hasOwnerTables = parsed.rooms.some(function (r) { return r.isOwnerTable; });
          if (!hasOwnerTables) {
            for (let i = 1; i <= 6; i++) {
              parsed.rooms.push({ id: "owner-" + i, name: "Owner Table " + i, isVip: false, hourlyRate: 0, singleRate: 0, multiRate: 0, rateMode: null, status: "available", startedAt: null, orders: [], zone: "lounge", splitInvoiceNumber: null, transferredFrom: null, isOwnerTable: true, isPaused: false, pausedAt: null, pausedDurationSec: 0 });
            }
          }
        }
        // ---- Migrate away from embedding sessions in this blob ----
        // Sessions grow forever (one per checkout, forever) and this cell
        // hit Google Sheets' 50,000-character single-cell limit, breaking
        // every checkout. Move any still-embedded sessions to their own
        // sheet ONE time (only if that sheet is still empty, so this never
        // re-runs or duplicates), then never store sessions here again —
        // they're attached fresh from the Sessions sheet in
        // withStockView_ instead, same pattern as `stock`.
        if (parsed.sessions && parsed.sessions.length > 0) {
          const sessionsSheet = getSheet_("Sessions");
          if (sessionsSheet.getLastRow() <= 1) {
            parsed.sessions.forEach(function (s) { appendSessionRow_(s); });
          }
        }
        if (parsed.shifts && parsed.shifts.length > 0) {
          const shiftsSheet = getSheet_("Shifts");
          if (shiftsSheet.getLastRow() <= 1) {
            parsed.shifts.forEach(function (sh) { appendObject_("Shifts", sh); });
          }
        }
        delete parsed.sessions;
        delete parsed.shifts;
        delete parsed.stock; // stock is always a computed view now, never persisted
        delete parsed.pendingVoidCountForActiveShift; // also computed, never persisted
        return parsed;
      } catch (e) {
        return defaultAppState_();
      }
    }
  }
  return defaultAppState_();
}

function setState_(state) {
  const toSave = Object.assign({}, state);
  delete toSave.stock; // never persist the computed view
  delete toSave.pendingVoidCountForActiveShift; // also computed, never persisted
  delete toSave.sessions; // sessions live in their own sheet now — see getState_ above
  const sheet = getSheet_(STATE_SHEET);
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (values[i][0] === "app") {
      sheet.getRange(i + 1, 2).setValue(JSON.stringify(toSave));
      return;
    }
  }
  sheet.appendRow(["app", JSON.stringify(toSave)]);
}
