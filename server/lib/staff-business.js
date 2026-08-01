const { pushActivity_ } = require("./util");
const { materialRemaining_, materialReserved_, consumeFifo_ } = require("./state");
const { readObjects_ } = require("../db");

function bizSubmitStaffOrder_(state, batches, staffName, items) {
  const trimmedName = (staffName || "").trim();
  if (!trimmedName) return { ok: false, error: "Staff member name is required", state };
  if (!items || items.length === 0) return { ok: false, error: "No items selected", state };

  let totalAmount = 0;
  const orderLines = [];
  for (const req of items) {
    const menuItem = state.menu.find((m) => m.id === req.menuItemId);
    if (!menuItem) return { ok: false, error: "Item not found", state };
    if (!req.qty || req.qty <= 0) return { ok: false, error: "Invalid quantity for " + menuItem.name, state };
    const insufficientIng = menuItem.ingredients.find((ing) => {
      const remaining = materialRemaining_(batches, ing.stockId);
      const reserved = materialReserved_(state.rooms, state.menu, ing.stockId);
      return remaining - reserved - ing.qty * req.qty < -1e-9;
    });
    if (insufficientIng) return { ok: false, error: "Insufficient stock for " + menuItem.name, state };
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
      touchedBatchIds.push(...res.touched);
    });
  });

  const staffOrder = { id: "staff-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7), ts: Date.now(), staffName: trimmedName, items: orderLines, totalAmount, cogs, processedBy: null, shiftId: state.activeShiftId || null };
  pushActivity_(state, "Staff order: " + trimmedName + " — " + totalAmount.toFixed(2) + " EGP (" + orderLines.length + " item(s))");
  return { ok: true, state, touchedBatchIds: Array.from(new Set(touchedBatchIds)), staffOrder };
}

function bizCloseBusinessDay_(state, sessions, shifts, ledger, username) {
  if (!state.businessDayId) return { ok: false, error: "No business day is currently open", state };
  if (state.activeShiftId) return { ok: false, error: "Close the active shift before closing the business day", state };
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
  const totalExpenses = ledger.filter((l) => l.direction === "outflow" && l.status === "approved" && l.ts >= windowStart && l.ts <= now).reduce((a, l) => a + Number(l.amount), 0);
  const netProfit = Math.round((totalRevenue - totalExpenses) * 100) / 100;

  return {
    ok: true, state, businessDayId: bdId,
    updates: {
      closedAt: now, totalRevenue: Math.round(totalRevenue * 100) / 100, totalCash: Math.round(totalCash * 100) / 100,
      totalVisa: Math.round(totalVisa * 100) / 100, totalInstapay: Math.round(totalInstapay * 100) / 100,
      totalExpenses: Math.round(totalExpenses * 100) / 100, netProfit, shiftCount: bdShifts.length, closedBy: username,
    },
    totalRevenue, totalCash, totalVisa, totalInstapay, totalExpenses, netProfit, shiftCount: bdShifts.length,
  };
}

module.exports = { bizSubmitStaffOrder_, bizCloseBusinessDay_ };
