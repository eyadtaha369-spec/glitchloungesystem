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

  ["RawMaterials", "Suppliers", "RecurringExpenses", "Batches", "Ledger", "VoidRequests", "ActivityLogs", "Sessions", "Shifts", "StaffOrders", "StaffMembers", "StaffAllowanceUsage", "RestockLog", "BusinessDays"].forEach(function (name) {
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
    rooms.push({ id: "room-" + i, name: "Room " + i, isVip: false, hourlyRate: 0, singleRate: 5, multiRate: 8, rateMode: null, status: "available", startedAt: null, orders: [], zone: "room", splitInvoiceNumber: null, transferredFrom: null, isOwnerTable: false, isPaused: false, pausedAt: null, pausedDurationSec: 0, timeAdjustmentSec: 0 });
  }
  rooms.push({ id: "room-vip", name: "VIP", isVip: true, hourlyRate: 0, singleRate: 10, multiRate: 15, rateMode: null, status: "available", startedAt: null, orders: [], zone: "room", splitInvoiceNumber: null, transferredFrom: null, isOwnerTable: false, isPaused: false, pausedAt: null, pausedDurationSec: 0, timeAdjustmentSec: 0 });
  for (let i = 1; i <= 6; i++) {
    rooms.push({ id: "lounge-" + i, name: "Lounge Table " + i, isVip: false, hourlyRate: 0, singleRate: 0, multiRate: 0, rateMode: null, status: "available", startedAt: null, orders: [], zone: "lounge", splitInvoiceNumber: null, transferredFrom: null, isOwnerTable: false, isPaused: false, pausedAt: null, pausedDurationSec: 0, timeAdjustmentSec: 0 });
  }
  for (let i = 1; i <= 6; i++) {
    rooms.push({ id: "owner-" + i, name: "Owner Table " + i, isVip: false, hourlyRate: 0, singleRate: 0, multiRate: 0, rateMode: null, status: "available", startedAt: null, orders: [], zone: "lounge", splitInvoiceNumber: null, transferredFrom: null, isOwnerTable: true, isPaused: false, pausedAt: null, pausedDurationSec: 0, timeAdjustmentSec: 0 });
  }
  // Wasted / Marketing virtual table — always "active" (no start/end
  // step), a permanent fixture. Items added here deduct real inventory
  // but settle instantly as a Marketing/Waste expense, never revenue.
  rooms.push({ id: "waste-marketing", name: "Wasted / Marketing / هدر وماركتينج", isVip: false, hourlyRate: 0, singleRate: 0, multiRate: 0, rateMode: null, status: "active", startedAt: Date.now(), orders: [], zone: "waste", splitInvoiceNumber: null, transferredFrom: null, isOwnerTable: false, isPaused: false, pausedAt: null, pausedDurationSec: 0, timeAdjustmentSec: 0 });
  return {
    rooms: rooms, menu: menu, sessions: [], activity: [], cashRecords: [],
    actualCashInput: 0, shifts: [], activeShiftId: null, businessDayId: null, orderCounter: 0, fraudThresholdPercent: 2,
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
    RawMaterials: ["id", "name", "unit", "minStockAlert", "unitCost", "actualStock", "actualStockUpdatedAt", "actualStockUpdatedBy", "openingStock", "category", "storageLocation", "lastPurchaseCost"],
    Suppliers: ["id", "name", "contact", "category"],
    RecurringExpenses: ["id", "name", "amount", "active"],
    Batches: ["id", "materialId", "supplierId", "qtyPurchased", "qtyRemaining", "unitCost", "purchasedAt", "source", "invoiceId", "ledgerId"],
    Ledger: ["id", "ts", "amount", "direction", "type", "category", "description", "supplierId", "staffUsername", "status", "receiptUrl", "paidFromDrawer", "shiftId", "materialId", "qty", "unitCost", "paymentSource", "paymentStatus"],
    PurchaseInvoices: ["id", "supplierId", "supplierName", "invoiceDate", "paymentType", "totalAmount", "createdAt", "createdBy", "paymentSource"],
    PurchaseInvoiceItems: ["id", "invoiceId", "materialId", "materialName", "qty", "unitPrice", "subtotal"],
    SupplierPayments: ["id", "supplierId", "ts", "amount", "paymentSource", "note", "recordedBy", "ledgerEntryId"],
    VoidRequests: ["id", "ts", "roomId", "roomName", "menuItemId", "itemName", "qty", "unitPrice", "billValue", "reason", "status", "cashierUsername", "waiterName", "shiftId", "approvedBy", "approvedAt", "cogs", "applied", "applyError"],
    ActivityLogs: ["id", "ts", "actorUsername", "actorRole", "actionType", "location", "riskLevel", "description", "before", "after", "shiftId"],
    Sessions: ["id", "orderNumber", "roomId", "roomName", "startedAt", "endedAt", "durationSec", "timeCost", "orders", "ordersCost", "total", "cogs", "discountAmount", "discountLabel", "timeDiscountAmount", "timeDiscountLabel", "ordersDiscountAmount", "ordersDiscountLabel", "splitBill", "paymentMethod", "cashAmount", "visaAmount", "instapayAmount", "shiftId", "rateSegments"],
    Shifts: ["id", "cashierUsername", "openedAt", "closedAt", "openingBalance", "closingActualCash", "expectedCash", "discrepancy", "forced", "openedLat", "openedLng", "closedLat", "closedLng", "businessDayId", "kotCounter"],
    StaffOrders: ["id", "ts", "staffName", "items", "totalAmount", "cogs", "processedBy", "shiftId"],
    StaffMembers: ["id", "name", "active"],
    StaffAllowanceUsage: ["id", "shiftId", "staffId", "teaClaimed", "coffeeClaimed"],
    RestockLog: ["id", "ts", "materialId", "materialName", "qtyAdded", "carryoverAdded", "newTotal", "unitCost", "performedBy"],
    WasteInvoices: ["id", "invoiceNumber", "ts", "materialId", "materialName", "unit", "wastedQty", "reason", "reasonLabel", "note", "unitCost", "totalCost", "loggedBy", "shiftId"],
    InventorySnapshots: ["id", "month", "archivedAt", "materialId", "materialName", "unit", "category", "openingBalance", "purchasesIn", "salesWasteOut", "finalSystemBalance", "finalActualCount", "unitCost", "totalValue", "archivedBy"],
    BusinessDays: ["id", "label", "openedAt", "closedAt", "totalRevenue", "totalCash", "totalVisa", "totalInstapay", "totalExpenses", "netProfit", "shiftCount", "closedBy"],
    DailyReconciliations: ["id", "shiftId", "dateLabel", "recordedAt", "recordedBy", "totalRevenue", "instapayTotal", "visaTotal", "expensesTotal", "expectedCash", "actualCash", "variance"],
  };
  return map[name];
}

