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

  ["RawMaterials", "Suppliers", "RecurringExpenses", "Batches", "Ledger", "VoidRequests"].forEach(function (name) {
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
    rooms: rooms, menu: menu, sessions: [], activity: [], cashRecords: [],
    actualCashInput: 0, shifts: [], activeShiftId: null, fraudThresholdPercent: 2,
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

// ---------- Generic row-object storage for the financial sheets ----------

function sheetObjectHeaders_(name) {
  const map = {
    RawMaterials: ["id", "name", "unit", "minStockAlert"],
    Suppliers: ["id", "name", "contact", "category"],
    RecurringExpenses: ["id", "name", "amount", "active"],
    Batches: ["id", "materialId", "supplierId", "qtyPurchased", "qtyRemaining", "unitCost", "purchasedAt", "source"],
    Ledger: ["id", "ts", "amount", "direction", "type", "category", "description", "supplierId", "staffUsername", "status", "receiptUrl", "paidFromDrawer", "shiftId", "materialId", "qty", "unitCost"],
    VoidRequests: ["id", "ts", "roomId", "roomName", "menuItemId", "itemName", "qty", "unitPrice", "billValue", "reason", "status", "cashierUsername", "waiterName", "shiftId", "approvedBy", "approvedAt", "cogs", "applied", "applyError"],
  };
  return map[name];
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

function bizEndRoom_(state, batches, roomId, splitBill, paymentMethod) {
  const room = state.rooms.find((r) => r.id === roomId);
  if (!room || room.status !== "active" || !room.startedAt) return { session: null, state: state, touchedBatchIds: [] };
  const endedAt = Date.now();
  const durationSec = Math.max(1, Math.floor((endedAt - room.startedAt) / 1000));
  const timeCost = (durationSec / 3600) * room.hourlyRate;
  const ordersCost = room.orders.reduce((a, o) => a + o.qty * o.price, 0);
  const total = timeCost + ordersCost;

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
    splitBill: !!splitBill,
    paymentMethod: paymentMethod === "visa" ? "visa" : "cash",
    shiftId: state.activeShiftId || null,
  };
  state.rooms = state.rooms.map((r) =>
    r.id === roomId ? Object.assign({}, r, { status: "available", startedAt: null, orders: [] }) : r
  );
  state.sessions = [session].concat(state.sessions);
  pushActivity_(state, room.name + " checked out - $" + total.toFixed(2) + " collected (" + session.paymentMethod + ")");
  return { session: session, state: state, touchedBatchIds: Array.from(new Set(touchedBatchIds)) };
}

function bizSetActualCash_(state, n) {
  state.actualCashInput = n;
  return state;
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

// Expected Cash = Opening Balance + Cash Sales - Approved drawer-paid
// expenses logged against this shift. `forced` = true means this came
// from the admin emergency-reset path rather than a cashier's normal End
// Shift.
function bizCloseActiveShift_(state, ledger, actualCash, forced) {
  if (!state.activeShiftId) return { ok: false, error: "No active shift to close", state: state };
  const shiftId = state.activeShiftId;
  const shift = state.shifts.find((sh) => sh.id === shiftId);
  const shiftSessions = state.sessions.filter((s) => s.shiftId === shiftId);
  const cashSales = shiftSessions.filter((s) => s.paymentMethod === "cash").reduce((a, s) => a + s.total, 0);
  const drawerExpenses = ledger
    .filter((l) => l.shiftId === shiftId && l.status === "approved" && l.paidFromDrawer && l.direction === "outflow")
    .reduce((a, l) => a + Number(l.amount), 0);
  const expectedCash = (shift ? shift.openingBalance : 0) + cashSales - drawerExpenses;
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

      case "getState": {
        requireRole_(body.username, ["admin", "cashier"]);
        return json_({ state: withStockView_(getState_()) });
      }

      // ---- Atomic business actions: read + mutate + write in ONE locked call ----

      case "setRoomRate": {
        requireRole_(body.username, ["admin"]);
        const state = bizSetRoomRate_(getState_(), body.roomId, body.rate);
        setState_(state);
        return json_({ state: withStockView_(state) });
      }
      case "startRoom": {
        requireRole_(body.username, ["admin", "cashier"]);
        const result = bizStartRoom_(getState_(), body.roomId);
        if (result.ok) setState_(result.state);
        return json_({ ok: result.ok, error: result.error || null, state: withStockView_(result.state) });
      }
      case "endRoom": {
        requireRole_(body.username, ["admin", "cashier"]);
        const batches = readObjects_("Batches");
        const result = bizEndRoom_(getState_(), batches, body.roomId, body.splitBill, body.paymentMethod);
        if (result.session) {
          setState_(result.state);
          result.touchedBatchIds.forEach(function (id) {
            const b = batches.find(function (x) { return x.id === id; });
            if (b) updateObjectById_("Batches", id, { qtyRemaining: b.qtyRemaining });
          });
          // Log the sale in the permanent ledger.
          appendObject_("Ledger", {
            id: newId_("ledg"), ts: result.session.endedAt, amount: result.session.total, direction: "inflow",
            type: "sale", category: "Room Sale", description: result.session.roomName + " checkout",
            supplierId: null, staffUsername: body.username, status: "approved", receiptUrl: null,
            paidFromDrawer: result.session.paymentMethod === "cash", shiftId: result.session.shiftId,
            materialId: null, qty: null, unitCost: null,
          });
        }
        return json_({ session: result.session, state: withStockView_(result.state) });
      }
      case "addOrder": {
        requireRole_(body.username, ["admin", "cashier"]);
        const batches = readObjects_("Batches");
        const result = bizAddOrder_(getState_(), batches, body.roomId, body.menuItemId, body.qty);
        if (result.ok) setState_(result.state);
        return json_({ ok: result.ok, error: result.error || null, state: withStockView_(result.state) });
      }
      case "setOrderLineQty": {
        requireRole_(body.username, ["admin", "cashier"]);
        const batches = readObjects_("Batches");
        const result = bizSetOrderLineQty_(getState_(), batches, body.roomId, body.menuItemId, body.qty);
        if (result.ok) setState_(result.state);
        return json_({ ok: result.ok, error: result.error || null, state: withStockView_(result.state) });
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
        state.menu = state.menu.map((x) => (x.id === body.id ? Object.assign({}, x, body.patch) : x));
        setState_(state);
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
        requireRole_(body.username, ["admin", "cashier"]);
        const result = bizOpenShift_(getState_(), body.username, body.openingBalance);
        if (result.ok) setState_(result.state);
        return json_({ ok: result.ok, error: result.error || null, state: withStockView_(result.state) });
      }
      case "endShift": {
        requireRole_(body.username, ["admin", "cashier"]);
        const ledger = readObjects_("Ledger");
        const result = bizCloseActiveShift_(getState_(), ledger, body.actualCash, false);
        if (result.ok) setState_(result.state);
        return json_({ ok: result.ok, error: result.error || null, state: withStockView_(result.state) });
      }
      case "forceEndShift": {
        requireRole_(body.username, ["admin"]);
        const state = getState_();
        if (!state.activeShiftId) return json_({ ok: true, state: withStockView_(state) });
        const ledger = readObjects_("Ledger");
        const result = bizCloseActiveShift_(state, ledger, body.actualCash, true);
        setState_(result.state);
        return json_({ ok: true, state: withStockView_(result.state) });
      }

      // ---- Raw materials / suppliers / recurring expenses CRUD (admin) ----
      case "getRawMaterials":
        requireRole_(body.username, ["admin", "cashier"]);
        return json_({ items: readObjects_("RawMaterials") });
      case "addRawMaterial": {
        requireRole_(body.username, ["admin"]);
        const item = { id: newId_("mat"), name: body.name, unit: body.unit, minStockAlert: body.minStockAlert || 0 };
        appendObject_("RawMaterials", item);
        return json_({ ok: true, item: item });
      }
      case "updateRawMaterial":
        requireRole_(body.username, ["admin"]);
        return json_({ ok: updateObjectById_("RawMaterials", body.id, body.patch) });
      case "deleteRawMaterial":
        requireRole_(body.username, ["admin"]);
        return json_({ ok: deleteObjectById_("RawMaterials", body.id) });

      case "getSuppliers":
        requireRole_(body.username, ["admin", "cashier"]);
        return json_({ items: readObjects_("Suppliers") });
      case "addSupplier": {
        requireRole_(body.username, ["admin"]);
        const item = { id: newId_("sup"), name: body.name, contact: body.contact || "", category: body.category || "" };
        appendObject_("Suppliers", item);
        return json_({ ok: true, item: item });
      }
      case "updateSupplier":
        requireRole_(body.username, ["admin"]);
        return json_({ ok: updateObjectById_("Suppliers", body.id, body.patch) });
      case "deleteSupplier":
        requireRole_(body.username, ["admin"]);
        return json_({ ok: deleteObjectById_("Suppliers", body.id) });

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
        return json_({ ok: true });
      }
      case "rejectPurchase": {
        requireRole_(body.username, ["admin"]);
        updateObjectById_("Ledger", body.ledgerId, { status: "rejected", description: (body.reason ? "[Rejected: " + body.reason + "] " : "[Rejected] ") });
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
        return json_({ ok: true, state: withStockView_(result.state) });
      }

      case "denyVoid": {
        requireRole_(body.username, ["admin"]);
        updateObjectById_("VoidRequests", body.voidId, { status: "denied", approvedBy: body.username, approvedAt: Date.now() });
        return json_({ ok: true });
      }

      case "setFraudThreshold": {
        requireRole_(body.username, ["admin"]);
        const state = getState_();
        state.fraudThresholdPercent = Number(body.percent) || 0;
        setState_(state);
        return json_({ state: withStockView_(state) });
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

function withStockView_(state) {
  if (!state) return state;
  const materials = readObjects_("RawMaterials");
  const batches = readObjects_("Batches");
  state.stock = computeStockView_(materials, batches);
  state.pendingVoidCountForActiveShift = pendingVoidCountForShift_(state.activeShiftId);
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
