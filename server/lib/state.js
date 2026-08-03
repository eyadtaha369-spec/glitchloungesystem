const { getStateRaw_, setStateRaw_, readObjects_, appendObject_, updateObjectById_ } = require("../db");
const { defaultAppState_ } = require("./defaultState");

// ---- Sessions live in their own table (not the blob) — same reasoning
// as the original: an unbounded list in a single JSON blob is what broke
// Google Sheets' 50,000-char cell limit earlier in this project. Kept
// that lesson here even though SQLite has no such limit, since it's
// still the right design (indexed queries, no giant blob rewrites).
function sessionToRow_(s) {
  return {
    id: s.id, orderNumber: s.orderNumber || 0, roomId: s.roomId, roomName: s.roomName,
    startedAt: s.startedAt, endedAt: s.endedAt, durationSec: s.durationSec, timeCost: s.timeCost,
    orders: JSON.stringify(s.orders || []), ordersCost: s.ordersCost, total: s.total, cogs: s.cogs,
    discountAmount: s.discountAmount || 0, discountLabel: s.discountLabel || null,
    timeDiscountAmount: s.timeDiscountAmount || 0, timeDiscountLabel: s.timeDiscountLabel || null,
    ordersDiscountAmount: s.ordersDiscountAmount || 0, ordersDiscountLabel: s.ordersDiscountLabel || null,
    splitBill: !!s.splitBill, paymentMethod: s.paymentMethod, cashAmount: s.cashAmount,
    visaAmount: s.visaAmount, instapayAmount: s.instapayAmount, shiftId: s.shiftId,
  };
}
function rowToSession_(r) {
  let orders = [];
  try { orders = JSON.parse(r.orders || "[]"); } catch { orders = []; }
  return Object.assign({}, r, {
    orders, splitBill: !!r.splitBill, orderNumber: Number(r.orderNumber) || 0,
    discountAmount: Number(r.discountAmount) || 0, discountLabel: r.discountLabel || null,
    timeDiscountAmount: Number(r.timeDiscountAmount) || 0, timeDiscountLabel: r.timeDiscountLabel || null,
    ordersDiscountAmount: Number(r.ordersDiscountAmount) || 0, ordersDiscountLabel: r.ordersDiscountLabel || null,
  });
}
function readSessions_() {
  return readObjects_("Sessions").map(rowToSession_).sort((a, b) => b.endedAt - a.endedAt);
}
function appendSessionRow_(s) { appendObject_("Sessions", sessionToRow_(s)); }

function readShifts_() {
  return readObjects_("Shifts").map((r) => Object.assign({}, r, { forced: !!r.forced })).sort((a, b) => b.openedAt - a.openedAt);
}
function readBusinessDays_() {
  return readObjects_("BusinessDays").sort((a, b) => b.openedAt - a.openedAt);
}

// ---- FIFO inventory (direct port of consumeFifo_/materialRemaining_) ----
function materialRemaining_(batches, materialId) {
  return batches.filter((b) => b.materialId === materialId).reduce((a, b) => a + (Number(b.qtyRemaining) || 0), 0);
}
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
// Consumes oldest-purchased batches first, mutates the in-memory batches
// array's qtyRemaining, and tracks which batch ids actually changed so the
// caller only needs to write those rows back (not the whole table).
function consumeFifo_(batches, materialId, qtyNeeded) {
  const matBatches = batches.filter((b) => b.materialId === materialId && Number(b.qtyRemaining) > 0)
    .sort((a, b) => Number(a.purchasedAt) - Number(b.purchasedAt));
  let remaining = qtyNeeded;
  let cost = 0;
  const touched = [];
  for (const b of matBatches) {
    if (remaining <= 1e-9) break;
    const take = Math.min(remaining, Number(b.qtyRemaining));
    b.qtyRemaining = Number(b.qtyRemaining) - take;
    cost += take * Number(b.unitCost);
    remaining -= take;
    touched.push(b.id);
  }
  return { cost, touched, shortfall: Math.max(0, remaining) };
}
function writeBatchesBack_(batches, touchedBatchIds) {
  touchedBatchIds.forEach((id) => {
    const b = batches.find((x) => x.id === id);
    if (b) updateObjectById_("Batches", id, { qtyRemaining: b.qtyRemaining });
  });
}

