// Local offline backend for GLITCH Lounge OS.
//
// This deliberately implements the EXACT same request/response contract
// as the Google Apps Script version (POST {secret, action, ...} -> JSON),
// so the existing frontend needs ZERO changes — only APPS_SCRIPT_URL in
// its .env changes, to point here instead of Google.
//
// STATUS: first working slice. Covers login, state, and the full room /
// order / shift lifecycle (start, add items, adjust qty, notes, pause,
// resume, extend time, checkout, open/close shift). The remaining ~65
// actions (voids, procurement, inventory restocking, reports, business
// day close, staff orders, etc.) are NOT ported yet — calling one of
// those from the UI right now will return a clear "not implemented"
// error instead of failing silently or corrupting data.

const express = require("express");
const cors = require("cors");
const { readObjects_, updateObjectById_, appendObject_, deleteObjectById_, db } = require("./db");
const { newId_, logActivity_ } = require("./lib/util");
const { login_, roleForUsername_, requireRole_, getAccounts_, addAccount_, updateAccount_, deleteAccount_ } = require("./lib/auth");
const {
  getState_, setState_, withStockView_,
  readSessions_, appendSessionRow_, readShifts_, readBusinessDays_,
  consumeFifo_, writeBatchesBack_,
} = require("./lib/state");
const {
  bizSetRoomRate_, bizRenameRoom_, bizStartRoom_, bizAddOrder_, bizSetOrderLineQty_, bizSetOrderLineNote_,
  bizExtendRoomTime_, bizPauseRoom_, bizResumeRoom_, bizLogWasteMarketing_, bizEndRoom_,
} = require("./lib/rooms");
const { bizOpenShift_, bizCloseActiveShift_ } = require("./lib/shifts");
const { bizTransferZone_, bizSplitBill_ } = require("./lib/transfer-split");
const { VOID_REASONS, applyVoid_ } = require("./lib/voids");
const { adjustStock_, bizRestockMaterial_, bizSubmitWasteInvoice_, bizRolloverInventory_ } = require("./lib/inventory");
const { resetMenuAndRecipes_ } = require("./lib/menu-reset");
const { bizSubmitPurchaseInvoice_, bizRecordSupplierPayment_, bizGetSupplierBalances_, bizGetSupplierLedger_ } = require("./lib/supplier-invoices");
const { bizSubmitStaffOrder_, bizCloseBusinessDay_ } = require("./lib/staff-business");
const { scheduleBackups, BACKUP_DIR } = require("./lib/backup");

const PORT = process.env.PORT || 4000;
const SHARED_SECRET = process.env.GLITCH_LOCAL_SECRET || "change-me-local-secret";

const app = express();
app.use(cors()); // other registers on the LAN need to reach this
app.use(express.json({ limit: "5mb" }));

function json_(obj) {
  return obj;
}

const handlers = {
  login(body) {
    const result = login_(body.username, body.password);
    if (result.ok) {
      logActivity_({ actorUsername: result.username, actorRole: result.role, actionType: "LOGIN_SUCCESS", description: result.username + " (" + result.role + ") logged in" });
    } else {
      logActivity_({ actorUsername: body.username, actorRole: "unknown", actionType: "LOGIN_FAILED", description: "Failed login attempt for username '" + body.username + "'" });
    }
    return json_(result);
  },

  getState(body) {
    requireRole_(body.username, ["admin", "cashier"]);
    return json_({ state: withStockView_(getState_()) });
  },

  startRoom(body) {
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
  },

  extendRoomTime(body) {
    requireRole_(body.username, ["admin", "cashier"]);
    const state0 = getState_();
    const before = state0.rooms.find((r) => r.id === body.roomId);
    const result = bizExtendRoomTime_(state0, body.roomId, body.deltaSec);
    if (!result.ok) return json_({ ok: false, error: result.error, state: withStockView_(result.state) });
    setState_(result.state);
    const after = result.state.rooms.find((r) => r.id === body.roomId);
    logActivity_({
      actorUsername: body.username, actorRole: roleForUsername_(body.username), actionType: "ROOM_TIME_EXTENDED",
      location: before ? before.name : body.roomId, shiftId: result.state.activeShiftId,
      description: (before ? before.name : body.roomId) + " time extended by +" + Math.round((Number(body.deltaSec) || 0) / 60) + " min",
      before: { timeAdjustmentSec: before ? before.timeAdjustmentSec : 0 },
      after: { timeAdjustmentSec: after ? after.timeAdjustmentSec : 0 },
    });
    return json_({ ok: true, state: withStockView_(result.state) });
  },

  pauseRoom(body) {
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
  },

  resumeRoom(body) {
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
  },

  endRoom(body) {
    requireRole_(body.username, ["admin", "cashier"]);
    const batches = readObjects_("Batches");
    const result = bizEndRoom_(getState_(), batches, body.roomId, body.splitBill, body.paymentMethod, body.cashAmount, body.secondaryAmount, body.frozenAt, {
      timeDiscountType: body.timeDiscountType, timeDiscountValue: body.timeDiscountValue,
      ordersDiscountType: body.ordersDiscountType, ordersDiscountValue: body.ordersDiscountValue,
    });
    if (result.error) return json_({ session: null, error: result.error, state: withStockView_(result.state) });
    if (result.session) {
      setState_(result.state);
      appendSessionRow_(result.session);
      result.touchedBatchIds.forEach((id) => {
        const b = batches.find((x) => x.id === id);
        if (b) updateObjectById_("Batches", id, { qtyRemaining: b.qtyRemaining });
      });
      appendObject_("Ledger", {
        id: newId_("ledg"), ts: result.session.endedAt, amount: result.session.total, direction: "inflow",
        type: "sale", category: "Room Sale", description: result.session.roomName + " checkout",
        supplierId: null, staffUsername: body.username, status: "approved", receiptUrl: null,
        paidFromDrawer: result.session.cashAmount > 0, shiftId: result.session.shiftId,
        materialId: null, qty: null, unitCost: null, paymentSource: null,
      });
      logActivity_({
        actorUsername: body.username, actorRole: roleForUsername_(body.username),
        actionType: body.splitBill ? "CHECKOUT_SPLIT_BILL" : "CHECKOUT",
        location: result.session.roomName, shiftId: result.session.shiftId,
        description: result.session.roomName + " checked out — " + result.session.total.toFixed(2) + " EGP (" + result.session.paymentMethod + ")",
        before: { orders: result.session.orders },
        after: { total: result.session.total, cogs: result.session.cogs, cashAmount: result.session.cashAmount, visaAmount: result.session.visaAmount, instapayAmount: result.session.instapayAmount },
      });
    }
    return json_({ session: result.session, state: withStockView_(result.state) });
  },

  addOrder(body) {
    requireRole_(body.username, ["admin", "cashier"]);
    const batches = readObjects_("Batches");
    const stateBefore = getState_();
    const roomBefore = stateBefore.rooms.find((r) => r.id === body.roomId);
    const qtyBefore = roomBefore ? (roomBefore.orders.find((o) => o.menuItemId === body.menuItemId) || {}).qty || 0 : 0;
    const result = bizAddOrder_(stateBefore, batches, body.roomId, body.menuItemId, body.qty);
    if (result.ok) {
      setState_(result.state);
      writeBatchesBack_(batches, result.touchedBatchIds);
      (result.newBatches || []).forEach((b) => appendObject_("Batches", b));
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
  },

  setOrderLineQty(body) {
    requireRole_(body.username, ["admin", "cashier"]);
    const batches = readObjects_("Batches");
    const stateBefore = getState_();
    const roomBefore = stateBefore.rooms.find((r) => r.id === body.roomId);
    const lineBefore = roomBefore ? roomBefore.orders.find((o) => o.menuItemId === body.menuItemId) : null;
    const result = bizSetOrderLineQty_(stateBefore, batches, body.roomId, body.menuItemId, body.qty);
    if (result.ok) {
      setState_(result.state);
      writeBatchesBack_(batches, result.touchedBatchIds);
      (result.newBatches || []).forEach((b) => appendObject_("Batches", b));
      logActivity_({
        actorUsername: body.username, actorRole: roleForUsername_(body.username), actionType: "ITEM_QTY_CHANGED",
        location: roomBefore ? roomBefore.name : body.roomId, shiftId: result.state.activeShiftId,
        description: (lineBefore ? lineBefore.name : body.menuItemId) + " qty changed to " + body.qty + " on " + (roomBefore ? roomBefore.name : body.roomId),
        before: { qty: lineBefore ? lineBefore.qty : null }, after: { qty: body.qty },
      });
    }
    return json_({ ok: result.ok, error: result.error || null, state: withStockView_(result.state) });
  },

  setOrderLineNote(body) {
    requireRole_(body.username, ["admin", "cashier"]);
    const stateBefore = getState_();
    const result = bizSetOrderLineNote_(stateBefore, body.roomId, body.menuItemId, body.notes);
    if (result.ok) setState_(result.state);
    return json_({ ok: result.ok, error: result.error || null, state: withStockView_(result.state) });
  },

  openShift(body) {
    const role = requireRole_(body.username, ["admin", "cashier"]);
    const state0 = getState_();
    // Geofencing is intentionally NOT ported for the local install — it
    // exists to verify a cashier is physically at a specific venue over
    // the public internet; on a local network you already control, it
    // doesn't add anything. Leave geofenceEnabled off in local state.
    const result = bizOpenShift_(state0, body.username, body.openingBalance, body.lat, body.lng);
    if (result.ok) {
      setState_(result.state);
      logActivity_({
        actorUsername: body.username, actorRole: role, actionType: "START_SHIFT", shiftId: result.state.activeShiftId,
        description: body.username + " started a shift (opening " + (body.openingBalance || 0).toFixed(2) + " EGP)",
        after: { openingBalance: body.openingBalance },
      });
    }
    return json_({ ok: result.ok, error: result.error || null, state: withStockView_(result.state) });
  },

  endShift(body) {
    const role = requireRole_(body.username, ["admin", "cashier"]);
    const state0 = getState_();
    const shiftIdBefore = state0.activeShiftId;
    const ledger = readObjects_("Ledger");
    const result = bizCloseActiveShift_(state0, readSessions_(), ledger, readShifts_(), body.actualCash, false, body.lat, body.lng);
    if (result.ok) {
      setState_(result.state);
      const closed = result.closedShift;
      logActivity_({
        actorUsername: body.username, actorRole: role, actionType: "END_SHIFT", shiftId: shiftIdBefore,
        description: body.username + " ended shift — expected " + (closed ? closed.expectedCash.toFixed(2) : "?") + " EGP, counted " + (closed ? closed.closingActualCash.toFixed(2) : "?") + " EGP",
        after: closed ? { expectedCash: closed.expectedCash, closingActualCash: closed.closingActualCash, discrepancy: closed.discrepancy } : null,
      });
    }
    return json_({ ok: result.ok, error: result.error || null, state: withStockView_(result.state) });
  },
};

// ---- Local receipt storage (replaces Google Drive upload) ----
const fs = require("fs");
const path = require("path");
const UPLOADS_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);
function saveReceiptLocally_(base64, filename) {
  const filePath = path.join(UPLOADS_DIR, filename);
  fs.writeFileSync(filePath, Buffer.from(base64, "base64"));
  return "/uploads/" + filename;
}
app.use("/uploads", express.static(UPLOADS_DIR));

