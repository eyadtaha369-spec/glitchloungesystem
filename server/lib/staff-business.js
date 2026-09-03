const { pushActivity_, newId_ } = require("./util");
const { materialRemaining_, materialReserved_, consumeFifo_ } = require("./state");
const { readObjects_, appendObject_, updateObjectById_ } = require("../db");

// Exact-name match, case-insensitive — matches this app's standard
// default menu items (see menuResetItems_ / Code.gs). If a café has
// renamed or removed these items, the allowance simply never
// triggers — a safe, silent no-op rather than a crash.
const TEA_ALLOWANCE_NAME = "classic tea";
const COFFEE_ALLOWANCE_NAME = "turkish coffee";

function bizSubmitStaffOrder_(state, batches, staffId, staffName, items) {
  const trimmedName = (staffName || "").trim();
  if (!trimmedName) return { ok: false, error: "Staff member name is required", state };
  if (!items || items.length === 0) return { ok: false, error: "No items selected", state };

  // Allowance tracking needs a shift to scope itself to — with no
  // active shift, every item is simply full price (no allowance to
  // claim or persist against).
  let usage = null;
  if (staffId && state.activeShiftId) {
    usage = readObjects_("StaffAllowanceUsage").find((u) => u.shiftId === state.activeShiftId && u.staffId === staffId) || null;
  }
  let teaClaimed = usage ? !!usage.teaClaimed : false;
  let coffeeClaimed = usage ? !!usage.coffeeClaimed : false;
  const usageChanges = {};

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

    // Inventory below is driven by req.qty as a whole (both lines
    // together, when split), NOT by whichever price applies — the free
    // allowance never changes what's actually deducted from stock.
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
      touchedBatchIds.push(...res.touched);
    });
  });

  // Persist the claim only after everything above has succeeded —
  // never mark an allowance used for an order that got rejected partway.
  if (Object.keys(usageChanges).length > 0) {
    if (usage) {
      updateObjectById_("StaffAllowanceUsage", usage.id, usageChanges);
    } else {
      appendObject_("StaffAllowanceUsage", {
        id: newId_("salw"), shiftId: state.activeShiftId, staffId,
        teaClaimed: !!usageChanges.teaClaimed, coffeeClaimed: !!usageChanges.coffeeClaimed,
      });
    }
  }

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
