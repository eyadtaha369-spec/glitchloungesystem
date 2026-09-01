const { pushActivity_ } = require("./util");
const { consumeFifo_ } = require("./state");
const { effectiveDurationSec_, PAYMENT_METHODS, computeDiscount_, computeTimeCost_ } = require("./rooms");

function bizTransferZone_(state, sourceId, targetId, rateMode) {
  const source = state.rooms.find((r) => r.id === sourceId);
  if (!source) return { ok: false, error: "Source not found", state };
  if (source.zone === "split") return { ok: false, error: "Cannot transfer a split invoice — check it out independently instead.", state };
  if (source.status !== "active") return { ok: false, error: "Source is not active", state };
  const target = state.rooms.find((r) => r.id === targetId);
  if (!target) return { ok: false, error: "Target not found", state };
  if (target.id === source.id) return { ok: false, error: "Source and target must be different", state };
  if (target.zone === "split") return { ok: false, error: "Cannot transfer into a split invoice", state };
  const targetAlreadyActive = target.status === "active";
  if (target.zone === "room" && !targetAlreadyActive && rateMode !== "single" && rateMode !== "multi") return { ok: false, error: "Select a Single or Multi rate to start " + target.name, state };

  const now = Date.now();
  let durationSec = 0;
  let roomCharge = 0;
  if (source.zone === "room" && source.startedAt) {
    durationSec = Math.max(1, Math.floor(effectiveDurationSec_(source, now)));
    roomCharge = computeTimeCost_(source, durationSec);
  }

  state.rooms = state.rooms.map((r) => {
    if (r.id === sourceId) {
      return Object.assign({}, r, { status: "available", startedAt: null, orders: [], hourlyRate: 0, rateMode: r.zone === "room" ? null : r.rateMode });
    }
    if (r.id === targetId) {
      let orders = r.orders.slice();
      if (roomCharge > 0) {
        orders = orders.concat([{ menuItemId: "transfer-charge-" + source.id + "-" + now, name: "Room Charge (" + source.name + ")", qty: 1, price: roomCharge }]);
      }
      source.orders.forEach((o) => {
        const existing = orders.find((x) => x.menuItemId === o.menuItemId);
        orders = existing
          ? orders.map((x) => (x.menuItemId === o.menuItemId ? Object.assign({}, x, { qty: x.qty + o.qty }) : x))
          : orders.concat([o]);
      });
      const patch = { orders, transferredFrom: source.name };
      if (r.zone === "room") {
        if (targetAlreadyActive) {
          // Merging into a room that's already running its own timer —
          // that timer, its rate, and any frozen segments continue
          // completely untouched. Only the orders and a frozen charge
          // for the SOURCE's time get folded in, same principle as
          // merging into an available room, just without resetting
          // anything the target already had running.
        } else {
          const rate = rateMode === "single" ? r.singleRate : r.multiRate;
          Object.assign(patch, { status: "active", startedAt: now, hourlyRate: rate, rateMode, rateSegments: [] });
        }
      } else {
        Object.assign(patch, { status: "active", startedAt: r.startedAt || now });
      }
      return Object.assign({}, r, patch);
    }
    return r;
  });

  pushActivity_(state, source.name + " transferred to " + target.name + (roomCharge > 0 ? " (" + roomCharge.toFixed(2) + " EGP room charge)" : "") + (target.zone === "room" ? (targetAlreadyActive ? " — merged into its running session" : " — started " + rateMode) : ""));
  return { ok: true, state, roomCharge, roomName: source.name, tableName: target.name, durationSec, targetZone: target.zone };
}