function computeStockView_(materials, batches) {
  return materials.map((m) => {
    const matBatches = batches.filter((b) => b.materialId === m.id);
    const initialStock = matBatches.reduce((a, b) => a + Number(b.qtyPurchased), 0);
    const remaining = matBatches.reduce((a, b) => a + Number(b.qtyRemaining), 0);
    const unitCost = Number(m.unitCost) || 0;
    const actualStock = (m.actualStock === null || m.actualStock === undefined || m.actualStock === "") ? null : Number(m.actualStock);
    const newest = matBatches.reduce((a, b) => (!a || Number(b.purchasedAt) > Number(a.purchasedAt) ? b : a), null);
    // Perpetual Inventory Ledger fields — Opening Stock is the one
    // permanent historical fact (locked from editing at the API level,
    // not just hidden in the UI); Purchases/In is everything added
    // since then (initialStock already includes the opening batch, so
    // subtracting it out isolates true purchases); Sales & Waste/Out is
    // exactly the existing `used` figure (recipe consumption + waste-
    // marketing + waste invoices — all of it already flows through the
    // same FIFO consumption, so this was already correct, just needed
    // exposing under this name). System Balance = Opening + Purchases -
    // Out holds by construction, since Out is DERIVED that way, not
    // independently tracked — no possibility of the three drifting
    // apart from each other.
    const openingStock = Number(m.openingStock) || 0;
    const purchasesIn = Math.round((initialStock - openingStock) * 1e6) / 1e6;
    const salesWasteOut = initialStock - remaining;
    return {
      id: m.id, name: m.name, unit: m.unit, initialStock, used: initialStock - remaining,
      minStock: m.minStockAlert, unitCost, remaining, totalValue: Math.round(remaining * unitCost * 100) / 100,
      usedSinceRestock: newest ? Number(newest.qtyPurchased) - Number(newest.qtyRemaining) : 0,
      lastRestockAt: newest ? Number(newest.purchasedAt) : null,
      actualStock, actualStockUpdatedAt: m.actualStockUpdatedAt || null, actualStockUpdatedBy: m.actualStockUpdatedBy || null,
      variance: actualStock === null ? null : Math.round((actualStock - remaining) * 100) / 100,
      openingStock, purchasesIn, salesWasteOut, systemBalance: remaining,
      actualCountValue: actualStock === null ? null : Math.round(actualStock * unitCost * 100) / 100,
      category: m.category || "", storageLocation: m.storageLocation || "", lastPurchaseCost: Number(m.lastPurchaseCost) || unitCost,
    };
  });
}

function pendingVoidCountForShift_(shiftId) {
  if (!shiftId) return 0;
  return readObjects_("VoidRequests").filter((v) => v.shiftId === shiftId && v.status === "pending").length;
}

// Direct port of getState_(): seeds a fresh default state on first run,
// otherwise returns the persisted blob (minus computed fields, which
// withStockView_ attaches fresh on every response).
function getState_() {
  let raw = getStateRaw_();
  if (!raw) {
    const fresh = defaultAppState_();
    setStateRaw_(JSON.stringify(fresh));
    return fresh;
  }
  const parsed = JSON.parse(raw);
  delete parsed.sessions;
  delete parsed.shifts;
  delete parsed.stock;
  delete parsed.pendingVoidCountForActiveShift;
  delete parsed.businessDays;
  return parsed;
}

function setState_(state) {
  const toSave = Object.assign({}, state);
  delete toSave.stock;
  delete toSave.pendingVoidCountForActiveShift;
  delete toSave.sessions;
  delete toSave.shifts;
  delete toSave.businessDays;
  setStateRaw_(JSON.stringify(toSave));
}

function withStockView_(state) {
  if (!state) return state;
  const materials = readObjects_("RawMaterials");
  const batches = readObjects_("Batches");
  state.stock = computeStockView_(materials, batches);
  state.pendingVoidCountForActiveShift = pendingVoidCountForShift_(state.activeShiftId);
  state.sessions = readSessions_();
  state.shifts = readShifts_();
  state.businessDays = readBusinessDays_();
  return state;
}

module.exports = {
  getState_, setState_, withStockView_, computeStockView_,
  readSessions_, appendSessionRow_, readShifts_, readBusinessDays_,
  materialRemaining_, materialReserved_, consumeFifo_, writeBatchesBack_,
  pendingVoidCountForShift_,
};
