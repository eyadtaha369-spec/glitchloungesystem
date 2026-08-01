const { appendObject_, updateObjectById_ } = require("../db");
const { pushActivity_ } = require("./util");

function formatDateLabel_(ts) {
  const d = new Date(ts);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function bizOpenShift_(state, username, openingBalance, lat, lng) {
  if (state.activeShiftId) return { ok: false, error: "A shift is already open", state };
  const now = Date.now();
  if (!state.businessDayId) {
    const bdId = "bday-" + now;
    appendObject_("BusinessDays", {
      id: bdId, label: formatDateLabel_(now), openedAt: now, closedAt: null,
      totalRevenue: 0, totalCash: 0, totalVisa: 0, totalInstapay: 0, totalExpenses: 0, netProfit: 0,
      shiftCount: 0, closedBy: null,
    });
    state.businessDayId = bdId;
    pushActivity_(state, "New business day opened (" + formatDateLabel_(now) + ")");
  }
  const id = "shift-" + now;
  const shift = {
    id, cashierUsername: username, openedAt: now, closedAt: null,
    openingBalance: openingBalance || 0, closingActualCash: null, expectedCash: null, discrepancy: null,
    forced: false, openedLat: typeof lat === "number" ? lat : null, openedLng: typeof lng === "number" ? lng : null,
    closedLat: null, closedLng: null, businessDayId: state.businessDayId, kotCounter: 0,
  };
  appendObject_("Shifts", shift);
  state.activeShiftId = id;
  state.actualCashInput = 0;
  pushActivity_(state, username + " opened a shift (opening balance " + (openingBalance || 0).toFixed(2) + " EGP)");
  return { ok: true, state };
}

function bizCloseActiveShift_(state, sessions, ledger, shifts, actualCash, forced, lat, lng) {
  if (!state.activeShiftId) return { ok: false, error: "No active shift to close", state };
  const shiftId = state.activeShiftId;
  const shift = shifts.find((sh) => sh.id === shiftId);
  const shiftSessions = sessions.filter((s) => s.shiftId === shiftId);
  const cashSales = shiftSessions.reduce((a, s) => a + (Number(s.cashAmount) || 0), 0);
  const drawerExpenses = ledger
    .filter((l) => l.shiftId === shiftId && l.status === "approved" && l.paidFromDrawer && l.direction === "outflow")
    .reduce((a, l) => a + Number(l.amount), 0);
  const expectedCash = (shift ? shift.openingBalance : 0) + cashSales - drawerExpenses;
  const closingActualCash = typeof actualCash === "number" ? actualCash : (state.actualCashInput || 0);
  const discrepancy = closingActualCash - expectedCash;

  updateObjectById_("Shifts", shiftId, {
    closedAt: Date.now(), closingActualCash, expectedCash, discrepancy, forced: !!forced,
    closedLat: typeof lat === "number" ? lat : null, closedLng: typeof lng === "number" ? lng : null,
  });
  state.activeShiftId = null;
  state.actualCashInput = 0;
  pushActivity_(state, (forced ? "Admin force-closed shift" : "Shift closed") + " — expected " + expectedCash.toFixed(2) + " EGP, counted " + closingActualCash.toFixed(2) + " EGP");
  return { ok: true, state, closedShift: { id: shiftId, expectedCash, closingActualCash, discrepancy } };
}

module.exports = { formatDateLabel_, bizOpenShift_, bizCloseActiveShift_ };