function bizSplitBill_(state, batches, roomId, mode, items, customAmount, paymentMethod, cashAmountInput, secondaryAmountInput, discountInput) {
  const room = state.rooms.find((r) => r.id === roomId);
  if (!room) return { ok: false, error: "Table/Room not found", state };
  if (room.status !== "active") return { ok: false, error: "Table/Room is not active", state };

  const method = PAYMENT_METHODS.indexOf(paymentMethod) === -1 ? "cash" : paymentMethod;
  let splitOrders = [];
  let splitTotal = 0;
  let cogs = 0;
  const touchedBatchIds = [];

  if (mode === "items") {
    if (!items || items.length === 0) return { ok: false, error: "No items selected to split", state };
    for (const req of items) {
      const reqQty = Number(req.qty);
      const line = room.orders.find((o) => o.menuItemId === req.menuItemId);
      if (!line) {
        return { ok: false, error: "\"" + req.menuItemId + "\" is not on this table's current bill (it may have been removed or already checked out).", state };
      }
      if (isNaN(reqQty) || reqQty <= 0) {
        return { ok: false, error: "Invalid quantity (" + req.qty + ") for \"" + line.name + "\".", state };
      }
      if (Number(line.qty) < reqQty) {
        return { ok: false, error: "Only " + line.qty + "x \"" + line.name + "\" is on the bill, can't split " + reqQty + "x.", state };
      }
    }
    items.forEach((req) => {
      const reqQty = Number(req.qty);
      const line = room.orders.find((o) => o.menuItemId === req.menuItemId);
      splitOrders.push(Object.assign({}, line, { qty: reqQty }));
      splitTotal += reqQty * line.price;
      // Ingredients were already consumed when this item was originally
      // ordered — NOT consumed again here (that would double-deduct).
      // Just compute what portion of the room's already-accrued cost
      // belongs to what's being split off, using the same "latest batch
      // cost" estimate as everywhere else, so it can be carved out of
      // cogsAccrued and correctly attributed to this split session
      // instead of double-counted when the rest of the room checks out.
      const menuItem = state.menu.find((m) => m.id === req.menuItemId);
      if (menuItem) {
        menuItem.ingredients.forEach((ing) => {
          const ingQty = ing.qty * reqQty;
          const matBatches = batches.filter((b) => b.materialId === ing.stockId);
          const newest = matBatches.reduce((a, b) => (!a || Number(b.purchasedAt) > Number(a.purchasedAt) ? b : a), null);
          const unitCost = newest ? Number(newest.unitCost) : 0;
          cogs += ingQty * unitCost;
        });
      }
    });
    state.rooms = state.rooms.map((r) => {
      if (r.id !== roomId) return r;
      const orders = r.orders.map((o) => {
        const ex = items.find((i) => i.menuItemId === o.menuItemId);
        if (!ex) return o;
        const newQty = o.qty - Number(ex.qty);
        return newQty <= 0 ? null : Object.assign({}, o, { qty: newQty });
      }).filter((o) => o !== null);
      return Object.assign({}, r, { orders, cogsAccrued: (r.cogsAccrued || 0) - cogs });
    });
  } else if (mode === "amount") {
    const amt = Number(customAmount) || 0;
    if (amt <= 0) return { ok: false, error: "Enter a valid split amount", state };
    const durationSec = room.startedAt ? Math.max(1, Math.floor(effectiveDurationSec_(room, Date.now()))) : 0;
    const timeCostNow = room.hourlyRate ? computeTimeCost_(room, durationSec) : 0;
    const ordersCostNow = room.orders.reduce((a, o) => a + o.qty * o.price, 0);
    const currentTotal = timeCostNow + ordersCostNow;
    if (amt > currentTotal + 0.01) {
      return { ok: false, error: "Split amount (" + amt.toFixed(2) + " EGP) exceeds the remaining balance (" + currentTotal.toFixed(2) + " EGP)", state };
    }
    splitTotal = amt;
    splitOrders = [{ menuItemId: "partial-payment", name: "Partial Payment", qty: 1, price: amt }];
    state.rooms = state.rooms.map((r) =>
      r.id === roomId
        ? Object.assign({}, r, { orders: r.orders.concat([{ menuItemId: "split-credit-" + Date.now(), name: "Partial Payment Applied", qty: 1, price: -amt }]) })
        : r
    );
  } else {
    return { ok: false, error: "Invalid split mode", state };
  }

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
      return { ok: false, error: (method === "mixed_cash_visa" ? "Visa" : "InstaPay") + " amount (" + s.toFixed(2) + " EGP) can't exceed the sub-bill total (" + splitTotal.toFixed(2) + " EGP).", state };
    }
    if (Math.abs(c + s - splitTotal) > 0.01) {
      return { ok: false, error: "Cash + " + (method === "mixed_cash_visa" ? "Visa" : "InstaPay") + " must equal the split total (" + splitTotal.toFixed(2) + " EGP).", state };
    }
    cashAmount = c;
    if (method === "mixed_cash_visa") visaAmount = s; else instapayAmount = s;
  }

  const now = Date.now();
  state.orderCounter = (state.orderCounter || 0) + 1;
  const splitSession = {
    id: "split-" + now, orderNumber: state.orderCounter, roomId: room.id, roomName: room.name + " (Split)",
    startedAt: now, endedAt: now, durationSec: 0, timeCost: 0, orders: splitOrders,
    ordersCost: preDiscountSplitTotal, total: splitTotal, cogs, discountAmount, discountLabel,
    splitBill: true, paymentMethod: method, cashAmount, visaAmount, instapayAmount, shiftId: state.activeShiftId || null,
  };

  pushActivity_(state, "Split payment of " + splitTotal.toFixed(2) + " EGP taken on " + room.name + " (" + method + ")");
  return { ok: true, state, touchedBatchIds: Array.from(new Set(touchedBatchIds)), splitSession };
}

module.exports = { bizTransferZone_, bizSplitBill_ };
