const { appendObject_, updateObjectById_ } = require("../db");
const { pushActivity_ } = require("./util");

function formatDateLabel_(ts) {
  const d = new Date(ts);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

// Finds every completed session and every drawer expense that was
// recorded with no shift attached at all (shiftId null/undefined) --
// this can only happen when a checkout or expense was submitted while
// no shift was open. Cashiers can never reach any POS screen without
// an active shift (the Gatekeeper blocks them), but an admin is
// exempt from that check, so this is a real, if narrow, gap: an admin
// checking out a room with no shift open leaves that revenue
// permanently excluded from every shift-scoped total forever, since
// nothing else ever revisits it. Read-only — never mutates anything,
// so this is safe to call just to check whether anything needs
// attention (e.g. right after a new shift opens).
function bizFindOrphanedSessions_(sessions, ledger) {
  const orphanedSessions = sessions.filter((s) => !s.shiftId);
  const orphanedExpenses = ledger.filter((l) => !l.shiftId && l.direction === "outflow" && l.paidFromDrawer && l.status === "approved");
  const sessionsTotal = orphanedSessions.reduce((a, s) => a + (Number(s.total) || 0), 0);
  const expensesTotal = orphanedExpenses.reduce((a, l) => a + (Number(l.amount) || 0), 0);
  return { orphanedSessions, orphanedExpenses, sessionsTotal, expensesTotal, count: orphanedSessions.length + orphanedExpenses.length };
}

// Actually reassigns every orphaned session/expense found above to the
// given shift. Idempotent — running it again with nothing orphaned
// left just does nothing rather than erroring.
function bizAttachOrphanedToShift_(sessions, ledger, targetShiftId) {
  const found = bizFindOrphanedSessions_(sessions, ledger);
  found.orphanedSessions.forEach((s) => updateObjectById_("Sessions", s.id, { shiftId: targetShiftId }));
  found.orphanedExpenses.forEach((l) => updateObjectById_("Ledger", l.id, { shiftId: targetShiftId }));
  return found;
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

// Re-runs the exact same expected-cash formula bizCloseActiveShift_
// uses, against a shift that's already closed, and overwrites its
// stored expectedCash/discrepancy with the freshly computed result.
// closingActualCash (what was physically counted at the time) is
// deliberately left untouched — that's a historical fact about what
// someone actually counted, not something to recompute. Exists purely
// as a manual correction tool for when underlying data changes after
// a shift closed (e.g. a debt settlement's shiftId being fixed) and
// the stored numbers need to catch up to reflect the truth. Every
// caller must be admin-only and log a proper before/after audit
// entry, since this rewrites financial history.
function bizRecalculateClosedShift_(sessions, ledger, shift) {
  if (!shift) return { ok: false, error: "Shift not found." };
  if (!shift.closedAt) return { ok: false, error: "This shift is still active — use End Shift instead, not this tool." };
  const shiftSessions = sessions.filter((s) => s.shiftId === shift.id);
  const cashSales = shiftSessions.reduce((a, s) => a + (Number(s.cashAmount) || 0), 0);
  const drawerExpenses = ledger
    .filter((l) => l.shiftId === shift.id && l.status === "approved" && l.paidFromDrawer && l.direction === "outflow")
    .reduce((a, l) => a + Number(l.amount), 0);
  const newExpectedCash = shift.openingBalance + cashSales - drawerExpenses;
  const actualCash = Number(shift.closingActualCash) || 0;
  const newDiscrepancy = actualCash - newExpectedCash;
  return {
    ok: true,
    before: { expectedCash: shift.expectedCash, discrepancy: shift.discrepancy },
    after: { expectedCash: newExpectedCash, discrepancy: newDiscrepancy },
  };
}

module.exports = { formatDateLabel_, bizOpenShift_, bizCloseActiveShift_, bizRecalculateClosedShift_, bizFindOrphanedSessions_, bizAttachOrphanedToShift_ };
