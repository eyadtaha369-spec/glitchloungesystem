const { pushActivity_ } = require("./util");
const { consumeFifo_ } = require("./state");
const { effectiveDurationSec_, PAYMENT_METHODS } = require("./rooms");

function bizTransferZone_(state, sourceId, targetId, rateMode) {
  const source = state.rooms.find((r) => r.id === sourceId);
  if (!source) return { ok: false, error: "Source not found", state };
  if (source.zone === "split") return { ok: false, error: "Cannot transfer a split invoice — check it out independently instead.", state };
  if (source.status !== "active") return { ok: false, error: "Source is not active", state };
  const target = state.rooms.find((r) => r.id === targetId);
  if (!target) return { ok: false, error: "Target not found", state };
  if (target.id === source.id) return { ok: false, error: "Source and target must be different", state };
  if (target.zone === "split") return { ok: false, error: "Cannot transfer into a split invoice", state };
  if (target.zone === "room" && target.status === "active") return { ok: false, error: target.name + " already has an active session", state };
  if (target.zone === "room" && rateMode !== "single" && rateMode !== "multi") return { ok: false, error: "Select a Single or Multi rate to start " + target.name, state };

  const now = Date.now();
  let durationSec = 0;
  let roomCharge = 0;
  if (source.zone === "room" && source.startedAt) {
    durationSec = Math.max(1, Math.floor(effectiveDurationSec_(source, now)));
    roomCharge = (durationSec / 3600) * source.hourlyRate;
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
        const rate = rateMode === "single" ? r.singleRate : r.multiRate;
        Object.assign(patch, { status: "active", startedAt: now, hourlyRate: rate, rateMode });
      } else {
        Object.assign(patch, { status: "active", startedAt: r.startedAt || now });
      }
      return Object.assign({}, r, patch);
    }
    return r;
  });

  pushActivity_(state, source.name + " transferred to " + target.name + (roomCharge > 0 ? " (" + roomCharge.toFixed(2) + " EGP room charge)" : "") + (target.zone === "room" ? " — started " + rateMode : ""));
  return { ok: true, state, roomCharge, roomName: source.name, tableName: target.name, durationSec, targetZone: target.zone };
}

function bizSplitBill_(state, batches, roomId, mode, items, customAmount, paymentMethod, cashAmountInput, secondaryAmountInput) {
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
      const line = room.orders.find((o) => o.menuItemId === req.menuItemId);
      if (!line || line.qty < req.qty || req.qty <= 0) return { ok: false, error: "Invalid item/qty to split", state };
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
          touchedBatchIds.push(...res.touched);
        });
      }
    });
    state.rooms = state.rooms.map((r) => {
      if (r.id !== roomId) return r;
      const orders = r.orders.map((o) => {
        const ex = items.find((i) => i.menuItemId === o.menuItemId);
        if (!ex) return o;
        const newQty = o.qty - ex.qty;
        return newQty <= 0 ? null : Object.assign({}, o, { qty: newQty });
      }).filter((o) => o !== null);
      return Object.assign({}, r, { orders });
    });
  } else if (mode === "amount") {
    const amt = Number(customAmount) || 0;
    if (amt <= 0) return { ok: false, error: "Enter a valid split amount", state };
    const durationSec = room.startedAt ? Math.max(1, Math.floor(effectiveDurationSec_(room, Date.now()))) : 0;
    const timeCostNow = room.hourlyRate ? (durationSec / 3600) * room.hourlyRate : 0;
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
