const { formatDateLabel_ } = require("./shifts");

// Scoped to the ACTIVE SHIFT, not the calendar day — per explicit
// confirmed decision, a "Business Day" here is defined strictly by a
// shift's own lifecycle (open to close), completely ignoring calendar
// dates and midnight. A shift running from Tuesday 6pm to Wednesday
// 5am is ONE business day, and this aggregates ALL of its transactions
// together regardless of which calendar date they technically fall on.
//
// InstaPay and Visa are DELIBERATELY NOT computed here — the admin
// enters both by hand (same as Actual Physical Cash Counted), since
// the source of truth for those totals is the bank/payment app
// statements, not necessarily what got typed into the till at checkout
// time. Only Total Revenue and this shift's approved drawer expenses
// are auto-calculated from the app's own records.
function bizComputeShiftFinancials_(sessions, ledger, shiftId) {
  if (!shiftId) return { shiftId: null, totalRevenue: 0, expensesTotal: 0 };
  const shiftSessions = sessions.filter((s) => s.shiftId === shiftId);
  const totalRevenue = shiftSessions.reduce((a, s) => a + (Number(s.total) || 0), 0);
  const expensesTotal = ledger
    .filter((l) => l.status === "approved" && l.paidFromDrawer && l.direction === "outflow" && l.shiftId === shiftId)
    .reduce((a, l) => a + (Number(l.amount) || 0), 0);
  return { shiftId, totalRevenue, expensesTotal };
}

function bizBuildShiftReconciliation_(sessions, ledger, shiftId, actualCash, instapayTotal, visaTotal, recordedBy) {
  const financials = bizComputeShiftFinancials_(sessions, ledger, shiftId);
  const instapay = Number(instapayTotal) || 0;
  const visa = Number(visaTotal) || 0;
  const actual = Number(actualCash) || 0;

  // Per explicit confirmed business decision (not the standard
  // opening-balance-inclusive formula shift-close uses): Total Revenue
  // minus the manually entered Visa and InstaPay minus this shift's
  // drawer expenses — confirmed and intentional, not an oversight.
  const expectedCash = financials.totalRevenue - visa - instapay - financials.expensesTotal;
  const now = Date.now();

  return {
    id: "shiftrecon-" + now,
    shiftId,
    // Kept purely as a display label (when this snapshot was taken) —
    // the actual financial scoping above uses shiftId, not this.
    dateLabel: formatDateLabel_(now),
    recordedAt: now,
    recordedBy,
    totalRevenue: financials.totalRevenue,
    instapayTotal: instapay,
    visaTotal: visa,
    expensesTotal: financials.expensesTotal,
    expectedCash,
    actualCash: actual,
    variance: actual - expectedCash,
  };
}

module.exports = { bizComputeShiftFinancials_, bizBuildShiftReconciliation_ };
