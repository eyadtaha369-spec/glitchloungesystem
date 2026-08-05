const { pushActivity_ } = require("./util");
const { materialRemaining_, materialReserved_, consumeFifo_, restoreFifo_ } = require("./state");

const PAYMENT_METHODS = ["cash", "visa", "mixed_cash_visa", "mixed_cash_instapay"];

function bizSetRoomRate_(state, roomId, singleRate, multiRate) {
  state.rooms = state.rooms.map((r) => (r.id === roomId ? Object.assign({}, r, { singleRate, multiRate }) : r));
  return state;
}

function bizRenameRoom_(state, roomId, name) {
  const trimmed = (name || "").trim();
  if (!trimmed) return { ok: false, error: "Name cannot be empty", state };
  state.rooms = state.rooms.map((r) => (r.id === roomId ? Object.assign({}, r, { name: trimmed }) : r));
  return { ok: true, state };
}

function effectiveDurationSec_(room, atTime) {
  if (!room.startedAt) return 0;
  const raw = (atTime - room.startedAt) / 1000;
  const pausedSoFar = (room.pausedDurationSec || 0) + (room.isPaused && room.pausedAt ? (atTime - room.pausedAt) / 1000 : 0);
  return Math.max(0, raw - pausedSoFar + (room.timeAdjustmentSec || 0));
}

function bizStartRoom_(state, roomId, rateMode) {
  if (!state.activeShiftId) return { ok: false, error: "No active shift — open a shift before starting a room.", state };
  const room = state.rooms.find((r) => r.id === roomId);
  if (!room || room.status === "active") return { ok: true, state };
  let hourlyRate = 0;
  let mode = null;
  if (room.zone === "room") {
    if (rateMode !== "single" && rateMode !== "multi") {
      return { ok: false, error: "Select a Single or Multi rate to start this room.", state };
    }
    hourlyRate = rateMode === "single" ? room.singleRate : room.multiRate;
    mode = rateMode;
  }
  const now = Date.now();
  const waterItem = state.menu.find((m) => m.id === "item-water");
  const initialOrders = waterItem ? [{ menuItemId: waterItem.id, name: waterItem.name, qty: 1, price: waterItem.price }] : [];
  state.rooms = state.rooms.map((r) =>
    r.id === roomId ? Object.assign({}, r, { status: "active", startedAt: now, orders: initialOrders, hourlyRate, rateMode: mode, timeAdjustmentSec: 0, isPaused: false, pausedAt: null, pausedDurationSec: 0 }) : r
  );
  pushActivity_(state, room.name + " session started" + (mode ? " (" + mode + " @ " + hourlyRate + " EGP/hr)" : ""));
  return { ok: true, state };
}

// Once consumption happens immediately at order time (below), nothing
// stays "reserved but not yet consumed" — every active order's
// ingredients are already reflected in materialRemaining_ the moment
// they're added. So this only needs to check what's actually left,
// not track reservations across other active rooms separately.
function bizCanFulfill_(state, batches, menuItemId, addQty) {
  const item = state.menu.find((m) => m.id === menuItemId);
  if (!item) return false;
  return item.ingredients.every((ing) => {
    const remaining = materialRemaining_(batches, ing.stockId);
    return remaining - ing.qty * addQty >= -1e-9;
  });
}

