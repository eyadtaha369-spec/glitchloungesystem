const { pushActivity_ } = require("./util");
const { consumeFifo_, restoreFifo_ } = require("./state");
const { login_ } = require("./auth");

const VOID_REASONS = {
  wrongInput: { label: "Wrong Input (Before Preparation)", deductsInventory: false, ledgerCategory: null },
  spilled: { label: "Spilled / Damaged by Staff", deductsInventory: true, ledgerCategory: "Operational Waste / Damaged Goods" },
  customerRejected: { label: "Customer Rejected (Taste/Quality)", deductsInventory: true, ledgerCategory: "Customer Satisfaction Waste" },
  complimentary: { label: "Complimentary / VIP Gift (Free)", deductsInventory: true, ledgerCategory: "Marketing & Hospitality (Comps)" },
};

// Ingredients are now consumed the moment an order is placed (not at
// checkout), so by the time a void happens, they're ALREADY gone from
// stock either way. What differs by reason is whether to RESTORE that
// stock: wrongInput means it was caught before anything was actually
// made, so the ingredients were never really used — give them back.
// The other three reasons mean the item genuinely was made (spilled,
// rejected after tasting, or comped) — the ingredients really were
// used, so stock correctly stays consumed, same net effect as before
// just reached by not restoring rather than by consuming now.
function applyVoid_(state, batches, req) {
  const room = state.rooms.find((r) => r.id === req.roomId);
  if (!room) return { ok: false, error: "Room not found", state, touchedBatchIds: [], newBatches: [] };
  const line = room.orders.find((o) => o.menuItemId === req.menuItemId);
  if (!line || line.qty < req.qty) {
    return { ok: false, error: "Item is no longer on the order as requested (checked out or already modified)", state, touchedBatchIds: [], newBatches: [] };
  }

  const reasonCfg = VOID_REASONS[req.reason];
  let cogsDelta = 0;
  let reportedWasteCost = 0;
  const touchedBatchIds = [];
  const newBatches = [];
  const item = state.menu.find((m) => m.id === req.menuItemId);
  if (reasonCfg && !reasonCfg.deductsInventory) {
    // wrongInput — nothing was really made, give the stock back.
    if (item) {
      const now = Date.now();
      item.ingredients.forEach((ing) => {
        const ingQty = ing.qty * req.qty;
        const matBatches = batches.filter((b) => b.materialId === ing.stockId);
        const newest = matBatches.reduce((a, b) => (!a || Number(b.purchasedAt) > Number(a.purchasedAt) ? b : a), null);
        const unitCost = newest ? Number(newest.unitCost) : 0;
        const res = restoreFifo_(batches, ing.stockId, ingQty, unitCost, now, "voidRestore");
        cogsDelta -= ingQty * unitCost;
        if (res.newBatch) newBatches.push(res.newBatch);
      });
    }
  } else if (reasonCfg && reasonCfg.deductsInventory && item) {
    // spilled / customerRejected / complimentary — the item genuinely
    // was made, so stock correctly stays consumed (no restore, no
    // batch changes at all here) — but the waste report still needs
    // the cost figure, computed the same way without touching batches.
    item.ingredients.forEach((ing) => {
      const ingQty = ing.qty * req.qty;
      const matBatches = batches.filter((b) => b.materialId === ing.stockId);
      const newest = matBatches.reduce((a, b) => (!a || Number(b.purchasedAt) > Number(a.purchasedAt) ? b : a), null);
      const unitCost = newest ? Number(newest.unitCost) : 0;
      reportedWasteCost += ingQty * unitCost;
    });
  }

  state.rooms = state.rooms.map((r) => {
    if (r.id !== req.roomId) return r;
    const newQty = line.qty - req.qty;
    const orders = newQty <= 0
      ? r.orders.filter((o) => o.menuItemId !== req.menuItemId)
      : r.orders.map((o) => (o.menuItemId === req.menuItemId ? Object.assign({}, o, { qty: newQty }) : o));
    return Object.assign({}, r, { orders, cogsAccrued: (r.cogsAccrued || 0) + cogsDelta });
  });

  pushActivity_(state, "VOID (" + (reasonCfg ? reasonCfg.label : req.reason) + "): " + req.qty + "x " + req.itemName + " — " + room.name);
  return { ok: true, state, cogs: reportedWasteCost > 0 ? reportedWasteCost : -cogsDelta, touchedBatchIds: Array.from(new Set(touchedBatchIds)), newBatches };
}

module.exports = { VOID_REASONS, applyVoid_, login_ };
