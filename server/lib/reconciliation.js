const { formatDateLabel_ } = require("./shifts");

// Scoped to the calendar day (matching "current day" from the dashboard
// request), not the currently active shift — this is deliberately a
// separate, admin-only executive overview, independent from the
// existing per-shift close reconciliation in shifts.js. The two are NOT
// meant to reconcile against each other: this uses a different formula
// (see below) on explicit business direction, so its numbers will
// legitimately differ from what a shift-close computes.
//
// InstaPay and Visa are DELIBERATELY NOT computed here — per direct
// follow-up request, the admin enters both by hand (same as Actual
// Physical Cash Counted), since the source of truth for those totals is
// the bank/payment app statements, not necessarily what got typed into
// the till at checkout time. Only Total Revenue and today's approved
// drawer expenses remain auto-calculated from the app's own records.
function bizComputeDailyFinancials_(sessions, ledger, atTime) {
  const dateLabel = formatDateLabel_(atTime || Date.now());
  const todaySessions = sessions.filter((s) => formatDateLabel_(s.endedAt) === dateLabel);
  const totalRevenue = todaySessions.reduce((a, s) => a + (Number(s.total) || 0), 0);
  const expensesTotal = ledger
    .filter((l) => l.status === "approved" && l.paidFromDrawer && l.direction === "outflow" && formatDateLabel_(l.ts) === dateLabel)
    .reduce((a, l) => a + (Number(l.amount) || 0), 0);

  return { dateLabel, totalRevenue, expensesTotal };
}

function bizBuildDailyReconciliation_(sessions, ledger, actualCash, instapayTotal, visaTotal, recordedBy, atTime) {
  const financials = bizComputeDailyFinancials_(sessions, ledger, atTime);
  const instapay = Number(instapayTotal) || 0;
  const visa = Number(visaTotal) || 0;
  const actual = Number(actualCash) || 0;

  // Per explicit confirmed business decision (not the standard
  // opening-balance-inclusive formula shift-close uses): Total Revenue
  // minus the manually entered Visa and InstaPay minus today's drawer
  // expenses — confirmed and intentional, not an oversight.
  const expectedCash = financials.totalRevenue - visa - instapay - financials.expensesTotal;
  const now = Date.now();

  return {
    id: "dailyrecon-" + now,
    dateLabel: financials.dateLabel,
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

module.exports = { bizComputeDailyFinancials_, bizBuildDailyReconciliation_ };