function bizAddOrder_(state, batches, roomId, menuItemId, qty) {
  if (!state.activeShiftId) return { ok: false, error: "No active shift — open a shift before taking orders.", state, touchedBatchIds: [], newBatches: [] };
  const item = state.menu.find((m) => m.id === menuItemId);
  if (!item) return { ok: false, error: "Item not found", state, touchedBatchIds: [], newBatches: [] };
  if (!bizCanFulfill_(state, batches, menuItemId, qty)) {
    return { ok: false, error: "Insufficient stock for " + item.name + "!", state, touchedBatchIds: [], newBatches: [] };
  }
  // Consumed the moment the order is placed — this app's "Print
  // Kitchen" step happens as part of the same add-order action, so
  // this is the point ingredients are actually put to use, not
  // whenever the customer eventually pays.
  let cogsDelta = 0;
  const touchedBatchIds = [];
  item.ingredients.forEach((ing) => {
    const res = consumeFifo_(batches, ing.stockId, ing.qty * qty);
    cogsDelta += res.cost;
    touchedBatchIds.push(...res.touched);
  });
  const room = state.rooms.find((r) => r.id === roomId);
  state.rooms = state.rooms.map((r) => {
    if (r.id !== roomId) return r;
    const existing = r.orders.find((o) => o.menuItemId === menuItemId);
    const newOrders = existing
      ? r.orders.map((o) => (o.menuItemId === menuItemId ? Object.assign({}, o, { qty: o.qty + qty }) : o))
      : r.orders.concat([{ menuItemId, name: item.name, qty, price: item.price }]);
    return Object.assign({}, r, { orders: newOrders, cogsAccrued: (r.cogsAccrued || 0) + cogsDelta });
  });
  pushActivity_(state, (room ? room.name : "Room") + " added " + qty + "x " + item.name);
  return { ok: true, state, touchedBatchIds: Array.from(new Set(touchedBatchIds)), newBatches: [] };
}

