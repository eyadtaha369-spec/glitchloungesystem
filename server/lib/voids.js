const { pushActivity_ } = require("./util");
const { consumeFifo_ } = require("./state");
const { login_ } = require("./auth");

const VOID_REASONS = {
  wrongInput: { label: "Wrong Input (Before Preparation)", deductsInventory: false, ledgerCategory: null },
  spilled: { label: "Spilled / Damaged by Staff", deductsInventory: true, ledgerCategory: "Operational Waste / Damaged Goods" },
  customerRejected: { label: "Customer Rejected (Taste/Quality)", deductsInventory: true, ledgerCategory: "Customer Satisfaction Waste" },
  complimentary: { label: "Complimentary / VIP Gift (Free)", deductsInventory: true, ledgerCategory: "Marketing & Hospitality (Comps)" },
};

// Actually executes a void: reduces/removes the qty on the room's LIVE
// order, and — if the reason requires it — consumes ingredients via FIFO
// right now, since they were physically used making the item.
function applyVoid_(state, batches, req) {
  const room = state.rooms.find((r) => r.id === req.roomId);
  if (!room) return { ok: false, error: "Room not found", state, touchedBatchIds: [] };
  const line = room.orders.find((o) => o.menuItemId === req.menuItemId);
  if (!line || line.qty < req.qty) {
    return { ok: false, error: "Item is no longer on the order as requested (checked out or already modified)", state, touchedBatchIds: [] };
  }

  state.rooms = state.rooms.map((r) => {
    if (r.id !== req.roomId) return r;
    const newQty = line.qty - req.qty;
    const orders = newQty <= 0
      ? r.orders.filter((o) => o.menuItemId !== req.menuItemId)
      : r.orders.map((o) => (o.menuItemId === req.menuItemId ? Object.assign({}, o, { qty: newQty }) : o));
    return Object.assign({}, r, { orders });
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
        touchedBatchIds.push(...res.touched);
      });
    }
  }

  pushActivity_(state, "VOID (" + (reasonCfg ? reasonCfg.label : req.reason) + "): " + req.qty + "x " + req.itemName + " — " + room.name);
  return { ok: true, state, cogs, touchedBatchIds: Array.from(new Set(touchedBatchIds)) };
}

module.exports = { VOID_REASONS, applyVoid_, login_ };