// Sessions carry an `orders` array, which the generic row helpers can't
// serialize on their own — JSON-encode/decode just that one field. A
// single session's own JSON is small (one order list), nowhere near the
// per-cell limit that broke the old single-blob-holds-everything design.
function sessionToRow_(s) {
  return {
    id: s.id, orderNumber: s.orderNumber || 0, roomId: s.roomId, roomName: s.roomName, startedAt: s.startedAt, endedAt: s.endedAt,
    durationSec: s.durationSec, timeCost: s.timeCost, orders: JSON.stringify(s.orders || []),
    ordersCost: s.ordersCost, total: s.total, cogs: s.cogs,
    discountAmount: s.discountAmount || 0, discountLabel: s.discountLabel || null,
    timeDiscountAmount: s.timeDiscountAmount || 0, timeDiscountLabel: s.timeDiscountLabel || null,
    ordersDiscountAmount: s.ordersDiscountAmount || 0, ordersDiscountLabel: s.ordersDiscountLabel || null,
    splitBill: !!s.splitBill,
    paymentMethod: s.paymentMethod, cashAmount: s.cashAmount, visaAmount: s.visaAmount,
    instapayAmount: s.instapayAmount, shiftId: s.shiftId,
    rateSegments: JSON.stringify(s.rateSegments || []),
  };
}
function rowToSession_(r) {
  let orders = [];
  try { orders = JSON.parse(r.orders || "[]"); } catch (e) { orders = []; }
  let rateSegments = [];
  try { rateSegments = JSON.parse(r.rateSegments || "[]"); } catch (e) { rateSegments = []; }
  return Object.assign({}, r, {
    orders: orders, rateSegments: rateSegments, splitBill: !!r.splitBill, orderNumber: Number(r.orderNumber) || 0,
    discountAmount: Number(r.discountAmount) || 0, discountLabel: r.discountLabel || null,
    timeDiscountAmount: Number(r.timeDiscountAmount) || 0, timeDiscountLabel: r.timeDiscountLabel || null,
    ordersDiscountAmount: Number(r.ordersDiscountAmount) || 0, ordersDiscountLabel: r.ordersDiscountLabel || null,
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
function readBusinessDays_() {
  return readObjects_("BusinessDays").sort(function (a, b) { return b.openedAt - a.openedAt; });
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
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    return;
  }
  // Migration for existing sheets: readObjects_/appendObject_ always use
  // THIS headers array (not whatever the sheet's row 1 actually says) to
  // decide column position — so data stays correct either way. But if a
  // feature adds new columns and this sheet predates that, its visible
  // header row would silently fall behind reality. Extend it to match.
  const currentHeaderRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (currentHeaderRow.length < headers.length) {
    sheet.getRange(1, currentHeaderRow.length + 1, 1, headers.length - currentHeaderRow.length)
      .setValues([headers.slice(currentHeaderRow.length)]);
  }
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
  ROOM_PAUSED: "green", ROOM_RESUMED: "green", BUSINESS_DAY_CLOSED: "yellow", PRODUCTION_RESET: "red", WASTE_MARKETING_LOGGED: "yellow", ROOM_TIME_EXTENDED: "green",
  CHECKOUT: "green", CHECKOUT_SPLIT_BILL: "yellow",
  VOID_REQUESTED: "red", VOID_APPROVED: "red", VOID_DENIED: "yellow", UNDO_ACTION: "red",
  UNAPPROVED_VOID_ROUTED: "red", UNAPPROVED_VOID_RECONCILED: "yellow", UNAPPROVED_VOID_FLAGGED: "red",
  EXPENSE_LOGGED: "yellow", EXPENSE_APPROVED: "yellow", EXPENSE_REJECTED: "yellow",
  RECURRING_EXPENSE_PAID: "yellow",
  ROOM_RATE_CHANGED: "red", MENU_PRICE_CHANGED: "red",
  SESSION_TRANSFERRED: "yellow", SPLIT_INTERFACE_OPENED: "yellow", SESSION_SPLIT: "yellow",
  ACCOUNT_CREATED: "yellow", ACCOUNT_ROLE_CHANGED: "red", ACCOUNT_PASSWORD_CHANGED: "yellow", ACCOUNT_DELETED: "red",
  RAW_MATERIAL_COST_CONTEXT: "yellow", SUPPLIER_CHANGED: "yellow", STOCK_ADJUSTED: "yellow", STOCK_RESTOCKED: "green", ACTUAL_STOCK_SET: "yellow",
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
  // Default Water Bottle: every new table session starts with 1x Water
  // already on the check — cashier can freely adjust or remove it (see
  // the setOrderLineQty bypass for this specific item, no approval
  // needed) if the customer doesn't want it.
  const waterItem = state.menu.find((m) => m.id === "item-water");
  const initialOrders = waterItem ? [{ menuItemId: waterItem.id, name: waterItem.name, qty: 1, price: waterItem.price }] : [];
  state.rooms = state.rooms.map((r) =>
    r.id === roomId ? Object.assign({}, r, { status: "active", startedAt: now, orders: initialOrders, hourlyRate: hourlyRate, rateMode: mode, timeAdjustmentSec: 0, isPaused: false, pausedAt: null, pausedDurationSec: 0, rateSegments: [] }) : r
  );
  pushActivity_(state, room.name + " session started" + (mode ? " (" + mode + " @ " + hourlyRate + " EGP/hr)" : ""));
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

// Once consumption happens immediately at order time (below), nothing
// stays "reserved but not yet consumed" — every active order's
// ingredients are already reflected in materialRemaining_ the moment
// they're added.
function bizCanFulfill_(state, batches, menuItemId, addQty) {
  const item = state.menu.find((m) => m.id === menuItemId);
  if (!item) return false;
  return item.ingredients.every((ing) => {
    const remaining = materialRemaining_(batches, ing.stockId);
    return remaining - ing.qty * addQty >= -1e-9;
  });
}

function bizAddOrder_(state, batches, roomId, menuItemId, qty) {
  if (!state.activeShiftId) return { ok: false, error: "No active shift — open a shift before taking orders.", state: state, touchedBatchIds: [], newBatches: [] };
  const item = state.menu.find((m) => m.id === menuItemId);
  if (!item) return { ok: false, error: "Item not found", state: state, touchedBatchIds: [], newBatches: [] };
  if (!bizCanFulfill_(state, batches, menuItemId, qty)) {
    return { ok: false, error: "Insufficient stock for " + item.name + "!", state: state, touchedBatchIds: [], newBatches: [] };
  }
  // Consumed the moment the order is placed — "Print Kitchen" happens
  // as part of this same action, not whenever the customer eventually
  // pays.
  let cogsDelta = 0;
  const touchedBatchIds = [];
  item.ingredients.forEach(function (ing) {
    const res = consumeFifo_(batches, ing.stockId, ing.qty * qty);
    cogsDelta += res.cost;
    touchedBatchIds.push.apply(touchedBatchIds, res.touched);
  });
  const room = state.rooms.find((r) => r.id === roomId);
  state.rooms = state.rooms.map((r) => {
    if (r.id !== roomId) return r;
    const existing = r.orders.find((o) => o.menuItemId === menuItemId);
    const newOrders = existing
      ? r.orders.map((o) => (o.menuItemId === menuItemId ? Object.assign({}, o, { qty: o.qty + qty }) : o))
      : r.orders.concat([{ menuItemId: menuItemId, name: item.name, qty: qty, price: item.price, printedQuantity: 0 }]);
    return Object.assign({}, r, { orders: newOrders, cogsAccrued: (r.cogsAccrued || 0) + cogsDelta });
  });
  pushActivity_(state, (room ? room.name : "Room") + " added " + qty + "x " + item.name);
  return { ok: true, state: state, touchedBatchIds: Array.from(new Set(touchedBatchIds)), newBatches: [] };
}

// Sets an order line to an EXACT qty (0 removes it). Ingredients were
// already consumed when this line was first added (or last increased)
// — an increase consumes the extra now; a decrease RESTORES exactly
// the delta being removed via a new batch, so a corrected quantity
// doesn't leave stock silently gone forever.
function bizSetOrderLineQty_(state, batches, roomId, menuItemId, qty) {
  const room = state.rooms.find((r) => r.id === roomId);
  if (!room) return { ok: false, error: "Room not found", state: state, touchedBatchIds: [], newBatches: [] };
  const line = room.orders.find((o) => o.menuItemId === menuItemId);
  if (!line) return { ok: false, error: "Item not on this check", state: state, touchedBatchIds: [], newBatches: [] };
  const item = state.menu.find((m) => m.id === menuItemId);
  const newQty = Math.max(0, Math.floor(qty));
  const delta = newQty - line.qty;

  if (delta > 0 && item && !bizCanFulfill_(state, batches, menuItemId, delta)) {
    return { ok: false, error: "Insufficient stock to increase " + item.name, state: state, touchedBatchIds: [], newBatches: [] };
  }

  let cogsDelta = 0;
  const touchedBatchIds = [];
  const newBatches = [];
  if (item && delta !== 0) {
    const now = Date.now();
    item.ingredients.forEach(function (ing) {
      const ingQty = ing.qty * Math.abs(delta);
      if (delta > 0) {
        const res = consumeFifo_(batches, ing.stockId, ingQty);
        cogsDelta += res.cost;
        touchedBatchIds.push.apply(touchedBatchIds, res.touched);
      } else {
        const matBatches = batches.filter(function (b) { return b.materialId === ing.stockId; });
        const newest = matBatches.reduce(function (a, b) { return (!a || b.purchasedAt > a.purchasedAt) ? b : a; }, null);
        const unitCost = newest ? newest.unitCost : 0;
        const res = restoreFifo_(batches, ing.stockId, ingQty, unitCost, now, "orderReduced");
        cogsDelta -= ingQty * unitCost;
        if (res.newBatch) newBatches.push(res.newBatch);
      }
    });
  }

  state.rooms = state.rooms.map((r) => {
    if (r.id !== roomId) return r;
    const orders = newQty <= 0
      ? r.orders.filter((o) => o.menuItemId !== menuItemId)
      : r.orders.map((o) => (o.menuItemId === menuItemId ? Object.assign({}, o, { qty: newQty, printedQuantity: Math.min(o.printedQuantity || 0, newQty) }) : o));
    return Object.assign({}, r, { orders: orders, cogsAccrued: (r.cogsAccrued || 0) + cogsDelta });
  });

  pushActivity_(
    state,
    room.name + ": " + (newQty <= 0 ? "removed " + line.name : "set " + line.name + " to x" + newQty),
  );
  return { ok: true, state: state, touchedBatchIds: Array.from(new Set(touchedBatchIds)), newBatches: newBatches };
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

// Called once a kitchen ticket has actually printed successfully — marks
// exactly the line items that were on that ticket as printed UP TO
// their current quantity (not a boolean), so a subsequent increase to
// the same item automatically becomes the new printable delta. See the
// local server's identical function for the full reasoning.
function bizMarkOrdersPrintedToKitchen_(state, roomId, menuItemIds) {
  const room = state.rooms.find((r) => r.id === roomId);
  if (!room) return { ok: false, error: "Room not found", state: state };
  const idSet = {};
  (menuItemIds || []).forEach(function (id) { idSet[id] = true; });
  state.rooms = state.rooms.map((r) => {
    if (r.id !== roomId) return r;
    return Object.assign({}, r, {
      orders: r.orders.map((o) => (idSet[o.menuItemId] ? Object.assign({}, o, { printedQuantity: o.qty }) : o)),
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

// Counterpart to consumeFifo_ — adds stock BACK. See the matching
// comment in the local server's state.js for the full reasoning: true
// FIFO reversal isn't retained across the add -> reduce/void lifecycle,
// so this creates one new batch at the material's current cost instead.
function restoreFifo_(batches, materialId, qty, unitCost, now, source) {
  if (qty <= 1e-9) return { touched: [] };
  const id = "batch-restore-" + now + "-" + Math.random().toString(36).slice(2, 7);
  const batch = { id: id, materialId: materialId, supplierId: null, qtyPurchased: qty, qtyRemaining: qty, unitCost: unitCost || 0, purchasedAt: now, source: source || "orderRestore" };
  batches.push(batch);
  return { touched: [id], newBatch: batch };
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
  return Math.max(0, raw - pausedSoFar + (room.timeAdjustmentSec || 0));
}

// Total elapsed time (effectiveDurationSec_) never needs to change
// when the rate mode switches mid-session — it stays the single
// running total for the whole room. What DOES change is how that
// total gets priced: each completed rate segment is frozen with its
// own duration and rate at the moment of the switch, and only the
// remainder (total minus everything already frozen) is billed at
// whatever the CURRENT rate is. This is what makes "1hr Single + 45min
// Multi" work correctly without ever resetting the underlying timer.
function computeTimeCost_(room, totalElapsedSec) {
  const segments = room.rateSegments || [];
  let cost = 0;
  let frozenSec = 0;
  segments.forEach(function (seg) {
    cost += (seg.durationSec / 3600) * seg.hourlyRate;
    frozenSec += seg.durationSec;
  });
  const currentSegmentSec = Math.max(0, totalElapsedSec - frozenSec);
  cost += (currentSegmentSec / 3600) * (room.hourlyRate || 0);
  return cost;
}

// How much of the total elapsed time belongs to the CURRENT (still
// running) segment — total minus everything already frozen.
function currentSegmentElapsedSec_(room, totalElapsedSec) {
  const frozenSec = (room.rateSegments || []).reduce(function (a, seg) { return a + seg.durationSec; }, 0);
  return Math.max(0, totalElapsedSec - frozenSec);
}

function bizSwitchRateMode_(state, roomId, newMode) {
  const room = state.rooms.find(function (r) { return r.id === roomId; });
  if (!room) return { ok: false, error: "Room not found", state: state };
  if (room.zone !== "room") return { ok: false, error: "Mode switching only applies to timed rooms.", state: state };
  if (room.status !== "active") return { ok: false, error: "Room is not active.", state: state };
  if (newMode !== "single" && newMode !== "multi") return { ok: false, error: "Select Single or Multi.", state: state };
  if (room.rateMode === newMode) return { ok: true, state: state }; // already in that mode, nothing to do

  const now = Date.now();
  const totalElapsed = effectiveDurationSec_(room, now);
  const frozenDurationSec = currentSegmentElapsedSec_(room, totalElapsed);
  const newHourlyRate = newMode === "single" ? room.singleRate : room.multiRate;

  const newSegments = (room.rateSegments || []).concat([{
    rateMode: room.rateMode, hourlyRate: room.hourlyRate, durationSec: frozenDurationSec,
  }]);

  state.rooms = state.rooms.map(function (r) {
    return r.id === roomId ? Object.assign({}, r, { rateMode: newMode, hourlyRate: newHourlyRate, rateSegments: newSegments }) : r;
  });

  const mins = Math.round(frozenDurationSec / 60);
  pushActivity_(state, room.name + " switched " + room.rateMode + " → " + newMode + " (froze " + mins + " min @ " + room.hourlyRate + " EGP/hr)");
  return { ok: true, state: state };
}

// Restores a previously closed check back to an active room/table —
// see the local server's identical function for the full reasoning.
// Two things this MUST get right: the room/table must not currently
// be occupied by something else, and the session record is REMOVED
// entirely once reopened (not just hidden), since its revenue is
// already reflected in past report totals — leaving it in place would
// double-count it the moment the room is checked out again.
function bizReopenSession_(state, session) {
  if (!state.activeShiftId) return { ok: false, error: "No active shift — open a shift before reopening a check.", state: state };
  const room = state.rooms.find(function (r) { return r.id === session.roomId; });
  if (!room) return { ok: false, error: "The original room/table no longer exists.", state: state };
  if (room.status === "active") return { ok: false, error: room.name + " is currently occupied by another active session — free it up first.", state: state };

  const now = Date.now();
  const newStartedAt = room.zone === "room" ? now - Math.round((session.durationSec || 0) * 1000) : (room.startedAt || now);

  const patch = {
    status: "active", startedAt: newStartedAt, orders: session.orders,
    isPaused: false, pausedAt: null, pausedDurationSec: 0, timeAdjustmentSec: 0, rateSegments: [],
  };
  if (room.zone === "room") {
    patch.hourlyRate = room.hourlyRate || room.singleRate || 0;
    patch.rateMode = room.rateMode || "single";
  } else {
    patch.hourlyRate = 0;
    patch.rateMode = null;
  }

  state.rooms = state.rooms.map(function (r) { return r.id === room.id ? Object.assign({}, r, patch) : r; });
  pushActivity_(state, "Reopened check #" + session.orderNumber + " (" + session.roomName + ") for correction — its prior revenue is removed from totals until it's checked out again.");
  return { ok: true, state: state };
}

// Flexible Time Extension/Reduction — either add a fixed increment
// (+15/+30/+60 min quick buttons), set a new target total duration, or
// (admin only) reduce time via a custom range. See the isAdmin gate
// below for the reduction-specific restriction.
function bizExtendRoomTime_(state, roomId, deltaSec, isAdmin) {
  const room = state.rooms.find((r) => r.id === roomId);
  if (!room) return { ok: false, error: "Room not found", state: state };
  if (room.zone !== "room") return { ok: false, error: "Time extension only applies to timed rooms", state: state };
  if (room.status !== "active") return { ok: false, error: "Room is not active", state: state };
  const delta = Math.round(Number(deltaSec) || 0);
  if (delta === 0) return { ok: false, error: "Enter a non-zero amount of time.", state: state };
  // Reducing time is a real under-billing risk if a cashier could do
  // it unsupervised — same reasoning as every other admin-gated
  // correction in this app. Cashiers can still add time as before.
  if (delta < 0 && !isAdmin) return { ok: false, error: "Only an admin can reduce time — ask an admin to make this correction.", state: state };
  if (delta < 0) {
    const currentElapsed = effectiveDurationSec_(room, Date.now());
    if (currentElapsed + delta < 0) {
      return { ok: false, error: "Can't reduce by that much — the session has only run " + Math.round(currentElapsed / 60) + " min so far.", state: state };
    }
  }

  state.rooms = state.rooms.map((r) =>
    r.id === roomId ? Object.assign({}, r, { timeAdjustmentSec: (r.timeAdjustmentSec || 0) + delta }) : r
  );
  const mins = Math.round(Math.abs(delta) / 60);
  pushActivity_(state, room.name + " time " + (delta > 0 ? "extended by +" : "reduced by -") + mins + " min" + (mins === 1 ? "" : "s"));
  return { ok: true, state: state };
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

// Settles everything currently sitting on the Wasted/Marketing virtual
// table: deducts real inventory (so stock counts stay accurate) but posts
// the cost as a Marketing/Waste Expense — NEVER as revenue, NEVER creates
// a Session, NEVER touches Expected Drawer Cash. Used for remakes,
// complaints, and complimentary hospitality items.
const WASTE_MARKETING_REASONS = {
  remakeWrongOrder: "Remake — Wrong Order",
  remakeComplaint: "Remake — Customer Complaint",
  complimentary: "Complimentary / VIP Hospitality",
  spilledDamaged: "Spilled / Damaged",
  marketingPromo: "Marketing / Promotional Giveaway",
  other: "Other",
};

function bizLogWasteMarketing_(state, batches, roomId, reason, note) {
  const room = state.rooms.find((r) => r.id === roomId);
  if (!room || room.zone !== "waste") return { ok: false, error: "This is only for the Wasted/Marketing table", state: state };
  if (room.orders.length === 0) return { ok: false, error: "Nothing on the Wasted/Marketing table to log", state: state };
  if (!WASTE_MARKETING_REASONS[reason]) return { ok: false, error: "Select a reason for this waste/marketing entry.", state: state };

  let cogs = 0;
  let retailValue = 0;
  const touchedBatchIds = [];
  const loggedItems = room.orders.slice();
  loggedItems.forEach((line) => {
    retailValue += line.qty * line.price;
    const menuItem = state.menu.find((m) => m.id === line.menuItemId);
    if (menuItem) {
      menuItem.ingredients.forEach((ing) => {
        const res = consumeFifo_(batches, ing.stockId, ing.qty * line.qty);
        cogs += res.cost;
        touchedBatchIds.push.apply(touchedBatchIds, res.touched);
      });
    }
  });

  state.rooms = state.rooms.map((r) => (r.id === roomId ? Object.assign({}, r, { orders: [] }) : r));
  pushActivity_(state, "Logged " + loggedItems.length + " item(s) as Wasted/Marketing (" + WASTE_MARKETING_REASONS[reason] + ") — " + cogs.toFixed(2) + " EGP" + " ingredient cost");
  return {
    ok: true, state: state, touchedBatchIds: Array.from(new Set(touchedBatchIds)),
    cogs: cogs, retailValue: retailValue, items: loggedItems, reason: reason, reasonLabel: WASTE_MARKETING_REASONS[reason], note: note || "",
  };
}

function computeDiscount_(base, type, value) {
  const v = Number(value) || 0;
  if (!type || v <= 0) return 0;
  const amt = type === "percent" ? base * (v / 100) : v;
  return Math.round(Math.max(0, Math.min(amt, base)) * 100) / 100;
}

function bizEndRoom_(state, batches, roomId, splitBill, paymentMethod, cashAmountInput, secondaryAmountInput, frozenAt, discountInput) {
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
  const timeCost = computeTimeCost_(room, durationSec);
  const ordersCost = room.orders.reduce((a, o) => a + o.qty * o.price, 0);
  const preDiscountTotal = timeCost + ordersCost;

  // Two independent, cashier-entered discounts (Time / Orders), each
  // fixed-EGP or percent, computed HERE from raw type+value — never from
  // a client-computed amount (same reasoning as the setAbsoluteStock
  // fix: the server must always be the one doing the math). When
  // neither is entered, Owner Tables keep their existing automatic 25%
  // discount unchanged — manual entry takes precedence when given.
  const di = discountInput || {};
  const hasManualDiscount = (Number(di.timeDiscountValue) || 0) > 0 || (Number(di.ordersDiscountValue) || 0) > 0;
  let timeDiscountAmount = 0, timeDiscountLabel = null, ordersDiscountAmount = 0, ordersDiscountLabel = null, discountAmount = 0, discountLabel = null;
  if (hasManualDiscount) {
    timeDiscountAmount = computeDiscount_(timeCost, di.timeDiscountType, di.timeDiscountValue);
    timeDiscountLabel = timeDiscountAmount > 0 ? "Time Discount" + (di.timeDiscountType === "percent" ? " (" + di.timeDiscountValue + "%)" : "") : null;
    ordersDiscountAmount = computeDiscount_(ordersCost, di.ordersDiscountType, di.ordersDiscountValue);
    ordersDiscountLabel = ordersDiscountAmount > 0 ? "Orders Discount" + (di.ordersDiscountType === "percent" ? " (" + di.ordersDiscountValue + "%)" : "") : null;
    discountAmount = timeDiscountAmount + ordersDiscountAmount;
    discountLabel = [timeDiscountLabel, ordersDiscountLabel].filter(Boolean).join(" + ") || null;
  } else if (room.isOwnerTable) {
    discountAmount = Math.round(preDiscountTotal * 0.25 * 100) / 100;
    discountLabel = "Owner Discount (25%)";
  }
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
        error: (method === "mixed_cash_visa" ? "Visa" : "InstaPay") + " amount (" + s.toFixed(2) + " EGP" + ") can't exceed the ticket total (" + total.toFixed(2) + " EGP" + ").",
      };
    }
    if (Math.abs(c + s - total) > 0.01) {
      return {
        session: null, state: state, touchedBatchIds: [],
        error: "Cash + " + (method === "mixed_cash_visa" ? "Visa" : "InstaPay") + " must equal the ticket total (" +
          total.toFixed(2) + " EGP). You entered " + (c + s).toFixed(2) + " EGP.",
      };
    }
    cashAmount = c;
    if (method === "mixed_cash_visa") visaAmount = s; else instapayAmount = s;
  }

  // Ingredients were already consumed as each order line was added (or
  // increased) — NOT re-consumed here. cogsAccrued is the running total
  // built up across every add/increase/decrease on this room, kept in
  // exact sync with the actual FIFO consumption that already happened.
  const cogs = room.cogsAccrued || 0;
  const touchedBatchIds = [];

  state.orderCounter = (state.orderCounter || 0) + 1;
  const session = {
    id: "sess-" + endedAt,
    orderNumber: state.orderCounter,
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
    timeDiscountAmount: timeDiscountAmount,
    timeDiscountLabel: timeDiscountLabel,
    ordersDiscountAmount: ordersDiscountAmount,
    ordersDiscountLabel: ordersDiscountLabel,
    splitBill: !!splitBill,
    paymentMethod: method,
    cashAmount: cashAmount,
    visaAmount: visaAmount,
    instapayAmount: instapayAmount,
    shiftId: state.activeShiftId || null,
    rateSegments: (room.rateSegments || []).concat(
      room.rateMode ? [{ rateMode: room.rateMode, hourlyRate: room.hourlyRate, durationSec: currentSegmentElapsedSec_(room, durationSec) }] : []
    ),
  };
  state.rooms = state.rooms.map((r) =>
    r.id === roomId ? Object.assign({}, r, { status: "available", startedAt: null, orders: [], cogsAccrued: 0 }) : r
  );
  // NOTE: the session is NOT added to state.sessions here anymore — it's
  // persisted directly to the dedicated Sessions sheet by the "endRoom"
  // doPost handler (appendSessionRow_), since sessions no longer live in
  // this blob at all (see getState_/setState_ for why).
  const paymentLabel = method === "mixed_cash_visa" ? "Cash " + cashAmount.toFixed(2) + " EGP" + " + Visa " + visaAmount.toFixed(2) + " EGP"
    : method === "mixed_cash_instapay" ? "Cash " + cashAmount.toFixed(2) + " EGP" + " + InstaPay " + instapayAmount.toFixed(2) + " EGP"
    : method;
  pushActivity_(state, room.name + " checked out - " + total.toFixed(2) + " EGP" + " collected (" + paymentLabel + ")");
  return { session: session, state: state, touchedBatchIds: Array.from(new Set(touchedBatchIds)), error: null };
}

// Closes a room/table as a Staff Order instead of a paid checkout. See
// the local server's identical function for the full reasoning —
// deliberately does NOT create a Session, and reuses room.cogsAccrued
// rather than re-consuming stock that was already deducted as each
// order line was added.
function bizEndRoomAsStaffOrder_(state, roomId, staffName, frozenAt) {
  const room = state.rooms.find(function (r) { return r.id === roomId; });
  if (!room || room.status !== "active") return { ok: false, error: "Room is not active", state: state };
  const trimmedName = (staffName || "").trim();
  if (!trimmedName) return { ok: false, error: "Staff member name is required", state: state };

  const now = Date.now();
  const endedAt = (typeof frozenAt === "number" && room.startedAt && frozenAt >= room.startedAt && frozenAt <= now) ? frozenAt : now;
  const durationSec = room.startedAt ? Math.max(1, Math.floor(effectiveDurationSec_(room, endedAt))) : 0;
  const timeCost = room.startedAt ? computeTimeCost_(room, durationSec) : 0;
  const ordersCost = room.orders.reduce(function (a, o) { return a + o.qty * o.price; }, 0);
  const totalAmount = timeCost + ordersCost;

  const orderLines = room.orders.slice();
  if (timeCost > 0) {
    orderLines.push({ menuItemId: "room-time", name: "Room Time (" + Math.round(durationSec / 60) + " min)", qty: 1, price: timeCost });
  }
  if (orderLines.length === 0) return { ok: false, error: "Nothing to log — this room/table has no orders or time charge yet.", state: state };

  const cogs = room.cogsAccrued || 0;
  const staffOrder = {
    id: "staff-" + now + "-" + Math.random().toString(36).slice(2, 7), ts: now, staffName: trimmedName,
    items: orderLines, totalAmount: totalAmount, cogs: cogs, processedBy: null, shiftId: state.activeShiftId || null,
  };

  state.rooms = state.rooms.map(function (r) {
    return r.id === roomId ? Object.assign({}, r, {
      status: "available", startedAt: null, orders: [], cogsAccrued: 0, rateSegments: [], timeAdjustmentSec: 0,
      isPaused: false, pausedAt: null, pausedDurationSec: 0, transferredFrom: null,
    }) : r;
  });
  pushActivity_(state, room.name + " closed as Staff Order for " + trimmedName + " — " + totalAmount.toFixed(2) + " EGP (excluded from revenue)");
  return { ok: true, state: state, staffOrder: staffOrder };
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
  const targetAlreadyActive = target.status === "active";
  if (target.zone === "room" && !targetAlreadyActive && rateMode !== "single" && rateMode !== "multi") {
    return { ok: false, error: "Select a Single or Multi rate to start " + target.name, state: state };
  }

  const now = Date.now();
  let durationSec = 0;
  let roomCharge = 0;
  if (source.zone === "room" && source.startedAt) {
    durationSec = Math.max(1, Math.floor(effectiveDurationSec_(source, now)));
    roomCharge = computeTimeCost_(source, durationSec);
  }

  state.rooms = state.rooms.map((r) => {
    if (r.id === sourceId) {
      return Object.assign({}, r, {
        status: "available", startedAt: null, orders: [],
        hourlyRate: 0, rateMode: r.zone === "room" ? null : r.rateMode,
        isPaused: false, pausedAt: null, pausedDurationSec: 0, timeAdjustmentSec: 0, rateSegments: [], transferredFrom: null,
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
        if (targetAlreadyActive) {
          // Merging into a room that's already running its own timer —
          // that timer, rate, its own pause state, and any frozen
          // segments continue completely untouched. Only the orders
          // and a frozen charge for the SOURCE's time get folded in.
        } else {
          const rate = rateMode === "single" ? r.singleRate : r.multiRate;
          // Starting the target fresh — see the local server's
          // identical fix for why this must reset pause/adjustment
          // leftovers from whatever session last ran in this room.
          Object.assign(patch, {
            status: "active", startedAt: now, hourlyRate: rate, rateMode: rateMode, rateSegments: [],
            isPaused: false, pausedAt: null, pausedDurationSec: 0, timeAdjustmentSec: 0,
          });
        }
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
      (roomCharge > 0 ? " (" + roomCharge.toFixed(2) + " EGP" + " room charge)" : "") +
      (target.zone === "room" ? (targetAlreadyActive ? " — merged into its running session" : " — started " + rateMode) : ""),
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
function bizSplitBill_(state, batches, roomId, mode, items, customAmount, paymentMethod, cashAmountInput, secondaryAmountInput, discountInput) {
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
      // Ingredients were already consumed when this item was originally
      // ordered — NOT consumed again here. Compute what portion of the
      // room's already-accrued cost belongs to what's being split off,
      // so it can be carved out of cogsAccrued rather than double-
      // counted when the rest of the room eventually checks out.
      const menuItem = state.menu.find((m) => m.id === req.menuItemId);
      if (menuItem) {
        menuItem.ingredients.forEach((ing) => {
          const ingQty = ing.qty * req.qty;
          const matBatches = batches.filter(function (b) { return b.materialId === ing.stockId; });
          const newest = matBatches.reduce(function (a, b) { return (!a || b.purchasedAt > a.purchasedAt) ? b : a; }, null);
          const unitCost = newest ? newest.unitCost : 0;
          cogs += ingQty * unitCost;
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
      return Object.assign({}, r, { orders: orders, cogsAccrued: (r.cogsAccrued || 0) - cogs });
    });
  } else if (mode === "amount") {
    const amt = Number(customAmount) || 0;
    if (amt <= 0) return { ok: false, error: "Enter a valid split amount", state: state };
    const durationSec = room.startedAt ? Math.max(1, Math.floor(effectiveDurationSec_(room, Date.now()))) : 0;
    const timeCostNow = room.hourlyRate ? computeTimeCost_(room, durationSec) : 0;
    const ordersCostNow = room.orders.reduce((a, o) => a + o.qty * o.price, 0);
    const currentTotal = timeCostNow + ordersCostNow;
    if (amt > currentTotal + 0.01) {
      return { ok: false, error: "Split amount (" + amt.toFixed(2) + " EGP" + ") exceeds the remaining balance (" + currentTotal.toFixed(2) + " EGP" + ")", state: state };
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
  // as a full checkout — itemized on the split receipt too. A manually
  // entered discount takes precedence when given, same rule as checkout.
  const preDiscountSplitTotal = splitTotal;
  const manualDiscountValue = Number(discountInput && discountInput.discountValue) || 0;
  let discountAmount, discountLabel;
  if (manualDiscountValue > 0) {
    discountAmount = computeDiscount_(preDiscountSplitTotal, discountInput.discountType, discountInput.discountValue);
    discountLabel = "Discount" + (discountInput.discountType === "percent" ? " (" + discountInput.discountValue + "%)" : "");
  } else if (room.isOwnerTable) {
    discountAmount = Math.round(preDiscountSplitTotal * 0.25 * 100) / 100;
    discountLabel = "Owner Discount (25%)";
  } else {
    discountAmount = 0;
    discountLabel = null;
  }
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
        error: (method === "mixed_cash_visa" ? "Visa" : "InstaPay") + " amount (" + s.toFixed(2) + " EGP" + ") can't exceed the sub-bill total (" + splitTotal.toFixed(2) + " EGP" + ").",
        state: state,
      };
    }
    if (Math.abs(c + s - splitTotal) > 0.01) {
      return {
        ok: false,
        error: "Cash + " + (method === "mixed_cash_visa" ? "Visa" : "InstaPay") + " must equal the split total (" + splitTotal.toFixed(2) + " EGP" + ").",
        state: state,
      };
    }
    cashAmount = c;
    if (method === "mixed_cash_visa") visaAmount = s; else instapayAmount = s;
  }

  const now = Date.now();
  state.orderCounter = (state.orderCounter || 0) + 1;
  const splitSession = {
    id: "split-" + now,
    orderNumber: state.orderCounter,
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

  pushActivity_(state, "Split payment of " + splitTotal.toFixed(2) + " EGP" + " taken on " + room.name + " (" + method + ")");
  return { ok: true, state: state, touchedBatchIds: Array.from(new Set(touchedBatchIds)), splitSession: splitSession };
}

// ---------- Void workflow ----------

// Actually executes a void: reduces (or removes) the qty on the room's LIVE
// order, and — if the reason requires it — consumes ingredients via FIFO
// right now, since they were physically used making the item. Returns the
// touched batch ids so only those get written back.
// Ingredients are now consumed the moment an order is placed (not at
// checkout), so by the time a void happens, they're ALREADY gone from
// stock either way. What differs by reason is whether to RESTORE that
// stock: wrongInput means it was caught before anything was actually
// made, so the ingredients were never really used — give them back.
// The other three reasons mean the item genuinely was made — stock
// correctly stays consumed, same net effect as before just reached by
// not restoring rather than by consuming now. The waste report still
// needs the cost figure for those reasons even without touching
// batches, computed the same way as everywhere else.
function applyVoid_(state, batches, req) {
  const room = state.rooms.find((r) => r.id === req.roomId);
  if (!room) return { ok: false, error: "Room not found", state: state, touchedBatchIds: [], newBatches: [] };
  const line = room.orders.find((o) => o.menuItemId === req.menuItemId);
  if (!line || line.qty < req.qty) {
    return { ok: false, error: "Item is no longer on the order as requested (checked out or already modified)", state: state, touchedBatchIds: [], newBatches: [] };
  }

  const reasonCfg = VOID_REASONS[req.reason];
  let cogsDelta = 0;
  let reportedWasteCost = 0;
  const touchedBatchIds = [];
  const newBatches = [];
  const item = state.menu.find((m) => m.id === req.menuItemId);
  if (reasonCfg && !reasonCfg.deductsInventory) {
    if (item) {
      const now = Date.now();
      item.ingredients.forEach(function (ing) {
        const ingQty = ing.qty * req.qty;
        const matBatches = batches.filter(function (b) { return b.materialId === ing.stockId; });
        const newest = matBatches.reduce(function (a, b) { return (!a || b.purchasedAt > a.purchasedAt) ? b : a; }, null);
        const unitCost = newest ? newest.unitCost : 0;
        const res = restoreFifo_(batches, ing.stockId, ingQty, unitCost, now, "voidRestore");
        cogsDelta -= ingQty * unitCost;
        if (res.newBatch) newBatches.push(res.newBatch);
      });
    }
  } else if (reasonCfg && reasonCfg.deductsInventory && item) {
    item.ingredients.forEach(function (ing) {
      const ingQty = ing.qty * req.qty;
      const matBatches = batches.filter(function (b) { return b.materialId === ing.stockId; });
      const newest = matBatches.reduce(function (a, b) { return (!a || b.purchasedAt > a.purchasedAt) ? b : a; }, null);
      const unitCost = newest ? newest.unitCost : 0;
      reportedWasteCost += ingQty * unitCost;
    });
  }

  state.rooms = state.rooms.map((r) => {
    if (r.id !== req.roomId) return r;
    const newQty = line.qty - req.qty;
    const orders = newQty <= 0
      ? r.orders.filter((o) => o.menuItemId !== req.menuItemId)
      : r.orders.map((o) => (o.menuItemId === req.menuItemId ? Object.assign({}, o, { qty: newQty }) : o));
    return Object.assign({}, r, { orders: orders, cogsAccrued: (r.cogsAccrued || 0) + cogsDelta });
  });

  pushActivity_(state, "VOID (" + (reasonCfg ? reasonCfg.label : req.reason) + "): " + req.qty + "x " + req.itemName + " — " + room.name);
  return { ok: true, state: state, cogs: reportedWasteCost > 0 ? reportedWasteCost : -cogsDelta, touchedBatchIds: Array.from(new Set(touchedBatchIds)), newBatches: newBatches };
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
  const now = Date.now();
  // 24/7 Business Day: auto-open one the moment the first shift of a fresh
  // period starts, if none is currently open. Stays open across any number
  // of shifts — including straight through midnight — until someone
  // explicitly closes it via Close Business Day.
  if (!state.businessDayId) {
    const bdId = "bday-" + now;
    appendObject_("BusinessDays", {
      id: bdId, label: formatDateLabel_(now), openedAt: now, closedAt: null,
      totalRevenue: 0, totalCash: 0, totalVisa: 0, totalInstapay: 0, totalExpenses: 0, netProfit: 0,
      shiftCount: 0, closedBy: null,
    });
    state.businessDayId = bdId;
    pushActivity_(state, "New business day opened (" + formatDateLabel_(now) + ")");
  }
  const id = "shift-" + now;
  const shift = {
    id: id,
    cashierUsername: username,
    openedAt: now,
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
    businessDayId: state.businessDayId,
    kotCounter: 0,
  };
  appendObject_("Shifts", shift);
  state.activeShiftId = id;
  state.actualCashInput = 0;
  pushActivity_(state, username + " opened a shift (opening balance " + (openingBalance || 0).toFixed(2) + " EGP)");
  return { ok: true, state: state };
}

function formatDateLabel_(ts) {
  const d = new Date(ts);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

// Scoped to the calendar day, not the currently active shift — a
// Scoped to the ACTIVE SHIFT, not the calendar day — per explicit
// confirmed decision, a "Business Day" here is defined strictly by a
// shift's own lifecycle (open to close), completely ignoring calendar
// dates and midnight. See server/lib/reconciliation.js for the full
// reasoning.
function bizComputeShiftFinancials_(sessions, ledger, shiftId) {
  if (!shiftId) return { shiftId: null, totalRevenue: 0, expensesTotal: 0 };
  const shiftSessions = sessions.filter(function (s) { return s.shiftId === shiftId; });
  const totalRevenue = shiftSessions.reduce(function (a, s) { return a + (Number(s.total) || 0); }, 0);
  const expensesTotal = ledger
    .filter(function (l) { return l.status === "approved" && l.paidFromDrawer && l.direction === "outflow" && l.shiftId === shiftId; })
    .reduce(function (a, l) { return a + (Number(l.amount) || 0); }, 0);
  return { shiftId: shiftId, totalRevenue: totalRevenue, expensesTotal: expensesTotal };
}

function bizBuildShiftReconciliation_(sessions, ledger, shiftId, actualCash, instapayTotal, visaTotal, recordedBy) {
  const financials = bizComputeShiftFinancials_(sessions, ledger, shiftId);
  const instapay = Number(instapayTotal) || 0;
  const visa = Number(visaTotal) || 0;
  const actual = Number(actualCash) || 0;

  // Per explicit confirmed business decision: Total Revenue minus the
  // manually entered Visa and InstaPay minus this shift's drawer
  // expenses — deliberately has no term for the shift's opening float,
  // confirmed and intentional.
  const expectedCash = financials.totalRevenue - visa - instapay - financials.expensesTotal;
  const now = Date.now();

  return {
    id: "shiftrecon-" + now,
    shiftId: shiftId,
    // Kept purely as a display label — the actual financial scoping
    // above uses shiftId, not this.
    dateLabel: formatDateLabel_(now),
    recordedAt: now,
    recordedBy: recordedBy,
    totalRevenue: financials.totalRevenue,
    instapayTotal: instapay,
    visaTotal: visa,
    expensesTotal: financials.expensesTotal,
    expectedCash: expectedCash,
    actualCash: actual,
    variance: actual - expectedCash,
  };
}

// Kitchen Order Ticket numbering: a clean sequential #001, #002... that
// resets to #001 at the start of every shift, instead of a random/hash
// number — makes it trivial for kitchen staff to notice a missed ticket.
function bizNextKotNumber_(shiftId) {
  const shifts = readObjects_("Shifts");
  const shift = shifts.find((s) => s.id === shiftId);
  if (!shift) return null;
  const next = (Number(shift.kotCounter) || 0) + 1;
  updateObjectById_("Shifts", shiftId, { kotCounter: next });
  return next;
}

// Expected Cash = Opening Balance + Cash Sales - Approved drawer-paid
// expenses logged against this shift. `forced` = true means this came
// from the admin emergency-reset path rather than a cashier's normal End
// Shift.
// Global End of Day: freezes and aggregates every shift, sale, and
// expense belonging to the currently open business day (which may span
// several shifts across midnight), commits the totals into BusinessDays,
// then clears businessDayId so the NEXT shift auto-opens a fresh one.
// Clears every DATA row from a sheet (keeps the header row intact) — used
// only by the Production Reset, never by normal business logic.
function clearSheetData_(sheetName) {
  const sheet = getSheet_(sheetName);
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow > 1 && lastCol > 0) {
    // clearContent() is dramatically faster than deleteRows() for large
    // sheets — deleteRows has to physically resize/reshuffle the sheet's
    // dimensions, which gets slower the more rows there are (exactly the
    // situation after months of accumulated Activity Logs). clearContent
    // just blanks the values in place, same end result for our purposes
    // since every read path here goes through readObjects_, which only
    // ever looks at actual populated rows.
    sheet.getRange(2, 1, lastRow - 1, lastCol).clearContent();
  }
}

// Production Reset / Go-Live Data Wipe — Super Admin only, requires the
// admin to re-enter their OWN password as a safeguard against an
// unattended logged-in session triggering this by accident. Deletes every
// transactional/test record; explicitly PRESERVES configuration data
// (menu, room definitions, employee accounts, suppliers, recurring
// expense templates, raw material definitions, geofence settings).
function resetForProduction_(username, password) {
  const auth = login_(username, password);
  if (!auth.ok || auth.role !== "admin") {
    return { ok: false, error: "Password incorrect — reset cancelled. Nothing was deleted." };
  }

  // Transactional / test data — WIPED.
  ["Sessions", "Shifts", "VoidRequests", "Ledger", "ActivityLogs", "StaffOrders", "StaffAllowanceUsage", "RestockLog", "Batches", "BusinessDays"]
    .forEach(function (name) { clearSheetData_(name); });

  // Configuration — PRESERVED (RawMaterials, Suppliers, RecurringExpenses,
  // Accounts are simply never touched here).

  const state = getState_();
  state.rooms = state.rooms.map(function (r) {
    return Object.assign({}, r, {
      status: "available", startedAt: null, orders: [],
      isPaused: false, pausedAt: null, pausedDurationSec: 0, timeAdjustmentSec: 0,
      hourlyRate: 0, rateMode: null, splitInvoiceNumber: null, transferredFrom: null,
    });
  });
  state.activeShiftId = null;
  state.businessDayId = null;
  state.actualCashInput = 0;
  state.activity = [];
  state.cashRecords = [];
  setState_(state);

  // This log entry is deliberately the FIRST thing written after the wipe —
  // proof the reset happened, permanently, even though everything before
  // it is gone.
  logActivity_({
    actorUsername: username, actorRole: "admin", actionType: "PRODUCTION_RESET",
    description: username + " performed a Go-Live Production Reset — all test orders, shifts, transactions, " +
      "and financial history were permanently deleted. Menu, room configuration, and employee accounts were preserved.",
  });

  return { ok: true, state: withStockView_(state) };
}

// More selective than resetForProduction_ above — that one wipes Ledger
// and Batches entirely (Ledger/Batches are treated as transactional
// history there). This one keeps them: RawMaterials, Batches,
// Suppliers, the full Ledger (both Expenses and Procurements),
// PurchaseInvoices/Items, SupplierPayments, and RecurringExpenses are
// all left untouched. Only genuinely test/transactional data — test
// sessions, shifts, void requests, activity logs, staff orders,
// restock log, business days, waste invoices, inventory snapshots —
// gets wiped.
function resetKeepingInventoryAndLedger_(username, password) {
  const auth = login_(username, password);
  if (!auth.ok || auth.role !== "admin") {
    return { ok: false, error: "Password incorrect — reset cancelled. Nothing was deleted." };
  }

  ["Sessions", "Shifts", "VoidRequests", "ActivityLogs", "StaffOrders", "StaffAllowanceUsage", "RestockLog", "BusinessDays", "WasteInvoices", "InventorySnapshots"]
    .forEach(function (name) { clearSheetData_(name); });

  const state = getState_();
  state.rooms = state.rooms.map(function (r) {
    return Object.assign({}, r, {
      status: "available", startedAt: null, orders: [],
      isPaused: false, pausedAt: null, pausedDurationSec: 0, timeAdjustmentSec: 0,
      hourlyRate: 0, rateMode: null, splitInvoiceNumber: null, transferredFrom: null,
    });
  });
  state.activeShiftId = null;
  state.businessDayId = null;
  state.actualCashInput = 0;
  state.activity = [];
  state.cashRecords = [];
  setState_(state);

  logActivity_({
    actorUsername: username, actorRole: "admin", actionType: "PRODUCTION_RESET",
    description: username + " reset test sessions/shifts/orders while keeping the current inventory, procurements, expenses, and suppliers intact.",
  });

  return { ok: true, state: withStockView_(state) };
}

// Wipes the ENTIRE stock system — every raw material, every batch,
// restock history, and waste invoice history — for a genuinely clean
// slate. Deliberately separate from Production Reset, which preserves
// RawMaterials/Batches as configuration. This is destructive to menu
// item recipes too: any menu item's ingredients will point at
// materials that no longer exist until recipes are rebuilt against the
// new material list.
// "اعتماد كبداية شهر جديد" — Monthly Rollover. For EVERY material:
// takes the current Actual Stock (physical count) if one has been
// entered, otherwise falls back to the current System Balance;
// consolidates all existing batches into ONE new batch representing
// that quantity; sets that as the new, permanently-locked Opening
// Stock for the new period; and clears the Actual Count so it
// correctly shows "not yet counted this period" until the next
// physical audit. Consolidating batches is what resets the
// Purchases/In and Sales & Waste/Out counters, since both are DERIVED
// from the full batch history.
function bizRolloverInventory_(username) {
  const materials = readObjects_("RawMaterials");
  const batches = readObjects_("Batches");

  const missing = materials.filter(function (m) { return m.actualStock === null || m.actualStock === undefined || m.actualStock === ""; });
  if (missing.length > 0) {
    return { ok: false, error: "Enter Actual Stock for all materials before confirming the audit — missing: " + missing.map(function (m) { return m.name; }).join(", ") };
  }

  const now = Date.now();
  const monthDate = new Date(now);
  const monthLabel = monthDate.getFullYear() + "-" + String(monthDate.getMonth() + 1).padStart(2, "0");
  let count = 0;

  materials.forEach(function (m) {
    const matBatches = batches.filter(function (b) { return b.materialId === m.id; });
    const initialStock = matBatches.reduce(function (a, b) { return a + Number(b.qtyPurchased); }, 0);
    const systemBalance = matBatches.reduce(function (a, b) { return a + Number(b.qtyRemaining); }, 0);
    const actualStock = (m.actualStock === null || m.actualStock === undefined || m.actualStock === "") ? null : Number(m.actualStock);
    const newOpening = actualStock !== null ? actualStock : systemBalance;

    // Snapshot the period that's ENDING, before the reset below wipes it.
    const openingStock = Number(m.openingStock) || 0;
    const purchasesIn = Math.round((initialStock - openingStock) * 1e6) / 1e6;
    const salesWasteOut = initialStock - systemBalance;
    const unitCost = Number(m.unitCost) || 0;
    appendObject_("InventorySnapshots", {
      id: newId_("snap"), month: monthLabel, archivedAt: now, materialId: m.id, materialName: m.name,
      unit: m.unit, category: m.category || "", openingBalance: openingStock, purchasesIn: purchasesIn,
      salesWasteOut: salesWasteOut, finalSystemBalance: systemBalance, finalActualCount: actualStock,
      unitCost: unitCost, totalValue: Math.round((actualStock !== null ? actualStock : systemBalance) * unitCost * 100) / 100,
      archivedBy: username || null,
    });

    matBatches.forEach(function (b) { updateObjectById_("Batches", b.id, { qtyPurchased: 0, qtyRemaining: 0 }); });
    if (newOpening > 0) {
      appendObject_("Batches", {
        id: newId_("batch"), materialId: m.id, supplierId: null,
        qtyPurchased: newOpening, qtyRemaining: newOpening, unitCost: m.unitCost,
        purchasedAt: now, source: "openingStock",
      });
    }
    updateObjectById_("RawMaterials", m.id, { openingStock: newOpening, actualStock: null, actualStockUpdatedAt: null, actualStockUpdatedBy: null });
    count++;
  });

  return { ok: true, count: count, month: monthLabel };
}

function resetInventory_(username, password) {
  const auth = login_(username, password);
  if (!auth.ok || auth.role !== "admin") {
    return { ok: false, error: "Password incorrect — reset cancelled. Nothing was deleted." };
  }

  ["RawMaterials", "Batches", "RestockLog", "WasteInvoices"].forEach(function (name) { clearSheetData_(name); });

  logActivity_({
    actorUsername: username, actorRole: "admin", actionType: "PRODUCTION_RESET",
    description: username + " reset the entire Stock Inventory system — every raw material, batch, restock " +
      "log, and waste invoice was permanently deleted. Menu item recipes now reference materials that no " +
      "longer exist until rebuilt against the new material list.",
  });

  return { ok: true, state: withStockView_(getState_()) };
}

function bizCloseBusinessDay_(state, sessions, shifts, ledger, username) {
  if (!state.businessDayId) return { ok: false, error: "No business day is currently open", state: state };
  if (state.activeShiftId) return { ok: false, error: "Close the active shift before closing the business day", state: state };
  const bdId = state.businessDayId;

  const bdShifts = shifts.filter((sh) => sh.businessDayId === bdId);
  const shiftIds = bdShifts.map((sh) => sh.id);
  const bdSessions = sessions.filter((s) => s.shiftId && shiftIds.indexOf(s.shiftId) !== -1);

  const totalRevenue = bdSessions.reduce((a, s) => a + s.total, 0);
  const totalCash = bdSessions.reduce((a, s) => a + s.cashAmount, 0);
  const totalVisa = bdSessions.reduce((a, s) => a + s.visaAmount, 0);
  const totalInstapay = bdSessions.reduce((a, s) => a + s.instapayAmount, 0);

  const bdRecord = readObjects_("BusinessDays").find((b) => b.id === bdId);
  const windowStart = bdRecord ? bdRecord.openedAt : 0;
  const now = Date.now();
  // Expenses: anything in the Ledger posted during this business day's
  // time window, not strictly by shiftId — this correctly catches
  // recurring-expense payments and staff consumption that aren't tied to
  // any specific shift but still belong to this operating period.
  const totalExpenses = ledger
    .filter((l) => l.direction === "outflow" && l.status === "approved" && l.ts >= windowStart && l.ts <= now)
    .reduce((a, l) => a + Number(l.amount), 0);
  const netProfit = Math.round((totalRevenue - totalExpenses) * 100) / 100;

  updateObjectById_("BusinessDays", bdId, {
    closedAt: now,
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    totalCash: Math.round(totalCash * 100) / 100,
    totalVisa: Math.round(totalVisa * 100) / 100,
    totalInstapay: Math.round(totalInstapay * 100) / 100,
    totalExpenses: Math.round(totalExpenses * 100) / 100,
    netProfit: netProfit,
    shiftCount: bdShifts.length,
    closedBy: username,
  });

  state.businessDayId = null;
  pushActivity_(state, "Business day closed by " + username + " — " + totalRevenue.toFixed(2) + " EGP" + " revenue across " + bdShifts.length + " shift(s)");
  return {
    ok: true, state: state, businessDayId: bdId, totalRevenue: totalRevenue, totalCash: totalCash,
    totalVisa: totalVisa, totalInstapay: totalInstapay, totalExpenses: totalExpenses, netProfit: netProfit, shiftCount: bdShifts.length,
  };
}

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
      " — expected " + expectedCash.toFixed(2) + " EGP" + ", counted " + closingActualCash.toFixed(2) + " EGP",
  );
  return {
    ok: true, state: state,
    closedShift: { id: shiftId, expectedCash: expectedCash, closingActualCash: closingActualCash, discrepancy: discrepancy },
  };
}

// Re-runs the exact same expected-cash formula bizCloseActiveShift_
// uses, against a shift that's already closed, and overwrites its
// stored expectedCash/discrepancy with the freshly computed result.
// See the local server's identical function for the full reasoning.
function bizRecalculateClosedShift_(sessions, ledger, shift) {
  if (!shift) return { ok: false, error: "Shift not found." };
  if (!shift.closedAt) return { ok: false, error: "This shift is still active — use End Shift instead, not this tool." };
  const shiftSessions = sessions.filter(function (s) { return s.shiftId === shift.id; });
  const cashSales = shiftSessions.reduce(function (a, s) { return a + (Number(s.cashAmount) || 0); }, 0);
  const drawerExpenses = ledger
    .filter(function (l) { return l.shiftId === shift.id && l.status === "approved" && l.paidFromDrawer && l.direction === "outflow"; })
    .reduce(function (a, l) { return a + Number(l.amount); }, 0);
  const newExpectedCash = shift.openingBalance + cashSales - drawerExpenses;
  const actualCash = Number(shift.closingActualCash) || 0;
  const newDiscrepancy = actualCash - newExpectedCash;
  return {
    ok: true,
    before: { expectedCash: shift.expectedCash, discrepancy: shift.discrepancy },
    after: { expectedCash: newExpectedCash, discrepancy: newDiscrepancy },
  };
}

// ---------- Staff Orders & Consumption ----------
// Standard menu prices are used (for costing/inventory consistency), but
// the amount is routed to a Staff Consumption EXPENSE, never counted as
// retail sales revenue — this never touches state.rooms or Sessions.
// Exact-name match, case-insensitive — matches this app's standard
// default menu items. See the local server's identical constants for
// the full reasoning.
const TEA_ALLOWANCE_NAME = "classic tea";
const COFFEE_ALLOWANCE_NAME = "turkish coffee";

function bizSubmitStaffOrder_(state, batches, staffId, staffName, items) {
  const trimmedName = (staffName || "").trim();
  if (!trimmedName) return { ok: false, error: "Staff member name is required", state: state };
  if (!items || items.length === 0) return { ok: false, error: "No items selected", state: state };

  let usage = null;
  if (staffId && state.activeShiftId) {
    usage = readObjects_("StaffAllowanceUsage").find(function (u) { return u.shiftId === state.activeShiftId && u.staffId === staffId; }) || null;
  }
  let teaClaimed = usage ? !!usage.teaClaimed : false;
  let coffeeClaimed = usage ? !!usage.coffeeClaimed : false;
  const usageChanges = {};

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

    const nameKey = (menuItem.name || "").trim().toLowerCase();
    let freeQty = 0;
    if (staffId && state.activeShiftId) {
      if (nameKey === TEA_ALLOWANCE_NAME && !teaClaimed) { freeQty = 1; teaClaimed = true; usageChanges.teaClaimed = true; }
      else if (nameKey === COFFEE_ALLOWANCE_NAME && !coffeeClaimed) { freeQty = 1; coffeeClaimed = true; usageChanges.coffeeClaimed = true; }
    }
    freeQty = Math.min(freeQty, req.qty);
    const paidQty = req.qty - freeQty;

    if (freeQty > 0) {
      orderLines.push({ menuItemId: req.menuItemId, name: menuItem.name + " (Staff Allowance)", qty: freeQty, price: 0 });
    }
    if (paidQty > 0) {
      orderLines.push({ menuItemId: req.menuItemId, name: menuItem.name, qty: paidQty, price: menuItem.price });
      totalAmount += paidQty * menuItem.price;
    }
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

  if (Object.keys(usageChanges).length > 0) {
    if (usage) {
      updateObjectById_("StaffAllowanceUsage", usage.id, usageChanges);
    } else {
      appendObject_("StaffAllowanceUsage", {
        id: newId_("salw"), shiftId: state.activeShiftId, staffId: staffId,
        teaClaimed: !!usageChanges.teaClaimed, coffeeClaimed: !!usageChanges.coffeeClaimed,
      });
    }
  }

  const staffOrder = {
    id: newId_("staff"), ts: Date.now(), staffName: trimmedName, items: orderLines,
    totalAmount: totalAmount, cogs: cogs, processedBy: null, shiftId: state.activeShiftId || null,
  };
  pushActivity_(state, "Staff order: " + trimmedName + " — " + totalAmount.toFixed(2) + " EGP" + " (" + orderLines.length + " item(s))");
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

// Adjust/Restock with carryover consolidation: whatever's still remaining
// from prior batches gets folded into ONE fresh batch alongside the new
// quantity, and old batches are retired (qtyRemaining zeroed, but their
// qtyPurchased/history stays for lifetime audit purposes). This is what
// makes "consumed since restock" reset to 0 on every restock instead of
// growing forever across the material's whole lifetime.
const WASTE_INVOICE_REASONS = {
  spill: "Spill",
  expired: "Expired",
  training: "Training",
  prepError: "Preparation Error",
};

// Distinct from Wasted/Marketing (which wastes finished MENU ITEMS off
// the virtual table, deducting their recipe ingredients). This wastes a
// RAW MATERIAL directly — spoiled coffee beans, an expired carton of
// milk — with no menu item or recipe involved at all.
function bizSubmitWasteInvoice_(materialId, wastedQty, reason, note, username, shiftId) {
  if (!WASTE_INVOICE_REASONS[reason]) return { ok: false, error: "Select a reason (Spill, Expired, or Training)." };
  const qty = Number(wastedQty) || 0;
  if (qty <= 0) return { ok: false, error: "Enter a wasted quantity greater than zero." };

  const material = readObjects_("RawMaterials").find((m) => m.id === materialId);
  if (!material) return { ok: false, error: "Material not found." };

  const batches = readObjects_("Batches");
  const remaining = batches.filter((b) => b.materialId === materialId).reduce((a, b) => a + Number(b.qtyRemaining), 0);
  if (qty > remaining + 1e-9) {
    return { ok: false, error: "Only " + remaining + " " + material.unit + " of " + material.name + " in stock — can't waste " + qty + "." };
  }

  const res = consumeFifo_(batches, materialId, qty);
  writeBatchesBack_(batches, res.touched);

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  let invoiceNumber;
  try {
    const state = getState_();
    state.wasteInvoiceCounter = (state.wasteInvoiceCounter || 0) + 1;
    invoiceNumber = state.wasteInvoiceCounter;
    setState_(state);
  } finally {
    lock.releaseLock();
  }

  const now = Date.now();
  const invoice = {
    id: newId_("wasteinv"), invoiceNumber: invoiceNumber, ts: now, materialId: materialId, materialName: material.name,
    unit: material.unit, wastedQty: qty, reason: reason, reasonLabel: WASTE_INVOICE_REASONS[reason], note: note || "",
    unitCost: material.unitCost, totalCost: res.cost, loggedBy: username, shiftId: shiftId || null,
  };
  appendObject_("WasteInvoices", invoice);

  if (res.cost > 0) {
    appendObject_("Ledger", {
      id: newId_("ledg"), ts: now, amount: res.cost, direction: "outflow", type: "manualAdjustment",
      category: "Raw Material Waste",
      description: "Waste Invoice #" + String(invoiceNumber).padStart(3, "0") + ": " + qty + " " + material.unit + " " + material.name + " — " + WASTE_INVOICE_REASONS[reason] + (note ? " (" + note + ")" : ""),
      supplierId: null, staffUsername: username, status: "approved", receiptUrl: null,
      paidFromDrawer: false, shiftId: shiftId || null, materialId: materialId, qty: qty, unitCost: material.unitCost, paymentSource: null,
    });
  }

  return { ok: true, invoice: invoice };
}

function bizRestockMaterial_(materialId, qtyAdded, unitCost, username) {
  if (!qtyAdded || qtyAdded <= 0) return { ok: false, error: "Enter a quantity greater than zero" };
  const materials = readObjects_("RawMaterials");
  const material = materials.find((m) => m.id === materialId);
  if (!material) return { ok: false, error: "Material not found" };

  const batches = readObjects_("Batches");
  const existing = batches.filter((b) => b.materialId === materialId && Number(b.qtyRemaining) > 0);
  const carryover = existing.reduce((a, b) => a + Number(b.qtyRemaining), 0);

  // Retire old batches by closing their books at exactly what was already
  // consumed from them — NOT just zeroing qtyRemaining. If we left
  // qtyPurchased untouched, the carryover portion would be double-counted
  // forever (once in this old batch's history, again in the new
  // consolidated batch), silently inflating every lifetime total.
  existing.forEach((b) => {
    const consumedFromThisBatch = Number(b.qtyPurchased) - Number(b.qtyRemaining);
    updateObjectById_("Batches", b.id, { qtyPurchased: consumedFromThisBatch, qtyRemaining: 0 });
  });

  const newTotal = qtyAdded + carryover;
  const finalUnitCost = typeof unitCost === "number" && unitCost >= 0 ? unitCost : (Number(material.unitCost) || 0);
  const now = Date.now();
  appendObject_("Batches", {
    id: newId_("batch"), materialId: materialId, supplierId: null,
    qtyPurchased: newTotal, qtyRemaining: newTotal, unitCost: finalUnitCost,
    purchasedAt: now, source: "restock",
  });

  if (typeof unitCost === "number" && unitCost >= 0) {
    updateObjectById_("RawMaterials", materialId, { unitCost: unitCost, lastPurchaseCost: unitCost });
  }

  appendObject_("RestockLog", {
    id: newId_("restock"), ts: now, materialId: materialId, materialName: material.name,
    qtyAdded: qtyAdded, carryoverAdded: carryover, newTotal: newTotal, unitCost: finalUnitCost, performedBy: username,
  });

  return { ok: true, materialName: material.name, qtyAdded: qtyAdded, carryover: carryover, newTotal: newTotal, unitCost: finalUnitCost };
}

function readRestockLog_() {
  return readObjects_("RestockLog").sort(function (a, b) { return b.ts - a.ts; });
}

// ---------- Derived "stock" view for backward-compat with the UI's low
// -stock alerts (initialStock = ever purchased, used = ever consumed) ----
function computeStockView_(materials, batches) {
  return materials.map((m) => {
    const matBatches = batches.filter((b) => b.materialId === m.id);
    const initialStock = matBatches.reduce((a, b) => a + Number(b.qtyPurchased), 0);
    const remaining = matBatches.reduce((a, b) => a + Number(b.qtyRemaining), 0);
    const unitCost = Number(m.unitCost) || 0;
    const actualStock = (m.actualStock === null || m.actualStock === undefined || m.actualStock === "") ? null : Number(m.actualStock);
    // "Current epoch" = the most recently added batch (i.e. since the last
    // restock/consolidation) — its own consumption resets to 0 every time
    // a restock folds the old remainder into a fresh batch.
    const newest = matBatches.reduce((a, b) => (!a || Number(b.purchasedAt) > Number(a.purchasedAt) ? b : a), null);
    // Perpetual Inventory Ledger fields — Opening Stock is the one
    // permanent historical fact (locked from editing at the API level);
    // Purchases/In is everything added since then (initialStock already
    // includes the opening batch, subtracting it isolates true
    // purchases); Sales & Waste/Out is exactly the existing `used`
    // figure — recipe consumption + waste-marketing + waste invoices all
    // already flow through the same FIFO consumption. System Balance =
    // Opening + Purchases - Out holds by construction, since Out is
    // DERIVED that way, not independently tracked.
    const openingStock = Number(m.openingStock) || 0;
    const purchasesIn = Math.round((initialStock - openingStock) * 1e6) / 1e6;
    return {
      id: m.id,
      name: m.name,
      unit: m.unit,
      initialStock: initialStock,
      used: initialStock - remaining,
      minStock: Number(m.minStockAlert) || 0,
      unitCost: unitCost,
      remaining: remaining,
      totalValue: Math.round(remaining * unitCost * 100) / 100,
      usedSinceRestock: newest ? Number(newest.qtyPurchased) - Number(newest.qtyRemaining) : 0,
      lastRestockAt: newest ? Number(newest.purchasedAt) : null,
      actualStock: actualStock,
      actualStockUpdatedAt: m.actualStockUpdatedAt || null,
      actualStockUpdatedBy: m.actualStockUpdatedBy || null,
      variance: actualStock === null ? null : Math.round((actualStock - remaining) * 100) / 100,
      openingStock: openingStock, purchasesIn: purchasesIn, salesWasteOut: initialStock - remaining, systemBalance: remaining,
      actualCountValue: actualStock === null ? null : Math.round(actualStock * unitCost * 100) / 100,
      category: m.category || "", storageLocation: m.storageLocation || "", lastPurchaseCost: Number(m.lastPurchaseCost) || unitCost,
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
  if (body.action === "submitExpense") {
    return handleSubmitExpense_(body);
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

      // Generic on-the-spot admin authorization check (manager-key-style
      // override) — does NOT create a session, just confirms these
      // credentials belong to an admin right now. Any future "cashier
      // needs an admin to approve this instantly" flow can reuse this.
      case "verifyAdminAuth": {
        const result = login_(body.adminUsername, body.adminPassword);
        const ok = result.ok && result.role === "admin";
        if (!ok) {
          logActivity_({
            actorUsername: body.username, actorRole: roleForUsername_(body.username), actionType: "LOGIN_FAILED",
            description: "Failed on-the-spot admin authorization attempt (target: '" + (body.adminUsername || "") + "')",
          });
        }
        return json_({ ok: ok, adminUsername: ok ? result.username : null });
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
          description: (before ? before.name : body.roomId) + " rates changed to Single " + body.singleRate + " EGP/hr, Multi " + body.multiRate + " EGP/hr",
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
            description: (room ? room.name : body.roomId) + " session started" + (room && room.rateMode ? " (" + room.rateMode + " @ " + room.hourlyRate + " EGP/hr)" : ""),
          });
        }
        return json_({ ok: result.ok, error: result.error || null, state: withStockView_(result.state) });
      }
      case "nextKotNumber": {
        requireRole_(body.username, ["admin", "cashier"]);
        if (!body.shiftId) return json_({ ok: false, error: "No active shift" });
        const num = bizNextKotNumber_(body.shiftId);
        if (num === null) return json_({ ok: false, error: "Shift not found" });
        return json_({ ok: true, number: num });
      }

      case "extendRoomTime": {
        requireRole_(body.username, ["admin", "cashier"]);
        const state0 = getState_();
        const before = state0.rooms.find((r) => r.id === body.roomId);
        const result = bizExtendRoomTime_(state0, body.roomId, body.deltaSec, roleForUsername_(body.username) === "admin");
        if (!result.ok) return json_({ ok: false, error: result.error, state: withStockView_(result.state) });
        setState_(result.state);
        const after = result.state.rooms.find((r) => r.id === body.roomId);
        const deltaSecNum = Number(body.deltaSec) || 0;
        logActivity_({
          actorUsername: body.username, actorRole: roleForUsername_(body.username), actionType: "ROOM_TIME_EXTENDED",
          location: before ? before.name : body.roomId, shiftId: result.state.activeShiftId,
          description: (before ? before.name : body.roomId) + " time " + (deltaSecNum > 0 ? "extended by +" : "reduced by -") + Math.round(Math.abs(deltaSecNum) / 60) + " min",
          before: { timeAdjustmentSec: before ? before.timeAdjustmentSec : 0 },
          after: { timeAdjustmentSec: after ? after.timeAdjustmentSec : 0 },
        });
        return json_({ ok: true, state: withStockView_(result.state) });
      }

      case "switchRateMode": {
        requireRole_(body.username, ["admin", "cashier"]);
        const state0 = getState_();
        const before = state0.rooms.find((r) => r.id === body.roomId);
        const result = bizSwitchRateMode_(state0, body.roomId, body.newMode);
        if (!result.ok) return json_({ ok: false, error: result.error, state: withStockView_(result.state) });
        setState_(result.state);
        logActivity_({
          actorUsername: body.username, actorRole: roleForUsername_(body.username), actionType: "ROOM_TIME_EXTENDED",
          location: before ? before.name : body.roomId, shiftId: result.state.activeShiftId,
          description: (before ? before.name : body.roomId) + " switched rate mode to " + body.newMode,
        });
        return json_({ ok: true, state: withStockView_(result.state) });
      }

      case "reopenSession": {
        requireRole_(body.username, ["admin"]);
        const session = readSessions_().find(function (s) { return s.id === body.sessionId; });
        if (!session) return json_({ ok: false, error: "Check not found." });
        const state0 = getState_();
        const result = bizReopenSession_(state0, session);
        if (!result.ok) return json_({ ok: false, error: result.error, state: withStockView_(result.state) });
        setState_(result.state);
        deleteObjectById_("Sessions", session.id);
        logActivity_({
          actorUsername: body.username, actorRole: "admin", actionType: "CHECK_REOPENED",
          location: session.roomName, shiftId: result.state.activeShiftId,
          description: body.username + " reopened check #" + session.orderNumber + " (" + session.roomName + ") for correction",
        });
        return json_({ ok: true, state: withStockView_(result.state) });
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
      case "logWasteMarketing": {
        requireRole_(body.username, ["admin", "cashier"]);
        const batches = readObjects_("Batches");
        const result = bizLogWasteMarketing_(getState_(), batches, body.roomId, body.reason, body.note);
        if (!result.ok) return json_({ ok: false, error: result.error, state: withStockView_(result.state) });
        setState_(result.state);
        writeBatchesBack_(batches, result.touchedBatchIds);
        // Always record — even if the calculated ingredient cost happens
        // to be exactly zero (unconfigured ingredient costs, a genuine
        // freebie, etc.), the admin still needs the audit record itself:
        // what was wasted, who logged it, when, and why. Silently
        // skipping the write here was the actual bug — the room cleared
        // successfully, giving the illusion the whole thing worked, but
        // nothing ever reached the Ledger for Reports to show.
        appendObject_("Ledger", {
          id: newId_("ledg"), ts: Date.now(), amount: result.cogs, direction: "outflow", type: "manualAdjustment",
          category: "Marketing / Waste Expense",
          description: result.items.map((i) => i.qty + "x " + i.name).join(", ") + " — Reason: " + result.reasonLabel + (result.note ? " (" + result.note + ")" : "") + " — Retail value: " + result.retailValue.toFixed(2) + " EGP",
          supplierId: null, staffUsername: body.username, status: "approved", receiptUrl: null,
          paidFromDrawer: false, shiftId: result.state.activeShiftId, materialId: null, qty: null, unitCost: null, paymentSource: null,
        });
        logActivity_({
          actorUsername: body.username, actorRole: roleForUsername_(body.username), actionType: "WASTE_MARKETING_LOGGED",
          location: "Wasted / Marketing", shiftId: result.state.activeShiftId,
          description: result.items.map((i) => i.qty + "x " + i.name).join(", ") + " — " + result.reasonLabel + " — " + result.cogs.toFixed(2) + " EGP" +
            " ingredient cost (retail value " + result.retailValue.toFixed(2) + " EGP" + ", not counted as revenue)",
          after: { items: result.items, cogs: result.cogs, retailValue: result.retailValue, reason: result.reason, note: result.note },
        });
        return json_({ ok: true, state: withStockView_(result.state) });
      }

      case "endRoom": {
        requireRole_(body.username, ["admin", "cashier"]);
        const batches = readObjects_("Batches");
        const result = bizEndRoom_(getState_(), batches, body.roomId, body.splitBill, body.paymentMethod, body.cashAmount, body.secondaryAmount, body.frozenAt, {
          timeDiscountType: body.timeDiscountType, timeDiscountValue: body.timeDiscountValue,
          ordersDiscountType: body.ordersDiscountType, ordersDiscountValue: body.ordersDiscountValue,
        });
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
            description: result.session.roomName + " checked out — " + result.session.total.toFixed(2) + " EGP" + " (" + result.session.paymentMethod + ")",
            before: { orders: result.session.orders },
            after: {
              total: result.session.total, cogs: result.session.cogs,
              cashAmount: result.session.cashAmount, visaAmount: result.session.visaAmount, instapayAmount: result.session.instapayAmount,
            },
          });
        }
        return json_({ session: result.session, state: withStockView_(result.state) });
      }

      case "endRoomAsStaffOrder": {
        requireRole_(body.username, ["admin", "cashier"]);
        const staffResult = bizEndRoomAsStaffOrder_(getState_(), body.roomId, body.staffName, body.frozenAt);
        if (!staffResult.ok) return json_({ ok: false, error: staffResult.error, state: withStockView_(staffResult.state) });
        setState_(staffResult.state);
        staffResult.staffOrder.processedBy = body.username;
        appendObject_("StaffOrders", {
          id: staffResult.staffOrder.id, ts: staffResult.staffOrder.ts, staffName: staffResult.staffOrder.staffName,
          items: JSON.stringify(staffResult.staffOrder.items), totalAmount: staffResult.staffOrder.totalAmount,
          cogs: staffResult.staffOrder.cogs, processedBy: body.username, shiftId: staffResult.staffOrder.shiftId,
        });
        appendObject_("Ledger", {
          id: newId_("ledg"), ts: staffResult.staffOrder.ts, amount: staffResult.staffOrder.totalAmount, direction: "outflow",
          type: "manualAdjustment", category: "Staff Consumption Expense",
          description: staffResult.staffOrder.staffName + " — " + staffResult.staffOrder.items.length + " item(s) (from room checkout)",
          supplierId: null, staffUsername: body.username, status: "approved", receiptUrl: null,
          paidFromDrawer: false, shiftId: staffResult.staffOrder.shiftId, materialId: null, qty: null, unitCost: null,
        });
        logActivity_({
          actorUsername: body.username, actorRole: roleForUsername_(body.username), actionType: "STAFF_ORDER_LOGGED",
          shiftId: staffResult.staffOrder.shiftId,
          description: "Room closed as staff order for " + staffResult.staffOrder.staffName + " — " + staffResult.staffOrder.totalAmount.toFixed(2) + " EGP (excluded from revenue)",
        });
        return json_({ ok: true, staffOrder: staffResult.staffOrder, state: withStockView_(staffResult.state) });
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
          result.touchedBatchIds.forEach(function (id) {
            const b = batches.find(function (x) { return x.id === id; });
            if (b) updateObjectById_("Batches", id, { qtyRemaining: b.qtyRemaining });
          });
          (result.newBatches || []).forEach(function (nb) { appendObject_("Batches", nb); });
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
          result.touchedBatchIds.forEach(function (id) {
            const b = batches.find(function (x) { return x.id === id; });
            if (b) updateObjectById_("Batches", id, { qtyRemaining: b.qtyRemaining });
          });
          (result.newBatches || []).forEach(function (nb) { appendObject_("Batches", nb); });
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

      case "markOrdersPrintedToKitchen": {
        requireRole_(body.username, ["admin", "cashier"]);
        const stateBefore2 = getState_();
        const result2 = bizMarkOrdersPrintedToKitchen_(stateBefore2, body.roomId, body.menuItemIds);
        if (result2.ok) setState_(result2.state);
        return json_({ ok: result2.ok, error: result2.error || null, state: withStockView_(result2.state) });
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
              (result.roomCharge > 0 ? " (" + result.roomCharge.toFixed(2) + " EGP" + " frozen room charge, " + result.durationSec + "s elapsed)" : "") +
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
        const result = bizSplitBill_(getState_(), batches, body.roomId, body.mode, body.items, body.customAmount, body.paymentMethod, body.cashAmount, body.secondaryAmount, {
          discountType: body.discountType, discountValue: body.discountValue,
        });
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
          description: "Split payment of " + result.splitSession.total.toFixed(2) + " EGP" + " (" + body.mode + ", " + body.paymentMethod + ")",
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
            description: before.name + " price changed from " + before.price + " EGP to " + body.patch.price + " EGP",
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
            description: body.username + " started a shift (opening " + (body.openingBalance || 0).toFixed(2) + " EGP)",
            after: { openingBalance: body.openingBalance, lat: body.lat, lng: body.lng },
          });
        }
        return json_({ ok: result.ok, error: result.error || null, state: withStockView_(result.state) });
      }
      case "endShift": {
        // Admin-only, no exceptions — confirmed explicitly.
        const role = requireRole_(body.username, ["admin"]);
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
            description: body.username + " ended shift — expected " + (closed ? closed.expectedCash.toFixed(2) : "?") + " EGP, counted " + (closed ? closed.closingActualCash.toFixed(2) : "?") + " EGP",
            after: closed ? { expectedCash: closed.expectedCash, closingActualCash: closed.closingActualCash, discrepancy: closed.discrepancy, lat: body.lat, lng: body.lng } : null,
          });
        }
        return json_({ ok: result.ok, error: result.error || null, state: withStockView_(result.state) });
      }

      case "saveDailyReconciliation": {
        requireRole_(body.username, ["admin"]);
        const state = getState_();
        if (!state.activeShiftId) return json_({ ok: false, error: "No active shift — open a shift before recording a reconciliation." });
        const sessions = readSessions_();
        const ledger = readObjects_("Ledger");
        const record = bizBuildShiftReconciliation_(sessions, ledger, state.activeShiftId, body.actualCash, body.instapayTotal, body.visaTotal, body.username);
        appendObject_("DailyReconciliations", record);
        logActivity_({
          actorUsername: body.username, actorRole: "admin", actionType: "DAILY_RECONCILIATION_SAVED", shiftId: state.activeShiftId,
          description: body.username + " recorded a shift reconciliation" +
            " — expected " + record.expectedCash.toFixed(2) + " EGP, counted " + record.actualCash.toFixed(2) + " EGP" +
            (record.variance >= 0 ? " (+" + record.variance.toFixed(2) + " over)" : " (" + record.variance.toFixed(2) + " short)"),
        });
        return json_({ ok: true, record: record });
      }

      case "getDailyReconciliationHistory": {
        requireRole_(body.username, ["admin"]);
        const records = readObjects_("DailyReconciliations").sort(function (a, b) { return b.recordedAt - a.recordedAt; });
        return json_({ ok: true, records: records });
      }

      case "recalculateClosedShift": {
        requireRole_(body.username, ["admin"]);
        if (body.confirmText !== "RECALCULATE") return json_({ ok: false, error: "Type RECALCULATE exactly to confirm." });
        const recalcAuth = login_(body.username, body.password);
        if (!recalcAuth.ok || recalcAuth.role !== "admin") return json_({ ok: false, error: "Password incorrect — nothing was changed." });
        const recalcShifts = readObjects_("Shifts");
        const recalcShift = recalcShifts.find(function (sh) { return sh.id === body.shiftId; });
        const recalcResult = bizRecalculateClosedShift_(readSessions_(), readObjects_("Ledger"), recalcShift);
        if (!recalcResult.ok) return json_(recalcResult);
        updateObjectById_("Shifts", body.shiftId, { expectedCash: recalcResult.after.expectedCash, discrepancy: recalcResult.after.discrepancy });
        logActivity_({
          actorUsername: body.username, actorRole: "admin", actionType: "SHIFT_RECALCULATED", shiftId: body.shiftId,
          description: body.username + " recalculated closed shift " + body.shiftId +
            " — expected cash " + recalcResult.before.expectedCash.toFixed(2) + " → " + recalcResult.after.expectedCash.toFixed(2) + " EGP" +
            ", discrepancy " + recalcResult.before.discrepancy.toFixed(2) + " → " + recalcResult.after.discrepancy.toFixed(2) + " EGP",
          before: recalcResult.before, after: recalcResult.after,
        });
        return json_({ ok: true, state: withStockView_(getState_()) });
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

      case "closeBusinessDay": {
        requireRole_(body.username, ["admin"]);
        const state0 = getState_();
        const result = bizCloseBusinessDay_(state0, readSessions_(), readShifts_(), readObjects_("Ledger"), body.username);
        if (!result.ok) return json_({ ok: false, error: result.error, state: withStockView_(state0) });
        setState_(result.state);
        logActivity_({
          actorUsername: body.username, actorRole: "admin", actionType: "BUSINESS_DAY_CLOSED",
          description: "Business day closed — " + result.totalRevenue.toFixed(2) + " EGP" + " revenue, " + result.totalExpenses.toFixed(2) + " EGP" +
            " expenses, " + result.netProfit.toFixed(2) + " EGP" + " net profit across " + result.shiftCount + " shift(s)",
          after: {
            businessDayId: result.businessDayId, totalRevenue: result.totalRevenue, totalCash: result.totalCash,
            totalVisa: result.totalVisa, totalInstapay: result.totalInstapay, totalExpenses: result.totalExpenses,
            netProfit: result.netProfit, shiftCount: result.shiftCount,
          },
        });
        return json_({ ok: true, state: withStockView_(result.state) });
      }

      case "getBusinessDays":
        requireRole_(body.username, ["admin"]);
        return json_({ items: readBusinessDays_() });

      case "resetForProduction": {
        requireRole_(body.username, ["admin"]);
        const result = resetForProduction_(body.username, body.password);
        if (!result.ok) return json_({ ok: false, error: result.error });
        return json_({ ok: true, state: result.state });
      }

      case "resetKeepingInventoryAndLedger": {
        requireRole_(body.username, ["admin"]);
        const keepResult = resetKeepingInventoryAndLedger_(body.username, body.password);
        if (!keepResult.ok) return json_({ ok: false, error: keepResult.error });
        return json_({ ok: true, state: keepResult.state });
      }

      case "resetInventory": {
        requireRole_(body.username, ["admin"]);
        const result = resetInventory_(body.username, body.password);
        if (!result.ok) return json_({ ok: false, error: result.error });
        return json_({ ok: true, state: result.state });
      }

      case "rolloverInventory": {
        requireRole_(body.username, ["admin"]);
        const rolloverResult = bizRolloverInventory_(body.username);
        if (!rolloverResult.ok) return json_({ ok: false, error: rolloverResult.error });
        logActivity_({
          actorUsername: body.username, actorRole: "admin", actionType: "PRODUCTION_RESET",
          description: body.username + " ran the Monthly Rollover (اعتماد كبداية شهر جديد) for " + rolloverResult.month + " — archived a snapshot and set Opening Stock to the current count for all " + rolloverResult.count + " material(s), resetting this period's Purchases/Out counters to zero.",
        });
        return json_({ ok: true, count: rolloverResult.count, month: rolloverResult.month, state: withStockView_(getState_()) });
      }

      case "getInventorySnapshots": {
        requireRole_(body.username, ["admin", "cashier"]);
        const allSnapshots = readObjects_("InventorySnapshots");
        const filteredSnapshots = body.month ? allSnapshots.filter(function (s) { return s.month === body.month; }) : allSnapshots;
        return json_({ items: filteredSnapshots.sort(function (a, b) { return a.materialName.localeCompare(b.materialName); }) });
      }

      case "getInventorySnapshotMonths": {
        requireRole_(body.username, ["admin", "cashier"]);
        const months = Array.from(new Set(readObjects_("InventorySnapshots").map(function (s) { return s.month; }))).sort().reverse();
        return json_({ months: months });
      }

      // ---- Raw materials / suppliers / recurring expenses CRUD (admin) ----
      case "getRawMaterials":
        requireRole_(body.username, ["admin", "cashier"]);
        return json_({ items: readObjects_("RawMaterials") });

      // Read-only, added for the offline-migration script — the computed
      // "stock" view (in getState) aggregates batches into one number per
      // material, but migrating to the local server needs the individual
      // batch records themselves (purchase dates, remaining qty per lot)
      // to preserve real FIFO history, not just the current totals.
      case "getBatches":
        requireRole_(body.username, ["admin"]);
        return json_({ items: readObjects_("Batches") });

      case "submitStaffOrder": {
        requireRole_(body.username, ["admin", "cashier"]);
        const batches = readObjects_("Batches");
        const result = bizSubmitStaffOrder_(getState_(), batches, body.staffId, body.staffName, body.items);
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
          description: "Staff order for " + result.staffOrder.staffName + " — " + result.staffOrder.totalAmount.toFixed(2) + " EGP",
          shiftId: result.staffOrder.shiftId,
          after: { staffName: result.staffOrder.staffName, totalAmount: result.staffOrder.totalAmount, items: result.staffOrder.items },
        });
        return json_({ ok: true, staffOrder: result.staffOrder, state: withStockView_(result.state) });
      }
      case "getStaffOrders":
        requireRole_(body.username, ["admin"]);
        return json_({ items: readStaffOrders_() });

      // Direct Value Override — the entered number becomes the exact
      // current stock, full stop. Unlike adjustStock (which takes a
      // pre-computed delta from the client), this computes its own delta
      // HERE, against the live remaining at this exact moment, inside the
      // lock. That's the actual fix for the Edit-modal bug: a
      // client-computed delta goes stale the instant any real consumption
      // happens between opening the modal and hitting Save (a sale, a
      // void, anything), silently undershooting the entered target. This
      // action can never go stale — there's no window for it to.
      case "setAbsoluteStock": {
        requireRole_(body.username, ["admin"]);
        const material = readObjects_("RawMaterials").find((m) => m.id === body.materialId);
        if (!material) return json_({ ok: false, error: "Material not found" });
        const target = Number(body.targetQty);
        if (isNaN(target) || target < 0) return json_({ ok: false, error: "Enter a valid quantity" });

        const lock = LockService.getScriptLock();
        lock.waitLock(30000);
        let before, after, delta;
        try {
          const batches = readObjects_("Batches");
          before = batches.filter((b) => b.materialId === body.materialId).reduce((a, b) => a + Number(b.qtyRemaining), 0);
          delta = Math.round((target - before) * 1e6) / 1e6;
          if (delta !== 0) {
            const result = adjustStock_(body.materialId, delta, "correction", body.note || "", body.username);
            after = result.after;
          } else {
            after = before;
          }
        } finally {
          lock.releaseLock();
        }

        logActivity_({
          actorUsername: body.username, actorRole: "admin", actionType: "STOCK_ADJUSTED",
          description: material.name + ": Actual Stock set to " + target + " " + material.unit +
            " (system showed " + before + " " + material.unit + ") — " +
            (delta < 0 ? "DEFICIT of " + Math.abs(delta) : delta > 0 ? "SURPLUS of " + delta : "no variance") + " " + material.unit +
            (body.note ? " — " + body.note : ""),
          before: { remaining: before }, after: { remaining: after, delta: delta },
        });
        return json_({ ok: true, before: before, after: after, delta: delta, state: withStockView_(getState_()) });
      }

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

      case "restockMaterial": {
        requireRole_(body.username, ["admin", "cashier"]);
        const result = bizRestockMaterial_(body.materialId, Number(body.qtyAdded), typeof body.unitCost === "number" ? body.unitCost : undefined, body.username);
        if (!result.ok) return json_({ ok: false, error: result.error });
        logActivity_({
          actorUsername: body.username, actorRole: roleForUsername_(body.username), actionType: "STOCK_RESTOCKED",
          description: "Restocked " + result.materialName + ": +" + result.qtyAdded +
            (result.carryover > 0 ? " (carried over " + result.carryover + " remaining)" : "") +
            " = " + result.newTotal + " total @ " + result.unitCost + " EGP/unit",
          after: { qtyAdded: result.qtyAdded, carryover: result.carryover, newTotal: result.newTotal, unitCost: result.unitCost },
        });
        return json_({ ok: true, state: withStockView_(getState_()) });
      }

      case "getRestockLog":
        requireRole_(body.username, ["admin", "cashier"]);
        return json_({ items: readRestockLog_() });

      case "submitWasteInvoice": {
        requireRole_(body.username, ["admin", "cashier"]);
        const state0 = getState_();
        const result = bizSubmitWasteInvoice_(body.materialId, body.wastedQty, body.reason, body.note, body.username, state0.activeShiftId);
        if (!result.ok) return json_({ ok: false, error: result.error });
        logActivity_({
          actorUsername: body.username, actorRole: roleForUsername_(body.username), actionType: "STOCK_ADJUSTED",
          shiftId: result.invoice.shiftId,
          description: "Waste Invoice #" + String(result.invoice.invoiceNumber).padStart(3, "0") + ": " + result.invoice.wastedQty + " " + result.invoice.unit + " " + result.invoice.materialName + " — " + result.invoice.reasonLabel + " — " + result.invoice.totalCost.toFixed(2) + " EGP",
          after: { invoiceNumber: result.invoice.invoiceNumber, materialId: result.invoice.materialId, wastedQty: result.invoice.wastedQty, reason: result.invoice.reason, totalCost: result.invoice.totalCost },
        });
        return json_({ ok: true, invoice: result.invoice, state: withStockView_(getState_()) });
      }

      case "getWasteInvoices":
        requireRole_(body.username, ["admin", "cashier"]);
        return json_({ items: readObjects_("WasteInvoices").sort(function (a, b) { return b.ts - a.ts; }) });

      case "setActualStock": {
        requireRole_(body.username, ["admin", "cashier"]);
        const materials = readObjects_("RawMaterials");
        const material = materials.find((m) => m.id === body.materialId);
        if (!material) return json_({ ok: false, error: "Material not found" });
        const actual = Number(body.actualStock);
        if (isNaN(actual) || actual < 0) return json_({ ok: false, error: "Enter a valid quantity" });

        const batches = readObjects_("Batches");
        const remaining = batches.filter((b) => b.materialId === body.materialId).reduce((a, b) => a + Number(b.qtyRemaining), 0);
        const variance = Math.round((actual - remaining) * 100) / 100;
        const now = Date.now();

        updateObjectById_("RawMaterials", body.materialId, {
          actualStock: actual, actualStockUpdatedAt: now, actualStockUpdatedBy: body.username,
        });

        logActivity_({
          actorUsername: body.username, actorRole: roleForUsername_(body.username), actionType: "ACTUAL_STOCK_SET",
          description: material.name + ": Actual Stock set to " + actual + " " + material.unit +
            " (system showed " + remaining + " " + material.unit + ") — " +
            (variance < 0 ? "DEFICIT of " + Math.abs(variance) : variance > 0 ? "SURPLUS of " + variance : "no variance") + " " + material.unit,
          before: { systemRemaining: remaining },
          after: { actualStock: actual, variance: variance },
        });
        return json_({ ok: true, variance: variance, state: withStockView_(getState_()) });
      }

      case "addRawMaterial": {
        requireRole_(body.username, ["admin"]);
        const openingStock = parseFloat(body.openingStock) || 0;
        const item = {
          id: newId_("mat"), name: body.name, unit: body.unit, minStockAlert: parseFloat(body.minStockAlert) || 0, unitCost: parseFloat(body.unitCost) || 0, openingStock: openingStock,
          category: body.category || "", storageLocation: body.storageLocation || "", lastPurchaseCost: parseFloat(body.unitCost) || 0,
        };
        appendObject_("RawMaterials", item);
        // Opening Stock needs to be REAL, trackable inventory — one
        // initial batch backs it, tagged distinctly.
        if (openingStock > 0) {
          appendObject_("Batches", {
            id: newId_("batch"), materialId: item.id, supplierId: null,
            qtyPurchased: openingStock, qtyRemaining: openingStock, unitCost: item.unitCost,
            purchasedAt: Date.now(), source: "openingStock",
          });
        }
        logActivity_({
          actorUsername: body.username, actorRole: "admin", actionType: "RAW_MATERIAL_COST_CONTEXT",
          description: "Added raw material '" + body.name + "'" + (openingStock > 0 ? " with opening stock of " + openingStock + " " + body.unit : ""), after: item,
        });
        return json_({ ok: true, item: item, state: withStockView_(getState_()) });
      }

      case "bulkAddRawMaterials": {
        requireRole_(body.username, ["admin"]);
        const rows = Array.isArray(body.rows) ? body.rows : [];
        const existing = readObjects_("RawMaterials");
        const existingNames = {};
        existing.forEach(function (m) { existingNames[m.name.trim().toLowerCase()] = true; });
        const bulkNow = Date.now();
        let added = 0;
        const skipped = [];

        rows.forEach(function (r) {
          const name = (r.name || "").trim();
          if (!name) return;
          if (existingNames[name.toLowerCase()]) { skipped.push(name); return; }
          const openingStock = parseFloat(r.openingStock) || 0;
          const unitCost = parseFloat(r.unitCost) || 0;
          const item = {
            id: newId_("mat"), name: name, unit: (r.unit || "").trim(), minStockAlert: parseFloat(r.minStockAlert) || 0,
            unitCost: unitCost, openingStock: openingStock, category: (r.category || "").trim(), storageLocation: "", lastPurchaseCost: unitCost,
          };
          appendObject_("RawMaterials", item);
          if (openingStock > 0) {
            appendObject_("Batches", {
              id: newId_("batch"), materialId: item.id, supplierId: null,
              qtyPurchased: openingStock, qtyRemaining: openingStock, unitCost: unitCost,
              purchasedAt: bulkNow, source: "openingStock",
            });
          }
          existingNames[name.toLowerCase()] = true;
          added++;
        });

        if (added > 0) {
          logActivity_({
            actorUsername: body.username, actorRole: "admin", actionType: "RAW_MATERIAL_COST_CONTEXT",
            description: body.username + " bulk-imported " + added + " raw material(s)" + (skipped.length > 0 ? " (" + skipped.length + " skipped as duplicates)" : ""),
          });
        }
        return json_({ ok: true, added: added, skipped: skipped, state: withStockView_(getState_()) });
      }

      case "updateRawMaterial": {
        requireRole_(body.username, ["admin"]);
        const before = readObjects_("RawMaterials").find((m) => m.id === body.id);
        const patch = Object.assign({}, body.patch);
        // Normalize numeric fields at write time — strips trailing text
        // like "10kg" down to 10 via parseFloat, rather than storing a
        // bad string (or silently becoming 0 via Number()).
        ["minStockAlert", "unitCost", "lastPurchaseCost"].forEach(function (field) {
          if (patch[field] !== undefined) {
            const n = parseFloat(patch[field]);
            if (!isNaN(n)) patch[field] = n;
          }
        });

        // Opening Stock is now editable, but it's tied to real batches —
        // Purchases/In is DERIVED as (initialStock - openingStock).
        // Changing the number alone without touching actual stock would
        // silently break "System Balance = Opening + Purchases - Out".
        // Apply the delta as a REAL stock change (new batch if
        // increasing, FIFO consumption if decreasing), same mechanism as
        // a manual stock correction, so the physical count and the
        // ledger math move together.
        if (before && patch.openingStock !== undefined && patch.openingStock !== null && patch.openingStock !== "") {
          const newOpening = parseFloat(patch.openingStock);
          if (!isNaN(newOpening) && newOpening !== Number(before.openingStock || 0)) {
          const lock = LockService.getScriptLock();
          lock.waitLock(30000);
          try {
            const delta = Math.round((newOpening - Number(before.openingStock || 0)) * 1e6) / 1e6;
            if (delta !== 0) {
              const batches = readObjects_("Batches");
              if (delta > 0) {
                appendObject_("Batches", {
                  id: newId_("batch"), materialId: body.id, supplierId: null,
                  qtyPurchased: delta, qtyRemaining: delta, unitCost: before.unitCost,
                  purchasedAt: Date.now(), source: "openingStock",
                });
              } else {
                const remaining = batches.filter(function (b) { return b.materialId === body.id; }).reduce(function (a, b) { return a + Number(b.qtyRemaining); }, 0);
                if (Math.abs(delta) > remaining + 1e-9) {
                  return json_({ ok: false, error: "Can't lower Opening Balance by that much — only " + remaining + " " + before.unit + " of actual stock exists to remove." });
                }
                const res = consumeFifo_(batches, body.id, Math.abs(delta));
                writeBatchesBack_(batches, res.touched);
              }
            }
            patch.openingStock = newOpening;
          } finally {
            lock.releaseLock();
          }
          }
        }

        const ok = updateObjectById_("RawMaterials", body.id, patch);
        if (ok) {
          logActivity_({
            actorUsername: body.username, actorRole: "admin", actionType: "RAW_MATERIAL_COST_CONTEXT",
            description: "Edited raw material '" + (before ? before.name : body.id) + "'",
            before: before, after: Object.assign({}, before, patch),
          });
        }
        return json_({ ok: ok, state: withStockView_(getState_()) });
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

      case "getStaffMembers":
        requireRole_(body.username, ["admin", "cashier"]);
        return json_({ items: readObjects_("StaffMembers") });

      case "addStaffMember": {
        requireRole_(body.username, ["admin"]);
        const staffName = (body.name || "").trim();
        if (!staffName) return json_({ ok: false, error: "Name is required." });
        const staffItem = { id: newId_("stf"), name: staffName, active: true };
        appendObject_("StaffMembers", staffItem);
        return json_({ ok: true, item: staffItem });
      }

      case "updateStaffMember":
        requireRole_(body.username, ["admin"]);
        return json_({ ok: updateObjectById_("StaffMembers", body.id, body.patch) });

      case "deleteStaffMember":
        requireRole_(body.username, ["admin"]);
        return json_({ ok: deleteObjectById_("StaffMembers", body.id) });

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
          description: "Logged payment of " + body.amount + " EGP for '" + body.name + "'",
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

      case "getUnpaidExpenses":
        requireRole_(body.username, ["admin", "cashier"]);
        return json_({ items: readObjects_("Ledger").filter((l) => l.paymentStatus === "unpaid" && l.status === "approved").sort((a, b) => b.ts - a.ts) });

      case "settleExpense": {
        const settleRole = requireRole_(body.username, ["admin", "cashier"]);
        const validSettleSources = ["cash_drawer", "out_of_pocket", "bank_transfer"];
        if (validSettleSources.indexOf(body.paymentSource) === -1) {
          return json_({ ok: false, error: "Select a payment source." });
        }
        const settleEntry = readObjects_("Ledger").find((l) => l.id === body.ledgerId);
        if (!settleEntry) return json_({ ok: false, error: "Entry not found." });
        if (settleEntry.paymentStatus !== "unpaid") return json_({ ok: false, error: "This entry is not marked unpaid." });
        const settlePaidFromDrawer = body.paymentSource === "cash_drawer";
        const settlePatch = { paymentStatus: "paid", paymentSource: body.paymentSource, paidFromDrawer: settlePaidFromDrawer };
        // The cash actually leaves the drawer NOW, at settlement — not
        // whenever this was first logged as a debt (which could be a
        // shift that's already closed). See the local server's
        // identical fix for the full reasoning.
        if (settlePaidFromDrawer) {
          const settleState = getState_();
          if (settleState.activeShiftId) settlePatch.shiftId = settleState.activeShiftId;
        }
        updateObjectById_("Ledger", body.ledgerId, settlePatch);
        logActivity_({
          actorUsername: body.username, actorRole: settleRole, actionType: "EXPENSE_LOGGED", shiftId: settlePatch.shiftId || settleEntry.shiftId,
          description: body.username + " settled a debt: " + settleEntry.description + " — " + settleEntry.amount.toFixed(2) + " EGP now paid via " + body.paymentSource,
          before: { paymentStatus: "unpaid" }, after: settlePatch,
        });
        return json_({ ok: true });
      }

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
            purchasedAt: entry.ts, source: entry.type === "stockedBatch" ? "stockedBatch" : "dailyFresh", ledgerId: entry.id,
          });
        }
        updateObjectById_("Ledger", entry.id, { status: "approved" });
        logActivity_({
          actorUsername: body.username, actorRole: "admin", actionType: "EXPENSE_APPROVED", shiftId: entry.shiftId,
          description: "Approved purchase of " + entry.qty + " " + entry.materialId + " (" + entry.amount.toFixed(2) + " EGP" + "), submitted by " + entry.staffUsername,
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

        // A cashier can get INSTANT execution (skip the pending-approval
        // queue) if an admin authorizes right here with their own
        // credentials — same idea as a manager-key override at a
        // register. Verified independently of the cashier's own session.
        let approvingAdmin = null;
        if (role !== "admin" && body.approvingAdminUsername && body.approvingAdminPassword) {
          const authCheck = login_(body.approvingAdminUsername, body.approvingAdminPassword);
          if (!authCheck.ok || authCheck.role !== "admin") {
            return json_({ ok: false, error: "Admin authorization failed — check the username and password." });
          }
          approvingAdmin = authCheck.username;
        }
        // Offline/Unapproved Void Routing: no admin is available at all
        // (not even remotely, via the on-the-spot flow above) — the
        // cashier can still remove the item and keep checkout moving.
        // Unlike a normal pending request (which deliberately stays ON
        // the bill until reviewed, precisely to prevent a colluding
        // cashier from quietly deleting a paid item), this route removes
        // it and deducts inventory IMMEDIATELY, trading that protection
        // for speed — accountability instead comes from a mandatory,
        // permanent post-hoc admin reconciliation queue.
        const routeUnapproved = role !== "admin" && !approvingAdmin && !!body.routeUnapproved;
        const executesNow = role === "admin" || !!approvingAdmin || routeUnapproved;
        const approverUsername = role === "admin" ? body.username : approvingAdmin;

        const req = {
          id: newId_("void"), ts: Date.now(), roomId: room.id, roomName: room.name,
          menuItemId: body.menuItemId, itemName: line.name, qty: body.qty, unitPrice: line.price,
          billValue: line.price * body.qty, reason: body.reason,
          status: executesNow ? (routeUnapproved ? "unapproved" : "approved") : "pending",
          cashierUsername: body.username, waiterName: body.waiterName || "",
          shiftId: state.activeShiftId,
          approvedBy: executesNow && !routeUnapproved ? approverUsername : null,
          approvedAt: executesNow && !routeUnapproved ? Date.now() : null,
          cogs: null, applied: false, applyError: null,
        };

        if (executesNow) {
          // Cashiers have no authority to void independently — but an
          // admin-initiated (or admin-authorized, or offline-routed)
          // void executes immediately, same auto-approve pattern as
          // procurement.
          const batches = readObjects_("Batches");
          const result = applyVoid_(state, batches, req);
          if (result.ok) {
            req.cogs = result.cogs;
            req.applied = true;
            setState_(result.state);
            writeBatchesBack_(batches, result.touchedBatchIds);
            (result.newBatches || []).forEach(function (nb) { appendObject_("Batches", nb); });
            const reasonCfg = VOID_REASONS[body.reason];
            if (routeUnapproved) {
              // Always posted, even for reasons that wouldn't normally
              // touch inventory (e.g. wrongInput) — an unapproved
              // removal needs a paper trail regardless of COGS, since
              // its whole point is post-hoc reconciliation.
              appendObject_("Ledger", {
                id: newId_("ledg"), ts: req.ts, amount: result.cogs, direction: "outflow", type: "manualAdjustment",
                category: "Unapproved Void — Pending Reconciliation",
                description: req.qty + "x " + req.itemName + " — " + room.name + " (bill value " + req.billValue.toFixed(2) + " EGP" + ")",
                supplierId: null, staffUsername: body.username, status: "approved", receiptUrl: null,
                paidFromDrawer: false, shiftId: state.activeShiftId, materialId: null, qty: null, unitCost: null, paymentSource: null,
              });
            } else if (reasonCfg.deductsInventory && result.cogs > 0) {
              appendObject_("Ledger", {
                id: newId_("ledg"), ts: req.ts, amount: result.cogs, direction: "outflow", type: "manualAdjustment",
                category: reasonCfg.ledgerCategory, description: req.qty + "x " + req.itemName + " — " + room.name,
                supplierId: null, staffUsername: body.username, status: "approved", receiptUrl: null,
                paidFromDrawer: false, shiftId: state.activeShiftId, materialId: null, qty: null, unitCost: null, paymentSource: null,
              });
            }
          } else {
            req.applyError = result.error;
          }
        }
        // Pending (cashier, no admin present, not routed) requests
        // intentionally do NOT touch the room or batches — the item
        // stays fully on the live bill (and therefore in Expected
        // Drawer Cash) until approved.
        appendObject_("VoidRequests", req);
        const wasteClass = (body.reason === "spilled" || body.reason === "customerRejected") ? "Wasted" : "Non-Waste";
        logActivity_({
          actorUsername: body.username, actorRole: role,
          actionType: routeUnapproved ? "UNAPPROVED_VOID_ROUTED" : (approvingAdmin ? "UNDO_ACTION" : "VOID_REQUESTED"),
          location: room.name, shiftId: state.activeShiftId,
          description: req.qty + "x " + req.itemName + " voided (" + VOID_REASONS[body.reason].label + ", " + wasteClass + ") — " +
            req.status + (approvingAdmin ? " — cancelled by " + body.username + ", authorized on the spot by admin " + approvingAdmin : "") +
            (routeUnapproved ? " — NO ADMIN AVAILABLE, routed for post-hoc reconciliation" : ""),
          before: { qty: line.qty },
          after: {
            voided: req.qty, status: req.status, reason: body.reason, wasteClass: wasteClass,
            cashierUsername: body.username, approvingAdmin: approvingAdmin || null, billValue: req.billValue,
          },
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
        (result.newBatches || []).forEach(function (nb) { appendObject_("Batches", nb); });
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

      // Offline/Unapproved Void Routing — the item was already removed
      // from the bill and inventory already deducted at request time (see
      // requestVoid's routeUnapproved path); this is purely a post-hoc
      // administrative sign-off, not a business-logic action. "Approve"
      // confirms it was legitimate. "Flag as Discrepancy" leaves a
      // permanent red flag on the record for follow-up — nothing is
      // reversed automatically since the item is already gone and the
      // stock already moved; this is about accountability, not undo.
      case "reconcileUnapprovedVoid": {
        requireRole_(body.username, ["admin"]);
        const before = readObjects_("VoidRequests").find((r) => r.id === body.voidId);
        if (!before) return json_({ ok: false, error: "Void request not found" });
        if (before.status !== "unapproved") return json_({ ok: false, error: "This request has already been reconciled" });
        const newStatus = body.decision === "flag_discrepancy" ? "discrepancy" : "approved";
        updateObjectById_("VoidRequests", body.voidId, { status: newStatus, approvedBy: body.username, approvedAt: Date.now() });
        logActivity_({
          actorUsername: body.username, actorRole: "admin",
          actionType: body.decision === "flag_discrepancy" ? "UNAPPROVED_VOID_FLAGGED" : "UNAPPROVED_VOID_RECONCILED",
          location: before.roomName, shiftId: before.shiftId,
          description: (body.decision === "flag_discrepancy" ? "Flagged as DISCREPANCY: " : "Reconciled: ") +
            before.qty + "x " + before.itemName + " (originally routed by " + before.cashierUsername + ", " + before.billValue.toFixed(2) + " EGP" + " bill value)" +
            (body.note ? " — Note: " + body.note : ""),
          before: { status: "unapproved" }, after: { status: newStatus, note: body.note || null },
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

      case "resetMenuAndRecipes": {
        requireRole_(body.username, ["admin"]);
        const auth = login_(body.username, body.password);
        if (!auth.ok || auth.role !== "admin") {
          return json_({ ok: false, error: "Password incorrect — reset cancelled. Nothing was changed." });
        }
        const result = resetMenuAndRecipes_(body.username);
        logActivity_({
          actorUsername: body.username, actorRole: "admin", actionType: "PRODUCTION_RESET",
          description: body.username + " rebuilt the entire menu from source — " + result.materialsCreated + " new material(s) created, " + result.itemsCreated + " menu item(s) rebuilt with recipes.",
        });
        return json_({
          ok: true, materialsCreated: result.materialsCreated, itemsCreated: result.itemsCreated,
          unresolved: result.unresolved, state: result.state,
        });
      }

      case "importAllData": {
        requireRole_(body.username, ["admin"]);
        const importAuth = login_(body.username, body.password);
        if (!importAuth.ok || importAuth.role !== "admin") {
          return json_({ ok: false, error: "Password incorrect — nothing was changed." });
        }
        if (body.confirmPhrase !== "MIGRATE FROM CAFE") {
          return json_({ ok: false, error: "Confirmation phrase didn't match — nothing was changed." });
        }
        const importResult = importAllData_(body);
        logActivity_({
          actorUsername: body.username, actorRole: "admin", actionType: "PRODUCTION_RESET",
          description: body.username + " migrated all data from the café's local database — " + Object.keys(importResult.tableSummary).map(function (k) { return k + ":" + importResult.tableSummary[k]; }).join(", ") + (importResult.accountsAdded > 0 ? "; " + importResult.accountsAdded + " new account(s) added" : ""),
        });
        return json_({ ok: true, tableSummary: importResult.tableSummary, accountsAdded: importResult.accountsAdded, state: withStockView_(getState_()) });
      }

      // Routine, unattended sync from the café's local server — runs
      // automatically every ~30s in the background, so it's
      // authenticated the same way every ordinary action is (the
      // shared secret checked once at the very top of doPost), NOT a
      // human-entered password + confirm phrase like the one-time
      // Migrate to Cloud tool above. The café is treated as
      // authoritative: each sync fully replaces cloud business data
      // with the latest local snapshot, same replace semantics as a
      // manual migration, just repeated automatically and silently.
      case "autoSyncFromLocal": {
        const syncResult = importAllData_(body);
        return json_({ ok: true, tableSummary: syncResult.tableSummary, accountsAdded: syncResult.accountsAdded });
      }

      case "submitPurchaseInvoice": {
        requireRole_(body.username, ["admin", "cashier"]);
        const invResult = submitPurchaseInvoice_(body);
        if (!invResult.ok) return json_(invResult);
        logActivity_({
          actorUsername: body.username, actorRole: roleForUsername_(body.username), actionType: "EXPENSE_LOGGED", shiftId: body.shiftId || null,
          description: body.username + " logged a supplier invoice: " + invResult.itemCount + " item(s) for " + invResult.totalAmount.toFixed(2) + " EGP (" + invResult.paymentType + ")",
        });
        return json_({ ok: true, invoiceId: invResult.invoiceId, totalAmount: invResult.totalAmount, itemCount: invResult.itemCount, state: withStockView_(getState_()) });
      }

      case "recordSupplierPayment": {
        requireRole_(body.username, ["admin", "cashier"]);
        const payResult = recordSupplierPayment_(body);
        if (!payResult.ok) return json_(payResult);
        logActivity_({
          actorUsername: body.username, actorRole: roleForUsername_(body.username), actionType: "EXPENSE_LOGGED", shiftId: body.shiftId || null,
          description: body.username + " recorded a payment of " + Number(body.amount).toFixed(2) + " EGP to a supplier via " + body.paymentSource,
        });
        return json_({ ok: true, paymentId: payResult.paymentId });
      }

      case "deleteSupplierPayment": {
        // Admin-only per explicit request.
        requireRole_(body.username, ["admin"]);
        const paymentBefore = readObjects_("SupplierPayments").find(function (p) { return p.id === body.paymentId; });
        const delPayResult = deleteSupplierPayment_(body.paymentId);
        if (!delPayResult.ok) return json_(delPayResult);
        logActivity_({
          actorUsername: body.username, actorRole: "admin", actionType: "EXPENSE_DELETED",
          description: body.username + " deleted a supplier payment" +
            (paymentBefore ? " — " + paymentBefore.amount.toFixed(2) + " EGP" : ""),
          before: paymentBefore || null,
        });
        return json_({ ok: true, state: withStockView_(getState_()) });
      }

      case "getSupplierBalances":
        requireRole_(body.username, ["admin", "cashier"]);
        return json_({ balances: getSupplierBalances_() });

      case "getSupplierLedger":
        requireRole_(body.username, ["admin", "cashier"]);
        if (!body.supplierId) return json_({ ok: false, error: "Supplier is required." });
        return json_({ ok: true, ledger: getSupplierLedger_(body.supplierId) });

      case "deletePurchase": {
        // Admin-only per explicit request — deleting a logged expense/
        // purchase is a real financial correction, not a routine
        // cashier action.
        requireRole_(body.username, ["admin"]);
        const entryBefore = readObjects_("Ledger").find(function (l) { return l.id === body.ledgerId; });
        const delResult = deletePurchase_(body.ledgerId);
        if (!delResult.ok) return json_(delResult);
        logActivity_({
          actorUsername: body.username, actorRole: roleForUsername_(body.username), actionType: "EXPENSE_DELETED",
          description: body.username + " deleted a logged expense — " +
            (entryBefore ? Number(entryBefore.amount).toFixed(2) + " EGP, \"" + (entryBefore.description || entryBefore.category) + "\"" : body.ledgerId),
          before: entryBefore ? { amount: entryBefore.amount, description: entryBefore.description, category: entryBefore.category } : null,
        });
        return json_({ ok: true, state: withStockView_(getState_()) });
      }

      case "updatePurchase": {
        requireRole_(body.username, ["admin", "cashier"]);
        const updResult = updatePurchase_(body);
        if (!updResult.ok) return json_(updResult);
        logActivity_({
          actorUsername: body.username, actorRole: roleForUsername_(body.username), actionType: "EXPENSE_LOGGED",
          description: body.username + " edited a procurement entry",
        });
        return json_({ ok: true, state: withStockView_(getState_()) });
      }

      case "deleteSupplierInvoice": {
        // Admin-only per explicit request — deleting a supplier invoice
        // is a real financial correction, not a routine cashier action.
        requireRole_(body.username, ["admin"]);
        const delInvResult = deleteSupplierInvoice_(body.invoiceId);
        if (!delInvResult.ok) return json_(delInvResult);
        logActivity_({
          actorUsername: body.username, actorRole: roleForUsername_(body.username), actionType: "EXPENSE_LOGGED",
          description: body.username + " deleted a supplier invoice",
        });
        return json_({ ok: true, state: withStockView_(getState_()) });
      }

      case "forceDeleteSupplierInvoice": {
        requireRole_(body.username, ["admin"]);
        if (body.confirmText !== "FORCE DELETE") return json_({ ok: false, error: "Type FORCE DELETE exactly to confirm." });
        const forceAuth = login_(body.username, body.password);
        if (!forceAuth.ok || forceAuth.role !== "admin") return json_({ ok: false, error: "Password incorrect — nothing was deleted." });
        const invoiceBefore = readObjects_("PurchaseInvoices").find(function (i) { return i.id === body.invoiceId; });
        const forceDelResult = forceDeleteSupplierInvoice_(body.invoiceId);
        if (!forceDelResult.ok) return json_(forceDelResult);
        logActivity_({
          actorUsername: body.username, actorRole: "admin", actionType: "SUPPLIER_INVOICE_FORCE_DELETED",
          description: body.username + " force-deleted a supplier invoice" +
            (invoiceBefore ? " — " + invoiceBefore.totalAmount.toFixed(2) + " EGP from " + invoiceBefore.supplierName + " (bypassed the already-used stock check)" : ""),
          before: invoiceBefore || null,
        });
        return json_({ ok: true, state: withStockView_(getState_()) });
      }

      case "updateSupplierInvoice": {
        requireRole_(body.username, ["admin"]);
        const updInvResult = updateSupplierInvoice_(body);
        if (!updInvResult.ok) return json_(updInvResult);
        logActivity_({
          actorUsername: body.username, actorRole: "admin", actionType: "EXPENSE_LOGGED",
          description: body.username + " edited a supplier invoice",
        });
        return json_({ ok: true, state: withStockView_(getState_()) });
      }

      case "repairMenuRecipes": {
        requireRole_(body.username, ["admin"]);
        const repairResult = repairMenuRecipes_(body.username);
        return json_({
          ok: true, materialsCreated: repairResult.materialsCreated, itemsFixed: repairResult.itemsFixed,
          stillUnresolved: repairResult.stillUnresolved, state: repairResult.state,
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
function menuResetMaterials_() {
  return [
    ["زبادي", "kg", 1, 10],
    ["عسل", "kg", 1, 200],
    ["لبن", "L", 1, 43],
    ["سكر", "kg", 1, 30],
    ["تلج", "kg", 1, 0],
    ["توبينج فراوله", "kg", 1, 160],
    ["توبينج مانجو", "kg", 1, 160],
    ["توبينج بيري", "kg", 1, 160],
    ["توبينج راس بيري", "kg", 1, 160],
    ["توبينج باشون فروت", "kg", 1, 160],
    ["بودر فانيليا", "kg", 1, 180],
    ["صوص شوكليت", "kg", 1, 165],
    ["صوص كراميل", "kg", 1, 165],
    ["بودر شوكليت", "kg", 1, 260],
    ["اسبريسو", "kg", 1, 700],
    ["نعناع سيرب", "L", 1, 90],
    ["بن تركي", "kg", 1, 420],
    ["مانجو فريش", "kg", 1, 60],
    ["فراوله فريش", "kg", 1, 55],
    ["شاي باكت", "pcs", 1, 1.5],
    ["مكسرات", "kg", 1, 600],
    ["سما نوتيلا", "kg", 1, 160],
    ["سما وايت", "kg", 1, 170],
    ["سما فسدق", "kg", 1, 550],
    ["سما لوتس", "kg", 1, 160],
    ["حليب مكثف", "L", 1, 285],
    ["اوريو", "kg", 1, 15],
    ["جوافه فروزين", "kg", 1, 75],
    ["فراوله فروزين", "kg", 1, 80],
    ["كيوي فروزين", "kg", 1, 180],
    ["بلح فروزين", "kg", 1, 75],
    ["افوكادو فروزين", "kg", 1, 250],
    ["بطيخ فروزين", "kg", 1, 75],
    ["رمان فروزين", "kg", 1, 75],
    ["سيرب فانيليا", "L", 1, 180],
    ["سيرب بندق", "L", 1, 180],
    ["سيرب بلوكراساو", "L", 1, 180],
    ["ايس كريم", "kg", 1, 80],
    ["ريدبول", "pcs", 1, 53],
    ["كان", "pcs", 1, 12.5],
    ["مياه ص", "pcs", 1, 5],
    ["مياه ك", "pcs", 1, 8.5],
    ["مشروب شعير", "L", 1, 13],
    ["مولتن كيك", "kg", 1, 35],
    ["تشيز كيك", "kg", 1, 40],
    ["براونيز", "kg", 1, 30],
    ["سيرب موهيتو", "L", 1, 170],
    ["مانجو فروزين", "kg", 1, 125],
    ["خوخ فروزين", "kg", 1, 150],
    ["فواكهه قطع", "pcs", 1, 15],
    ["موز", "kg", 1, 35],
    ["ليمون", "kg", 1, 25],
    ["جهينه تفاح", "kg", 1, 30],
    ["جهينه اناناس", "kg", 1, 35],
    ["نعناع فريش", "kg", 1, 1],
    ["سيرب سويت اند ساور", "L", 1, 180],
    ["ليمون قطع", "pcs", 1, 0.5],
    ["سيرب شيري", "L", 1, 170],
    ["اكسترا توبينج", "kg", 1, 170],
    ["عجينه وافل", "kg", 1, 10],
    ["معسل فاخر", "kg", 1, 740],
    ["معسل دندش", "kg", 1, 550],
    ["معسل مزايا", "kg", 1, 710],
    ["نسكافيه", "kg", 1, 1200],
    ["شاي سايب", "kg", 1, 200],
    ["قرنفل", "kg", 1, 900],
    ["شاي اخضر", "kg", 1, 2],
    ["شاي نكهات", "kg", 1, 5],
    ["قرفه عيدان", "kg", 1, 300],
    ["اعشاب باكت", "pcs", 1, 2],
    ["سحلب بودر", "kg", 1, 130],
    ["توبينج جوز الهند", "kg", 1, 160],
    ["صوص كيندر", "kg", 1, 165],
    ["فيروز", "pcs", 1, 45],
    ["كومبوت اناناس", "kg", 1, 160]
  ];
}

function menuResetItems_() {
  return {
    "Espresso": { price: 35, category: "Coffee", ingredients: [["اسبريسو", 0.007]] },
    "Espresso Double": { price: 45, category: "Coffee", ingredients: [["اسبريسو", 0.014]] },
    "Macchiato": { price: 35, category: "Coffee", ingredients: [["اسبريسو", 0.007], ["لبن", 0.02]] },
    "Macchiato Double": { price: 50, category: "Coffee", ingredients: [["اسبريسو", 0.014], ["لبن", 0.04]] },
    "Cappuccino": { price: 60, category: "Coffee", ingredients: [["اسبريسو", 0.014], ["لبن", 0.15], ["سكر", 0.01]] },
    "Latte": { price: 60, category: "Coffee", ingredients: [["اسبريسو", 0.007], ["لبن", 0.15], ["سكر", 0.01]] },
    "Spanish Latte": { price: 65, category: "Coffee", ingredients: [["اسبريسو", 0.007], ["لبن", 0.15], ["حليب مكثف", 0.03]] },
    "Mocha": { price: 60, category: "Coffee", ingredients: [["اسبريسو", 0.007], ["لبن", 0.15], ["صوص شوكليت", 0.03]] },
    "Cortado": { price: 50, category: "Coffee", ingredients: [["لبن", 0.1], ["اسبريسو", 0.014], ["سكر", 0.01]] },
    "Nescafe": { price: 60, category: "Coffee", ingredients: [["نسكافيه", 0.005], ["لبن", 0.15]] },
    "Hazelnut Coffee": { price: 60, category: "Coffee", ingredients: [["بن تركي", 0.01], ["سيرب بندق", 0.03], ["لبن", 0.1]] },
    "Nutella Coffee": { price: 65, category: "Coffee", ingredients: [["بن تركي", 0.01], ["لبن", 0.1], ["سما نوتيلا", 0.05]] },
    "French Coffee": { price: 45, category: "Coffee", ingredients: [["بن تركي", 0.01], ["لبن", 0.1], ["سكر", 0.01]] },
    "Turkish Coffee": { price: 30, category: "Coffee", ingredients: [["بن تركي", 0.015], ["سكر", 0.01]] },
    "Turkish Coffee Double": { price: 35, category: "Coffee", ingredients: [["بن تركي", 0.025], ["سكر", 0.01]] },
    "Classic Frappe": { price: 70, category: "Coffee Frappe", ingredients: [["بودر فانيليا", 0.03], ["اسبريسو", 0.007], ["تلج", 1.0], ["لبن", 0.15], ["ايس كريم", 0.07]] },
    "Nutella Frappe": { price: 75, category: "Coffee Frappe", ingredients: [["بودر فانيليا", 0.03], ["سما نوتيلا", 0.04], ["تلج", 1.0], ["لبن", 0.15], ["ايس كريم", 0.07]] },
    "Lotus Frappe": { price: 75, category: "Coffee Frappe", ingredients: [["بودر فانيليا", 0.03], ["سما لوتس", 0.04], ["تلج", 1.0], ["لبن", 0.15], ["ايس كريم", 0.07]] },
    "Caramel Frappe": { price: 80, category: "Coffee Frappe", ingredients: [["بودر فانيليا", 0.03], ["اسبريسو", 0.007], ["تلج", 1.0], ["لبن", 0.15], ["ايس كريم", 0.07], ["صوص كراميل", 0.03]] },
    "Hazelnut Frappe": { price: 90, category: "Coffee Frappe", ingredients: [["بودر فانيليا", 0.03], ["سما فسدق", 0.03], ["تلج", 1.0], ["لبن", 0.15], ["ايس كريم", 0.07]] },
    "Iced Latte": { price: 70, category: "Ice Coffee", ingredients: [["اسبريسو", 0.007], ["لبن", 0.15], ["سكر", 0.02]] },
    "Iced Spanish Latte": { price: 75, category: "Ice Coffee", ingredients: [["اسبريسو", 0.007], ["لبن", 0.15], ["سكر", 0.02], ["حليب مكثف", 0.02]] },
    "Iced Mocha": { price: 75, category: "Ice Coffee", ingredients: [["اسبريسو", 0.007], ["لبن", 0.15], ["سكر", 0.02], ["صوص شوكليت", 0.02]] },
    "Iced Cappuccino": { price: 70, category: "Ice Coffee", ingredients: [["نسكافيه", 0.005], ["لبن", 0.15], ["سكر", 0.02]] },
    "Vanilla Shake": { price: 60, category: "Milkshake", ingredients: [["ايس كريم", 0.21], ["لبن", 0.1]] },
    "Chocolate Shake": { price: 65, category: "Milkshake", ingredients: [["صوص شوكليت", 0.03], ["لبن", 0.1], ["ايس كريم", 0.21]] },
    "Mango Shake": { price: 70, category: "Milkshake", ingredients: [["مانجو فروزين", 0.1], ["لبن", 0.1], ["ايس كريم", 0.21]] },
    "Strawberry Shake": { price: 65, category: "Milkshake", ingredients: [["توبينج فراوله", 0.025], ["ايس كريم", 0.21], ["لبن", 0.1]] },
    "Mix Berry Shake": { price: 65, category: "Milkshake", ingredients: [["توبينج بيري", 0.015], ["توبينج راس بيري", 0.015], ["ايس كريم", 0.21], ["لبن", 0.1]] },
    "Passion Fruit Shake": { price: 65, category: "Milkshake", ingredients: [["توبينج باشون فروت", 0.025], ["لبن", 0.1], ["ايس كريم", 0.21]] },
    "Oreo Shake": { price: 70, category: "Milkshake", ingredients: [["اوريو", 1.0], ["لبن", 0.1], ["ايس كريم", 0.21]] },
    "Nutella Shake": { price: 75, category: "Milkshake", ingredients: [["سما نوتيلا", 0.03], ["لبن", 0.1], ["ايس كريم", 0.21]] },
    "Lotus Shake": { price: 75, category: "Milkshake", ingredients: [["لبن", 0.03], ["ايس كريم", 0.21]] },
    "Pistachio Shake": { price: 80, category: "Milkshake", ingredients: [["سما فسدق", 0.03], ["لبن", 0.1], ["ايس كريم", 0.21]] },
    "Caramel Shake": { price: 75, category: "Milkshake", ingredients: [["صوص كراميل", 0.03], ["لبن", 0.1], ["ايس كريم", 0.21]] },
    "Kinder Shake": { price: 75, category: "Milkshake", ingredients: [["لبن", 0.2], ["صوص كيندر", 0.03], ["تلج", 0.1]] },
    "Mango": { price: 65, category: "Fresh Juice", ingredients: [["مانجو فريش", 0.25]] },
    "Strawberry": { price: 60, category: "Fresh Juice", ingredients: [["فراوله فروزين", 0.2], ["سكر", 0.03], ["لبن", 0.15]] },
    "Guava": { price: 60, category: "Fresh Juice", ingredients: [["جوافه فروزين", 0.2], ["لبن", 0.15], ["سكر", 0.03]] },
    "Banana": { price: 60, category: "Fresh Juice", ingredients: [["موز", 0.15], ["لبن", 0.15], ["سكر", 0.03]] },
    "Kiwi": { price: 70, category: "Fresh Juice", ingredients: [["كيوي فروزين", 0.2], ["سكر", 0.03]] },
    "Watermelon": { price: 65, category: "Fresh Juice", ingredients: [["بطيخ فروزين", 0.25], ["سكر", 0.02]] },
    "Pomegranate": { price: 60, category: "Fresh Juice", ingredients: [["رمان فروزين", 0.25], ["سكر", 0.02]] },
    "Lemon": { price: 45, category: "Fresh Juice", ingredients: [["ليمون", 0.06], ["سكر", 0.04], ["تلج", 1.0], ["لبن", 0.02]] },
    "Lemon Mint": { price: 55, category: "Fresh Juice", ingredients: [["ليمون", 0.06], ["نعناع سيرب", 0.04], ["سكر", 0.1], ["تلج", 1.0], ["لبن", 0.025]] },
    "Date": { price: 70, category: "Fresh Juice", ingredients: [["بلح فروزين", 0.2], ["سكر", 0.01], ["لبن", 0.15]] },
    "Avocado": { price: 80, category: "Fresh Juice", ingredients: [["افوكادو فروزين", 0.12], ["لبن", 0.15], ["ايس كريم", 0.07]] },
    "Classic Yogurt": { price: 60, category: "Fresh Juice", ingredients: [["زبادي", 2.0], ["سكر", 0.02], ["لبن", 0.1]] },
    "Watermelon Mint": { price: 70, category: "Frozen Fresh", ingredients: [["بطيخ فروزين", 0.25], ["نعناع فريش", 1.0], ["تلج", 1.0], ["سكر", 0.02]] },
    "Passion Fruit Smoothie": { price: 65, category: "Frozen Fresh", ingredients: [["توبينج باشون فروت", 0.04], ["تلج", 1.0], ["سكر", 0.02]] },
    "Mango Smoothie": { price: 70, category: "Frozen Fresh", ingredients: [["مانجو فروزين", 0.1], ["سكر", 0.03], ["توبينج مانجو", 0.02]] },
    "Strawberry Smoothie": { price: 70, category: "Frozen Fresh", ingredients: [["فراوله فروزين", 0.2], ["سكر", 0.02], ["توبينج فراوله", 0.02]] },
    "Lemon Mint Smoothie": { price: 60, category: "Frozen Fresh", ingredients: [["ليمون", 0.075], ["سكر", 0.04], ["تلج", 1.0], ["لبن", 0.02]] },
    "Mix Berry Smoothie": { price: 65, category: "Frozen Fresh", ingredients: [["توبينج بيري", 0.02], ["توبينج راس بيري", 0.02], ["جهينه اناناس", 0.15], ["سيرب بلوكراساو", 0.02]] },
    "Peach Smoothie": { price: 65, category: "Frozen Fresh", ingredients: [["خوخ فروزين", 0.15], ["تلج", 0.1]] },
    "Pina Colada": { price: 75, category: "Frozen Fresh", ingredients: [["توبينج جوز الهند", 0.02], ["كومبوت اناناس", 0.03], ["تلج", 0.1]] },
    "Classic Cocktail": { price: 70, category: "Cocktails", ingredients: [["مانجو فروزين", 0.1], ["فراوله فروزين", 0.1], ["جوافه فروزين", 0.1], ["تلج", 1.0], ["سكر", 0.02]] },
    "Mix Power": { price: 80, category: "Cocktails", ingredients: [["افوكادو فروزين", 0.06], ["بلح فروزين", 0.1], ["مكسرات", 0.015], ["عسل", 0.03], ["لبن", 0.15], ["سكر", 0.02]] },
    "Mango Dream": { price: 75, category: "Cocktails", ingredients: [["مانجو فروزين", 0.1], ["خوخ فروزين", 0.1], ["ايس كريم", 0.07], ["توبينج باشون فروت", 0.025]] },
    "Berry Bomb": { price: 75, category: "Cocktails", ingredients: [["فراوله فروزين", 0.1], ["توبينج بيري", 0.02], ["توبينج راس بيري", 0.02], ["سكر", 0.02]] },
    "Zabadooo": { price: 75, category: "Cocktails", ingredients: [["زبادي", 1.0], ["مانجو فروزين", 0.1], ["فواكهه قطع", 1.0], ["سكر", 0.02], ["تلج", 1.0]] },
    "Twist": { price: 80, category: "Cocktails", ingredients: [["مانجو فروزين", 0.1], ["كيوي فروزين", 0.1], ["ايس كريم", 0.07], ["سكر", 0.02]] },
    "Glitch Cocktail": { price: 85, category: "Cocktails", ingredients: [["زبادي", 1.0], ["مانجو فروزين", 0.1], ["ايس كريم", 0.14], ["موز", 0.1], ["عسل", 0.02], ["لبن", 0.1]] },
    "Hot Chocolate": { price: 60, category: "Hot Drinks", ingredients: [["لبن", 0.1], ["بودر شوكليت", 0.03]] },
    "Hot Chocolate Nutella": { price: 70, category: "Hot Drinks", ingredients: [["لبن", 0.1], ["بودر شوكليت", 0.03], ["سما نوتيلا", 0.02]] },
    "Hot Cider": { price: 50, category: "Hot Drinks", ingredients: [["جهينه تفاح", 0.15], ["قرفه عيدان", 0.01], ["سكر", 0.01]] },
    "Classic Tea": { price: 25, category: "Hot Drinks", ingredients: [["شاي باكت", 1.0], ["سكر", 0.05]] },
    "Golden Tea": { price: 30, category: "Hot Drinks", ingredients: [["شاي سايب", 0.005], ["نعناع فريش", 0.5], ["سكر", 0.05], ["قرنفل", 0.005]] },
    "Milk Tea": { price: 35, category: "Hot Drinks", ingredients: [["شاي باكت", 1.0], ["سكر", 0.05], ["لبن", 0.05]] },
    "Flavored Tea": { price: 30, category: "Hot Drinks", ingredients: [["شاي نكهات", 1.0], ["سكر", 0.05]] },
    "Flavored Milk Tea": { price: 40, category: "Hot Drinks", ingredients: [["شاي نكهات", 1.0], ["لبن", 0.05], ["سكر", 0.05]] },
    "Herbal Tea": { price: 30, category: "Hot Drinks", ingredients: [["اعشاب باكت", 1.0], ["سكر", 0.05]] },
    "Herbal Cocktail": { price: 50, category: "Hot Drinks", ingredients: [["اعشاب باكت", 2.0], ["قرفه عيدان", 0.01], ["عسل", 0.02], ["نعناع فريش", 0.5], ["ليمون قطع", 1.0]] },
    "Molten Cake": { price: 70, category: "Desserts", ingredients: [["مولتن كيك", 1.0], ["ايس كريم", 0.07], ["سما نوتيلا", 0.02], ["سما وايت", 0.01]] },
    "Cheesecake": { price: 70, category: "Desserts", ingredients: [["تشيز كيك", 1.0], ["سما فسدق", 0.02], ["سما وايت", 0.01]] },
    "Brownies": { price: 65, category: "Desserts", ingredients: [["براونيز", 1.0], ["ايس كريم", 0.07], ["صوص شوكليت", 0.02]] },
    "Waffle Nutella": { price: 75, category: "Desserts", ingredients: [["سما نوتيلا", 0.05], ["ايس كريم", 0.07], ["عجينه وافل", 1.0], ["سما وايت", 0.01]] },
    "Waffle Four Seasons": { price: 85, category: "Desserts", ingredients: [["صوص شوكليت", 0.02], ["عجينه وافل", 1.0], ["ايس كريم", 0.07], ["سما نوتيلا", 0.03], ["سما وايت", 0.01]] },
    "Classic Mojito": { price: 60, category: "Mojito", ingredients: [["كان", 1], ["ليمون قطع", 1], ["نعناع فريش", 0.5], ["سيرب موهيتو", 0.01]] },
    "Mix Berry Mojito": { price: 65, category: "Mojito", ingredients: [["كان", 1.0], ["سيرب موهيتو", 0.01], ["نعناع فريش", 0.5], ["ليمون قطع", 1.0], ["توبينج بيري", 0.01], ["توبينج راس بيري", 0.01]] },
    "Strawberry Mojito": { price: 65, category: "Mojito", ingredients: [["كان", 1.0], ["ليمون قطع", 1.0], ["سيرب موهيتو", 0.01], ["توبينج فراوله", 0.02], ["نعناع فريش", 0.5]] },
    "Passion Fruit Mojito": { price: 70, category: "Mojito", ingredients: [["كان", 1.0], ["سيرب موهيتو", 0.01], ["نعناع فريش", 0.5], ["توبينج باشون فروت", 0.02], ["ليمون قطع", 1.0]] },
    "Blue Sky Mojito": { price: 75, category: "Mojito", ingredients: [["كان", 1.0], ["سيرب موهيتو", 0.01], ["ليمون قطع", 1.0], ["سيرب بلوكراساو", 0.01], ["توبينج بيري", 0.02], ["نعناع فريش", 0.5]] },
    "Mango Mojito": { price: 70, category: "Mojito", ingredients: [["كان", 1.0], ["ليمون قطع", 1.0], ["سيرب موهيتو", 0.01], ["توبينج مانجو", 0.02], ["تلج", 1.0], ["نعناع فريش", 0.5]] },
    "Cherry Mojito": { price: 70, category: "Mojito", ingredients: [["كان", 1.0], ["تلج", 1.0], ["ليمون قطع", 1.0], ["سيرب موهيتو", 0.01], ["سيرب شيري", 0.02], ["نعناع فريش", 0.5]] },
    "Peach Mojito": { price: 65, category: "Mojito", ingredients: [["كان", 1], ["ليمون قطع", 1], ["نعناع فريش", 0.5], ["سيرب موهيتو", 0.01], ["خوخ فروزين", 0.02]] },
    "Red Bull Mojito": { price: 90, category: "Mojito", ingredients: [["ريدبول", 1.0], ["ليمون قطع", 1.0], ["اكسترا توبينج", 0.02], ["نعناع فريش", 0.5], ["سيرب موهيتو", 0.01]] },
    "Water": { price: 10, category: "Soft Drinks", ingredients: [["مياه ص", 1]] },
    "Soft Soda": { price: 40, category: "Soft Drinks", ingredients: [["كان", 1]] },
    "Fayrouz": { price: 45, category: "Soft Drinks", ingredients: [["فيروز", 1]] },
    "Redbull": { price: 80, category: "Soft Drinks", ingredients: [["ريدبول", 1]] },
    "Milk": { price: 15, category: "Extras", ingredients: [["لبن", 0.1]] },
    "Honey": { price: 15, category: "Extras", ingredients: [["عسل", 0.02]] },
    "Nuts": { price: 20, category: "Extras", ingredients: [["مكسرات", 0.02]] },
    "Sauce": { price: 20, category: "Extras", ingredients: [["صوص شوكليت", 0.02]] },
    "Ice Cream": { price: 15, category: "Extras", ingredients: [["ايس كريم", 0.05]] },
    "Espresso Shot": { price: 20, category: "Extras", ingredients: [["اسبريسو", 0.007]] },
    "Maasel": { price: 20, category: "Shisha", ingredients: [["معسل مزايا", 0.02]] },
    "Moroccan": { price: 40, category: "Shisha", ingredients: [["معسل مزايا", 0.02]] },
    "Moroccan Flavors": { price: 45, category: "Shisha", ingredients: [["معسل فاخر", 0.02]] },
    "Premium Shisha": { price: 65, category: "Shisha", ingredients: [["معسل فاخر", 0.03]] },
    "Glitch Special Shisha": { price: 85, category: "Shisha", ingredients: [["معسل دندش", 0.03]] },
    "Extra Hose (Regular)": { price: 10, category: "Shisha", ingredients: [] },
    "Extra Hose (Ice)": { price: 20, category: "Shisha", ingredients: [] }
  };
}

// Supplier Purchase Invoice + Supplier Ledger system. Deliberately
// separate from the general cash Ledger's Unpaid Expenses/Settle flow
// — a supplier account is a running balance across many invoices and
// many partial payments, not a single debt settled in one action.
// Cash invoices still create a normal Ledger entry (so drawer math
// stays correct everywhere else); deferred ones only affect the
// supplier's running balance, never the Ledger.
function submitPurchaseInvoice_(body) {
  const items = Array.isArray(body.items) ? body.items : [];
  if (!body.supplierId || items.length === 0) {
    return { ok: false, error: "Select a supplier and add at least one item." };
  }
  if (body.paymentType === "cash") {
    const validSources = ["cash_drawer", "out_of_pocket", "bank_transfer"];
    if (validSources.indexOf(body.paymentSource) === -1) {
      return { ok: false, error: "Select a payment source for a cash invoice." };
    }
  }

  const materials = readObjects_("RawMaterials");
  const materialById = {};
  materials.forEach(function (m) { materialById[m.id] = m; });

  let totalAmount = 0;
  const preparedItems = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const material = materialById[it.materialId];
    if (!material) return { ok: false, error: "One of the selected materials no longer exists." };
    const qty = Number(it.qty);
    const unitPrice = Number(it.unitPrice);
    if (!(qty > 0) || !(unitPrice >= 0)) return { ok: false, error: "Every line item needs a valid quantity and unit price." };
    const subtotal = qty * unitPrice;
    totalAmount += subtotal;
    preparedItems.push({ materialId: it.materialId, materialName: material.name, qty: qty, unitPrice: unitPrice, subtotal: subtotal });
  }

  const now = Date.now();
  const invoiceId = newId_("pinv");
  const paymentType = body.paymentType === "cash" ? "cash" : "deferred";
  const paymentSource = paymentType === "cash" ? body.paymentSource : null;

  appendObject_("PurchaseInvoices", {
    id: invoiceId, supplierId: body.supplierId, supplierName: body.supplierName || "",
    invoiceDate: body.invoiceDate || now, paymentType: paymentType, totalAmount: totalAmount, createdAt: now,
    createdBy: body.username, paymentSource: paymentSource,
  });

  const cashLedgerEntryId = paymentType === "cash" ? newId_("ledg") : null;

  preparedItems.forEach(function (it) {
    appendObject_("PurchaseInvoiceItems", {
      id: newId_("pinvitem"), invoiceId: invoiceId, materialId: it.materialId, materialName: it.materialName,
      qty: it.qty, unitPrice: it.unitPrice, subtotal: it.subtotal,
    });
    appendObject_("Batches", {
      id: newId_("batch"), materialId: it.materialId, supplierId: body.supplierId,
      qtyPurchased: it.qty, qtyRemaining: it.qty, unitCost: it.unitPrice, purchasedAt: now, source: "supplierInvoice",
      invoiceId: invoiceId, ledgerId: cashLedgerEntryId,
    });
    updateObjectById_("RawMaterials", it.materialId, { unitCost: it.unitPrice, lastPurchaseCost: it.unitPrice });
  });

  let ledgerEntryId = null;
  if (paymentType === "cash") {
    ledgerEntryId = cashLedgerEntryId;
    appendObject_("Ledger", {
      id: ledgerEntryId, ts: now, amount: totalAmount, direction: "outflow", type: "supplierInvoice",
      category: "Supplier Invoice", description: "Invoice from " + (body.supplierName || "supplier") + " (" + preparedItems.length + " item" + (preparedItems.length === 1 ? "" : "s") + ")",
      supplierId: body.supplierId, staffUsername: body.username, status: "approved", receiptUrl: null,
      paidFromDrawer: paymentSource === "cash_drawer", shiftId: body.shiftId || null, materialId: null,
      qty: null, unitCost: null, paymentSource: paymentSource, paymentStatus: "paid",
    });
  }

  return { ok: true, invoiceId: invoiceId, totalAmount: totalAmount, itemCount: preparedItems.length, paymentType: paymentType, ledgerEntryId: ledgerEntryId };
}

function recordSupplierPayment_(body) {
  if (!body.supplierId || !(Number(body.amount) > 0)) {
    return { ok: false, error: "Select a supplier and enter a valid amount." };
  }
  const validSources = ["cash_drawer", "out_of_pocket", "bank_transfer"];
  if (validSources.indexOf(body.paymentSource) === -1) {
    return { ok: false, error: "Select a payment source." };
  }
  const now = Date.now();
  const paymentId = newId_("spay");
  const ledgerEntryId = newId_("ledg");
  appendObject_("SupplierPayments", {
    id: paymentId, supplierId: body.supplierId, ts: now, amount: Number(body.amount),
    paymentSource: body.paymentSource, note: body.note || "", recordedBy: body.username,
    // Stored so a future delete can find and remove exactly this
    // expense entry, rather than guessing by matching fields.
    ledgerEntryId: ledgerEntryId,
  });
  appendObject_("Ledger", {
    id: ledgerEntryId, ts: now, amount: Number(body.amount), direction: "outflow", type: "supplierPayment",
    category: "Supplier Payment", description: "Payment to supplier" + (body.note ? " — " + body.note : ""),
    supplierId: body.supplierId, staffUsername: body.username, status: "approved", receiptUrl: null,
    paidFromDrawer: body.paymentSource === "cash_drawer", shiftId: body.shiftId || null, materialId: null,
    qty: null, unitCost: null, paymentSource: body.paymentSource, paymentStatus: "paid",
  });
  return { ok: true, paymentId: paymentId, ledgerEntryId: ledgerEntryId };
}

// A payment is a pure cash transaction reducing the supplier's debt —
// unlike an invoice, it never touches stock, so there's no
// "already consumed" safety check needed here at all. Removes the
// payment and its linked Ledger expense entry together.
function deleteSupplierPayment_(paymentId) {
  const payment = readObjects_("SupplierPayments").find(function (p) { return p.id === paymentId; });
  if (!payment) return { ok: false, error: "Payment not found." };
  if (payment.ledgerEntryId) deleteObjectById_("Ledger", payment.ledgerEntryId);
  deleteObjectById_("SupplierPayments", paymentId);
  return { ok: true, supplierId: payment.supplierId };
}

function getSupplierBalances_() {
  const invoices = readObjects_("PurchaseInvoices");
  const payments = readObjects_("SupplierPayments");
  const balances = {};
  invoices.forEach(function (inv) {
    if (inv.paymentType !== "deferred") return;
    balances[inv.supplierId] = (balances[inv.supplierId] || 0) + Number(inv.totalAmount);
  });
  payments.forEach(function (p) {
    balances[p.supplierId] = (balances[p.supplierId] || 0) - Number(p.amount);
  });
  return balances;
}

function getSupplierLedger_(supplierId) {
  const invoices = readObjects_("PurchaseInvoices").filter(function (i) { return i.supplierId === supplierId; });
  const payments = readObjects_("SupplierPayments").filter(function (p) { return p.supplierId === supplierId; });
  const invoiceItems = readObjects_("PurchaseInvoiceItems");

  const entries = [];
  invoices.forEach(function (inv) {
    const items = invoiceItems.filter(function (it) { return it.invoiceId === inv.id; });
    const itemDesc = items.map(function (it) { return it.materialName + " x" + it.qty; }).join(", ");
    entries.push({
      ts: Number(inv.invoiceDate) || Number(inv.createdAt), type: "invoice", description: "Invoice — " + itemDesc,
      amount: Number(inv.totalAmount), debit: inv.paymentType === "deferred" ? Number(inv.totalAmount) : 0,
      credit: 0, paymentType: inv.paymentType, id: inv.id,
      invoiceDate: Number(inv.invoiceDate) || Number(inv.createdAt),
      paymentSource: inv.paymentSource || null,
      items: items.map(function (it) { return { id: it.id, materialId: it.materialId, materialName: it.materialName, qty: Number(it.qty), unitPrice: Number(it.unitPrice) }; }),
    });
  });
  payments.forEach(function (p) {
    entries.push({
      ts: Number(p.ts), type: "payment", description: "Payment" + (p.note ? " — " + p.note : ""),
      amount: Number(p.amount), debit: 0, credit: Number(p.amount), paymentType: null, id: p.id,
    });
  });
  entries.sort(function (a, b) { return a.ts - b.ts; });

  let running = 0;
  const withBalance = entries.map(function (e) {
    running += e.debit - e.credit;
    return Object.assign({}, e, { runningBalance: running });
  });

  return { entries: withBalance.reverse(), currentBalance: running };
}

// Edit/delete for procurement records — see procurement-edit.js on the
// local server for the full reasoning. Core safety rule: if a
// purchase's stock has already been touched by a later sale/waste
// (qtyRemaining !== qtyPurchased), editing/deleting it is blocked.
function findLinkedBatch_(ledgerId) {
  const batches = readObjects_("Batches");
  for (let i = 0; i < batches.length; i++) {
    if (batches[i].ledgerId === ledgerId) return batches[i];
  }
  return null;
}
function batchIsUntouched_(batch) {
  return Math.abs(Number(batch.qtyRemaining) - Number(batch.qtyPurchased)) < 1e-9;
}

// One-time migration: café's local database is the authoritative
// source, this REPLACES all business data on the cloud with what was
// exported from it — see exportAllData on the local server for what's
// included. Accounts are the one exception: MERGED, not replaced,
// so an existing cloud-only login (e.g. the owner's web account) is
// never silently overwritten or locked out. Password hashes are
// plain SHA-256 hex on both systems by design, so they copy across
// directly — no password reset needed for migrated accounts.
const IMPORT_TABLE_NAMES = [
  "RawMaterials", "Suppliers", "RecurringExpenses", "Batches", "Ledger",
  "VoidRequests", "ActivityLogs", "Sessions", "Shifts", "StaffOrders",
  "StaffMembers", "StaffAllowanceUsage",
  "RestockLog", "BusinessDays", "WasteInvoices", "InventorySnapshots",
  "PurchaseInvoices", "PurchaseInvoiceItems", "SupplierPayments",
];

function importAllData_(payload) {
  const summary = {};

  IMPORT_TABLE_NAMES.forEach(function (tableName) {
    const rows = payload.tables && payload.tables[tableName] ? payload.tables[tableName] : [];
    const headers = sheetObjectHeaders_(tableName);
    const sheet = getSheet_(tableName);
    ensureHeaders_(sheet, headers);

    // Clear existing DATA rows only — row 1 (headers) stays untouched.
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clearContent();
    }

    if (rows.length > 0) {
      const values = rows.map(function (obj) {
        return headers.map(function (h) { return obj[h] === undefined || obj[h] === null ? "" : obj[h]; });
      });
      sheet.getRange(2, 1, values.length, headers.length).setValues(values);
    }
    summary[tableName] = rows.length;
  });

  // App state — menu, rooms, active shift, etc. Already stripped of
  // computed-only fields (stock, sessions, businessDays) by the local
  // server's own getState_ before export, so this is safe to write
  // as-is.
  if (payload.appState) {
    setState_(payload.appState);
  }

  // Accounts — merge, never overwrite. Only usernames that don't
  // already exist on the cloud get added.
  let accountsAdded = 0;
  if (Array.isArray(payload.accounts)) {
    const { sheet, rows } = accountsRows_();
    const existingUsernames = {};
    rows.forEach(function (r) { if (r[0]) existingUsernames[r[0]] = true; });
    payload.accounts.forEach(function (acc) {
      if (existingUsernames[acc.username]) return;
      sheet.appendRow([acc.username, acc.passwordHash, acc.role]);
      existingUsernames[acc.username] = true;
      accountsAdded++;
    });
  }

  return { ok: true, tableSummary: summary, accountsAdded: accountsAdded };
}

function deletePurchase_(ledgerId) {
  const entry = readObjects_("Ledger").find(function (l) { return l.id === ledgerId; });
  if (!entry) return { ok: false, error: "Entry not found." };

  const batch = findLinkedBatch_(ledgerId);
  if (batch && !batchIsUntouched_(batch)) {
    const used = Number(batch.qtyPurchased) - Number(batch.qtyRemaining);
    return { ok: false, error: "Can't delete — " + used + " of the " + batch.qtyPurchased + " purchased has already been used in sales or waste. Nothing was changed." };
  }

  if (batch) deleteObjectById_("Batches", batch.id);
  deleteObjectById_("Ledger", ledgerId);
  return { ok: true, materialId: entry.materialId || null };
}

function updatePurchase_(body) {
  const entry = readObjects_("Ledger").find(function (l) { return l.id === body.ledgerId; });
  if (!entry) return { ok: false, error: "Entry not found." };

  const qtyChanging = body.qty !== undefined && Number(body.qty) !== Number(entry.qty);
  const costChanging = body.unitCost !== undefined && Number(body.unitCost) !== Number(entry.unitCost);
  const batch = findLinkedBatch_(body.ledgerId);

  if ((qtyChanging || costChanging) && batch && !batchIsUntouched_(batch)) {
    const used = Number(batch.qtyPurchased) - Number(batch.qtyRemaining);
    return { ok: false, error: "Can't change quantity or cost — " + used + " of the " + batch.qtyPurchased + " purchased has already been used. You can still edit the description, category, or supplier." };
  }

  const newQty = qtyChanging ? Number(body.qty) : Number(entry.qty);
  const newCost = costChanging ? Number(body.unitCost) : Number(entry.unitCost);
  const ledgerPatch = {};
  if (body.description !== undefined) ledgerPatch.description = body.description;
  if (body.category !== undefined) ledgerPatch.category = body.category;
  if (body.supplierId !== undefined) ledgerPatch.supplierId = body.supplierId;
  if (qtyChanging) ledgerPatch.qty = newQty;
  if (costChanging) ledgerPatch.unitCost = newCost;
  if (qtyChanging || costChanging) ledgerPatch.amount = newQty * newCost;

  updateObjectById_("Ledger", body.ledgerId, ledgerPatch);
  if (batch && (qtyChanging || costChanging)) {
    updateObjectById_("Batches", batch.id, { qtyPurchased: newQty, qtyRemaining: newQty, unitCost: newCost });
  }
  return { ok: true };
}

function deleteSupplierInvoice_(invoiceId) {
  const invoice = readObjects_("PurchaseInvoices").find(function (i) { return i.id === invoiceId; });
  if (!invoice) return { ok: false, error: "Invoice not found." };

  const batches = readObjects_("Batches").filter(function (b) { return b.invoiceId === invoiceId; });
  const touched = batches.filter(function (b) { return !batchIsUntouched_(b); });
  if (touched.length > 0) {
    const items = readObjects_("PurchaseInvoiceItems").filter(function (it) { return it.invoiceId === invoiceId; });
    const names = touched.map(function (b) {
      const item = items.find(function (it) { return it.materialId === b.materialId; });
      return item ? item.materialName : b.materialId;
    });
    return { ok: false, error: "Can't delete — some items on this invoice have already been used: " + names.join(", ") + ". Nothing was changed." };
  }

  const linkedLedgerId = batches.length > 0 ? batches[0].ledgerId : null;
  batches.forEach(function (b) { deleteObjectById_("Batches", b.id); });
  readObjects_("PurchaseInvoiceItems").filter(function (it) { return it.invoiceId === invoiceId; }).forEach(function (it) { deleteObjectById_("PurchaseInvoiceItems", it.id); });
  if (linkedLedgerId) deleteObjectById_("Ledger", linkedLedgerId);
  deleteObjectById_("PurchaseInvoices", invoiceId);

  return { ok: true, supplierId: invoice.supplierId };
}

// Admin-only, per explicit request — bypasses the "already used" safety
// check that deleteSupplierInvoice_ enforces above. See the local
// server's identical function for the full reasoning.
function forceDeleteSupplierInvoice_(invoiceId) {
  const invoice = readObjects_("PurchaseInvoices").find(function (i) { return i.id === invoiceId; });
  if (!invoice) return { ok: false, error: "Invoice not found." };

  const batches = readObjects_("Batches").filter(function (b) { return b.invoiceId === invoiceId; });
  const linkedLedgerId = batches.length > 0 ? batches[0].ledgerId : null;
  batches.forEach(function (b) { deleteObjectById_("Batches", b.id); });
  readObjects_("PurchaseInvoiceItems").filter(function (it) { return it.invoiceId === invoiceId; }).forEach(function (it) { deleteObjectById_("PurchaseInvoiceItems", it.id); });
  if (linkedLedgerId) deleteObjectById_("Ledger", linkedLedgerId);
  deleteObjectById_("PurchaseInvoices", invoiceId);

  return { ok: true, supplierId: invoice.supplierId };
}

// Edits a supplier invoice: invoiceDate, paymentType/paymentSource, and
// each line item's qty/unitPrice. Still respects the same
// already-touched safety check per item — editing wasn't part of the
// explicit "force" request, only deleting was. See the local server's
// identical function for the full reasoning.
function updateSupplierInvoice_(body) {
  const invoice = readObjects_("PurchaseInvoices").find(function (i) { return i.id === body.invoiceId; });
  if (!invoice) return { ok: false, error: "Invoice not found." };
  const existingItems = readObjects_("PurchaseInvoiceItems").filter(function (it) { return it.invoiceId === body.invoiceId; });
  const batches = readObjects_("Batches").filter(function (b) { return b.invoiceId === body.invoiceId; });
  const items = Array.isArray(body.items) ? body.items : [];

  for (const it of items) {
    const existing = existingItems.find(function (e) { return e.id === it.id; });
    if (!existing) return { ok: false, error: "One of the items on this invoice couldn't be found." };
    const qtyChanging = Number(it.qty) !== Number(existing.qty);
    const priceChanging = Number(it.unitPrice) !== Number(existing.unitPrice);
    if (qtyChanging || priceChanging) {
      const batch = batches.find(function (b) { return b.materialId === existing.materialId; });
      if (batch && !batchIsUntouched_(batch)) {
        const used = Number(batch.qtyPurchased) - Number(batch.qtyRemaining);
        return { ok: false, error: "Can't change quantity or cost for " + existing.materialName + " — " + used + " of the " + batch.qtyPurchased + " purchased has already been used." };
      }
    }
  }

  let totalAmount = 0;
  items.forEach(function (it) {
    const existing = existingItems.find(function (e) { return e.id === it.id; });
    const qty = Number(it.qty);
    const unitPrice = Number(it.unitPrice);
    const subtotal = qty * unitPrice;
    totalAmount += subtotal;
    updateObjectById_("PurchaseInvoiceItems", it.id, { qty: qty, unitPrice: unitPrice, subtotal: subtotal });
    const batch = batches.find(function (b) { return b.materialId === existing.materialId; });
    if (batch) updateObjectById_("Batches", batch.id, { qtyPurchased: qty, qtyRemaining: qty, unitCost: unitPrice });
  });

  const invoicePatch = { totalAmount: totalAmount };
  if (body.invoiceDate !== undefined) invoicePatch.invoiceDate = body.invoiceDate;
  if (body.paymentType !== undefined) invoicePatch.paymentType = body.paymentType;
  if (body.paymentSource !== undefined) invoicePatch.paymentSource = body.paymentSource;
  updateObjectById_("PurchaseInvoices", body.invoiceId, invoicePatch);

  const linkedLedgerId = batches.length > 0 ? batches[0].ledgerId : null;
  if (linkedLedgerId) {
    const ledgerPatch = { amount: totalAmount };
    if (body.invoiceDate !== undefined) ledgerPatch.ts = body.invoiceDate;
    if (body.description !== undefined) ledgerPatch.description = body.description;
    updateObjectById_("Ledger", linkedLedgerId, ledgerPatch);
  }

  return { ok: true, supplierId: invoice.supplierId };
}


  const existingMaterials = readObjects_("RawMaterials");
  const materialIdByName = {};
  existingMaterials.forEach(function (m) { materialIdByName[m.name.trim().toLowerCase()] = m.id; });

function resetMenuAndRecipes_(username) {
  let materialsCreated = 0;
  menuResetMaterials_().forEach(function (row) {
    const name = row[0], unit = row[1], minStockAlert = row[2], unitCost = row[3];
    const key = name.trim().toLowerCase();
    if (materialIdByName[key]) return;
    const id = newId_("mat");
    appendObject_("RawMaterials", { id: id, name: name, unit: unit, minStockAlert: minStockAlert, unitCost: unitCost, openingStock: 0, category: "", storageLocation: "", lastPurchaseCost: unitCost });
    materialIdByName[key] = id;
    materialsCreated++;
  });

  const itemDefs = menuResetItems_();
  const state = getState_();
  const newMenu = [];
  const unresolved = [];
  Object.keys(itemDefs).forEach(function (name) {
    const def = itemDefs[name];
    const ingredients = [];
    def.ingredients.forEach(function (row) {
      const matName = row[0], qty = row[1];
      const id = materialIdByName[matName.trim().toLowerCase()];
      if (!id) { unresolved.push(name + " -> " + matName); return; }
      ingredients.push({ stockId: id, qty: qty });
    });
    newMenu.push({ id: newId_("item"), name: name, price: def.price, category: def.category, ingredients: ingredients });
  });
  state.menu = newMenu;
  setState_(state);

  return { ok: true, materialsCreated: materialsCreated, itemsCreated: newMenu.length, unresolved: unresolved, state: withStockView_(getState_()) };
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
  state.businessDays = readBusinessDays_();
  return state;
}

// Submitting a purchase/expense — a stocked batch delivery, a daily-fresh
// item, or a mid-shift purchase. Admin submissions are auto-approved
// (inventory + ledger effective immediately). Cashier submissions are
// `pending` and have NO effect until an admin approves them. A receipt
// photo is mandatory either way.
function handleSubmitExpense_(body) {
  if (!body.secret || body.secret !== getSecret_()) return json_({ error: "forbidden" });
  let role;
  try {
    role = requireRole_(body.username, ["admin", "cashier"]);
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
  if (!body.itemName || !body.amount) {
    return json_({ ok: false, error: "Item/expense description and amount are required." });
  }
  const paymentStatus = body.paymentStatus === "unpaid" ? "unpaid" : "paid";
  let paymentSource = null;
  if (paymentStatus === "paid") {
    const validSources = ["cash_drawer", "out_of_pocket", "bank_transfer"];
    if (validSources.indexOf(body.paymentSource) === -1) {
      return json_({ ok: false, error: "Select a payment source." });
    }
    paymentSource = body.paymentSource;
  }

  let receiptUrl = null;
  if (body.receiptBase64) {
    try {
      receiptUrl = uploadReceipt_(body.receiptBase64, body.receiptMimeType, "receipt-" + Date.now() + ".jpg");
    } catch (err) {
      return json_({ ok: false, error: "Receipt upload failed: " + String(err) });
    }
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const isAdmin = role === "admin";
    const amount = Number(body.amount);
    const entry = {
      id: newId_("ledg"), ts: Date.now(), amount: amount, direction: "outflow", type: "midShiftPurchase",
      category: body.category || "Expense", description: body.itemName + (body.notes ? " — " + body.notes : ""),
      supplierId: body.supplierId || null, staffUsername: body.username, status: isAdmin ? "approved" : "pending",
      receiptUrl: receiptUrl, paidFromDrawer: paymentStatus === "paid" && paymentSource === "cash_drawer",
      shiftId: body.shiftId || null, materialId: null, qty: null, unitCost: null,
      paymentSource: paymentSource, paymentStatus: paymentStatus,
    };
    appendObject_("Ledger", entry);
    logActivity_({
      actorUsername: body.username, actorRole: role, actionType: "EXPENSE_LOGGED", shiftId: entry.shiftId,
      description: (isAdmin ? "Logged & auto-approved" : "Submitted (pending)") + " expense: " + body.itemName + " for " + amount.toFixed(2) + " EGP (" + paymentStatus + ")",
      after: { status: entry.status, amount: amount, itemName: body.itemName, paymentStatus: paymentStatus },
    });
    return json_({ ok: true, status: entry.status, entry: entry });
  } finally {
    lock.releaseLock();
  }
}

function handleSubmitPurchase_(body) {
  if (!body.secret || body.secret !== getSecret_()) return json_({ error: "forbidden" });
  let role;
  try {
    role = requireRole_(body.username, ["admin", "cashier"]);
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
  if (!body.materialId || !body.qty || !body.unitCost) {
    return json_({ ok: false, error: "Material, quantity, and cost are required." });
  }
  const paymentStatus = body.paymentStatus === "unpaid" ? "unpaid" : "paid";
  let paymentSource = null;
  if (paymentStatus === "paid") {
    const validSources = ["cash_drawer", "out_of_pocket", "bank_transfer"];
    if (validSources.indexOf(body.paymentSource) === -1) {
      return json_({ ok: false, error: "Select a payment source (Cash Drawer, Out of Pocket, or Bank Transfer)." });
    }
    paymentSource = body.paymentSource;
  }

  let receiptUrl = null;
  if (body.receiptBase64) {
    try {
      receiptUrl = uploadReceipt_(body.receiptBase64, body.receiptMimeType, "receipt-" + Date.now() + ".jpg");
    } catch (err) {
      return json_({ ok: false, error: "Receipt upload failed: " + String(err) });
    }
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
      paidFromDrawer: paymentStatus === "paid" && paymentSource === "cash_drawer",
      paymentSource: paymentSource,
      paymentStatus: paymentStatus,
      shiftId: body.shiftId || null,
      materialId: body.materialId,
      qty: body.qty,
      unitCost: body.unitCost,
    };
    appendObject_("Ledger", entry);

    if (isAdmin) {
      // The material physically arrives either way — receiving it on
      // credit (unpaid) doesn't change that it's now in stock, only
      // whether cash has left the drawer for it yet.
      appendObject_("Batches", {
        id: newId_("batch"), materialId: body.materialId, supplierId: body.supplierId || null,
        qtyPurchased: body.qty, qtyRemaining: body.qty, unitCost: body.unitCost, purchasedAt: entry.ts,
        source: body.purchaseType === "stockedBatch" ? "stockedBatch" : "dailyFresh", ledgerId: entry.id,
      });
      // "Most Recent Purchase Unit Cost" replaces average-cost logic —
      // every approved purchase becomes the new reference cost.
      updateObjectById_("RawMaterials", body.materialId, { unitCost: Number(body.unitCost), lastPurchaseCost: Number(body.unitCost) });
    }

    logActivity_({
      actorUsername: body.username, actorRole: role, actionType: "EXPENSE_LOGGED", shiftId: entry.shiftId,
      description: (isAdmin ? "Logged & auto-approved" : "Submitted (pending)") + " " + body.purchaseType + ": " + body.qty + " " + body.materialId + " for " + amount.toFixed(2) + " EGP (" + paymentStatus + ")",
      after: { status: entry.status, amount: amount, materialId: body.materialId, qty: body.qty, paymentStatus: paymentStatus },
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
        if (typeof parsed.businessDayId === "undefined") parsed.businessDayId = null;
        if (typeof parsed.orderCounter !== "number") parsed.orderCounter = 0;
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
              : Object.assign({}, withOwnerFlag, { isPaused: false, pausedAt: null, pausedDurationSec: 0, timeAdjustmentSec: 0 });
            const withTimeAdjustment = typeof withPauseFields.timeAdjustmentSec === "number"
              ? withPauseFields
              : Object.assign({}, withPauseFields, { timeAdjustmentSec: 0 });
            if (typeof withTimeAdjustment.singleRate === "number") return withTimeAdjustment;
            const legacyRate = typeof withTimeAdjustment.hourlyRate === "number" ? withTimeAdjustment.hourlyRate : 0;
            return Object.assign({}, withTimeAdjustment, {
              singleRate: withTimeAdjustment.zone === "room" ? (legacyRate || 5) : 0,
              multiRate: withTimeAdjustment.zone === "room" ? (legacyRate ? legacyRate * 1.6 : 8) : 0,
              rateMode: withTimeAdjustment.status === "active" && withTimeAdjustment.zone === "room" ? "single" : null,
              hourlyRate: withTimeAdjustment.status === "active" ? legacyRate : 0,
            });
          });

          // Hard safety net: collapse any accidental duplicate room ids
          // down to one (keeps the first — an ACTIVE duplicate is kept
          // over an available one of the same id, so a live session is
          // never silently dropped). This alone fixes any pre-existing
          // duplication from an older, less careful version of the
          // top-up logic below, regardless of how it happened.
          const byId = {};
          const deduped = [];
          parsed.rooms.forEach(function (r) {
            const existing = byId[r.id];
            if (!existing) {
              byId[r.id] = r;
              deduped.push(r);
            } else if (existing.status !== "active" && r.status === "active") {
              const idx = deduped.indexOf(existing);
              deduped[idx] = r;
              byId[r.id] = r;
            }
          });
          parsed.rooms = deduped;

          // Top up by EXACT id, not "does any exist" — safe to run on
          // every single read/request with zero risk of duplicating.
          const idSet = {};
          parsed.rooms.forEach(function (r) { idSet[r.id] = true; });
          for (let i = 1; i <= 6; i++) {
            const id = "lounge-" + i;
            if (!idSet[id]) {
              parsed.rooms.push({ id: id, name: "Lounge Table " + i, isVip: false, hourlyRate: 0, singleRate: 0, multiRate: 0, rateMode: null, status: "available", startedAt: null, orders: [], zone: "lounge", splitInvoiceNumber: null, transferredFrom: null, isOwnerTable: false, isPaused: false, pausedAt: null, pausedDurationSec: 0, timeAdjustmentSec: 0 });
              idSet[id] = true;
            }
          }
          for (let i = 1; i <= 6; i++) {
            const id = "owner-" + i;
            if (!idSet[id]) {
              parsed.rooms.push({ id: id, name: "Owner Table " + i, isVip: false, hourlyRate: 0, singleRate: 0, multiRate: 0, rateMode: null, status: "available", startedAt: null, orders: [], zone: "lounge", splitInvoiceNumber: null, transferredFrom: null, isOwnerTable: true, isPaused: false, pausedAt: null, pausedDurationSec: 0, timeAdjustmentSec: 0 });
              idSet[id] = true;
            }
          }
          if (!idSet["waste-marketing"]) {
            parsed.rooms.push({ id: "waste-marketing", name: "Wasted / Marketing / هدر وماركتينج", isVip: false, hourlyRate: 0, singleRate: 0, multiRate: 0, rateMode: null, status: "active", startedAt: Date.now(), orders: [], zone: "waste", splitInvoiceNumber: null, transferredFrom: null, isOwnerTable: false, isPaused: false, pausedAt: null, pausedDurationSec: 0, timeAdjustmentSec: 0 });
            idSet["waste-marketing"] = true;
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
  delete toSave.businessDays; // also computed, never persisted
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
