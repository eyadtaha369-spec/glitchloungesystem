const { formatDateLabel_ } = require("./shifts");

// Scoped to the calendar day (matching "current day" from the dashboard
// request), not the currently active shift — this is deliberately a
// separate, admin-only executive overview, independent from the
// existing per-shift close reconciliation in shifts.js. The two are NOT
// meant to reconcile against each other: this uses a different formula
// (see below) on explicit business direction, so its numbers will
// legitimately differ from what a shift-close computes.
function bizComputeDailyFinancials_(sessions, ledger, atTime) {
  const dateLabel = formatDateLabel_(atTime || Date.now());
  const todaySessions = sessions.filter((s) => formatDateLabel_(s.endedAt) === dateLabel);
  const totalRevenue = todaySessions.reduce((a, s) => a + (Number(s.total) || 0), 0);
  const instapayTotal = todaySessions.reduce((a, s) => a + (Number(s.instapayAmount) || 0), 0);
  const visaTotal = todaySessions.reduce((a, s) => a + (Number(s.visaAmount) || 0), 0);
  const expensesTotal = ledger
    .filter((l) => l.status === "approved" && l.paidFromDrawer && l.direction === "outflow" && formatDateLabel_(l.ts) === dateLabel)
    .reduce((a, l) => a + (Number(l.amount) || 0), 0);

  // Per explicit confirmed business decision (not the standard
  // opening-balance-inclusive formula shift-close uses): Total Revenue
  // minus Visa minus InstaPay minus today's drawer expenses. Revenue
  // already contains the Visa/InstaPay/Cash split, so this reduces to
  // (Cash Sales - Expenses) with no term for the shift's opening float —
  // confirmed and intentional, not an oversight.
  const expectedCash = totalRevenue - visaTotal - instapayTotal - expensesTotal;

  return { dateLabel, totalRevenue, instapayTotal, visaTotal, expensesTotal, expectedCash };
}

function bizBuildDailyReconciliation_(sessions, ledger, actualCash, recordedBy, atTime) {
  const financials = bizComputeDailyFinancials_(sessions, ledger, atTime);
  const now = Date.now();
  return {
    id: "dailyrecon-" + now,
    dateLabel: financials.dateLabel,
    recordedAt: now,
    recordedBy,
    totalRevenue: financials.totalRevenue,
    instapayTotal: financials.instapayTotal,
    visaTotal: financials.visaTotal,
    expensesTotal: financials.expensesTotal,
    expectedCash: financials.expectedCash,
    actualCash: Number(actualCash) || 0,
    variance: (Number(actualCash) || 0) - financials.expectedCash,
  };
}

module.exports = { bizComputeDailyFinancials_, bizBuildDailyReconciliation_ };
