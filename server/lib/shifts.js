const { appendObject_, updateObjectById_ } = require("../db");
const { pushActivity_ } = require("./util");

// This café's business day is defined in Africa/Cairo local time,
// regardless of what timezone the machine running this code is
// actually set to. A cloud host commonly defaults to UTC, and other
// hosts can be set to anything -- if this read the *server's* local
// clock instead, the exact same timestamp could label itself onto a
// different calendar day depending purely on where the process
// happens to run, which is exactly the bug that let morning expenses
// (7:50 AM-10:00 AM Cairo time) drift onto the wrong date. Pinning the
// formatting to an explicit IANA zone makes the result identical no
// matter the host's own timezone, and Intl handles Egypt's DST
// transitions automatically so this never needs manual offset math.
const CAFE_TIMEZONE = "Africa/Cairo";
const cafeDateFormatter_ = new Intl.DateTimeFormat("en-CA", {
  timeZone: CAFE_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit",
});
function formatDateLabel_(ts) {
  // en-CA formats as YYYY-MM-DD directly.
  return cafeDateFormatter_.format(new Date(ts));
}

// This café's real operating cycle runs 8:00 AM to 7:59:59 AM the next
// calendar day (with a 30-minute grace window before the nominal 8 AM
// cutoff), NOT calendar midnight to midnight -- see the matching
// businessDayBounds()/BUSINESS_DAY_START_HOUR comment in
// src/components/glitch/Reports.tsx, which this deliberately mirrors
// exactly. A plain formatDateLabel_(ts) of a 2 AM timestamp would claim
// that moment belongs to "today", when by this café's own accounting it's
// still last night's business day -- this shifts the clock back by that
// same 7.5-hour window first, so the calendar date read off the result
// always lands on the correct business day.
const BUSINESS_DAY_GRACE_MS = 8 * 3600000 - 30 * 60000;
function businessDayLabelForTs_(ts) {
  return formatDateLabel_(ts - BUSINESS_DAY_GRACE_MS);
}

// The parsing-direction counterpart to formatDateLabel_ above: turns a
// plain "yyyy-MM-dd" date string an admin typed/picked (a Backdated
// Expense date, a Supplier Invoice date, an Advance date) into a real
// timestamp, anchored at NOON in Africa/Cairo rather than midnight.
//
// This fixes a real date-shifting bug: `new Date(dateStr + "T00:00:00")`
// (what this used to be) parses that string as midnight in whatever
// timezone the HOST PROCESS happens to be running in -- commonly UTC on
// a cloud server, which sits BEHIND Cairo. Midnight Cairo computed that
// way lands at 21:00 the PREVIOUS UTC day, so "2026-09-25" silently
// became "2026-09-24T21:00:00.000Z". Node has no Utilities.parseDate
// (Apps Script's IANA-aware parser -- see Code.gs's identical helper),
// so this reconstructs the same guarantee from Intl: read what Cairo's
// wall clock says for a trial UTC instant, measure the gap, and shift by
// that gap. This stays correct across Egypt's DST transitions without
// hardcoding its offset. Anchoring at midday instead of midnight adds a
// second layer of safety: even if the measured offset were off by a few
// hours, a noon instant still couldn't cross a calendar-day boundary
// when read back in Cairo time.
function cairoOffsetMsAt_(utcMs) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: CAFE_TIMEZONE, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts = {};
  dtf.formatToParts(new Date(utcMs)).forEach((p) => { if (p.type !== "literal") parts[p.type] = p.value; });
  const asIfUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return asIfUtc - utcMs;
}
function cairoMiddayTimestamp_(dateStr) {
  const trialUtcMs = new Date(dateStr + "T12:00:00.000Z").getTime();
  return trialUtcMs - cairoOffsetMsAt_(trialUtcMs);
}

// Accepts either a plain "yyyy-MM-dd" date string (the only form the
// frontend should send now) or a legacy numeric epoch ms (still
// accepted so an older client build, or a value already round-tripped
// through one, keeps working). Falls back to fallbackTs when input is
// missing/blank/unparseable.
function resolveDateInput_(input, fallbackTs) {
  if (input === undefined || input === null || input === "") return fallbackTs;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(input))) return cairoMiddayTimestamp_(String(input));
  const n = Number(input);
  return isNaN(n) ? fallbackTs : n;
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

module.exports = { formatDateLabel_, businessDayLabelForTs_, cairoMiddayTimestamp_, resolveDateInput_, bizOpenShift_, bizCloseActiveShift_, bizRecalculateClosedShift_, bizFindOrphanedSessions_, bizAttachOrphanedToShift_ };