function bizSetOrderLineQty_(state, batches, roomId, menuItemId, qty) {
  const room = state.rooms.find((r) => r.id === roomId);
  if (!room) return { ok: false, error: "Room not found", state, touchedBatchIds: [], newBatches: [] };
  const line = room.orders.find((o) => o.menuItemId === menuItemId);
  if (!line) return { ok: false, error: "Item not on this check", state, touchedBatchIds: [], newBatches: [] };
  const item = state.menu.find((m) => m.id === menuItemId);
  const newQty = Math.max(0, Math.floor(qty));
  const delta = newQty - line.qty;
  if (delta > 0 && item && !bizCanFulfill_(state, batches, menuItemId, delta)) {
    return { ok: false, error: "Insufficient stock to increase " + item.name, state, touchedBatchIds: [], newBatches: [] };
  }
  // Ingredients were already consumed when this line was first added
  // (or last increased) — an increase consumes the extra now; a
  // decrease restores exactly the delta being removed, so a mistaken
  // "5x Latte" corrected down to "1x Latte" doesn't leave 4 lattes'
  // worth of milk and coffee silently gone from stock forever.
  let cogsDelta = 0;
  const touchedBatchIds = [];
  const newBatches = [];
  if (item && delta !== 0) {
    const now = Date.now();
    item.ingredients.forEach((ing) => {
      const ingQty = ing.qty * Math.abs(delta);
      if (delta > 0) {
        const res = consumeFifo_(batches, ing.stockId, ingQty);
        cogsDelta += res.cost;
        touchedBatchIds.push(...res.touched);
      } else {
        // state doesn't carry a materials list directly (that's a
        // separate table) — use the most recent batch's cost as a
        // reasonable basis for what's being credited back instead of
        // requiring a lookup that doesn't exist on this object.
        const matBatches = batches.filter((b) => b.materialId === ing.stockId);
        const newest = matBatches.reduce((a, b) => (!a || Number(b.purchasedAt) > Number(a.purchasedAt) ? b : a), null);
        const unitCost = newest ? Number(newest.unitCost) : 0;
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
      : r.orders.map((o) => (o.menuItemId === menuItemId ? Object.assign({}, o, { qty: newQty }) : o));
    return Object.assign({}, r, { orders, cogsAccrued: (r.cogsAccrued || 0) + cogsDelta });
  });
  pushActivity_(state, room.name + ": " + (newQty <= 0 ? "removed " + line.name : "set " + line.name + " to x" + newQty));
  return { ok: true, state, touchedBatchIds: Array.from(new Set(touchedBatchIds)), newBatches };
}

function bizSetOrderLineNote_(state, roomId, menuItemId, notes) {
  const room = state.rooms.find((r) => r.id === roomId);
  if (!room) return { ok: false, error: "Room not found", state };
  const line = room.orders.find((o) => o.menuItemId === menuItemId);
  if (!line) return { ok: false, error: "Item not on this check", state };
  const trimmed = (notes || "").trim();
  state.rooms = state.rooms.map((r) => {
    if (r.id !== roomId) return r;
    return Object.assign({}, r, { orders: r.orders.map((o) => (o.menuItemId === menuItemId ? Object.assign({}, o, { notes: trimmed }) : o)) });
  });
  return { ok: true, state };
}

function bizExtendRoomTime_(state, roomId, deltaSec) {
  const room = state.rooms.find((r) => r.id === roomId);
  if (!room) return { ok: false, error: "Room not found", state };
  if (room.zone !== "room") return { ok: false, error: "Time extension only applies to timed rooms", state };
  if (room.status !== "active") return { ok: false, error: "Room is not active", state };
  const delta = Math.round(Number(deltaSec) || 0);
  if (delta <= 0) return { ok: false, error: "Time can only be extended, never reduced — enter a positive amount.", state };
  state.rooms = state.rooms.map((r) => (r.id === roomId ? Object.assign({}, r, { timeAdjustmentSec: (r.timeAdjustmentSec || 0) + delta }) : r));
  const mins = Math.round(delta / 60);
  pushActivity_(state, room.name + " time extended by +" + mins + " min" + (mins === 1 ? "" : "s"));
  return { ok: true, state };
}

function bizPauseRoom_(state, roomId) {
  const room = state.rooms.find((r) => r.id === roomId);
  if (!room) return { ok: false, error: "Room not found", state };
  if (room.status !== "active") return { ok: false, error: "Room is not active", state };
  if (room.isPaused) return { ok: true, state };
  state.rooms = state.rooms.map((r) => (r.id === roomId ? Object.assign({}, r, { isPaused: true, pausedAt: Date.now() }) : r));
  pushActivity_(state, room.name + " session paused");
  return { ok: true, state };
}

function bizResumeRoom_(state, roomId) {
  const room = state.rooms.find((r) => r.id === roomId);
  if (!room) return { ok: false, error: "Room not found", state };
  if (!room.isPaused) return { ok: true, state };
  const now = Date.now();
  const addedPause = room.pausedAt ? (now - room.pausedAt) / 1000 : 0;
  state.rooms = state.rooms.map((r) =>
    r.id === roomId ? Object.assign({}, r, { isPaused: false, pausedAt: null, pausedDurationSec: (r.pausedDurationSec || 0) + addedPause }) : r
  );
  pushActivity_(state, room.name + " session resumed");
  return { ok: true, state };
}

// Computes ONE discount amount server-side from a type+value pair —
// never trust a client-computed discount amount directly (same lesson
// as the earlier setAbsoluteStock fix: the server must be the one doing
// the math, from raw inputs, every time). Capped to [0, base] so a
// mistyped value can never create a negative total or exceed the
// portion it's discounting.
function computeDiscount_(base, type, value) {
  const v = Number(value) || 0;
  if (!type || v <= 0) return 0;
  const amt = type === "percent" ? base * (v / 100) : v;
  return Math.round(Math.max(0, Math.min(amt, base)) * 100) / 100;
}

function bizEndRoom_(state, batches, roomId, splitBill, paymentMethod, cashAmountInput, secondaryAmountInput, frozenAt, discountInput) {
  const room = state.rooms.find((r) => r.id === roomId);
  if (!room || room.status !== "active" || !room.startedAt) return { session: null, state, touchedBatchIds: [], error: null };
  const now = Date.now();
  const endedAt = (typeof frozenAt === "number" && frozenAt >= room.startedAt && frozenAt <= now) ? frozenAt : now;
  const durationSec = Math.max(1, Math.floor(effectiveDurationSec_(room, endedAt)));
  const timeCost = (durationSec / 3600) * room.hourlyRate;
  const ordersCost = room.orders.reduce((a, o) => a + o.qty * o.price, 0);
  const preDiscountTotal = timeCost + ordersCost;

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
    // Unchanged fallback — manual entry takes precedence when given,
    // but existing owner-table behavior is untouched otherwise.
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
    const c = Number(cashAmountInput) || 0;
    const s = Number(secondaryAmountInput) || 0;
    if (s > total + 0.01) {
      return { session: null, state, touchedBatchIds: [], error: (method === "mixed_cash_visa" ? "Visa" : "InstaPay") + " amount (" + s.toFixed(2) + " EGP) can't exceed the ticket total (" + total.toFixed(2) + " EGP)." };
    }
    if (Math.abs(c + s - total) > 0.01) {
      return { session: null, state, touchedBatchIds: [], error: "Cash + " + (method === "mixed_cash_visa" ? "Visa" : "InstaPay") + " must equal the ticket total (" + total.toFixed(2) + " EGP). You entered " + (c + s).toFixed(2) + " EGP." };
    }
    cashAmount = c;
    if (method === "mixed_cash_visa") visaAmount = s; else instapayAmount = s;
  }

  // Ingredients were already consumed as each order line was added
  // (or increased) — NOT re-consumed here. cogsAccrued is the running
  // total built up across every add/increase/decrease on this room
  // since it started, kept in exact sync with the actual FIFO
  // consumption that already happened.
  const cogs = room.cogsAccrued || 0;
  const touchedBatchIds = [];

  state.orderCounter = (state.orderCounter || 0) + 1;
  const session = {
    id: "sess-" + endedAt, orderNumber: state.orderCounter, roomId: room.id, roomName: room.name,
    startedAt: room.startedAt, endedAt, durationSec, timeCost, orders: room.orders, ordersCost, total, cogs,
    discountAmount, discountLabel, timeDiscountAmount, timeDiscountLabel, ordersDiscountAmount, ordersDiscountLabel,
    splitBill: !!splitBill, paymentMethod: method,
    cashAmount, visaAmount, instapayAmount, shiftId: state.activeShiftId || null,
  };
  state.rooms = state.rooms.map((r) => (r.id === roomId ? Object.assign({}, r, { status: "available", startedAt: null, orders: [], cogsAccrued: 0 }) : r));
  const paymentLabel = method === "mixed_cash_visa" ? "Cash " + cashAmount.toFixed(2) + " EGP + Visa " + visaAmount.toFixed(2) + " EGP"
    : method === "mixed_cash_instapay" ? "Cash " + cashAmount.toFixed(2) + " EGP + InstaPay " + instapayAmount.toFixed(2) + " EGP"
    : method;
  pushActivity_(state, room.name + " checked out - " + total.toFixed(2) + " EGP collected (" + paymentLabel + ")");
  return { session, state, touchedBatchIds: Array.from(new Set(touchedBatchIds)), error: null };
}

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
  if (!room || room.zone !== "waste") return { ok: false, error: "This is only for the Wasted/Marketing table", state };
  if (room.orders.length === 0) return { ok: false, error: "Nothing on the Wasted/Marketing table to log", state };
  if (!WASTE_MARKETING_REASONS[reason]) return { ok: false, error: "Select a reason for this waste/marketing entry.", state };

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
        touchedBatchIds.push(...res.touched);
      });
    }
  });

  state.rooms = state.rooms.map((r) => (r.id === roomId ? Object.assign({}, r, { orders: [] }) : r));
  pushActivity_(state, "Logged " + loggedItems.length + " item(s) as Wasted/Marketing (" + WASTE_MARKETING_REASONS[reason] + ") — " + cogs.toFixed(2) + " EGP ingredient cost");
  return { ok: true, state, touchedBatchIds: Array.from(new Set(touchedBatchIds)), cogs, retailValue, items: loggedItems, reason, reasonLabel: WASTE_MARKETING_REASONS[reason], note: note || "" };
}

module.exports = {
  PAYMENT_METHODS, effectiveDurationSec_, bizSetRoomRate_, bizRenameRoom_, bizStartRoom_, bizCanFulfill_, bizAddOrder_,
  bizSetOrderLineQty_, bizSetOrderLineNote_, bizExtendRoomTime_, bizPauseRoom_, bizResumeRoom_, bizLogWasteMarketing_, bizEndRoom_,
  WASTE_MARKETING_REASONS, computeDiscount_,
};