Object.assign(handlers, {
  // ---- Room extras ----
  setRoomRate(body) {
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
    return { state: withStockView_(state) };
  },

  renameRoom(body) {
    requireRole_(body.username, ["admin"]);
    const state0 = getState_();
    const before = state0.rooms.find((r) => r.id === body.roomId);
    const result = bizRenameRoom_(state0, body.roomId, body.name);
    if (!result.ok) return { ok: false, error: result.error, state: withStockView_(state0) };
    setState_(result.state);
    logActivity_({
      actorUsername: body.username, actorRole: "admin", actionType: "ROOM_RATE_CHANGED",
      location: before ? before.name : body.roomId,
      description: "Renamed '" + (before ? before.name : body.roomId) + "' to '" + body.name + "'",
      before: before ? { name: before.name } : null, after: { name: body.name },
    });
    return { ok: true, state: withStockView_(result.state) };
  },

  logWasteMarketing(body) {
    requireRole_(body.username, ["admin", "cashier"]);
    const batches = readObjects_("Batches");
    const result = bizLogWasteMarketing_(getState_(), batches, body.roomId, body.reason, body.note);
    if (!result.ok) return { ok: false, error: result.error, state: withStockView_(result.state) };
    setState_(result.state);
    result.touchedBatchIds.forEach((id) => {
      const b = batches.find((x) => x.id === id);
      if (b) updateObjectById_("Batches", id, { qtyRemaining: b.qtyRemaining });
    });
    // Always record — even at zero calculated cost. See the matching
    // comment in Code.gs for why: the audit record itself (what/who/
    // when/why) is the point, not just tracking non-zero cost.
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
      description: result.items.map((i) => i.qty + "x " + i.name).join(", ") + " — " + result.reasonLabel + " — " + result.cogs.toFixed(2) + " EGP ingredient cost",
      after: { items: result.items, cogs: result.cogs, retailValue: result.retailValue, reason: result.reason, note: result.note },
    });
    return { ok: true, state: withStockView_(result.state) };
  },

  // ---- Transfer / Split ----
  transferZone(body) {
    requireRole_(body.username, ["admin", "cashier"]);
    const result = bizTransferZone_(getState_(), body.sourceId, body.targetId, body.rateMode);
    if (result.ok) {
      setState_(result.state);
      logActivity_({
        actorUsername: body.username, actorRole: roleForUsername_(body.username), actionType: "SESSION_TRANSFERRED",
        location: result.roomName + " -> " + result.tableName, shiftId: result.state.activeShiftId,
        description: result.roomName + " transferred to " + result.tableName,
      });
    }
    return { ok: result.ok, error: result.error || null, state: withStockView_(result.state) };
  },

  splitBill(body) {
    requireRole_(body.username, ["admin", "cashier"]);
    const batches = readObjects_("Batches");
    const result = bizSplitBill_(getState_(), batches, body.roomId, body.mode, body.items, body.customAmount, body.paymentMethod, body.cashAmount, body.secondaryAmount, {
      discountType: body.discountType, discountValue: body.discountValue,
    });
    if (!result.ok) return { ok: false, error: result.error, state: withStockView_(result.state) };
    setState_(result.state);
    result.touchedBatchIds.forEach((id) => {
      const b = batches.find((x) => x.id === id);
      if (b) updateObjectById_("Batches", id, { qtyRemaining: b.qtyRemaining });
    });
    appendSessionRow_(result.splitSession);
    appendObject_("Ledger", {
      id: newId_("ledg"), ts: result.splitSession.endedAt, amount: result.splitSession.total, direction: "inflow",
      type: "sale", category: "Split Payment", description: result.splitSession.roomName + " split payment",
      supplierId: null, staffUsername: body.username, status: "approved", receiptUrl: null,
      paidFromDrawer: result.splitSession.cashAmount > 0, shiftId: result.splitSession.shiftId,
      materialId: null, qty: null, unitCost: null, paymentSource: null,
    });
    logActivity_({
      actorUsername: body.username, actorRole: roleForUsername_(body.username), actionType: "SESSION_SPLIT",
      location: result.splitSession.roomName, shiftId: result.splitSession.shiftId,
      description: "Split payment of " + result.splitSession.total.toFixed(2) + " EGP (" + body.mode + ", " + body.paymentMethod + ")",
    });
    return { ok: true, session: result.splitSession, state: withStockView_(result.state) };
  },

  // ---- Menu management ----
  addMenuItem(body) {
    requireRole_(body.username, ["admin"]);
    const state = getState_();
    state.menu = state.menu.concat([body.item]);
    setState_(state);
    return { state: withStockView_(state) };
  },
  updateMenuItem(body) {
    requireRole_(body.username, ["admin"]);
    const state = getState_();
    const before = state.menu.find((x) => x.id === body.id);
    state.menu = state.menu.map((x) => (x.id === body.id ? Object.assign({}, x, body.patch) : x));
    setState_(state);
    return { state: withStockView_(state) };
  },
  deleteMenuItem(body) {
    requireRole_(body.username, ["admin"]);
    const state = getState_();
    state.menu = state.menu.filter((x) => x.id !== body.id);
    setState_(state);
    return { state: withStockView_(state) };
  },

  // ---- Inventory ----
  getRawMaterials(body) {
    requireRole_(body.username, ["admin", "cashier"]);
    return { items: readObjects_("RawMaterials") };
  },
  addRawMaterial(body) {
    requireRole_(body.username, ["admin"]);
    const openingStock = parseFloat(body.openingStock) || 0;
    const item = {
      id: newId_("mat"), name: body.name, unit: body.unit, minStockAlert: parseFloat(body.minStockAlert) || 0, unitCost: parseFloat(body.unitCost) || 0, openingStock,
      category: body.category || "", storageLocation: body.storageLocation || "", lastPurchaseCost: parseFloat(body.unitCost) || 0,
    };
    appendObject_("RawMaterials", item);
    // Opening Stock is a permanent historical fact, but it also needs to
    // be REAL, trackable inventory — not just a number sitting separate
    // from the actual FIFO batches everything else reads from. One
    // initial batch backs it, tagged distinctly so it's identifiable in
    // history.
    if (openingStock > 0) {
      appendObject_("Batches", {
        id: newId_("batch"), materialId: item.id, supplierId: null,
        qtyPurchased: openingStock, qtyRemaining: openingStock, unitCost: item.unitCost,
        purchasedAt: Date.now(), source: "openingStock",
      });
    }
    logActivity_({ actorUsername: body.username, actorRole: "admin", actionType: "RAW_MATERIAL_COST_CONTEXT", description: "Added raw material '" + body.name + "'" + (openingStock > 0 ? " with opening stock of " + openingStock + " " + body.unit : ""), after: item });
    return { ok: true, item, state: withStockView_(getState_()) };
  },
  bulkAddRawMaterials(body) {
    requireRole_(body.username, ["admin"]);
    const rows = Array.isArray(body.rows) ? body.rows : [];
    const existing = readObjects_("RawMaterials");
    const existingNames = new Set(existing.map((m) => m.name.trim().toLowerCase()));
    const now = Date.now();
    let added = 0;
    const skipped = [];

    rows.forEach((r) => {
      const name = (r.name || "").trim();
      if (!name) return;
      if (existingNames.has(name.toLowerCase())) { skipped.push(name); return; }
      const openingStock = parseFloat(r.openingStock) || 0;
      const unitCost = parseFloat(r.unitCost) || 0;
      const item = {
        id: newId_("mat"), name, unit: (r.unit || "").trim(), minStockAlert: parseFloat(r.minStockAlert) || 0,
        unitCost, openingStock, category: (r.category || "").trim(), storageLocation: "", lastPurchaseCost: unitCost,
      };
      appendObject_("RawMaterials", item);
      if (openingStock > 0) {
        appendObject_("Batches", {
          id: newId_("batch"), materialId: item.id, supplierId: null,
          qtyPurchased: openingStock, qtyRemaining: openingStock, unitCost,
          purchasedAt: now, source: "openingStock",
        });
      }
      existingNames.add(name.toLowerCase());
      added++;
    });

    if (added > 0) {
      logActivity_({
        actorUsername: body.username, actorRole: "admin", actionType: "RAW_MATERIAL_COST_CONTEXT",
        description: body.username + " bulk-imported " + added + " raw material(s)" + (skipped.length > 0 ? " (" + skipped.length + " skipped as duplicates)" : ""),
      });
    }
    return { ok: true, added, skipped, state: withStockView_(getState_()) };
  },
  updateRawMaterial(body) {
    requireRole_(body.username, ["admin"]);
    const before = readObjects_("RawMaterials").find((m) => m.id === body.id);
    const patch = Object.assign({}, body.patch);
    // Normalize numeric fields at write time — strips trailing text like
    // "10kg" down to 10 via parseFloat, rather than storing a bad string
    // (or silently becoming 0 via Number()) that would need a read-time
    // safety net to compensate for later.
    ["minStockAlert", "unitCost", "lastPurchaseCost"].forEach((field) => {
      if (patch[field] !== undefined) {
        const n = parseFloat(patch[field]);
        if (!isNaN(n)) patch[field] = n;
      }
    });

    // Opening Stock is now editable, but it's not just a label — it's
    // tied to real batches, and Purchases/In is DERIVED as
    // (initialStock - openingStock). Changing the number alone without
    // touching actual stock would silently break "System Balance =
    // Opening + Purchases - Out". So: apply the delta as a REAL stock
    // change (new batch if increasing, FIFO consumption if decreasing)
    // — same mechanism as a manual stock correction — so the physical
    // count and the ledger math move together, consistently.
    if (before && patch.openingStock !== undefined && patch.openingStock !== null && patch.openingStock !== "") {
      const newOpening = parseFloat(patch.openingStock);
      if (!isNaN(newOpening) && newOpening !== Number(before.openingStock || 0)) {
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
          const remaining = batches.filter((b) => b.materialId === body.id).reduce((a, b) => a + Number(b.qtyRemaining), 0);
          if (Math.abs(delta) > remaining + 1e-9) {
            return { ok: false, error: `Can't lower Opening Balance by that much — only ${remaining} ${before.unit} of actual stock exists to remove.` };
          }
          const res = consumeFifo_(batches, body.id, Math.abs(delta));
          writeBatchesBack_(batches, res.touched);
        }
      }
      patch.openingStock = newOpening;
      }
    }

    const ok = updateObjectById_("RawMaterials", body.id, patch);
    if (ok) logActivity_({ actorUsername: body.username, actorRole: "admin", actionType: "RAW_MATERIAL_COST_CONTEXT", description: "Edited raw material '" + (before ? before.name : body.id) + "'", before, after: Object.assign({}, before, patch) });
    return { ok, state: withStockView_(getState_()) };
  },
  deleteRawMaterial(body) {
    requireRole_(body.username, ["admin"]);
    const before = readObjects_("RawMaterials").find((m) => m.id === body.id);
    const ok = deleteObjectById_("RawMaterials", body.id);
    if (ok) logActivity_({ actorUsername: body.username, actorRole: "admin", actionType: "RAW_MATERIAL_COST_CONTEXT", description: "Deleted raw material '" + (before ? before.name : body.id) + "'", before });
    return { ok };
  },
  adjustStock(body) {
    requireRole_(body.username, ["admin"]);
    const material = readObjects_("RawMaterials").find((m) => m.id === body.materialId);
    if (!material) return { ok: false, error: "Material not found" };
    const delta = Number(body.deltaQty) || 0;
    if (delta === 0) return { ok: false, error: "Enter a non-zero adjustment" };
    const result = adjustStock_(body.materialId, delta, body.reason, body.note, body.username);
    logActivity_({
      actorUsername: body.username, actorRole: "admin", actionType: "STOCK_ADJUSTED",
      description: (delta > 0 ? "+" : "") + delta + " " + material.unit + " of " + material.name + " (" + body.reason + (body.note ? ": " + body.note : "") + ")",
      before: { remaining: result.before }, after: { remaining: result.after, reason: body.reason, note: body.note || "" },
    });
    return { ok: true, state: withStockView_(getState_()) };
  },
  restockMaterial(body) {
    requireRole_(body.username, ["admin", "cashier"]);
    const result = bizRestockMaterial_(body.materialId, Number(body.qtyAdded), typeof body.unitCost === "number" ? body.unitCost : undefined, body.username);
    if (!result.ok) return { ok: false, error: result.error };
    logActivity_({
      actorUsername: body.username, actorRole: roleForUsername_(body.username), actionType: "STOCK_RESTOCKED",
      description: "Restocked " + result.materialName + ": +" + result.qtyAdded + " = " + result.newTotal + " total @ " + result.unitCost + " EGP/unit",
      after: { qtyAdded: result.qtyAdded, carryover: result.carryover, newTotal: result.newTotal, unitCost: result.unitCost },
    });
    return { ok: true, state: withStockView_(getState_()) };
  },
  getRestockLog(body) {
    requireRole_(body.username, ["admin", "cashier"]);
    return { items: readObjects_("RestockLog").sort((a, b) => b.ts - a.ts) };
  },
  submitWasteInvoice(body) {
    requireRole_(body.username, ["admin", "cashier"]);
    const state = getState_();
    const result = bizSubmitWasteInvoice_(body.materialId, body.wastedQty, body.reason, body.note, body.username, state.activeShiftId);
    if (!result.ok) return { ok: false, error: result.error };
    logActivity_({
      actorUsername: body.username, actorRole: roleForUsername_(body.username), actionType: "STOCK_ADJUSTED",
      shiftId: result.invoice.shiftId,
      description: `Waste Invoice #${String(result.invoice.invoiceNumber).padStart(3, "0")}: ${result.invoice.wastedQty} ${result.invoice.unit} ${result.invoice.materialName} — ${result.invoice.reasonLabel} — ${result.invoice.totalCost.toFixed(2)} EGP`,
      after: { invoiceNumber: result.invoice.invoiceNumber, materialId: result.invoice.materialId, wastedQty: result.invoice.wastedQty, reason: result.invoice.reason, totalCost: result.invoice.totalCost },
    });
    return { ok: true, invoice: result.invoice, state: withStockView_(getState_()) };
  },
  getWasteInvoices(body) {
    requireRole_(body.username, ["admin", "cashier"]);
    return { items: readObjects_("WasteInvoices").sort((a, b) => b.ts - a.ts) };
  },
  rolloverInventory(body) {
    requireRole_(body.username, ["admin"]);
    const result = bizRolloverInventory_(body.username);
    if (!result.ok) return { ok: false, error: result.error };
    logActivity_({
      actorUsername: body.username, actorRole: "admin", actionType: "PRODUCTION_RESET",
      description: body.username + " ran the Monthly Rollover (اعتماد كبداية شهر جديد) for " + result.month + " — archived a snapshot and set Opening Stock to the current count for all " + result.count + " material(s), resetting this period's Purchases/Out counters to zero.",
    });
    return { ok: true, count: result.count, month: result.month, state: withStockView_(getState_()) };
  },
  resetMenuAndRecipes(body) {
    requireRole_(body.username, ["admin"]);
    const auth = login_(body.username, body.password);
    if (!auth.ok || auth.role !== "admin") return { ok: false, error: "Password incorrect — reset cancelled. Nothing was changed." };
    const result = resetMenuAndRecipes_(readObjects_, appendObject_, updateObjectById_, newId_, getState_, setState_, withStockView_, body.username);
    logActivity_({
      actorUsername: body.username, actorRole: "admin", actionType: "PRODUCTION_RESET",
      description: body.username + " rebuilt the entire menu from source — " + result.materialsCreated + " new material(s) created, " + result.itemsCreated + " menu item(s) rebuilt with recipes.",
    });
    return { ok: true, materialsCreated: result.materialsCreated, itemsCreated: result.itemsCreated, unresolved: result.unresolved, state: result.state };
  },
  submitPurchaseInvoice(body) {
    requireRole_(body.username, ["admin", "cashier"]);
    const deps = { readObjects_, appendObject_, updateObjectById_, newId_ };
    const result = bizSubmitPurchaseInvoice_(deps, body);
    if (!result.ok) return result;
    logActivity_({
      actorUsername: body.username, actorRole: roleForUsername_(body.username), actionType: "EXPENSE_LOGGED", shiftId: body.shiftId || null,
      description: body.username + " logged a supplier invoice: " + result.itemCount + " item(s) for " + result.totalAmount.toFixed(2) + " EGP (" + result.paymentType + ")",
    });
    return { ok: true, invoiceId: result.invoiceId, totalAmount: result.totalAmount, itemCount: result.itemCount, state: withStockView_(getState_()) };
  },
  recordSupplierPayment(body) {
    requireRole_(body.username, ["admin", "cashier"]);
    const deps = { appendObject_, newId_ };
    const result = bizRecordSupplierPayment_(deps, body);
    if (!result.ok) return result;
    logActivity_({
      actorUsername: body.username, actorRole: roleForUsername_(body.username), actionType: "EXPENSE_LOGGED", shiftId: body.shiftId || null,
      description: body.username + " recorded a payment of " + Number(body.amount).toFixed(2) + " EGP to a supplier via " + body.paymentSource,
    });
    return { ok: true, paymentId: result.paymentId };
  },
  getSupplierBalances(body) {
    requireRole_(body.username, ["admin", "cashier"]);
    return { balances: bizGetSupplierBalances_({ readObjects_ }) };
  },
  getSupplierLedger(body) {
    requireRole_(body.username, ["admin", "cashier"]);
    if (!body.supplierId) return { ok: false, error: "Supplier is required." };
    return { ok: true, ledger: bizGetSupplierLedger_({ readObjects_ }, body.supplierId) };
  },
  getInventorySnapshots(body) {
    requireRole_(body.username, ["admin", "cashier"]);
    const all = readObjects_("InventorySnapshots");
    const items = body.month ? all.filter((s) => s.month === body.month) : all;
    return { items: items.sort((a, b) => a.materialName.localeCompare(b.materialName)) };
  },
  getInventorySnapshotMonths(body) {
    requireRole_(body.username, ["admin", "cashier"]);
    const months = Array.from(new Set(readObjects_("InventorySnapshots").map((s) => s.month))).sort().reverse();
    return { months };
  },
  setActualStock(body) {
    requireRole_(body.username, ["admin", "cashier"]);
    const material = readObjects_("RawMaterials").find((m) => m.id === body.materialId);
    if (!material) return { ok: false, error: "Material not found" };
    const actual = Number(body.actualStock);
    if (isNaN(actual) || actual < 0) return { ok: false, error: "Enter a valid quantity" };
    const batches = readObjects_("Batches");
    const remaining = batches.filter((b) => b.materialId === body.materialId).reduce((a, b) => a + Number(b.qtyRemaining), 0);
    const variance = Math.round((actual - remaining) * 100) / 100;
    updateObjectById_("RawMaterials", body.materialId, { actualStock: actual, actualStockUpdatedAt: Date.now(), actualStockUpdatedBy: body.username });
    logActivity_({
      actorUsername: body.username, actorRole: roleForUsername_(body.username), actionType: "ACTUAL_STOCK_SET",
      description: material.name + ": Actual Stock set to " + actual + " " + material.unit + " (variance " + variance + ")",
      before: { systemRemaining: remaining }, after: { actualStock: actual, variance },
    });
    return { ok: true, variance, state: withStockView_(getState_()) };
  },

  // ---- Procurement ----
  submitPurchase(body) {
    const role = requireRole_(body.username, ["admin", "cashier"]);
    if (!body.materialId || !body.qty || !body.unitCost) return { ok: false, error: "Material, quantity, and cost are required." };
    const paymentStatus = body.paymentStatus === "unpaid" ? "unpaid" : "paid";
    let paymentSource = null;
    if (paymentStatus === "paid") {
      const validSources = ["cash_drawer", "out_of_pocket", "bank_transfer"];
      if (validSources.indexOf(body.paymentSource) === -1) return { ok: false, error: "Select a payment source." };
      paymentSource = body.paymentSource;
    }
    const receiptUrl = body.receiptBase64 ? saveReceiptLocally_(body.receiptBase64, "receipt-" + Date.now() + ".jpg") : null;
    const amount = Number(body.qty) * Number(body.unitCost);
    const isAdmin = role === "admin";
    const entry = {
      id: newId_("ledg"), ts: Date.now(), amount, direction: "outflow", type: body.purchaseType,
      category: body.category || "Procurement", description: body.description || "", supplierId: body.supplierId || null,
      staffUsername: body.username, status: isAdmin ? "approved" : "pending", receiptUrl,
      paidFromDrawer: paymentStatus === "paid" && paymentSource === "cash_drawer", paymentSource, paymentStatus, shiftId: body.shiftId || null,
      materialId: body.materialId, qty: body.qty, unitCost: body.unitCost,
    };
    appendObject_("Ledger", entry);
    if (isAdmin) {
      // The material physically arrives either way — receiving it on
      // credit (unpaid) doesn't change that it's now in stock, only
      // whether cash has left the drawer for it yet.
      appendObject_("Batches", { id: newId_("batch"), materialId: body.materialId, supplierId: body.supplierId || null, qtyPurchased: body.qty, qtyRemaining: body.qty, unitCost: body.unitCost, purchasedAt: entry.ts, source: body.purchaseType === "stockedBatch" ? "stockedBatch" : "dailyFresh" });
      // "Most Recent Purchase Unit Cost" replaces average-cost logic —
      // every approved purchase becomes the new reference cost, both for
      // display and for future FIFO batch valuation defaults.
      updateObjectById_("RawMaterials", body.materialId, { unitCost: Number(body.unitCost), lastPurchaseCost: Number(body.unitCost) });
    }
    logActivity_({
      actorUsername: body.username, actorRole: role, actionType: "EXPENSE_LOGGED", shiftId: entry.shiftId,
      description: (isAdmin ? "Logged & auto-approved" : "Submitted (pending)") + " " + body.purchaseType + ": " + body.qty + " " + body.materialId + " for " + amount.toFixed(2) + " EGP (" + paymentStatus + ")",
      after: { status: entry.status, amount, materialId: body.materialId, qty: body.qty, paymentStatus },
    });
    return { ok: true, status: entry.status, entry };
  },
  submitExpense(body) {
    const role = requireRole_(body.username, ["admin", "cashier"]);
    if (!body.itemName || !body.amount) return { ok: false, error: "Item/expense description and amount are required." };
    const paymentStatus = body.paymentStatus === "unpaid" ? "unpaid" : "paid";
    // Unpaid: no money has left anything yet, so there's genuinely no
    // payment source to record — paidFromDrawer stays false, which is
    // also exactly what already keeps this out of the active shift's
    // expected-cash calculation (that logic already filters on
    // paidFromDrawer, so an unpaid expense is automatically excluded
    // without needing any special-case handling there).
    let paymentSource = null;
    if (paymentStatus === "paid") {
      const validSources = ["cash_drawer", "out_of_pocket", "bank_transfer"];
      if (validSources.indexOf(body.paymentSource) === -1) return { ok: false, error: "Select a payment source." };
      paymentSource = body.paymentSource;
    }
    const receiptUrl = body.receiptBase64 ? saveReceiptLocally_(body.receiptBase64, "receipt-" + Date.now() + ".jpg") : null;
    const isAdmin = role === "admin";
    const amount = Number(body.amount);
    const entry = {
      id: newId_("ledg"), ts: Date.now(), amount, direction: "outflow", type: "midShiftPurchase",
      category: body.category || "Expense", description: body.itemName + (body.notes ? " — " + body.notes : ""),
      supplierId: body.supplierId || null, staffUsername: body.username, status: isAdmin ? "approved" : "pending",
      receiptUrl, paidFromDrawer: paymentStatus === "paid" && paymentSource === "cash_drawer",
      shiftId: body.shiftId || null, materialId: null, qty: null, unitCost: null,
      paymentSource, paymentStatus,
    };
    appendObject_("Ledger", entry);
    logActivity_({
      actorUsername: body.username, actorRole: role, actionType: "EXPENSE_LOGGED", shiftId: entry.shiftId,
      description: (isAdmin ? "Logged & auto-approved" : "Submitted (pending)") + " expense: " + body.itemName + " for " + amount.toFixed(2) + " EGP (" + paymentStatus + ")",
      after: { status: entry.status, amount, itemName: body.itemName, paymentStatus },
    });
    return { ok: true, status: entry.status, entry };
  },
  getUnpaidExpenses(body) {
    requireRole_(body.username, ["admin", "cashier"]);
    return { items: readObjects_("Ledger").filter((l) => l.paymentStatus === "unpaid" && l.status === "approved").sort((a, b) => b.ts - a.ts) };
  },
  settleExpense(body) {
    const role = requireRole_(body.username, ["admin", "cashier"]);
    const validSources = ["cash_drawer", "out_of_pocket", "bank_transfer"];
    if (validSources.indexOf(body.paymentSource) === -1) return { ok: false, error: "Select a payment source." };
    const entry = readObjects_("Ledger").find((l) => l.id === body.ledgerId);
    if (!entry) return { ok: false, error: "Entry not found." };
    if (entry.paymentStatus !== "unpaid") return { ok: false, error: "This entry is not marked unpaid." };
    const patch = { paymentStatus: "paid", paymentSource: body.paymentSource, paidFromDrawer: body.paymentSource === "cash_drawer" };
    updateObjectById_("Ledger", body.ledgerId, patch);
    logActivity_({
      actorUsername: body.username, actorRole: role, actionType: "EXPENSE_LOGGED", shiftId: entry.shiftId,
      description: body.username + " settled a debt: " + entry.description + " — " + entry.amount.toFixed(2) + " EGP now paid via " + body.paymentSource,
      before: { paymentStatus: "unpaid" }, after: patch,
    });
    return { ok: true };
  },
  getPendingApprovals(body) {
    requireRole_(body.username, ["admin"]);
    return { items: readObjects_("Ledger").filter((l) => l.status === "pending") };
  },
  approvePurchase(body) {
    requireRole_(body.username, ["admin"]);
    const entry = readObjects_("Ledger").find((l) => l.id === body.ledgerId);
    if (!entry) return { ok: false, error: "Entry not found" };
    if (entry.status !== "pending") return { ok: false, error: "Entry is not pending" };
    if (entry.materialId && entry.qty) {
      appendObject_("Batches", { id: newId_("batch"), materialId: entry.materialId, supplierId: entry.supplierId, qtyPurchased: entry.qty, qtyRemaining: entry.qty, unitCost: entry.unitCost, purchasedAt: entry.ts, source: entry.type === "stockedBatch" ? "stockedBatch" : "dailyFresh" });
    }
    updateObjectById_("Ledger", entry.id, { status: "approved" });
    logActivity_({ actorUsername: body.username, actorRole: "admin", actionType: "EXPENSE_APPROVED", shiftId: entry.shiftId, description: "Approved purchase of " + entry.qty + " " + entry.materialId, before: { status: "pending" }, after: { status: "approved" } });
    return { ok: true };
  },
  rejectPurchase(body) {
    requireRole_(body.username, ["admin"]);
    const before = readObjects_("Ledger").find((l) => l.id === body.ledgerId);
    updateObjectById_("Ledger", body.ledgerId, { status: "rejected" });
    logActivity_({ actorUsername: body.username, actorRole: "admin", actionType: "EXPENSE_REJECTED", shiftId: before ? before.shiftId : null, description: "Rejected purchase" + (body.reason ? " — " + body.reason : ""), before: { status: "pending" }, after: { status: "rejected" } });
    return { ok: true };
  },
  getLedger(body) {
    requireRole_(body.username, ["admin"]);
    return { items: readObjects_("Ledger") };
  },

  // ---- Voids ----
  requestVoid(body) {
    const role = requireRole_(body.username, ["admin", "cashier"]);
    if (!VOID_REASONS[body.reason]) return { ok: false, error: "Invalid void reason" };
    const state = getState_();
    const room = state.rooms.find((r) => r.id === body.roomId);
    if (!room) return { ok: false, error: "Room not found" };
    const line = room.orders.find((o) => o.menuItemId === body.menuItemId);
    const voidQty = Number(body.qty);
    if (!line) return { ok: false, error: "\"" + body.menuItemId + "\" is not on this table's current bill (it may have been removed or already checked out)." };
    if (isNaN(voidQty) || voidQty <= 0) return { ok: false, error: "Invalid quantity (" + body.qty + ") to void." };
    if (Number(line.qty) < voidQty) return { ok: false, error: "Only " + line.qty + "x \"" + line.name + "\" is on the bill, can't void " + voidQty + "x." };

    let approvingAdmin = null;
    if (role !== "admin" && body.approvingAdminUsername && body.approvingAdminPassword) {
      const authCheck = login_(body.approvingAdminUsername, body.approvingAdminPassword);
      if (!authCheck.ok || authCheck.role !== "admin") return { ok: false, error: "Admin authorization failed." };
      approvingAdmin = authCheck.username;
    }
    const routeUnapproved = role !== "admin" && !approvingAdmin && !!body.routeUnapproved;
    const executesNow = role === "admin" || !!approvingAdmin || routeUnapproved;
    const approverUsername = role === "admin" ? body.username : approvingAdmin;

    const req = {
      id: newId_("void"), ts: Date.now(), roomId: room.id, roomName: room.name,
      menuItemId: body.menuItemId, itemName: line.name, qty: voidQty, unitPrice: line.price,
      billValue: line.price * voidQty, reason: body.reason,
      status: executesNow ? (routeUnapproved ? "unapproved" : "approved") : "pending",
      cashierUsername: body.username, waiterName: body.waiterName || "", shiftId: state.activeShiftId,
      approvedBy: executesNow && !routeUnapproved ? approverUsername : null,
      approvedAt: executesNow && !routeUnapproved ? Date.now() : null,
      cogs: null, applied: false, applyError: null,
    };

    if (executesNow) {
      const batches = readObjects_("Batches");
      const result = applyVoid_(state, batches, req);
      if (result.ok) {
        req.cogs = result.cogs;
        req.applied = true;
        setState_(result.state);
        result.touchedBatchIds.forEach((id) => {
          const b = batches.find((x) => x.id === id);
          if (b) updateObjectById_("Batches", id, { qtyRemaining: b.qtyRemaining });
        });
        (result.newBatches || []).forEach((b) => appendObject_("Batches", b));
        const reasonCfg = VOID_REASONS[body.reason];
        if (routeUnapproved) {
          appendObject_("Ledger", { id: newId_("ledg"), ts: req.ts, amount: result.cogs, direction: "outflow", type: "manualAdjustment", category: "Unapproved Void — Pending Reconciliation", description: req.qty + "x " + req.itemName + " — " + room.name, supplierId: null, staffUsername: body.username, status: "approved", receiptUrl: null, paidFromDrawer: false, shiftId: state.activeShiftId, materialId: null, qty: null, unitCost: null, paymentSource: null });
        } else if (reasonCfg.deductsInventory && result.cogs > 0) {
          appendObject_("Ledger", { id: newId_("ledg"), ts: req.ts, amount: result.cogs, direction: "outflow", type: "manualAdjustment", category: reasonCfg.ledgerCategory, description: req.qty + "x " + req.itemName + " — " + room.name, supplierId: null, staffUsername: body.username, status: "approved", receiptUrl: null, paidFromDrawer: false, shiftId: state.activeShiftId, materialId: null, qty: null, unitCost: null, paymentSource: null });
        }
      } else {
        req.applyError = result.error;
      }
    }
    appendObject_("VoidRequests", req);
    logActivity_({
      actorUsername: body.username, actorRole: role,
      actionType: routeUnapproved ? "UNAPPROVED_VOID_ROUTED" : (approvingAdmin ? "UNDO_ACTION" : "VOID_REQUESTED"),
      location: room.name, shiftId: state.activeShiftId,
      description: req.qty + "x " + req.itemName + " voided (" + VOID_REASONS[body.reason].label + ") — " + req.status,
    });
    return { ok: true, request: req, state: withStockView_(getState_()) };
  },
  getVoidRequests(body) {
    requireRole_(body.username, ["admin"]);
    return { items: readObjects_("VoidRequests") };
  },
  approveVoid(body) {
    requireRole_(body.username, ["admin"]);
    const req = readObjects_("VoidRequests").find((r) => r.id === body.voidId);
    if (!req) return { ok: false, error: "Void request not found" };
    if (req.status === "approved") return { ok: true, state: withStockView_(getState_()) };
    const state = getState_();
    const batches = readObjects_("Batches");
    const result = applyVoid_(state, batches, req);
    if (!result.ok) {
      updateObjectById_("VoidRequests", req.id, { applyError: result.error });
      return { ok: false, error: result.error };
    }
    setState_(result.state);
    result.touchedBatchIds.forEach((id) => {
      const b = batches.find((x) => x.id === id);
      if (b) updateObjectById_("Batches", id, { qtyRemaining: b.qtyRemaining });
    });
    (result.newBatches || []).forEach((b) => appendObject_("Batches", b));
    updateObjectById_("VoidRequests", req.id, { status: "approved", approvedBy: body.username, approvedAt: Date.now(), cogs: result.cogs, applied: true, applyError: null });
    const reasonCfg = VOID_REASONS[req.reason];
    if (reasonCfg && reasonCfg.deductsInventory && result.cogs > 0) {
      appendObject_("Ledger", { id: newId_("ledg"), ts: Date.now(), amount: result.cogs, direction: "outflow", type: "manualAdjustment", category: reasonCfg.ledgerCategory, description: req.qty + "x " + req.itemName + " — " + req.roomName, supplierId: null, staffUsername: body.username, status: "approved", receiptUrl: null, paidFromDrawer: false, shiftId: req.shiftId, materialId: null, qty: null, unitCost: null, paymentSource: null });
    }
    logActivity_({ actorUsername: body.username, actorRole: "admin", actionType: "VOID_APPROVED", location: req.roomName, shiftId: req.shiftId, description: "Approved void of " + req.qty + "x " + req.itemName, before: { status: "pending" }, after: { status: "approved", cogs: result.cogs } });
    return { ok: true, state: withStockView_(result.state) };
  },
  denyVoid(body) {
    requireRole_(body.username, ["admin"]);
    const before = readObjects_("VoidRequests").find((r) => r.id === body.voidId);
    updateObjectById_("VoidRequests", body.voidId, { status: "denied", approvedBy: body.username, approvedAt: Date.now() });
    logActivity_({ actorUsername: body.username, actorRole: "admin", actionType: "VOID_DENIED", location: before ? before.roomName : "", shiftId: before ? before.shiftId : null, description: "Denied void request", before: { status: "pending" }, after: { status: "denied" } });
    return { ok: true };
  },
  reconcileUnapprovedVoid(body) {
    requireRole_(body.username, ["admin"]);
    const before = readObjects_("VoidRequests").find((r) => r.id === body.voidId);
    if (!before) return { ok: false, error: "Void request not found" };
    if (before.status !== "unapproved") return { ok: false, error: "This request has already been reconciled" };
    const newStatus = body.decision === "flag_discrepancy" ? "discrepancy" : "approved";
    updateObjectById_("VoidRequests", body.voidId, { status: newStatus, approvedBy: body.username, approvedAt: Date.now() });
    logActivity_({
      actorUsername: body.username, actorRole: "admin",
      actionType: body.decision === "flag_discrepancy" ? "UNAPPROVED_VOID_FLAGGED" : "UNAPPROVED_VOID_RECONCILED",
      location: before.roomName, shiftId: before.shiftId,
      description: (body.decision === "flag_discrepancy" ? "Flagged: " : "Reconciled: ") + before.qty + "x " + before.itemName,
      before: { status: "unapproved" }, after: { status: newStatus, note: body.note || null },
    });
    return { ok: true };
  },

  // ---- Staff orders ----
  submitStaffOrder(body) {
    requireRole_(body.username, ["admin", "cashier"]);
    const batches = readObjects_("Batches");
    const result = bizSubmitStaffOrder_(getState_(), batches, body.staffName, body.items);
    if (!result.ok) return { ok: false, error: result.error, state: withStockView_(result.state) };
    setState_(result.state);
    result.touchedBatchIds.forEach((id) => {
      const b = batches.find((x) => x.id === id);
      if (b) updateObjectById_("Batches", id, { qtyRemaining: b.qtyRemaining });
    });
    result.staffOrder.processedBy = body.username;
    appendObject_("StaffOrders", { id: result.staffOrder.id, ts: result.staffOrder.ts, staffName: result.staffOrder.staffName, items: JSON.stringify(result.staffOrder.items), totalAmount: result.staffOrder.totalAmount, cogs: result.staffOrder.cogs, processedBy: body.username, shiftId: result.staffOrder.shiftId });
    appendObject_("Ledger", { id: newId_("ledg"), ts: result.staffOrder.ts, amount: result.staffOrder.totalAmount, direction: "outflow", type: "manualAdjustment", category: "Staff Consumption Expense", description: result.staffOrder.staffName + " — " + result.staffOrder.items.length + " item(s)", supplierId: null, staffUsername: body.username, status: "approved", receiptUrl: null, paidFromDrawer: false, shiftId: result.staffOrder.shiftId, materialId: null, qty: null, unitCost: null, paymentSource: null });
    logActivity_({ actorUsername: body.username, actorRole: roleForUsername_(body.username), actionType: "STAFF_ORDER_LOGGED", description: "Staff order for " + result.staffOrder.staffName + " — " + result.staffOrder.totalAmount.toFixed(2) + " EGP", shiftId: result.staffOrder.shiftId });
    return { ok: true, staffOrder: result.staffOrder, state: withStockView_(result.state) };
  },
  getStaffOrders(body) {
    requireRole_(body.username, ["admin"]);
    return { items: readObjects_("StaffOrders").map((r) => { let items = []; try { items = JSON.parse(r.items || "[]"); } catch { items = []; } return Object.assign({}, r, { items }); }) };
  },

  // ---- Business day / shift extras ----
  forceEndShift(body) {
    requireRole_(body.username, ["admin"]);
    const state = getState_();
    if (!state.activeShiftId) return { ok: true, state: withStockView_(state) };
    const shiftIdBefore = state.activeShiftId;
    const result = bizCloseActiveShift_(state, readSessions_(), readObjects_("Ledger"), readShifts_(), body.actualCash, true);
    setState_(result.state);
    logActivity_({ actorUsername: body.username, actorRole: "admin", actionType: "FORCE_END_SHIFT", shiftId: shiftIdBefore, description: "Admin force-closed shift " + shiftIdBefore });
    return { ok: true, state: withStockView_(result.state) };
  },
  closeBusinessDay(body) {
    requireRole_(body.username, ["admin"]);
    const state0 = getState_();
    const result = bizCloseBusinessDay_(state0, readSessions_(), readShifts_(), readObjects_("Ledger"), body.username);
    if (!result.ok) return { ok: false, error: result.error, state: withStockView_(state0) };
    updateObjectById_("BusinessDays", result.businessDayId, result.updates);
    setState_(result.state);
    logActivity_({
      actorUsername: body.username, actorRole: "admin", actionType: "BUSINESS_DAY_CLOSED",
      description: "Business day closed — " + result.totalRevenue.toFixed(2) + " EGP revenue, " + result.netProfit.toFixed(2) + " EGP net profit across " + result.shiftCount + " shift(s)",
    });
    return { ok: true, state: withStockView_(result.state) };
  },
  getBusinessDays(body) {
    requireRole_(body.username, ["admin"]);
    return { items: readBusinessDays_() };
  },

  // ---- Suppliers / recurring expenses ----
  getSuppliers(body) {
    requireRole_(body.username, ["admin"]);
    return { items: readObjects_("Suppliers") };
  },
  addSupplier(body) {
    requireRole_(body.username, ["admin"]);
    const item = { id: newId_("sup"), name: body.name, contact: body.contact || "", category: body.category || "" };
    appendObject_("Suppliers", item);
    return { ok: true, item };
  },
  updateSupplier(body) {
    requireRole_(body.username, ["admin"]);
    return { ok: updateObjectById_("Suppliers", body.id, body.patch) };
  },
  deleteSupplier(body) {
    requireRole_(body.username, ["admin"]);
    return { ok: deleteObjectById_("Suppliers", body.id) };
  },
  getRecurringExpenses(body) {
    requireRole_(body.username, ["admin"]);
    return { items: readObjects_("RecurringExpenses") };
  },
  addRecurringExpense(body) {
    requireRole_(body.username, ["admin"]);
    const item = { id: newId_("rec"), name: body.name, amount: body.amount || 0, active: body.active !== false };
    appendObject_("RecurringExpenses", item);
    return { ok: true, item };
  },
  updateRecurringExpense(body) {
    requireRole_(body.username, ["admin"]);
    return { ok: updateObjectById_("RecurringExpenses", body.id, body.patch) };
  },
  deleteRecurringExpense(body) {
    requireRole_(body.username, ["admin"]);
    return { ok: deleteObjectById_("RecurringExpenses", body.id) };
  },

  // ---- Accounts ----
  getAccounts(body) {
    requireRole_(body.username, ["admin"]);
    return { accounts: getAccounts_() };
  },
  addAccount(body) {
    requireRole_(body.username, ["admin"]);
    const result = addAccount_(body.newUsername, body.newPassword, body.newRole);
    if (result.ok) logActivity_({ actorUsername: body.username, actorRole: "admin", actionType: "ACCOUNT_CREATED", description: "Created account '" + body.newUsername + "' with role " + body.newRole, after: { username: body.newUsername, role: body.newRole } });
    return result;
  },
  updateAccount(body) {
    requireRole_(body.username, ["admin"]);
    return updateAccount_(body.originalUsername, body.patch || {});
  },
  deleteAccount(body) {
    requireRole_(body.username, ["admin"]);
    return deleteAccount_(body.targetUsername);
  },

  // ---- Activity log ----
  getActivityLogs(body) {
    requireRole_(body.username, ["admin"]);
    return { items: readObjects_("ActivityLogs").sort((a, b) => b.ts - a.ts) };
  },

  // ---- Misc config ----
  setFraudThreshold(body) {
    requireRole_(body.username, ["admin"]);
    const state = getState_();
    state.fraudThresholdPercent = Number(body.percent) || 0;
    setState_(state);
    return { state: withStockView_(state) };
  },
  setActualCash(body) {
    requireRole_(body.username, ["admin", "cashier"]);
    const state = getState_();
    state.actualCashInput = body.amount;
    setState_(state);
    return { state: withStockView_(state) };
  },

  setAbsoluteStock(body) {
    requireRole_(body.username, ["admin"]);
    const material = readObjects_("RawMaterials").find((m) => m.id === body.materialId);
    if (!material) return { ok: false, error: "Material not found" };
    const target = Number(body.targetQty);
    if (isNaN(target) || target < 0) return { ok: false, error: "Enter a valid quantity" };

    // Same fix as the cloud version: compute the delta HERE, against the
    // live remaining at this exact moment — never trust a delta the
    // client pre-computed, since that goes stale the instant real
    // consumption happens between opening the Edit modal and saving.
    const batches = readObjects_("Batches");
    const before = batches.filter((b) => b.materialId === body.materialId).reduce((a, b) => a + Number(b.qtyRemaining), 0);
    const delta = Math.round((target - before) * 1e6) / 1e6;
    let after = before;
    if (delta !== 0) {
      const result = adjustStock_(body.materialId, delta, "correction", body.note || "", body.username);
      after = result.after;
    }
    logActivity_({
      actorUsername: body.username, actorRole: "admin", actionType: "STOCK_ADJUSTED",
      description: material.name + ": Actual Stock set to " + target + " " + material.unit +
        " (system showed " + before + " " + material.unit + ") — " +
        (delta < 0 ? "DEFICIT of " + Math.abs(delta) : delta > 0 ? "SURPLUS of " + delta : "no variance") + " " + material.unit +
        (body.note ? " — " + body.note : ""),
      before: { remaining: before }, after: { remaining: after, delta },
    });
    return { ok: true, before, after, delta, state: withStockView_(getState_()) };
  },

  nextKotNumber(body) {
    requireRole_(body.username, ["admin", "cashier"]);
    if (!body.shiftId) return { ok: false, error: "No active shift" };
    const shift = readShifts_().find((s) => s.id === body.shiftId);
    if (!shift) return { ok: false, error: "Shift not found" };
    const next = (Number(shift.kotCounter) || 0) + 1;
    updateObjectById_("Shifts", body.shiftId, { kotCounter: next });
    return { ok: true, number: next };
  },

  verifyAdminAuth(body) {
    const result = login_(body.adminUsername, body.adminPassword);
    const ok = result.ok && result.role === "admin";
    if (!ok) {
      logActivity_({ actorUsername: body.username, actorRole: roleForUsername_(body.username), actionType: "LOGIN_FAILED", description: "Failed on-the-spot admin authorization attempt (target: '" + (body.adminUsername || "") + "')" });
    }
    return { ok, adminUsername: ok ? result.username : null };
  },

  logRecurringExpensePayment(body) {
    requireRole_(body.username, ["admin"]);
    const entry = {
      id: newId_("ledg"), ts: Date.now(), amount: body.amount, direction: "outflow",
      type: "recurringExpense", category: body.name || "Recurring Expense", description: body.description || "",
      supplierId: null, staffUsername: body.username, status: "approved", receiptUrl: body.receiptUrl || null,
      paidFromDrawer: false, shiftId: null, materialId: null, qty: null, unitCost: null, paymentSource: null,
    };
    appendObject_("Ledger", entry);
    logActivity_({ actorUsername: body.username, actorRole: "admin", actionType: "RECURRING_EXPENSE_PAID", description: "Logged payment of " + body.amount + " EGP for '" + body.name + "'", after: { name: body.name, amount: body.amount } });
    return { ok: true, entry };
  },

  logSplitInterfaceOpened(body) {
    requireRole_(body.username, ["admin", "cashier"]);
    const state0 = getState_();
    const source = state0.rooms.find((r) => r.id === body.roomId);
    logActivity_({ actorUsername: body.username, actorRole: roleForUsername_(body.username), actionType: "SPLIT_INTERFACE_OPENED", location: source ? source.name : body.roomId, shiftId: state0.activeShiftId, description: "Split interface opened for " + (source ? source.name : body.roomId) });
    return { ok: true };
  },

  setGeofenceConfig(body) {
    requireRole_(body.username, ["admin"]);
    const state = getState_();
    const before = { enabled: state.geofenceEnabled, lat: state.cafeLat, lng: state.cafeLng, radiusMeters: state.geofenceRadiusMeters };
    state.geofenceEnabled = !!body.enabled;
    state.cafeLat = Number(body.lat) || 0;
    state.cafeLng = Number(body.lng) || 0;
    state.geofenceRadiusMeters = Number(body.radiusMeters) || 50;
    setState_(state);
    logActivity_({ actorUsername: body.username, actorRole: "admin", actionType: "GEOFENCE_CONFIG_CHANGED", description: "Geofence config updated — enabled=" + state.geofenceEnabled, before, after: { enabled: state.geofenceEnabled, lat: state.cafeLat, lng: state.cafeLng, radiusMeters: state.geofenceRadiusMeters } });
    return { state: withStockView_(state) };
  },

  resetForProduction(body) {
    requireRole_(body.username, ["admin"]);
    const auth = login_(body.username, body.password);
    if (!auth.ok || auth.role !== "admin") return { ok: false, error: "Password incorrect — reset cancelled. Nothing was deleted." };

    // Transactional / test data — WIPED. Configuration (RawMaterials,
    // Suppliers, RecurringExpenses, Accounts) is never touched here.
    ["Sessions", "Shifts", "VoidRequests", "Ledger", "ActivityLogs", "StaffOrders", "RestockLog", "Batches", "BusinessDays"]
      .forEach((table) => db.exec(`DELETE FROM ${table}`));

    const state = getState_();
    state.rooms = state.rooms.map((r) => Object.assign({}, r, {
      status: "available", startedAt: null, orders: [],
      isPaused: false, pausedAt: null, pausedDurationSec: 0, timeAdjustmentSec: 0,
      hourlyRate: 0, rateMode: null, splitInvoiceNumber: null, transferredFrom: null,
    }));
    state.activeShiftId = null;
    state.businessDayId = null;
    state.actualCashInput = 0;
    state.activity = [];
    state.cashRecords = [];
    setState_(state);

    logActivity_({
      actorUsername: body.username, actorRole: "admin", actionType: "PRODUCTION_RESET",
      description: body.username + " performed a Go-Live Production Reset (local server) — all test orders, shifts, transactions, and financial history were permanently deleted. Menu, room configuration, and employee accounts were preserved.",
    });
    return { ok: true, state: withStockView_(state) };
  },

  resetInventory(body) {
    requireRole_(body.username, ["admin"]);
    const auth = login_(body.username, body.password);
    if (!auth.ok || auth.role !== "admin") return { ok: false, error: "Password incorrect — reset cancelled. Nothing was deleted." };

    // Wipes the ENTIRE stock system for a genuinely clean slate.
    // Deliberately separate from Production Reset, which preserves
    // RawMaterials/Batches as configuration. Destructive to menu item
    // recipes too — ingredients will point at materials that no longer
    // exist until rebuilt against the new material list.
    ["RawMaterials", "Batches", "RestockLog", "WasteInvoices"].forEach((table) => db.exec(`DELETE FROM ${table}`));

    logActivity_({
      actorUsername: body.username, actorRole: "admin", actionType: "PRODUCTION_RESET",
      description: body.username + " reset the entire Stock Inventory system (local server) — every raw material, batch, restock log, and waste invoice was permanently deleted. Menu item recipes now reference materials that no longer exist until rebuilt against the new material list.",
    });
    return { ok: true, state: withStockView_(getState_()) };
  },
});


app.post("/", (req, res) => {
  const body = req.body || {};
  if (body.secret !== SHARED_SECRET) {
    res.status(403).json({ error: "forbidden — secret mismatch" });
    return;
  }
  const handler = handlers[body.action];
  if (!handler) {
    res.status(200).json({ error: "Action '" + body.action + "' is not implemented in the local server yet." });
    return;
  }
  try {
    const result = handler(body);
    res.status(200).json(result);
  } catch (err) {
    res.status(200).json({ error: String(err && err.message ? err.message : err) });
  }
});

app.get("/health", (req, res) => res.json({ ok: true, actionsImplemented: Object.keys(handlers).length }));

app.listen(PORT, "0.0.0.0", () => {
  console.log("GLITCH local server listening on http://0.0.0.0:" + PORT);
  console.log("Actions implemented so far: " + Object.keys(handlers).join(", "));
  scheduleBackups();
  console.log("Automatic backups: one now, then every 24h, kept in " + BACKUP_DIR);
});
