// Server-only. Strips sales history and revenue aggregates out of every
// backend response before it can reach a non-admin (cashier) device.
//
// The browser never talks to the Node/Apps Script backend directly -- it
// calls the server functions in src/backend/*.ts, which run on the web
// server and relay to the backend. callAppsScript() (appsScript.ts) runs
// every response through redactForRole() using the role from the signed
// session cookie, so this is enforced where the cashier's network
// boundary actually is, not just hidden in the UI.
//
// A cashier keeps everything needed to run the CURRENT check: rooms and
// their live orders, the menu, stock availability, the active shift's
// identity/opening balance, and the closed-check receipt returned by
// checkout ("session" / "splitSession").

type AnyRecord = Record<string, any>;

export function redactStateForCashier(state: AnyRecord): AnyRecord {
  if (!state || typeof state !== "object") return state;
  const s: AnyRecord = { ...state };
  const active = Array.isArray(s.shifts) ? s.shifts.find((sh: AnyRecord) => sh.id === s.activeShiftId) : null;
  // Only checks of the currently OPEN shift stay (that is what the cashier's
  // Daily Financial Reconciliation is computed from) -- never any history.
  s.sessions = Array.isArray(s.sessions) && s.activeShiftId ? s.sessions.filter((x: AnyRecord) => x.shiftId === s.activeShiftId) : [];
  s.businessDays = [];    // daily revenue / profit roll-ups
  s.activity = [];        // activity feed text quotes checkout amounts
  s.cashRecords = [];     // cash drawer history
  // Only the open shift survives, with its (not-yet-computed) cash
  // reconciliation fields blanked. Past shifts carry expectedCash etc.
  s.shifts = active
    ? [{ ...active, expectedCash: null, closingActualCash: null, discrepancy: null }]
    : [];
  return s;
}

export function redactForRole<T>(json: T, role: string | null | undefined): T {
  if (role === "admin" || !json || typeof json !== "object") return json;
  const out: AnyRecord = { ...(json as AnyRecord) };
  if (out.state) out.state = redactStateForCashier(out.state);
  // Orphaned-check totals (openShift / attachOrphanedToShift) are revenue.
  if (out.orphaned && typeof out.orphaned === "object") {
    out.orphaned = { ...out.orphaned, total: 0, sessionsTotal: 0, expensesTotal: 0 };
  }
  if ("total" in out && ("count" in out)) out.total = 0;
  return out as T;
}
