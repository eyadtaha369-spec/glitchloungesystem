// Defense in depth for the local server: even if a request reached this
// backend with a cashier's username, sales history and revenue aggregates
// are stripped before the response leaves. (The web server layer,
// src/backend/redact.ts, enforces the same rule for the browser.)
function redactStateForCashier_(state) {
  if (!state || typeof state !== "object") return state;
  const s = Object.assign({}, state);
  const active = Array.isArray(s.shifts) ? s.shifts.find((sh) => sh.id === s.activeShiftId) : null;
  s.sessions = Array.isArray(s.sessions) && s.activeShiftId ? s.sessions.filter((x) => x.shiftId === s.activeShiftId) : [];
  s.businessDays = [];
  s.activity = [];
  s.cashRecords = [];
  s.shifts = active ? [Object.assign({}, active, { expectedCash: null, closingActualCash: null, discrepancy: null })] : [];
  return s;
}

function redactForRole_(obj, role) {
  if (role === "admin" || !obj || typeof obj !== "object") return obj;
  const out = Object.assign({}, obj);
  if (out.state) out.state = redactStateForCashier_(out.state);
  if (out.orphaned && typeof out.orphaned === "object") {
    out.orphaned = Object.assign({}, out.orphaned, { total: 0, sessionsTotal: 0, expensesTotal: 0 });
  }
  if ("total" in out && "count" in out) out.total = 0;
  return out;
}

module.exports = { redactForRole_, redactStateForCashier_ };
