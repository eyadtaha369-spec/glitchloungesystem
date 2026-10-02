import { useEffect, useMemo, useState } from "react";
import { useStore, fmtMoney, computeMenuItemCost } from "@/lib/glitch-store";
import { generateShiftReportPdf, downloadBlob } from "@/lib/shift-report-pdf";
import { generateMonthlyAuditReportPdf, type MonthlyAuditFinancials, type MonthlyAuditItemRow } from "@/lib/monthly-audit-report-pdf";
import { generateSectionReportPdf } from "@/lib/section-report-pdf";
import type { Shift, Session, LedgerEntry, PaymentSource } from "@/lib/glitch-store";
import { FileDown, TrendingUp, Boxes, History, Wallet, MapPin, Sunrise, CalendarCheck, AlertTriangle, Trash2, Plus, Edit2, X, ArrowRightLeft } from "lucide-react";
import { ReceiptModal, ReopenCheckModal } from "./Rooms";

// What counts as a real, same-day operational expense — used
// consistently everywhere "Daily Expenses" is computed on this page.
// Excludes:
// - sales (obviously not an expense)
// - Staff Consumption Expense (a staff allowance/order, not a
//   purchase — tracked separately on the Staff Orders page)
// - anything with "Void" in its category (waste/mistakes, not spend)
// - unpaid entries (nothing has actually left the business yet)
// - supplierPayment entries specifically -- these SETTLE an older,
//   already-incurred debt (often from a previous day or month
//   entirely), so counting them as "today's" or "this month's"
//   expense double-counts spending that was really incurred whenever
//   the original deferred invoice was logged. These are tracked in
//   their own Monthly Expenses Ledger instead. A cash supplier
//   invoice (type "supplierInvoice") is NOT excluded here -- that IS
//   a same-day expense, paid at the moment the goods were received.
// Every Ledger category a void reason can produce (server/lib/voids.js
// VOID_REASONS) — these represent inventory LOST, not cash actually
// spent, so none of them belong in "operational expenses". They're
// tracked in their own Wasted & Complimentary Ledger instead. Kept as
// an explicit set (matching the backend exactly) rather than a
// substring match, since "Marketing & Hospitality (Comps)" and
// "Customer Satisfaction Waste" don't contain the word "void" at all.
const WASTE_LEDGER_CATEGORIES = new Set([
  "Operational Waste / Damaged Goods",
  "Customer Satisfaction Waste",
  "Marketing & Hospitality (Comps)",
  "Unapproved Void — Pending Reconciliation",
]);

function isOperationalExpense(l: LedgerEntry): boolean {
  return (
    l.direction === "outflow" &&
    l.type !== "sale" &&
    l.type !== "supplierPayment" &&
    l.type !== "fixedMonthlyCost" &&
    l.category !== "Staff Consumption Expense" &&
    l.status === "approved" &&
    l.paymentStatus !== "unpaid" &&
    !WASTE_LEDGER_CATEGORIES.has(l.category)
  );
}

// A settled supplier-account payment (deferred invoice being paid off)
// is real cash leaving the business, on the day it's actually paid --
// but a DEFERRED invoice never creates any Ledger entry at all when
// it's first received (only a cash invoice does), so the only Ledger
// event that ever exists for that debt is this payment. Previously
// excluded entirely from Selected Day/Monthly Expenses and Net Profit
// (kept in its own Monthly Expenses Ledger panel instead) on the
// reasoning that counting it would double-count the original invoice
// -- but since the original deferred invoice was never counted
// anywhere, that left every deferred purchase permanently absent from
// every P&L figure. Counted here on a cash basis (the day it was
// actually paid, via its own ts -- these are never backdated, so no
// expenseDate exists or is needed).
function isSettledSupplierPayment_(l: LedgerEntry): boolean {
  return l.type === "supplierPayment";
}

// This café's confirmed real operating cycle: a "business day" runs
// 8:00 AM to 7:59:59 AM the next calendar day, not midnight to
// midnight. A shift that opens at 11 PM and runs until 4 AM belongs
// entirely to the business day it opened on, never split across two.
//
// A 30-minute grace window is applied before the nominal 8:00 AM
// cutoff: real shift-opening times vary by a few minutes (a cashier
// opening at 7:55:32 AM is still unmistakably "the 8 AM shift"), and
// a hard instant-of-8:00:00.000 cutoff would otherwise misattribute
// that entire shift to the previous business day over a few minutes
// of natural variance. The window stays a consistent 24 hours long,
// just shifted 30 minutes earlier to absorb that variance.
const BUSINESS_DAY_START_HOUR = 8;
const BUSINESS_DAY_GRACE_MINUTES = 30;
function businessDayBounds(dateStr: string) {
  const from = new Date(dateStr + "T00:00:00").getTime() + BUSINESS_DAY_START_HOUR * 3600000 - BUSINESS_DAY_GRACE_MINUTES * 60000;
  const to = from + 86400000 - 1; // 24 hours later, minus 1ms
  return { from, to };
}

// This café operates in Africa/Cairo local time, regardless of the
// timezone the viewing browser (or an SSR render) happens to be set
// to. Every expense's own expenseDate is already computed server-side
// pinned to Cairo (see server/lib/shifts.js's formatDateLabel_), so
// the ONLY place that still mattered was picking today's date as the
// initial default for the day/month pickers below — a viewer whose
// own machine is set to a different timezone than the café's would
// otherwise land on the wrong default date the moment their local
// midnight and Cairo's don't line up.
const CAIRO_TZ_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit",
});
function cairoDateLabel(ts: number): string {
  return CAIRO_TZ_FORMATTER.format(new Date(ts));
}

// Generalizes businessDayBounds to a closed [startDateStr, endDateStr]
// range — every section below now has its own independent date-range
// picker (rather than sharing one page-level date), and each one's own
// range still has to resolve to the same 8 AM-to-8 AM business-day
// bounds as everywhere else in this app, just spanning more than one day.
function rangeBusinessDayBounds(startDateStr: string, endDateStr: string): { from: number; to: number } {
  const orderedStart = startDateStr <= endDateStr ? startDateStr : endDateStr;
  const orderedEnd = startDateStr <= endDateStr ? endDateStr : startDateStr;
  return { from: businessDayBounds(orderedStart).from, to: businessDayBounds(orderedEnd).to };
}

function formatRangeLabel(startDate: string, endDate: string): string {
  const fmt = (d: string) => new Date(d + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return startDate === endDate ? fmt(startDate) : `${fmt(startDate)} – ${fmt(endDate)}`;
}

// Shared header toolbar for every independently-dated Reports section:
// a start/end date range picker plus its own "Generate PDF Report"
// button. Each section owns its own range state and PDF-building
// callback — this just renders the controls consistently everywhere.
function SectionDateRangeToolbar({
  startDate, endDate, onStartDateChange, onEndDateChange, onGeneratePdf, generating, maxDate,
}: {
  startDate: string;
  endDate: string;
  onStartDateChange: (v: string) => void;
  onEndDateChange: (v: string) => void;
  onGeneratePdf: () => void;
  generating: boolean;
  maxDate?: string;
}) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <input
        type="date" value={startDate} max={endDate}
        onChange={(e) => onStartDateChange(e.target.value)}
        className="bg-white/70 border border-black/10 rounded-lg px-2.5 py-1.5 text-xs font-mono"
      />
      <span className="text-xs text-muted-foreground">to</span>
      <input
        type="date" value={endDate} min={startDate} max={maxDate}
        onChange={(e) => onEndDateChange(e.target.value)}
        className="bg-white/70 border border-black/10 rounded-lg px-2.5 py-1.5 text-xs font-mono"
      />
      <button
        onClick={onGeneratePdf}
        disabled={generating}
        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-gradient-to-r from-[oklch(0.7_0.19_260)] to-[oklch(0.65_0.24_305)] text-[#2b2416] font-bold disabled:opacity-50"
      >
        <FileDown className="w-3.5 h-3.5" /> {generating ? "Generating..." : "Generate PDF Report"}
      </button>
    </div>
  );
}

// Tiny shared hook-like helper: a section's own [startDate, endDate]
// range state, defaulted to today (Cairo) on both ends, plus a
// generating flag for its Generate PDF Report button.
function useSectionDateRange() {
  const today = cairoDateLabel(Date.now());
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [generating, setGenerating] = useState(false);
  return { startDate, setStartDate, endDate, setEndDate, generating, setGenerating, today };
}

// Same as useSectionDateRange, but defaults the start of the range to
// the 1st of the current (Cairo) month instead of today — for sections
// whose entries are logged occasionally rather than daily (Fixed
// Monthly Costs, Expenses Ledger), so the default view shows this
// month's activity instead of an empty "today only" range.
function useSectionDateRangeMonthToDate() {
  const today = cairoDateLabel(Date.now());
  const monthStart = today.slice(0, 7) + "-01";
  const [startDate, setStartDate] = useState(monthStart);
  const [endDate, setEndDate] = useState(today);
  const [generating, setGenerating] = useState(false);
  return { startDate, setStartDate, endDate, setEndDate, generating, setGenerating, today };
}

// Shift-first binding: an order/expense/void that has a shiftId is
// scoped by whichever business day that SHIFT opened within — never
// by re-deriving a calendar date from the record's own timestamp,
// which is exactly what let midnight-to-8AM activity bleed into the
// wrong day. shiftId is already set correctly at the moment every
// record is created (from whatever shift was actually active then),
// so this never needs to rewrite any historical record to work
// correctly retroactively — it only needed the query logic fixed.
// Falls back to the record's own timestamp only for the rare case of
// no shiftId at all (logged with no shift open).
function filterByBusinessDay<T extends { shiftId: string | null; ts?: number; endedAt?: number }>(
  items: T[],
  dayShiftIds: Set<string>,
  from: number,
  to: number,
): T[] {
  return items.filter((item) => {
    if (item.shiftId) return dayShiftIds.has(item.shiftId);
    const ts = item.ts ?? item.endedAt ?? 0;
    return ts >= from && ts <= to;
  });
}

// Prefers the entry's own stored expenseDate (a business-day label set
// ONCE at creation — see server-side businessDayLabelForTs_) over
// re-deriving a day from shiftId/ts. This is what makes a Backdated
// Expense reliably show up under the exact historical day/range an
// admin assigned it to, rather than whichever business day the target
// SHIFT opened within (which silently misfiled entries whenever that
// shift itself straddled the 8 AM business-day boundary). Entries
// logged before this field existed have no expenseDate and fall back
// to the previous shift-first behavior unchanged. See
// expenseMatchesRange_ below for the actual [startDate, endDate]
// version every section now uses; expenseMatchesMonth_ remains for the
// Monthly Financial & Sales Audit Report and Financial Reconciliation,
// which are genuinely calendar-month-scoped rather than date-range-scoped.
// Same idea, one calendar month at a time (YYYY-MM prefix of expenseDate).
function expenseMatchesMonth_(l: LedgerEntry, monthShiftIds: Set<string>, from: number, to: number, monthStr: string): boolean {
  if (l.expenseDate) return l.expenseDate.slice(0, 7) === monthStr;
  if (l.shiftId) return monthShiftIds.has(l.shiftId);
  return l.ts >= from && l.ts <= to;
}
// Same idea again, but for an arbitrary [startDate, endDate] range —
// every independently-dated Reports section below uses this one.
// YYYY-MM-DD strings compare correctly with plain <=/>=, so no date
// parsing is needed for the expenseDate branch.
function expenseMatchesRange_(l: LedgerEntry, rangeShiftIds: Set<string>, from: number, to: number, startDate: string, endDate: string): boolean {
  if (l.expenseDate) return l.expenseDate >= startDate && l.expenseDate <= endDate;
  if (l.shiftId) return rangeShiftIds.has(l.shiftId);
  return l.ts >= from && l.ts <= to;
}

// Same business-day month range as MonthlyReconciliationDashboard
// below, extracted as a standalone function so the Monthly Audit
// Report (which needs the same range for two fixed months, August and
// September 2026, rather than one admin-picked month) doesn't
// duplicate the day-1-through-last-day math independently.
function monthBusinessDayBounds(monthStr: string): { from: number; to: number } {
  const [y, m] = monthStr.split("-").map(Number);
  const firstDay = `${monthStr}-01`;
  const lastDayNum = new Date(y, m, 0).getDate();
  const lastDay = `${monthStr}-${String(lastDayNum).padStart(2, "0")}`;
  return { from: businessDayBounds(firstDay).from, to: businessDayBounds(lastDay).to };
}

// Identical revenue/expense/net-profit logic to
// MonthlyReconciliationDashboard (same inclusions: operational
// expenses + settled supplier payments + approved fixed monthly
// costs, all business-day/shift-first scoped) — kept as a plain
// function here since the Monthly Audit Report below needs it for
// two specific months at once (for the compare view), not one
// admin-picked month tied to a single component's own state.
function computeMonthFinancials(state: ReturnType<typeof useStore>["state"], monthStr: string): MonthlyAuditFinancials {
  const { from, to } = monthBusinessDayBounds(monthStr);
  const [y, m] = monthStr.split("-").map(Number);
  const monthLabel = new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const monthShiftIds = new Set(state.shifts.filter((sh) => sh.openedAt >= from && sh.openedAt <= to).map((sh) => sh.id));
  const revenue = filterByBusinessDay(state.sessions, monthShiftIds, from, to).reduce((a, s) => a + s.total, 0);
  const operationalAndSupplier = [
    ...state.ledger.filter(isOperationalExpense),
    ...state.ledger.filter(isSettledSupplierPayment_),
  ]
    .filter((l) => expenseMatchesMonth_(l, monthShiftIds, from, to, monthStr))
    .reduce((a, l) => a + Number(l.amount), 0);
  const fixedCosts = filterByBusinessDay(
    state.ledger.filter((l) => l.type === "fixedMonthlyCost" && l.status === "approved"),
    monthShiftIds, from, to,
  ).reduce((a, l) => a + Number(l.amount), 0);
  const expenses = operationalAndSupplier + fixedCosts;
  return { monthStr, monthLabel, revenue, expenses, netProfit: revenue - expenses };
}

// Per-item sales aggregated across every session closed in the given
// month, with COGS computed the same way the rest of the app computes
// recipe cost (computeMenuItemCost: current ingredient unitCost × recipe
// qty) — there's no historical per-sale ingredient-cost snapshot stored
// anywhere, so, consistent with every other cost figure in this app
// (Dashboard, Inventory), this uses each material's current cost
// rather than reconstructing what it cost on the exact day of sale.
function computeItemSalesBreakdown(state: ReturnType<typeof useStore>["state"], monthStr: string): { rows: MonthlyAuditItemRow[]; totalRevenue: number; totalCost: number; totalProfit: number } {
  const { from, to } = monthBusinessDayBounds(monthStr);
  const monthShiftIds = new Set(state.shifts.filter((sh) => sh.openedAt >= from && sh.openedAt <= to).map((sh) => sh.id));
  const sessions = filterByBusinessDay(state.sessions, monthShiftIds, from, to);

  const map = new Map<string, { name: string; qty: number; revenue: number }>();
  sessions.forEach((s) => {
    s.orders.forEach((o) => {
      const cur = map.get(o.menuItemId) ?? { name: o.name, qty: 0, revenue: 0 };
      cur.qty += o.qty;
      cur.revenue += o.qty * o.price;
      map.set(o.menuItemId, cur);
    });
  });

  const rows: MonthlyAuditItemRow[] = Array.from(map.entries()).map(([menuItemId, v]) => {
    const item = state.menu.find((m) => m.id === menuItemId);
    const unitCost = item ? computeMenuItemCost(item, state.stock) : 0;
    const totalCost = Math.round(unitCost * v.qty * 100) / 100;
    const revenue = Math.round(v.revenue * 100) / 100;
    const profit = Math.round((revenue - totalCost) * 100) / 100;
    const marginPct = revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : null;
    return { name: v.name, qty: v.qty, revenue, unitCost, totalCost, profit, marginPct };
  }).sort((a, b) => b.revenue - a.revenue);

  const totalRevenue = rows.reduce((a, r) => a + r.revenue, 0);
  const totalCost = rows.reduce((a, r) => a + r.totalCost, 0);
  return { rows, totalRevenue, totalCost, totalProfit: totalRevenue - totalCost };
}

function startOfDay(ts: number) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function startOfWeek(ts: number) {
  const d = new Date(ts);
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function startOfMonth(ts: number) {
  const d = new Date(ts);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function ReportsPage() {
  const { state, refreshLedger } = useStore();

  // The Ledger is admin-only and loaded once per session, not something
  // that magically stays in sync across different browser tabs/logins —
  // a cashier logging a waste item, or an admin who's been sitting on
  // this page since before that happened, would otherwise see stale
  // data indefinitely. Refresh on every visit to this page specifically,
  // rather than relying on whichever action most recently touched the
  // ledger to have pushed a refresh into THIS session.
  useEffect(() => {
    void refreshLedger();
  }, [refreshLedger]);

  // Shift-based, not calendar-date-based — a shift spanning midnight is
  // ONE report, never split across two calendar days. Defaults to
  // whichever shift is currently active; falls back to the most
  // recently closed one if none is open right now.
  const sortedShifts = useMemo(() => [...state.shifts].sort((a, b) => b.openedAt - a.openedAt), [state.shifts]);
  const [selectedShiftId, setSelectedShiftId] = useState<string | null>(null);
  const effectiveShiftId = selectedShiftId ?? state.activeShiftId ?? sortedShifts[0]?.id ?? null;
  const selectedShift = useMemo(() => state.shifts.find((sh) => sh.id === effectiveShiftId) ?? null, [state.shifts, effectiveShiftId]);
  const isViewingActiveShift = effectiveShiftId !== null && effectiveShiftId === state.activeShiftId;

  const shiftSessions = useMemo(
    () => (effectiveShiftId ? state.sessions.filter((s) => s.shiftId === effectiveShiftId) : []),
    [state.sessions, effectiveShiftId],
  );
  const wasteEntries = useMemo(
    () => (effectiveShiftId ? state.ledger.filter((l) => l.category === "Marketing / Waste Expense" && l.shiftId === effectiveShiftId) : []),
    [state.ledger, effectiveShiftId],
  );

  // Exact aggregation: cashAmount + visaAmount + instapayAmount always sums
  // to session.total for every session (pure or mixed), so summing these
  // three fields across the shift's sessions IS the definitive Total
  // Shift Revenue — no separate "combined" calculation needed.
  const cashRevenue = shiftSessions.reduce((a, s) => a + s.cashAmount, 0);
  const visaRevenue = shiftSessions.reduce((a, s) => a + s.visaAmount, 0);
  const instapayRevenue = shiftSessions.reduce((a, s) => a + s.instapayAmount, 0);
  const totalRevenue = cashRevenue + visaRevenue + instapayRevenue;

  // Material consumption for this shift, derived from its orders × recipes —
  // NOT from stock.used, since that's cumulative since last restock, not
  // scoped to any one shift.
  const consumption = useMemo(() => {
    const map = new Map<string, number>();
    shiftSessions.forEach((s) => {
      s.orders.forEach((o) => {
        const item = state.menu.find((m) => m.id === o.menuItemId);
        if (!item) return;
        item.ingredients.forEach((ing) => {
          map.set(ing.stockId, (map.get(ing.stockId) ?? 0) + ing.qty * o.qty);
        });
      });
    });
    return Array.from(map.entries()).map(([stockId, qty]) => {
      const stk = state.stock.find((s) => s.id === stockId);
      return { name: stk?.name ?? stockId, unit: stk?.unit ?? "", qty };
    }).sort((a, b) => b.qty - a.qty);
  }, [shiftSessions, state.menu, state.stock]);

  // Financial Reconciliation is genuinely monthly (Day 1 through the
  // last day) — a separate month picker from any of the per-section
  // date ranges below.
  const [selectedMonth, setSelectedMonth] = useState(() => cairoDateLabel(Date.now()).slice(0, 7));

  const [viewingCheck, setViewingCheck] = useState<Session | null>(null);
  const [reopenTarget, setReopenTarget] = useState<Session | null>(null);
  const isAdmin = state.currentUser?.role === "admin";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Owner Reports</h1>
          <p className="text-sm text-muted-foreground mt-1 font-mono uppercase tracking-widest">
            {selectedShift ? `${selectedShift.cashierUsername} · ${new Date(selectedShift.openedAt).toLocaleString()}${isViewingActiveShift ? " (active)" : ""}` : "No shifts yet"}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div>
            <label className="text-[10px] uppercase tracking-widest text-muted-foreground block">Shift</label>
            <select
              value={effectiveShiftId ?? ""}
              onChange={(e) => setSelectedShiftId(e.target.value || null)}
              className="mt-0.5 bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm font-mono max-w-[280px]"
            >
              {state.activeShiftId && (
                <option value={state.activeShiftId}>
                  Active now — {state.shifts.find((sh) => sh.id === state.activeShiftId)?.cashierUsername ?? "?"}
                </option>
              )}
              {sortedShifts.filter((sh) => sh.id !== state.activeShiftId).map((sh) => (
                <option key={sh.id} value={sh.id}>
                  {sh.cashierUsername} — {new Date(sh.openedAt).toLocaleString()}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={() => selectedShift && generateDailyReport(selectedShift, shiftSessions, consumption, totalRevenue, cashRevenue, visaRevenue, instapayRevenue, wasteEntries.reduce((a, e) => a + e.amount, 0))}
            disabled={!selectedShift}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-r from-black to-black text-[#2b2416] text-sm font-semibold self-end disabled:opacity-40"
          >
            <FileDown className="w-4 h-4" /> Generate Report
          </button>
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs font-mono text-muted-foreground">
        <span>{shiftSessions.length} order{shiftSessions.length === 1 ? "" : "s"} this shift</span>
      </div>

      {/* 1. Financial Reconciliation — top-level monthly overview */}
      <MonthlyReconciliationDashboard selectedMonth={selectedMonth} onMonthChange={setSelectedMonth} />

      {/* 1a. Monthly Financial & Sales Audit Report — fixed to August and
          September 2026 specifically, independent of the admin-picked
          month above */}
      <MonthlyFinancialAuditReport />

      {/* 1b. Fixed Monthly Costs — dedicated ledger, directly below
          Financial Reconciliation per explicit request */}
      <FixedMonthlyCostsLedger />

      {/* 2. Current Business Day Overview */}
      <BusinessDayPanel />

      {/* 3. Total Revenue by Date — its own independent date-range picker
          and PDF export, decoupled from every other section's picker */}
      <TotalRevenueByDatePanel />

      {/* 4. Order History — its own independent date-range picker and PDF
          export; every row still opens the full check via ReceiptModal */}
      <OrderHistoryPanel isAdmin={isAdmin} onViewCheck={setViewingCheck} />

      {/* 5. Expenses History — its own independent date-range picker and
          PDF export, same exclusions as before (no Staff Orders, no voids) */}
      <ExpensesHistoryPanel isAdmin={isAdmin} />

      {/* 6. Material Consumption — its own independent date-range picker
          and PDF export */}
      <MaterialConsumptionPanel />

      {/* 7. Wasted / Marketing / Complimentary — audit summary, valued at COGS */}
      <WastedComplimentaryLedger />
      <WasteMarketingPanel allEntries={state.ledger.filter((l) => l.category === "Marketing / Waste Expense")} />

      {/* 8. Expenses Ledger — settled supplier payments, now with its own
          independent date-range picker and PDF export */}
      <MonthlyExpensesLedger />

      {/* 9. Shift History */}
      <MonthlyShiftsExportPanel />
      <ShiftHistoryPanel />

      <AttendanceLog />

      {viewingCheck && (
        <ReceiptModal
          session={viewingCheck} onClose={() => setViewingCheck(null)}
          onReopen={isAdmin ? () => { setReopenTarget(viewingCheck); setViewingCheck(null); } : undefined}
        />
      )}
      {reopenTarget && <ReopenCheckModal session={reopenTarget} onClose={() => setReopenTarget(null)} />}
    </div>
  );
}

// Total Revenue by Date — now its own independent start/end date-range
// picker and "Generate PDF Report" button. Order History, Expenses
// History, and Material Consumption used to all share this one date —
// each of the four now owns its own range completely independently.
function TotalRevenueByDatePanel() {
  const { state } = useStore();
  const { startDate, setStartDate, endDate, setEndDate, generating, setGenerating, today } = useSectionDateRange();

  const { from, to } = useMemo(() => rangeBusinessDayBounds(startDate, endDate), [startDate, endDate]);
  const rangeShiftIds = useMemo(
    () => new Set(state.shifts.filter((sh) => sh.openedAt >= from && sh.openedAt <= to).map((sh) => sh.id)),
    [state.shifts, from, to],
  );
  const rangeSessions = useMemo(() => filterByBusinessDay(state.sessions, rangeShiftIds, from, to), [state.sessions, rangeShiftIds, from, to]);
  const rangeExpenseEntries = useMemo(
    () => state.ledger.filter(isOperationalExpense).filter((l) => expenseMatchesRange_(l, rangeShiftIds, from, to, startDate, endDate)),
    [state.ledger, rangeShiftIds, from, to, startDate, endDate],
  );
  const rangeSupplierPayments = useMemo(
    () => state.ledger.filter(isSettledSupplierPayment_).filter((l) => expenseMatchesRange_(l, rangeShiftIds, from, to, startDate, endDate)),
    [state.ledger, rangeShiftIds, from, to, startDate, endDate],
  );
  const revenue = rangeSessions.reduce((a, s) => a + s.total, 0);
  const expensesTotal = rangeExpenseEntries.reduce((a, l) => a + Number(l.amount), 0) + rangeSupplierPayments.reduce((a, l) => a + Number(l.amount), 0);
  const netProfit = revenue - expensesTotal;
  const rangeLabel = formatRangeLabel(startDate, endDate);

  const handleGeneratePdf = async () => {
    setGenerating(true);
    try {
      await generateSectionReportPdf({
        sectionTitle: "Total Revenue by Date",
        rangeLabel,
        columns: [{ header: "Metric" }, { header: "Amount EGP", align: "right" }],
        rows: [
          ["Revenue", fmtMoney(revenue)],
          ["Expenses", fmtMoney(expensesTotal)],
          ["Net Profit", fmtMoney(netProfit)],
        ],
        summaryLines: [
          { label: "Revenue", value: fmtMoney(revenue) },
          { label: "Expenses", value: fmtMoney(expensesTotal) },
          { label: "Net Profit", value: fmtMoney(netProfit) },
        ],
        filenameBase: "Total_Revenue_by_Date",
        startDate, endDate,
      });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="glass rounded-2xl p-6 border border-[oklch(0.78_0.2_155/0.4)]">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-1">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-[oklch(0.78_0.2_155)]" />
          <h2 className="text-lg font-semibold">Total Revenue by Date</h2>
        </div>
        <SectionDateRangeToolbar
          startDate={startDate} endDate={endDate}
          onStartDateChange={setStartDate} onEndDateChange={setEndDate}
          onGeneratePdf={() => void handleGeneratePdf()} generating={generating} maxDate={today}
        />
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Orders closed and expenses logged {rangeLabel}. Staff Orders and voided items are never counted here.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white/60 rounded-lg p-4 border border-black/8">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Revenue</div>
          <div className="text-2xl font-mono font-bold mt-1 text-[oklch(0.78_0.2_155)]">{fmtMoney(revenue)}</div>
        </div>
        <div className="bg-white/60 rounded-lg p-4 border border-black/8">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Expenses</div>
          <div className="text-2xl font-mono font-bold mt-1 text-[oklch(0.62_0.24_25)]">{fmtMoney(expensesTotal)}</div>
        </div>
        <div className={`rounded-lg p-4 border ${netProfit >= 0 ? "bg-[oklch(0.78_0.2_155/0.1)] border-[oklch(0.78_0.2_155/0.4)]" : "bg-[oklch(0.62_0.24_25/0.1)] border-[oklch(0.62_0.24_25/0.4)]"}`}>
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Net Profit</div>
          <div className={`text-2xl font-mono font-bold mt-1 ${netProfit >= 0 ? "text-[oklch(0.78_0.2_155)]" : "text-[oklch(0.62_0.24_25)]"}`}>{fmtMoney(netProfit)}</div>
        </div>
      </div>
    </div>
  );
}

// Material Consumption — its own independent date-range picker and PDF
// export, decoupled from Total Revenue by Date (they used to share one
// page-level date picker).
function MaterialConsumptionPanel() {
  const { state } = useStore();
  const { startDate, setStartDate, endDate, setEndDate, generating, setGenerating, today } = useSectionDateRange();

  const { from, to } = useMemo(() => rangeBusinessDayBounds(startDate, endDate), [startDate, endDate]);
  const rangeShiftIds = useMemo(
    () => new Set(state.shifts.filter((sh) => sh.openedAt >= from && sh.openedAt <= to).map((sh) => sh.id)),
    [state.shifts, from, to],
  );
  const rangeSessions = useMemo(() => filterByBusinessDay(state.sessions, rangeShiftIds, from, to), [state.sessions, rangeShiftIds, from, to]);
  const consumption = useMemo(() => {
    const map = new Map<string, number>();
    rangeSessions.forEach((s) => {
      s.orders.forEach((o) => {
        const item = state.menu.find((m) => m.id === o.menuItemId);
        if (!item) return;
        item.ingredients.forEach((ing) => {
          map.set(ing.stockId, (map.get(ing.stockId) ?? 0) + ing.qty * o.qty);
        });
      });
    });
    return Array.from(map.entries()).map(([stockId, qty]) => {
      const stk = state.stock.find((s) => s.id === stockId);
      return { name: stk?.name ?? stockId, unit: stk?.unit ?? "", qty };
    }).sort((a, b) => b.qty - a.qty);
  }, [rangeSessions, state.menu, state.stock]);
  const rangeLabel = formatRangeLabel(startDate, endDate);

  const handleGeneratePdf = async () => {
    setGenerating(true);
    try {
      await generateSectionReportPdf({
        sectionTitle: "Material Consumption",
        rangeLabel,
        columns: [{ header: "Material" }, { header: "Qty Consumed", align: "right" }, { header: "Unit" }],
        rows: consumption.map((c) => [c.name, c.qty, c.unit]),
        filenameBase: "Material_Consumption",
        startDate, endDate,
        emptyMessage: "No orders completed in this date range.",
      });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="glass rounded-2xl p-6">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Boxes className="w-5 h-5 text-black" />
          <h2 className="text-lg font-semibold">Material Consumption — {rangeLabel}</h2>
        </div>
        <SectionDateRangeToolbar
          startDate={startDate} endDate={endDate}
          onStartDateChange={setStartDate} onEndDateChange={setEndDate}
          onGeneratePdf={() => void handleGeneratePdf()} generating={generating} maxDate={today}
        />
      </div>
      {consumption.length === 0 ? (
        <div className="text-sm text-muted-foreground font-mono">No orders completed in this date range.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {consumption.map((c) => (
            <div key={c.name} className="bg-white/60 rounded-lg p-3 border border-black/8 flex justify-between items-center">
              <span className="text-sm">{c.name}</span>
              <span className="font-mono text-sm text-black">{c.qty}{c.unit}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Order History — its own independent date-range picker and PDF export.
// Every row still opens the full check via ReceiptModal. Admins get a
// Move icon per row to re-assign a closed order to a different shift
// (and therefore business day), without dragging up the check details
// modal at the same time.
function OrderHistoryPanel({ isAdmin, onViewCheck }: { isAdmin: boolean; onViewCheck: (s: Session) => void }) {
  const { state } = useStore();
  const [moveTarget, setMoveTarget] = useState<Session | null>(null);
  const { startDate, setStartDate, endDate, setEndDate, generating, setGenerating, today } = useSectionDateRange();

  const { from, to } = useMemo(() => rangeBusinessDayBounds(startDate, endDate), [startDate, endDate]);
  const rangeShiftIds = useMemo(
    () => new Set(state.shifts.filter((sh) => sh.openedAt >= from && sh.openedAt <= to).map((sh) => sh.id)),
    [state.shifts, from, to],
  );
  const rangeSessions = useMemo(() => filterByBusinessDay(state.sessions, rangeShiftIds, from, to), [state.sessions, rangeShiftIds, from, to]);
  const sortedSessions = useMemo(() => [...rangeSessions].sort((a, b) => b.endedAt - a.endedAt), [rangeSessions]);
  const rangeLabel = formatRangeLabel(startDate, endDate);

  const handleGeneratePdf = async () => {
    setGenerating(true);
    try {
      await generateSectionReportPdf({
        sectionTitle: "Order History",
        rangeLabel,
        columns: [
          { header: "Order ID" }, { header: "Room/Table" }, { header: "Date & Time" }, { header: "Payment" },
          { header: "Subtotal", align: "right" }, { header: "Discount", align: "right" }, { header: "Total EGP", align: "right" },
        ],
        rows: sortedSessions.map((s) => [
          s.id.slice(0, 12), s.roomName, new Date(s.endedAt).toLocaleString(), s.paymentMethod.replace(/_/g, " "),
          fmtMoney(s.total + (s.discountAmount || 0)), s.discountAmount ? "-" + fmtMoney(s.discountAmount) : "—", fmtMoney(s.total),
        ]),
        summaryLines: [
          { label: "Orders", value: String(sortedSessions.length) },
          { label: "Total Revenue", value: fmtMoney(sortedSessions.reduce((a, s) => a + s.total, 0)) },
        ],
        filenameBase: "Order_History",
        startDate, endDate,
        emptyMessage: "No closed orders in this date range.",
      });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="glass rounded-2xl p-6">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div className="flex items-center gap-2">
          <History className="w-5 h-5 text-[oklch(0.7_0.19_260)]" />
          <h2 className="text-lg font-semibold">Order History — {rangeLabel}</h2>
        </div>
        <SectionDateRangeToolbar
          startDate={startDate} endDate={endDate}
          onStartDateChange={setStartDate} onEndDateChange={setEndDate}
          onGeneratePdf={() => void handleGeneratePdf()} generating={generating} maxDate={today}
        />
      </div>
      {sortedSessions.length === 0 ? (
        <div className="text-sm text-muted-foreground font-mono text-center py-6">No closed orders in this date range.</div>
      ) : (
        <div className="overflow-x-auto overflow-y-auto max-h-[32rem] border border-black/8 rounded-xl">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white/95 backdrop-blur-sm">
              <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground border-b border-black/10">
                <th className="pb-2 pt-3 pl-3 pr-3">Order ID</th>
                <th className="pb-2 pt-3 pr-3">Room/Table</th>
                <th className="pb-2 pt-3 pr-3">Date &amp; Time</th>
                <th className="pb-2 pt-3 pr-3">Payment</th>
                <th className="pb-2 pt-3 pr-3 text-right">Subtotal</th>
                <th className="pb-2 pt-3 pr-3 text-right">Discount</th>
                <th className="pb-2 pt-3 pr-3 text-right">Total EGP</th>
                {isAdmin && <th className="pb-2 pt-3 pr-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {sortedSessions.map((s) => (
                <tr
                  key={s.id}
                  onClick={() => onViewCheck(s)}
                  className="border-b border-black/5 cursor-pointer hover:bg-[oklch(0.7_0.19_260/0.06)]"
                  title="Click to view full check details"
                >
                  <td className="py-2 pl-3 pr-3 font-mono text-xs text-muted-foreground">{s.id.slice(0, 12)}</td>
                  <td className="py-2 pr-3">{s.roomName}</td>
                  <td className="py-2 pr-3 font-mono">{new Date(s.endedAt).toLocaleString()}</td>
                  <td className="py-2 pr-3 uppercase">{s.paymentMethod.replace(/_/g, " ")}</td>
                  <td className="py-2 pr-3 text-right font-mono">{fmtMoney(s.total + (s.discountAmount || 0))}</td>
                  <td className="py-2 pr-3 text-right font-mono text-[oklch(0.62_0.24_25)]">{s.discountAmount ? "-" + fmtMoney(s.discountAmount) : "—"}</td>
                  <td className="py-2 pr-3 text-right font-mono font-bold">{fmtMoney(s.total)}</td>
                  {isAdmin && (
                    <td className="py-2 pr-3 text-right">
                      <button
                        onClick={(e) => { e.stopPropagation(); setMoveTarget(s); }}
                        title="Move to Shift/Date"
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-black/5 border border-black/10 hover:bg-black/10"
                      >
                        <ArrowRightLeft className="w-3.5 h-3.5" /> Move
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {moveTarget && <MoveOrderModal session={moveTarget} onClose={() => setMoveTarget(null)} />}
    </div>
  );
}

function MoveOrderModal({ session, onClose }: { session: Session; onClose: () => void }) {
  const { state, moveSessionToShift } = useStore();
  const [targetShiftId, setTargetShiftId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const candidateShifts = useMemo(
    () => [...state.shifts].filter((sh) => sh.id !== session.shiftId).sort((a, b) => b.openedAt - a.openedAt),
    [state.shifts, session.shiftId],
  );
  const currentShift = state.shifts.find((sh) => sh.id === session.shiftId) ?? null;

  const submit = async () => {
    setErr(null);
    if (!targetShiftId) { setErr("Select a target shift."); return; }
    setSubmitting(true);
    try {
      const res = await moveSessionToShift(session.id, targetShiftId);
      if (!res.ok) { setErr(res.error ?? "Could not move this order."); return; }
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[220] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={() => !submitting && onClose()}>
      <div className="w-full max-w-md glass-strong rounded-2xl border border-[oklch(0.7_0.19_260/0.5)] p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-bold mb-2">Move Order to a Different Shift/Date</h3>
        <p className="text-sm text-muted-foreground mb-3">
          <strong>{session.roomName}</strong> — {fmtMoney(session.total)}, currently on{" "}
          {currentShift ? <>Shift #{currentShift.id.slice(0, 14)} ({new Date(currentShift.openedAt).toLocaleDateString()})</> : "no shift"}.
          Moving it will immediately recalculate expected cash/discrepancy for both the source and target shift, if either is already closed.
        </p>
        <div>
          <label className="text-xs uppercase tracking-widest text-muted-foreground">Target Shift</label>
          <select
            value={targetShiftId} onChange={(e) => setTargetShiftId(e.target.value)}
            className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm font-mono"
          >
            <option value="">Select a shift...</option>
            {candidateShifts.map((sh) => (
              <option key={sh.id} value={sh.id}>
                {new Date(sh.openedAt).toLocaleString()} — {sh.cashierUsername}{sh.closedAt ? "" : " (active)"}
              </option>
            ))}
          </select>
        </div>
        {err && <div className="text-sm text-[oklch(0.62_0.24_25)] mt-3">{err}</div>}
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} disabled={submitting} className="px-3 py-1.5 rounded-lg text-sm bg-black/5 border border-black/10">Cancel</button>
          <button
            onClick={() => void submit()}
            disabled={submitting}
            className="px-3 py-1.5 rounded-lg text-sm font-bold bg-gradient-to-r from-[oklch(0.7_0.19_260)] to-[oklch(0.65_0.24_305)] text-[#2b2416] disabled:opacity-50"
          >
            {submitting ? "Moving..." : "Move Order"}
          </button>
        </div>
      </div>
    </div>
  );
}

const EDITABLE_EXPENSE_CATEGORIES = [
  "Expense", "Procurement", "Utilities", "Maintenance", "Office Supplies", "Marketing", "Transportation", "Other",
];

const PAYMENT_SOURCE_LABELS: Record<PaymentSource, string> = {
  cash_drawer: "Cash Drawer / من الدرج",
  out_of_pocket: "Out of Pocket / من الجيب",
  bank_transfer: "Bank Transfer / Visa / InstaPay",
};

// Expenses History — this specific date only (same exclusions as the KPI
// card above: no Staff Orders, no voids). Admins get Edit/Delete on every
// row; both immediately trigger a shift recalculation on the backend if
// the entry belongs to an already-closed shift, and refreshing the
// Ledger here is what makes Selected Day Expenses/Net Profit update
// instantly without a page reload.
function ExpensesHistoryPanel({ isAdmin }: { isAdmin: boolean }) {
  const { state, deleteExpense, deleteSupplierPayment } = useStore();
  const [editingEntry, setEditingEntry] = useState<LedgerEntry | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<LedgerEntry | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  const { startDate, setStartDate, endDate, setEndDate, generating, setGenerating, today } = useSectionDateRange();

  const { from, to } = useMemo(() => rangeBusinessDayBounds(startDate, endDate), [startDate, endDate]);
  const rangeShiftIds = useMemo(
    () => new Set(state.shifts.filter((sh) => sh.openedAt >= from && sh.openedAt <= to).map((sh) => sh.id)),
    [state.shifts, from, to],
  );
  const rangeExpenseEntries = useMemo(
    () => state.ledger.filter(isOperationalExpense).filter((l) => expenseMatchesRange_(l, rangeShiftIds, from, to, startDate, endDate)),
    [state.ledger, rangeShiftIds, from, to, startDate, endDate],
  );
  const rangeSupplierPayments = useMemo(
    () => state.ledger.filter(isSettledSupplierPayment_).filter((l) => expenseMatchesRange_(l, rangeShiftIds, from, to, startDate, endDate)),
    [state.ledger, rangeShiftIds, from, to, startDate, endDate],
  );
  const rangeLabel = formatRangeLabel(startDate, endDate);

  // Settled supplier payments show up here too (Issue 1) so the table
  // actually reflects what's already counted in Total Revenue by
  // Date's Expenses/Net Profit, instead of a total with no rows behind
  // it. They're not editable (editExpense explicitly rejects this type —
  // there's nothing to "amend" about a plain settlement) but they ARE
  // deletable, routed to deleteSupplierPayment instead of deleteExpense
  // since it's a different table (SupplierPayments + its own Ledger row).
  const allRows = useMemo(() => [...rangeExpenseEntries, ...rangeSupplierPayments].sort((a, b) => b.ts - a.ts), [rangeExpenseEntries, rangeSupplierPayments]);
  const isPayment = (l: LedgerEntry) => l.type === "supplierPayment";

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteErr(null);
    try {
      const res = isPayment(deleteTarget) ? await deleteSupplierPayment(deleteTarget.id) : await deleteExpense(deleteTarget.id);
      if (!res.ok) { setDeleteErr(res.error ?? "Could not delete this entry."); return; }
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  const handleGeneratePdf = async () => {
    setGenerating(true);
    try {
      await generateSectionReportPdf({
        sectionTitle: "Expenses History",
        rangeLabel,
        columns: [
          { header: "Expense ID" }, { header: "Description / Category" }, { header: "Amount EGP", align: "right" },
          { header: "Payment Source" }, { header: "Recorded Date & Time" },
        ],
        rows: allRows.map((l) => [
          l.id.slice(0, 12),
          (l.description || l.category) + (l.backdated ? " (backdated)" : "") + (isPayment(l) ? " (supplier payment)" : ""),
          fmtMoney(Number(l.amount)), l.paymentSource ?? "—", new Date(l.ts).toLocaleString(),
        ]),
        summaryLines: [
          { label: "Entries", value: String(allRows.length) },
          { label: "Total", value: fmtMoney(allRows.reduce((a, l) => a + Number(l.amount), 0)) },
        ],
        filenameBase: "Expenses_History",
        startDate, endDate,
        emptyMessage: "No expenses logged in this date range.",
      });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="glass rounded-2xl p-6">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Wallet className="w-5 h-5 text-[oklch(0.62_0.24_25)]" />
          <h2 className="text-lg font-semibold">Expenses History — {rangeLabel}</h2>
        </div>
        <SectionDateRangeToolbar
          startDate={startDate} endDate={endDate}
          onStartDateChange={setStartDate} onEndDateChange={setEndDate}
          onGeneratePdf={() => void handleGeneratePdf()} generating={generating} maxDate={today}
        />
      </div>
      {allRows.length === 0 ? (
        <div className="text-sm text-muted-foreground font-mono text-center py-6">No expenses logged in this date range.</div>
      ) : (
        <div className="overflow-x-auto overflow-y-auto max-h-[32rem] border border-black/8 rounded-xl">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white/95 backdrop-blur-sm">
              <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground border-b border-black/10">
                <th className="pb-2 pt-3 pl-3 pr-3">Expense ID</th>
                <th className="pb-2 pt-3 pr-3">Description / Category</th>
                <th className="pb-2 pt-3 pr-3 text-right">Amount EGP</th>
                <th className="pb-2 pt-3 pr-3">Payment Source</th>
                <th className="pb-2 pt-3 pr-3">Recorded Date &amp; Time</th>
                {isAdmin && <th className="pb-2 pt-3 pr-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {allRows.map((l) => (
                <tr key={l.id} className="border-b border-black/5">
                  <td className="py-2 pl-3 pr-3 font-mono text-xs text-muted-foreground">{l.id.slice(0, 12)}</td>
                  <td className="py-2 pr-3">
                    {l.description || l.category}
                    {l.backdated ? <span className="ml-1.5 text-[10px] uppercase tracking-widest text-[oklch(0.62_0.24_25)]">(backdated)</span> : null}
                    {isPayment(l) ? <span className="ml-1.5 text-[10px] uppercase tracking-widest text-[oklch(0.7_0.19_260)]">(supplier payment)</span> : null}
                  </td>
                  <td className="py-2 pr-3 text-right font-mono font-bold text-[oklch(0.62_0.24_25)]">{fmtMoney(Number(l.amount))}</td>
                  <td className="py-2 pr-3">{l.paymentSource ?? "—"}</td>
                  <td className="py-2 pr-3 font-mono">{new Date(l.ts).toLocaleString()}</td>
                  {isAdmin && (
                    <td className="py-2 pr-3">
                      <div className="flex items-center justify-end gap-1.5">
                        {!isPayment(l) && (
                          <button onClick={() => setEditingEntry(l)} title="Edit" className="w-7 h-7 flex items-center justify-center rounded bg-black/5 border border-black/10 hover:bg-black/10">
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button onClick={() => { setDeleteTarget(l); setDeleteErr(null); }} title="Delete" className="w-7 h-7 flex items-center justify-center rounded bg-black/5 border border-black/10 hover:bg-[oklch(0.62_0.24_25/0.15)] hover:text-[oklch(0.62_0.24_25)]">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editingEntry && <ExpenseEditModal entry={editingEntry} onClose={() => setEditingEntry(null)} />}

      {deleteTarget && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={() => !deleting && setDeleteTarget(null)}>
          <div className="w-full max-w-sm glass-strong rounded-2xl border-2 border-[oklch(0.62_0.24_25/0.5)] p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-bold mb-2 text-[oklch(0.62_0.24_25)]">Delete this {isPayment(deleteTarget) ? "supplier payment" : "expense"}?</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Permanently removes <strong>{deleteTarget.description || deleteTarget.category}</strong> ({fmtMoney(Number(deleteTarget.amount))}).
              {isPayment(deleteTarget) ? " The supplier's outstanding balance goes back up by this amount." : (deleteTarget.shiftId ? " If its shift is already closed, that shift's expected cash and discrepancy will be recalculated immediately." : "")} This can't be undone.
            </p>
            {deleteErr && <div className="text-sm text-[oklch(0.62_0.24_25)] mb-3">{deleteErr}</div>}
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleteTarget(null)} disabled={deleting} className="px-3 py-1.5 rounded-lg text-sm bg-black/5 border border-black/10">Cancel</button>
              <button onClick={() => void confirmDelete()} disabled={deleting} className="px-3 py-1.5 rounded-lg text-sm font-bold bg-[oklch(0.62_0.24_25/0.9)] text-white disabled:opacity-50">
                {deleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ExpenseEditModal({ entry, onClose }: { entry: LedgerEntry; onClose: () => void }) {
  const { editExpense } = useStore();
  const [description, setDescription] = useState(entry.description ?? "");
  const [amount, setAmount] = useState(String(entry.amount));
  const [category, setCategory] = useState(entry.category || "Expense");
  const [paymentSource, setPaymentSource] = useState<PaymentSource | "">(
    entry.paymentSource === "cash_drawer" || entry.paymentSource === "out_of_pocket" || entry.paymentSource === "bank_transfer" ? entry.paymentSource : "",
  );
  // Falls back to a Cairo-pinned label derived from ts for the rare
  // legacy entry logged before expenseDate existed, so the field is
  // never blank -- same fallback logic as the backend's own
  // businessDayLabelForTs_, just so the date shown here always matches
  // what the server would already consider this entry's business day.
  const [expenseDate, setExpenseDate] = useState(entry.expenseDate || cairoDateLabel(entry.ts));
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isUnpaid = entry.paymentStatus === "unpaid";
  const dateChanged = expenseDate !== (entry.expenseDate || cairoDateLabel(entry.ts));

  const submit = async () => {
    setErr(null);
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { setErr("Amount must be greater than zero."); return; }
    if (!description.trim()) { setErr("Description can't be empty."); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expenseDate)) { setErr("Pick a valid date."); return; }
    setSubmitting(true);
    try {
      const res = await editExpense(entry.id, {
        amount: amt,
        category,
        description: description.trim(),
        paymentSource: !isUnpaid && paymentSource ? (paymentSource as PaymentSource) : undefined,
        expenseDate: dateChanged ? expenseDate : undefined,
      });
      if (!res.ok) { setErr(res.error ?? "Could not save changes."); return; }
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-start sm:items-center justify-center p-4 py-8 overflow-y-auto bg-black/70 backdrop-blur-sm" onClick={() => !submitting && onClose()}>
      <div className="w-full max-w-lg max-h-[85vh] flex flex-col glass-strong rounded-2xl border border-[oklch(0.62_0.24_25/0.4)] my-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/8 shrink-0">
          <h3 className="text-lg font-bold">Edit Expense{entry.shiftId ? <span className="ml-2 text-xs font-mono text-muted-foreground">Shift #{entry.shiftId.slice(0, 14)}</span> : null}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-[#2b2416]"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <div>
            <label className="text-xs uppercase tracking-widest text-muted-foreground">Description</label>
            <input
              value={description} onChange={(e) => setDescription(e.target.value)}
              className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2.5 text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs uppercase tracking-widest text-muted-foreground">Amount (EGP)</label>
              <input
                type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)}
                className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2.5 text-sm font-mono"
              />
            </div>
            <div>
              <label className="text-xs uppercase tracking-widest text-muted-foreground">Category</label>
              <select
                value={category} onChange={(e) => setCategory(e.target.value)}
                className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2.5 text-sm"
              >
                {!EDITABLE_EXPENSE_CATEGORIES.includes(category) && <option value={category}>{category}</option>}
                {EDITABLE_EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {isUnpaid ? (
            <div className="text-xs text-muted-foreground bg-black/[0.03] rounded-lg px-3 py-2">
              This entry is unpaid (a debt) — Payment Source isn't set until it's settled via Settle Expense.
            </div>
          ) : (
            <div>
              <label className="text-xs uppercase tracking-widest text-muted-foreground">Payment Source</label>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-1">
                {(Object.keys(PAYMENT_SOURCE_LABELS) as PaymentSource[]).map((src) => (
                  <button
                    key={src}
                    type="button"
                    onClick={() => setPaymentSource(src)}
                    className={`text-xs py-2.5 px-3 rounded-lg border transition ${
                      paymentSource === src
                        ? "bg-black/20 border-black/60 text-[#2b2416] font-semibold"
                        : "bg-black/5 border-black/10 text-muted-foreground hover:bg-black/8"
                    }`}
                  >
                    {PAYMENT_SOURCE_LABELS[src]}
                  </button>
                ))}
              </div>
              {entry.shiftId && (
                <p className="text-[11px] text-black mt-1.5">If this expense's shift is already closed, changing the amount or payment source recalculates that shift's expected cash and discrepancy immediately.</p>
              )}
            </div>
          )}

          <div>
            <label className="text-xs uppercase tracking-widest text-muted-foreground">Expense Date</label>
            <input
              type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)}
              className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2.5 text-sm"
            />
            <p className="text-[11px] text-muted-foreground mt-1.5">
              Which day this shows up under in Expenses History and Net Profit — moves the report entry only, not which shift's drawer it was paid from.
            </p>
          </div>

          {err && <div className="text-sm text-[oklch(0.62_0.24_25)]">{err}</div>}
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-black/8 shrink-0">
          <button onClick={onClose} disabled={submitting} className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-black/5 border border-black/10">Cancel</button>
          <button
            onClick={() => void submit()}
            disabled={submitting}
            className="px-5 py-2.5 rounded-lg text-sm font-bold bg-[oklch(0.62_0.24_25/0.9)] text-white disabled:opacity-50"
          >
            {submitting ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

type RangeKey = "today" | "week" | "month" | "custom";

function WasteMarketingPanel({ allEntries }: { allEntries: LedgerEntry[] }) {
  const [timeframe, setTimeframe] = useState<"day" | "week" | "month">("day");
  const [dateInput, setDateInput] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [monthInput, setMonthInput] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });

  const range = useMemo(() => {
    if (timeframe === "day") {
      const start = new Date(dateInput + "T00:00:00").getTime();
      return { start, end: start + 86400000, label: new Date(dateInput + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }) };
    }
    if (timeframe === "week") {
      const anchor = new Date(dateInput + "T00:00:00");
      const start = new Date(anchor);
      start.setDate(anchor.getDate() - anchor.getDay());
      const startTs = start.getTime();
      const end = startTs + 7 * 86400000;
      const endDate = new Date(end - 1);
      return { start: startTs, end, label: `Week of ${start.toLocaleDateString()} – ${endDate.toLocaleDateString()}` };
    }
    const [y, m] = monthInput.split("-").map(Number);
    const start = new Date(y, m - 1, 1).getTime();
    const end = new Date(y, m, 1).getTime();
    return { start, end, label: new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" }) };
  }, [timeframe, dateInput, monthInput]);

  const entries = useMemo(() => allEntries.filter((e) => e.ts >= range.start && e.ts < range.end).sort((a, b) => b.ts - a.ts), [allEntries, range]);
  const total = entries.reduce((a, e) => a + e.amount, 0);
  const [generating, setGenerating] = useState(false);

  const handleGeneratePdf = async () => {
    setGenerating(true);
    try {
      const startDate = new Date(range.start).toISOString().slice(0, 10);
      const endDate = new Date(range.end - 1).toISOString().slice(0, 10);
      await generateSectionReportPdf({
        sectionTitle: "Wasted / Marketing Expense — Audit Summary",
        rangeLabel: range.label,
        columns: [{ header: "Description" }, { header: "Date & Time" }, { header: "Logged By" }, { header: "Cost EGP", align: "right" }],
        rows: entries.map((e) => [e.description || "Wasted/Marketing item(s)", new Date(e.ts).toLocaleString(), e.staffUsername, fmtMoney(e.amount)]),
        summaryLines: [
          { label: "Entries", value: String(entries.length) },
          { label: "Total (at cost)", value: fmtMoney(total) },
        ],
        filenameBase: "Wasted_Marketing_Expense_Audit_Summary",
        startDate, endDate,
        emptyMessage: "Nothing logged in this period.",
      });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="glass rounded-2xl p-6 border border-[oklch(0.62_0.24_25/0.4)]">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-1">
        <div className="flex items-center gap-2">
          <Trash2 className="w-5 h-5 text-[oklch(0.62_0.24_25)]" />
          <h2 className="text-lg font-semibold">Wasted / Marketing Expense — Audit Summary</h2>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex gap-1.5">
            {(["day", "week", "month"] as const).map((tf) => (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest border ${
                  timeframe === tf
                    ? "bg-[oklch(0.62_0.24_25/0.2)] border-[oklch(0.62_0.24_25/0.6)] text-[oklch(0.62_0.24_25)]"
                    : "bg-black/5 border-black/10 text-muted-foreground"
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
          <button
            onClick={() => void handleGeneratePdf()}
            disabled={generating}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-gradient-to-r from-[oklch(0.7_0.19_260)] to-[oklch(0.65_0.24_305)] text-[#2b2416] font-bold disabled:opacity-50"
          >
            <FileDown className="w-3.5 h-3.5" /> {generating ? "Generating..." : "Generate PDF Report"}
          </button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        Remade orders, complaints, and complimentary hospitality — ingredient cost only, already excluded from revenue
        and Expected Drawer Cash above.
      </p>

      {timeframe === "month" ? (
        <input type="month" value={monthInput} onChange={(e) => setMonthInput(e.target.value)} className="mb-3 bg-white/70 border border-black/10 rounded-lg px-3 py-1.5 text-xs" />
      ) : (
        <input type="date" value={dateInput} onChange={(e) => setDateInput(e.target.value)} max={new Date().toISOString().slice(0, 10)} className="mb-3 bg-white/70 border border-black/10 rounded-lg px-3 py-1.5 text-xs" />
      )}
      <div className="text-[11px] text-muted-foreground uppercase tracking-widest mb-1">{range.label}</div>

      <div className="text-3xl font-mono font-bold text-[oklch(0.62_0.24_25)] mb-4">{fmtMoney(total)}</div>
      {entries.length === 0 ? (
        <div className="text-sm text-muted-foreground font-mono">Nothing logged in this period.</div>
      ) : (
        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {entries.map((e) => (
            <div key={e.id} className="flex items-center justify-between text-xs font-mono bg-white/60 rounded-lg px-3 py-2 border border-black/8">
              <span className="truncate">{e.description || "Wasted/Marketing item(s)"} · {new Date(e.ts).toLocaleString()} · {e.staffUsername}</span>
              <span className="text-[oklch(0.62_0.24_25)] font-bold shrink-0 ml-2">{fmtMoney(e.amount)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BusinessDayPanel() {
  const { state, closeBusinessDay } = useStore();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const currentBd = state.businessDays.find((b) => b.id === state.businessDayId);
  const bdShifts = state.shifts.filter((sh) => sh.businessDayId === state.businessDayId);
  const bdShiftIds = new Set(bdShifts.map((sh) => sh.id));
  const bdSessions = state.sessions.filter((s) => s.shiftId && bdShiftIds.has(s.shiftId));
  const liveRevenue = bdSessions.reduce((a, s) => a + s.total, 0);
  const closedHistory = state.businessDays.filter((b) => b.closedAt !== null);

  const canClose = !!state.businessDayId && !state.activeShiftId;

  const doClose = async () => {
    setClosing(true);
    setErr(null);
    try {
      const res = await closeBusinessDay();
      if (!res.ok) { setErr(res.error ?? "Could not close business day"); return; }
      setConfirmOpen(false);
    } finally {
      setClosing(false);
    }
  };

  return (
    <div className="glass rounded-2xl p-6 border border-black/50">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
        <div className="flex items-center gap-2">
          <Sunrise className="w-5 h-5 text-black" />
          <h2 className="text-lg font-semibold">Current Business Day</h2>
        </div>
        <button onClick={() => setShowHistory((v) => !v)} className="text-xs px-3 py-1.5 rounded-lg bg-black/5 border border-black/10 hover:bg-black/8 flex items-center gap-1.5">
          <History className="w-3.5 h-3.5" /> {showHistory ? "Hide" : "Show"} History
        </button>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        A business day stays open across any number of shifts — Shift 1, 2, 3 — even straight through midnight. It only
        ends when you explicitly close it here.
      </p>

      {state.businessDayId ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div className="bg-black/5 rounded-lg p-3 border border-black/8">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Opened</div>
            <div className="text-sm font-mono font-bold mt-1">{currentBd ? new Date(currentBd.openedAt).toLocaleString() : "—"}</div>
          </div>
          <div className="bg-black/5 rounded-lg p-3 border border-black/8">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Shifts So Far</div>
            <div className="text-lg font-mono font-bold mt-1">{bdShifts.length}</div>
          </div>
          <div className="bg-black/5 rounded-lg p-3 border border-black/8 col-span-2">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Revenue So Far (Live)</div>
            <div className="text-lg font-mono font-bold mt-1 text-[oklch(0.78_0.2_155)]">{fmtMoney(liveRevenue)}</div>
          </div>
        </div>
      ) : (
        <div className="text-sm text-muted-foreground font-mono mb-4">No business day is open yet — one starts automatically the moment the next shift opens.</div>
      )}

      {!canClose && state.businessDayId && (
        <div className="flex items-center gap-2 text-xs text-black mb-3">
          <AlertTriangle className="w-3.5 h-3.5" /> Close the active shift first — a business day can't close while a shift is still running.
        </div>
      )}

      <button
        onClick={() => setConfirmOpen(true)}
        disabled={!canClose}
        className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-r from-black to-black text-[#2b2416] text-sm font-bold uppercase tracking-wide disabled:opacity-40"
      >
        <CalendarCheck className="w-4 h-4" /> Close Business Day
      </button>

      {showHistory && (
        <div className="mt-5 pt-4 border-t border-black/8">
          <h3 className="text-sm font-semibold mb-2">Closed Business Days</h3>
          {closedHistory.length === 0 ? (
            <div className="text-xs text-muted-foreground font-mono">None closed yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[9px] uppercase tracking-widest text-muted-foreground border-b border-black/8">
                    <th className="text-left py-1.5 px-2">Opened</th>
                    <th className="text-left py-1.5 px-2">Closed</th>
                    <th className="text-right py-1.5 px-2">Shifts</th>
                    <th className="text-right py-1.5 px-2">Revenue</th>
                    <th className="text-right py-1.5 px-2">Expenses</th>
                    <th className="text-right py-1.5 px-2">Net Profit</th>
                    <th className="text-left py-1.5 px-2">Closed By</th>
                  </tr>
                </thead>
                <tbody>
                  {closedHistory.map((b) => (
                    <tr key={b.id} className="border-b border-black/8">
                      <td className="py-1.5 px-2 font-mono">{new Date(b.openedAt).toLocaleString()}</td>
                      <td className="py-1.5 px-2 font-mono">{b.closedAt ? new Date(b.closedAt).toLocaleString() : "—"}</td>
                      <td className="py-1.5 px-2 text-right font-mono">{b.shiftCount}</td>
                      <td className="py-1.5 px-2 text-right font-mono">{fmtMoney(b.totalRevenue)}</td>
                      <td className="py-1.5 px-2 text-right font-mono">{fmtMoney(b.totalExpenses)}</td>
                      <td className="py-1.5 px-2 text-right font-mono font-bold">{fmtMoney(b.netProfit)}</td>
                      <td className="py-1.5 px-2">{b.closedBy}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {confirmOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={() => setConfirmOpen(false)}>
          <div className="w-full max-w-md glass-strong rounded-2xl border border-black/50" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 space-y-3">
              <h3 className="text-lg font-bold">Close Business Day?</h3>
              <p className="text-sm text-muted-foreground">
                This freezes and aggregates <strong>{fmtMoney(liveRevenue)}</strong> in revenue across{" "}
                <strong>{bdShifts.length}</strong> shift{bdShifts.length === 1 ? "" : "s"} into the permanent financial
                ledger, then opens a brand new business day starting from zero for the next shift. This cannot be undone.
              </p>
              {err && <div className="text-sm text-[oklch(0.62_0.24_25)]">{err}</div>}
            </div>
            <div className="p-4 border-t border-black/8 flex justify-end gap-2">
              <button onClick={() => setConfirmOpen(false)} className="px-4 py-2 rounded-lg text-sm bg-black/5 hover:bg-black/8 border border-black/10">Cancel</button>
              <button
                onClick={doClose}
                disabled={closing}
                className="px-4 py-2 rounded-lg text-sm bg-gradient-to-r from-black to-black text-[#2b2416] font-bold disabled:opacity-60"
              >
                {closing ? "Closing..." : "Confirm & Close"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Fixed to the CURRENT calendar month (Day 1 00:00:00 through the last
// day 23:59:59) — deliberately independent of the Detailed Ledger
// panel's own Today/Week/Month/Custom picker below it, per the
// explicit requirement that this is a standing monthly summary, not
// another range selection.
function MonthlyReconciliationDashboard({ selectedMonth, onMonthChange }: { selectedMonth: string; onMonthChange: (month: string) => void }) {
  const { state } = useStore();

  // A month's business-day range spans from Day 1's business-day start
  // through the last day's business-day end — extending the same
  // 8 AM (with grace window) shift-first logic across the whole month,
  // rather than switching to a different midnight-based definition
  // just because the scope widened from a day to a month.
  const { monthStart, monthEnd, monthLabel } = useMemo(() => {
    const [y, m] = selectedMonth.split("-").map(Number);
    const firstDay = `${selectedMonth}-01`;
    const lastDayNum = new Date(y, m, 0).getDate();
    const lastDay = `${selectedMonth}-${String(lastDayNum).padStart(2, "0")}`;
    const start = businessDayBounds(firstDay).from;
    const end = businessDayBounds(lastDay).to;
    const label = new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
    return { monthStart: start, monthEnd: end, monthLabel: label };
  }, [selectedMonth]);

  // Shift-first: the month is defined by which shifts OPENED within
  // this business-day range, not by re-deriving a calendar date from
  // each record's own timestamp — this is what keeps a shift that
  // opens late (and runs past midnight, or even past the business-day
  // cutoff) fully counted in the month it started, never split across two.
  const monthShiftIds = useMemo(
    () => new Set(state.shifts.filter((sh) => sh.openedAt >= monthStart && sh.openedAt <= monthEnd).map((sh) => sh.id)),
    [state.shifts, monthStart, monthEnd],
  );
  const totalRevenue = useMemo(
    () => filterByBusinessDay(state.sessions, monthShiftIds, monthStart, monthEnd).reduce((a, s) => a + s.total, 0),
    [state.sessions, monthShiftIds, monthStart, monthEnd],
  );

  // Operational expenses and supplier purchases for this month —
  // already includes procurement/supplier invoices (the source of
  // COGS), so this deliberately does NOT add a separate COGS term
  // below -- doing so would double-count the same raw-material spend.
  // Also includes settled supplier-account payments (deferred invoices
  // paid off this month) — see isSettledSupplierPayment_ for why these
  // have to be counted here on a cash basis, on pain of a deferred
  // purchase's cost never appearing in Net Profit at all.
  const totalExpenses = useMemo(
    () => [
      ...state.ledger.filter(isOperationalExpense),
      ...state.ledger.filter(isSettledSupplierPayment_),
    ]
      .filter((l) => expenseMatchesMonth_(l, monthShiftIds, monthStart, monthEnd, selectedMonth))
      .reduce((a, l) => a + Number(l.amount), 0),
    [state.ledger, monthShiftIds, monthStart, monthEnd, selectedMonth],
  );

  // Fixed monthly costs are now genuine, dated Ledger entries
  // (fixedMonthlyCost type) logged via the dedicated module below,
  // not a flat sum of RecurringExpenses config rows — this is what
  // makes the figure change month to month rather than always
  // reporting the same static total regardless of which month is
  // selected.
  const monthFixedCosts = useMemo(
    () => filterByBusinessDay(state.ledger.filter((l) => l.type === "fixedMonthlyCost" && l.status === "approved"), monthShiftIds, monthStart, monthEnd),
    [state.ledger, monthShiftIds, monthStart, monthEnd],
  );
  const totalFixedExpenses = useMemo(() => monthFixedCosts.reduce((a, l) => a + Number(l.amount), 0), [monthFixedCosts]);

  const netProfit = totalRevenue - (totalExpenses + totalFixedExpenses);
  const isProfit = netProfit >= 0;

  return (
    <div className="glass rounded-2xl p-6">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-1">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-[oklch(0.7_0.19_260)]" />
          <h2 className="text-lg font-semibold">Financial Reconciliation</h2>
        </div>
        <input
          type="month" value={selectedMonth} max={cairoDateLabel(Date.now()).slice(0, 7)}
          onChange={(e) => onMonthChange(e.target.value)}
          className="bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm font-mono"
        />
      </div>
      <p className="text-xs text-muted-foreground mb-4">{monthLabel} — Day 1 through the last day, by each shift's own start time</p>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white/60 rounded-xl p-5 border border-black/8">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Revenue</div>
          <div className="text-2xl font-mono font-bold mt-2 text-[oklch(0.78_0.2_155)]">{fmtMoney(totalRevenue)}</div>
        </div>
        <div className="bg-white/60 rounded-xl p-5 border border-black/8">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Expenses &amp; Purchases</div>
          <div className="text-2xl font-mono font-bold mt-2 text-[oklch(0.62_0.24_25)]">{fmtMoney(totalExpenses)}</div>
        </div>
        <div className="bg-white/60 rounded-xl p-5 border border-black/8">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Fixed Monthly Costs</div>
          <div className="text-2xl font-mono font-bold mt-2 text-[oklch(0.62_0.24_25)]">{fmtMoney(totalFixedExpenses)}</div>
        </div>
        <div
          className={`rounded-xl p-5 border-2 shadow-lg ${
            isProfit
              ? "bg-gradient-to-br from-[oklch(0.78_0.2_155/0.2)] to-[oklch(0.78_0.2_155/0.05)] border-[oklch(0.78_0.2_155/0.6)] shadow-[oklch(0.78_0.2_155/0.3)]"
              : "bg-gradient-to-br from-[oklch(0.62_0.24_25/0.2)] to-[oklch(0.62_0.24_25/0.05)] border-[oklch(0.62_0.24_25/0.6)] shadow-[oklch(0.62_0.24_25/0.3)]"
          }`}
        >
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Net Profit {isProfit ? "(+ Profit)" : "(− Loss)"}</div>
          <div className={`text-2xl font-mono font-black mt-2 ${isProfit ? "text-[oklch(0.78_0.2_155)]" : "text-[oklch(0.62_0.24_25)]"}`}>
            {fmtMoney(netProfit)}
          </div>
        </div>
      </div>
    </div>
  );
}

const AUDIT_MONTHS = ["2026-08", "2026-09"] as const;
type AuditMonth = (typeof AUDIT_MONTHS)[number];

// Dedicated Monthly Financial & Sales Audit Report — deliberately scoped
// to exactly Month 8 (August 2026) and Month 9 (September 2026), not a
// free-pick month selector like Financial Reconciliation above. Shows
// the same Revenue / Expenses & Purchases / Net Profit summary (with an
// optional side-by-side comparison of both months), plus a full
// item-level sales & COGS breakdown table for whichever of the two
// months is currently selected, and an export button that rasterizes
// the whole thing into a downloadable PDF (same html2pdf.js approach as
// the Inventory Audit Report, for reliable Arabic text rendering).
function MonthlyFinancialAuditReport() {
  const { state } = useStore();
  const [auditMonth, setAuditMonth] = useState<AuditMonth>("2026-09");
  const [compareView, setCompareView] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genErr, setGenErr] = useState<string | null>(null);

  const financialsByMonth = useMemo(
    () => Object.fromEntries(AUDIT_MONTHS.map((m) => [m, computeMonthFinancials(state, m)])) as Record<AuditMonth, MonthlyAuditFinancials>,
    [state],
  );
  const selectedFinancials = financialsByMonth[auditMonth];
  const itemBreakdown = useMemo(() => computeItemSalesBreakdown(state, auditMonth), [state, auditMonth]);

  const handleExport = async () => {
    setGenerating(true);
    setGenErr(null);
    try {
      await generateMonthlyAuditReportPdf({
        financials: selectedFinancials,
        items: itemBreakdown.rows,
        totalRevenue: itemBreakdown.totalRevenue,
        totalCost: itemBreakdown.totalCost,
        totalProfit: itemBreakdown.totalProfit,
      });
    } catch (e) {
      setGenErr(e instanceof Error ? e.message : "Could not generate the PDF — please try again.");
    } finally {
      setGenerating(false);
    }
  };

  const financialCard = (f: MonthlyAuditFinancials, highlighted: boolean) => (
    <div key={f.monthStr} className={`rounded-xl p-5 border ${highlighted ? "border-[oklch(0.7_0.19_260/0.6)] bg-[oklch(0.7_0.19_260/0.06)]" : "border-black/8 bg-white/60"}`}>
      <div className="text-xs uppercase tracking-widest text-muted-foreground mb-3">{f.monthLabel}</div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Revenue<br /><span dir="rtl" className="normal-case font-normal opacity-70">الإيرادات</span></div>
          <div className="text-lg font-mono font-bold text-[oklch(0.78_0.2_155)]">{fmtMoney(f.revenue)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Expenses &amp; Purchases<br /><span dir="rtl" className="normal-case font-normal opacity-70">المصاريف والمشتريات</span></div>
          <div className="text-lg font-mono font-bold text-[oklch(0.62_0.24_25)]">{fmtMoney(f.expenses)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Net Profit<br /><span dir="rtl" className="normal-case font-normal opacity-70">صافي الربح</span></div>
          <div className={`text-lg font-mono font-black ${f.netProfit >= 0 ? "text-[oklch(0.78_0.2_155)]" : "text-[oklch(0.62_0.24_25)]"}`}>{fmtMoney(f.netProfit)}</div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="glass rounded-2xl p-6 border border-[oklch(0.7_0.19_260/0.4)]">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-1">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-[oklch(0.7_0.19_260)]" />
          <h2 className="text-lg font-semibold">Monthly Financial &amp; Sales Audit Report</h2>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-lg border border-black/10 overflow-hidden">
            {AUDIT_MONTHS.map((m) => (
              <button
                key={m}
                onClick={() => setAuditMonth(m)}
                className={`px-3 py-2 text-xs font-bold uppercase tracking-widest ${auditMonth === m ? "bg-[oklch(0.7_0.19_260/0.2)] text-[oklch(0.7_0.19_260)]" : "bg-white/60 text-muted-foreground hover:bg-black/5"}`}
              >
                {financialsByMonth[m].monthLabel}
              </button>
            ))}
          </div>
          <button
            onClick={() => setCompareView((v) => !v)}
            className={`px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-widest border ${compareView ? "bg-black/15 border-black/50 text-[#2b2416]" : "bg-black/5 border-black/10 text-muted-foreground hover:bg-black/8"}`}
          >
            {compareView ? "Hide Comparison" : "Compare Aug vs Sep"}
          </button>
          <button
            onClick={() => void handleExport()}
            disabled={generating}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-[oklch(0.7_0.19_260)] to-[oklch(0.65_0.24_305)] text-[#2b2416] text-sm font-semibold disabled:opacity-60"
          >
            <FileDown className="w-4 h-4" /> {generating ? "Generating PDF..." : "Download PDF / Print Report"}
          </button>
        </div>
      </div>
      {genErr && <div className="text-xs text-[oklch(0.62_0.24_25)] mb-2">{genErr}</div>}

      <p className="text-xs text-muted-foreground mb-4">
        Month 8 (August 2026) and Month 9 (September 2026) only — business-day bound (8 AM to 8 AM), the same
        definition used everywhere else on this page.
      </p>

      <div className={`grid gap-4 mb-6 ${compareView ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1"}`}>
        {compareView
          ? AUDIT_MONTHS.map((m) => financialCard(financialsByMonth[m], m === auditMonth))
          : financialCard(selectedFinancials, true)}
      </div>

      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Item-Level Sales &amp; Cost Breakdown — {selectedFinancials.monthLabel}
          <span dir="rtl" className="normal-case font-normal opacity-70 ml-2">تقرير مبيعات وتكلفة الأصناف</span>
        </h3>
      </div>

      {itemBreakdown.rows.length === 0 ? (
        <div className="text-sm text-muted-foreground font-mono text-center py-6">No sales recorded in {selectedFinancials.monthLabel}.</div>
      ) : (
        <div className="overflow-x-auto overflow-y-auto max-h-[32rem] border border-black/8 rounded-xl">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white/95 backdrop-blur-sm">
              <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground border-b border-black/10">
                <th className="pb-2 pt-3 pl-3 pr-3">Item<br /><span dir="rtl" className="normal-case font-normal opacity-70">اسم الصنف</span></th>
                <th className="pb-2 pt-3 pr-3 text-right">Qty Sold<br /><span dir="rtl" className="normal-case font-normal opacity-70">الكمية</span></th>
                <th className="pb-2 pt-3 pr-3 text-right">Revenue<br /><span dir="rtl" className="normal-case font-normal opacity-70">إجمالي البيع</span></th>
                <th className="pb-2 pt-3 pr-3 text-right">Unit Cost<br /><span dir="rtl" className="normal-case font-normal opacity-70">تكلفة الوحدة</span></th>
                <th className="pb-2 pt-3 pr-3 text-right">Total Cost (COGS)<br /><span dir="rtl" className="normal-case font-normal opacity-70">إجمالي التكلفة</span></th>
                <th className="pb-2 pt-3 pr-3 text-right">Profit<br /><span dir="rtl" className="normal-case font-normal opacity-70">المكسب</span></th>
                <th className="pb-2 pt-3 pr-3 text-right">Margin</th>
              </tr>
            </thead>
            <tbody>
              {itemBreakdown.rows.map((r) => (
                <tr key={r.name} className="border-b border-black/5">
                  <td className="py-2 pl-3 pr-3 font-semibold">{r.name}</td>
                  <td className="py-2 pr-3 text-right font-mono">{r.qty}</td>
                  <td className="py-2 pr-3 text-right font-mono text-[oklch(0.78_0.2_155)]">{fmtMoney(r.revenue)}</td>
                  <td className="py-2 pr-3 text-right font-mono text-muted-foreground">{fmtMoney(r.unitCost)}</td>
                  <td className="py-2 pr-3 text-right font-mono text-[oklch(0.62_0.24_25)]">{fmtMoney(r.totalCost)}</td>
                  <td className={`py-2 pr-3 text-right font-mono font-bold ${r.profit >= 0 ? "text-[oklch(0.78_0.2_155)]" : "text-[oklch(0.62_0.24_25)]"}`}>{fmtMoney(r.profit)}</td>
                  <td className="py-2 pr-3 text-right font-mono text-muted-foreground">{r.marginPct === null ? "—" : `${r.marginPct}%`}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-black/20 font-bold">
                <td className="py-3 pl-3 pr-3">Total</td>
                <td className="py-3 pr-3 text-right font-mono">{itemBreakdown.rows.reduce((a, r) => a + r.qty, 0)}</td>
                <td className="py-3 pr-3 text-right font-mono text-[oklch(0.78_0.2_155)]">{fmtMoney(itemBreakdown.totalRevenue)}</td>
                <td className="py-3 pr-3"></td>
                <td className="py-3 pr-3 text-right font-mono text-[oklch(0.62_0.24_25)]">{fmtMoney(itemBreakdown.totalCost)}</td>
                <td className={`py-3 pr-3 text-right font-mono ${itemBreakdown.totalProfit >= 0 ? "text-[oklch(0.78_0.2_155)]" : "text-[oklch(0.62_0.24_25)]"}`}>{fmtMoney(itemBreakdown.totalProfit)}</td>
                <td className="py-3 pr-3 text-right font-mono">
                  {itemBreakdown.totalRevenue > 0 ? `${Math.round((itemBreakdown.totalProfit / itemBreakdown.totalRevenue) * 1000) / 10}%` : "—"}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

const FIXED_COST_CATEGORIES = ["Fixed Overhead", "Rent", "Utilities", "Internet", "Subscriptions", "Salaries", "Other"];

// A dedicated ledger for actually-paid fixed monthly costs (rent,
// utilities, internet, subscriptions) — distinct from the old
// RecurringExpenses config list, which had no UI anywhere to
// populate it and no date/logger per entry, only a static list of
// templates. Every entry here is a real, dated, admin-logged payment
// from owner revenue, explicitly outside the daily cash drawer.
function FixedMonthlyCostsLedger() {
  const { state, deleteFixedMonthlyCost } = useStore();
  const [formOpen, setFormOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<LedgerEntry | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<LedgerEntry | null>(null);
  const { startDate, setStartDate, endDate, setEndDate, generating, setGenerating, today } = useSectionDateRangeMonthToDate();

  const allEntries = useMemo(
    () => state.ledger.filter((l) => l.type === "fixedMonthlyCost").sort((a, b) => b.ts - a.ts),
    [state.ledger],
  );
  const { from, to } = useMemo(() => rangeBusinessDayBounds(startDate, endDate), [startDate, endDate]);
  const entries = useMemo(() => allEntries.filter((l) => l.ts >= from && l.ts <= to), [allEntries, from, to]);
  const total = entries.reduce((a, l) => a + Number(l.amount), 0);
  const rangeLabel = formatRangeLabel(startDate, endDate);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    await deleteFixedMonthlyCost(deleteTarget.id);
    setDeleteTarget(null);
  };

  const handleGeneratePdf = async () => {
    setGenerating(true);
    try {
      await generateSectionReportPdf({
        sectionTitle: "Fixed Monthly Costs",
        sectionTitleAr: "المصاريف الشهرية الثابتة",
        rangeLabel,
        columns: [
          { header: "Date & Time" }, { header: "Expense" }, { header: "Amount EGP", align: "right" },
          { header: "Category" }, { header: "Logged By" }, { header: "Payment Source" },
        ],
        rows: entries.map((l) => [new Date(l.ts).toLocaleString(), l.description, fmtMoney(Number(l.amount)), l.category, l.staffUsername, "Owner Revenue"]),
        summaryLines: [
          { label: "Entries", value: String(entries.length) },
          { label: "Total", value: fmtMoney(total) },
        ],
        filenameBase: "Fixed_Monthly_Costs",
        startDate, endDate,
        emptyMessage: "No fixed monthly costs logged in this date range.",
      });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="glass rounded-2xl p-6">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-1">
        <div className="flex items-center gap-2">
          <Wallet className="w-5 h-5 text-[oklch(0.62_0.24_25)]" />
          <h2 className="text-lg font-semibold">Fixed Monthly Costs — المصاريف الشهرية الثابتة</h2>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="text-sm font-mono font-bold text-[oklch(0.62_0.24_25)]">{fmtMoney(total)} in range</div>
          <button
            onClick={() => { setEditingEntry(null); setFormOpen(true); }}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-[oklch(0.62_0.24_25/0.1)] border border-[oklch(0.62_0.24_25/0.4)] text-[oklch(0.62_0.24_25)] hover:bg-[oklch(0.62_0.24_25/0.2)] font-bold"
          >
            <Plus className="w-3.5 h-3.5" /> Add Fixed Monthly Cost
          </button>
        </div>
      </div>
      <div className="mb-3">
        <SectionDateRangeToolbar
          startDate={startDate} endDate={endDate}
          onStartDateChange={setStartDate} onEndDateChange={setEndDate}
          onGeneratePdf={() => void handleGeneratePdf()} generating={generating} maxDate={today}
        />
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Rent, utilities, internet, subscriptions — paid directly from owner revenue, never from the daily cashier
        drawer. These never affect a shift's Expected Cash or count toward a drawer discrepancy. Showing {rangeLabel}.
      </p>
      {entries.length === 0 ? (
        <div className="text-sm text-muted-foreground font-mono text-center py-8">No fixed monthly costs logged in this date range.</div>
      ) : (
        <div className="overflow-x-auto overflow-y-auto max-h-[28rem] border border-black/8 rounded-xl">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white/95 backdrop-blur-sm">
              <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground border-b border-black/10">
                <th className="pb-2 pt-3 pl-3 pr-3">Date &amp; Time</th>
                <th className="pb-2 pt-3 pr-3">Expense</th>
                <th className="pb-2 pt-3 pr-3 text-right">Amount EGP</th>
                <th className="pb-2 pt-3 pr-3">Category</th>
                <th className="pb-2 pt-3 pr-3">Logged By</th>
                <th className="pb-2 pt-3 pr-3">Payment Source</th>
                <th className="pb-2 pt-3 pr-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((l) => (
                <tr key={l.id} className="border-b border-black/5">
                  <td className="py-2 pl-3 pr-3 font-mono">{new Date(l.ts).toLocaleString()}</td>
                  <td className="py-2 pr-3 font-semibold">{l.description}</td>
                  <td className="py-2 pr-3 text-right font-mono font-bold text-[oklch(0.62_0.24_25)]">{fmtMoney(Number(l.amount))}</td>
                  <td className="py-2 pr-3">{l.category}</td>
                  <td className="py-2 pr-3">{l.staffUsername}</td>
                  <td className="py-2 pr-3 text-xs uppercase">Owner Revenue</td>
                  <td className="py-2 pr-3">
                    <div className="flex items-center justify-end gap-1.5">
                      <button onClick={() => { setEditingEntry(l); setFormOpen(true); }} title="Edit" className="w-7 h-7 flex items-center justify-center rounded bg-black/5 border border-black/10 hover:bg-black/10">
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => setDeleteTarget(l)} title="Delete" className="w-7 h-7 flex items-center justify-center rounded bg-black/5 border border-black/10 hover:bg-[oklch(0.62_0.24_25/0.15)] hover:text-[oklch(0.62_0.24_25)]">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {formOpen && <FixedMonthlyCostFormModal entry={editingEntry} onClose={() => setFormOpen(false)} />}

      {deleteTarget && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={() => setDeleteTarget(null)}>
          <div className="w-full max-w-sm glass-strong rounded-2xl border-2 border-[oklch(0.62_0.24_25/0.5)] p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-bold mb-2 text-[oklch(0.62_0.24_25)]">Delete this entry?</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Permanently removes <strong>{deleteTarget.description}</strong> ({fmtMoney(Number(deleteTarget.amount))}). This can't be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleteTarget(null)} className="px-3 py-1.5 rounded-lg text-sm bg-black/5 border border-black/10">Cancel</button>
              <button onClick={() => void confirmDelete()} className="px-3 py-1.5 rounded-lg text-sm font-bold bg-[oklch(0.62_0.24_25/0.9)] text-white">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FixedMonthlyCostFormModal({ entry, onClose }: { entry: LedgerEntry | null; onClose: () => void }) {
  const { addFixedMonthlyCost, updateFixedMonthlyCost } = useStore();
  const isEdit = !!entry;
  const entryDate = entry ? new Date(entry.ts) : new Date();

  const [description, setDescription] = useState(entry?.description ?? "");
  const [amount, setAmount] = useState(entry ? String(entry.amount) : "");
  const [category, setCategory] = useState(entry?.category ?? "Fixed Overhead");
  const [date, setDate] = useState(entryDate.toISOString().slice(0, 10));
  const [time, setTime] = useState(`${String(entryDate.getHours()).padStart(2, "0")}:${String(entryDate.getMinutes()).padStart(2, "0")}`);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    if (!description.trim()) { setErr("Expense description is required."); return; }
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { setErr("Amount must be greater than zero."); return; }
    const ts = new Date(`${date}T${time}`).getTime();
    if (Number.isNaN(ts)) { setErr("Invalid date/time."); return; }

    setSubmitting(true);
    try {
      if (isEdit && entry) {
        const res = await updateFixedMonthlyCost(entry.id, { description: description.trim(), amount: amt, category, ts });
        if (!res.ok) { setErr(res.error ?? "Could not save changes."); return; }
      } else {
        const res = await addFixedMonthlyCost({ description: description.trim(), amount: amt, category, notes: notes.trim() || undefined, ts });
        if (!res.ok) { setErr(res.error ?? "Could not log this expense."); return; }
      }
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-start sm:items-center justify-center p-4 py-8 overflow-y-auto bg-black/70 backdrop-blur-sm" onClick={() => !submitting && onClose()}>
      <div className="w-full max-w-lg max-h-[85vh] flex flex-col glass-strong rounded-2xl border border-[oklch(0.62_0.24_25/0.4)] my-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/8 shrink-0">
          <h3 className="text-lg font-bold">{isEdit ? "Edit Fixed Monthly Cost" : "Add Fixed Monthly Cost"}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-[#2b2416]"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <div>
            <label className="text-xs uppercase tracking-widest text-muted-foreground">Expense Name / Description</label>
            <input
              value={description} onChange={(e) => setDescription(e.target.value)}
              className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2.5 text-sm"
              placeholder="e.g. إيجار المحل / فاتورة الكهرباء"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs uppercase tracking-widest text-muted-foreground">Amount (EGP)</label>
              <input
                type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)}
                className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2.5 text-sm font-mono"
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="text-xs uppercase tracking-widest text-muted-foreground">Category</label>
              <select
                value={category} onChange={(e) => setCategory(e.target.value)}
                className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2.5 text-sm"
              >
                {FIXED_COST_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs uppercase tracking-widest text-muted-foreground">Date</label>
              <input
                type="date" value={date} onChange={(e) => setDate(e.target.value)}
                className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2.5 text-sm font-mono"
              />
            </div>
            <div>
              <label className="text-xs uppercase tracking-widest text-muted-foreground">Time</label>
              <input
                type="time" value={time} onChange={(e) => setTime(e.target.value)}
                className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2.5 text-sm font-mono"
              />
            </div>
          </div>

          {!isEdit && (
            <div>
              <label className="text-xs uppercase tracking-widest text-muted-foreground">Notes (optional)</label>
              <textarea
                value={notes} onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2.5 text-sm resize-none"
                placeholder="Any extra detail worth keeping with this entry"
              />
            </div>
          )}

          <div className="text-xs text-muted-foreground bg-black/[0.03] rounded-lg px-3 py-2">
            Payment Source: <strong>Owner Revenue</strong> — this is always paid outside the daily cash drawer and never affects a shift's Expected Cash.
          </div>

          {err && <div className="text-sm text-[oklch(0.62_0.24_25)]">{err}</div>}
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-black/8 shrink-0">
          <button onClick={onClose} disabled={submitting} className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-black/5 border border-black/10">Cancel</button>
          <button
            onClick={() => void submit()}
            disabled={submitting}
            className="px-5 py-2.5 rounded-lg text-sm font-bold bg-[oklch(0.62_0.24_25/0.9)] text-white disabled:opacity-50"
          >
            {submitting ? "Saving..." : isEdit ? "Save Changes" : "Log Expense"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Automatically logged the instant a deferred/credit supplier invoice
// (or any outstanding balance) is settled via Record Payment — this
// IS the settlement itself (every supplierPayment Ledger entry), not a
// separate write path, so there's no way for a settlement to happen
// without appearing here. Deliberately excluded from Daily/Monthly
// Expenses above, since it settles a debt incurred whenever the
// original invoice was logged, not a new expense today.
// Deliberately GLOBAL, never filtered by the date picker elsewhere on
// this page — every deferred/credit supplier invoice settlement ever
// recorded, regardless of when. A settlement made today for an
// invoice from months ago belongs here permanently, not scoped to
// whatever date happens to be selected in Total Revenue by Date.
function MonthlyExpensesLedger() {
  const { state } = useStore();
  const isAdmin = state.currentUser?.role === "admin";
  const [clearModalOpen, setClearModalOpen] = useState(false);
  const { startDate, setStartDate, endDate, setEndDate, generating, setGenerating, today } = useSectionDateRangeMonthToDate();

  // All-time, unaffected by the section's own date-range picker below —
  // Clear Ledger is a global destructive action on every settlement
  // ever recorded, not just whatever's currently in view.
  const settlements = useMemo(
    () => state.ledger.filter((l) => l.type === "supplierPayment").sort((a, b) => b.ts - a.ts),
    [state.ledger],
  );
  const allTimeTotal = settlements.reduce((a, l) => a + Number(l.amount), 0);

  const { from, to } = useMemo(() => rangeBusinessDayBounds(startDate, endDate), [startDate, endDate]);
  const rangeSettlements = useMemo(() => settlements.filter((l) => l.ts >= from && l.ts <= to), [settlements, from, to]);
  const rangeTotal = rangeSettlements.reduce((a, l) => a + Number(l.amount), 0);
  const rangeLabel = formatRangeLabel(startDate, endDate);

  const handleGeneratePdf = async () => {
    setGenerating(true);
    try {
      await generateSectionReportPdf({
        sectionTitle: "Expenses Ledger",
        rangeLabel,
        columns: [
          { header: "Date & Time" }, { header: "Supplier" }, { header: "Description" },
          { header: "Amount EGP", align: "right" }, { header: "Payment Source" }, { header: "Settled By" },
        ],
        rows: rangeSettlements.map((l) => {
          const supplier = state.suppliers.find((s) => s.id === l.supplierId);
          return [new Date(l.ts).toLocaleString(), supplier?.name ?? "—", l.description || "—", fmtMoney(Number(l.amount)), l.paymentSource ?? "—", l.staffUsername];
        }),
        summaryLines: [
          { label: "Settlements", value: String(rangeSettlements.length) },
          { label: "Total Settled", value: fmtMoney(rangeTotal) },
        ],
        filenameBase: "Expenses_Ledger",
        startDate, endDate,
        emptyMessage: "No settled supplier payments in this date range.",
      });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="glass rounded-2xl p-6">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
        <div className="flex items-center gap-2">
          <Wallet className="w-5 h-5 text-[oklch(0.65_0.24_305)]" />
          <h2 className="text-lg font-semibold">Expenses Ledger</h2>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="text-sm font-mono font-bold text-[oklch(0.65_0.24_305)]">{fmtMoney(allTimeTotal)} settled all-time</div>
          {isAdmin && settlements.length > 0 && (
            <button
              onClick={() => setClearModalOpen(true)}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-[oklch(0.62_0.24_25/0.1)] border border-[oklch(0.62_0.24_25/0.4)] text-[oklch(0.62_0.24_25)] hover:bg-[oklch(0.62_0.24_25/0.2)]"
            >
              <Trash2 className="w-3.5 h-3.5" /> Clear Ledger
            </button>
          )}
        </div>
      </div>
      <div className="mb-3">
        <SectionDateRangeToolbar
          startDate={startDate} endDate={endDate}
          onStartDateChange={setStartDate} onEndDateChange={setEndDate}
          onGeneratePdf={() => void handleGeneratePdf()} generating={generating} maxDate={today}
        />
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Every deferred/credit supplier invoice or outstanding balance settled via Record Payment — logged
        automatically the instant it's paid. Showing {rangeLabel} ({fmtMoney(rangeTotal)}); Clear Ledger still
        affects every settlement ever recorded, not just this range.
      </p>
      {rangeSettlements.length === 0 ? (
        <div className="text-sm text-muted-foreground font-mono text-center py-6">No settled supplier payments in this date range.</div>
      ) : (
        <div className="overflow-x-auto overflow-y-auto max-h-[32rem] border border-black/8 rounded-xl">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white/95 backdrop-blur-sm">
              <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground border-b border-black/10">
                <th className="pb-2 pt-3 pl-3 pr-3">Date &amp; Time</th>
                <th className="pb-2 pt-3 pr-3">Supplier</th>
                <th className="pb-2 pt-3 pr-3">Description</th>
                <th className="pb-2 pt-3 pr-3 text-right">Amount EGP</th>
                <th className="pb-2 pt-3 pr-3">Payment Source</th>
                <th className="pb-2 pt-3">Settled By</th>
              </tr>
            </thead>
            <tbody>
              {rangeSettlements.map((l) => {
                const supplier = state.suppliers.find((s) => s.id === l.supplierId);
                return (
                  <tr key={l.id} className="border-b border-black/5">
                    <td className="py-2 pl-3 pr-3 font-mono">{new Date(l.ts).toLocaleString()}</td>
                    <td className="py-2 pr-3 font-semibold">{supplier?.name ?? "—"}</td>
                    <td className="py-2 pr-3">{l.description || "—"}</td>
                    <td className="py-2 pr-3 text-right font-mono font-bold text-[oklch(0.65_0.24_305)]">{fmtMoney(Number(l.amount))}</td>
                    <td className="py-2 pr-3">{l.paymentSource ?? "—"}</td>
                    <td className="py-2 pr-3">{l.staffUsername}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {clearModalOpen && (
        <ClearExpensesLedgerModal count={settlements.length} total={allTimeTotal} onClose={() => setClearModalOpen(false)} />
      )}
    </div>
  );
}

function ClearExpensesLedgerModal({ count, total, onClose }: { count: number; total: number; onClose: () => void }) {
  const { clearExpensesLedger } = useStore();
  const [confirmText, setConfirmText] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const canSubmit = confirmText === "CLEAR LEDGER" && password.length > 0;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setErr(null);
    try {
      const res = await clearExpensesLedger(confirmText, password);
      if (!res.ok) { setErr(res.error ?? "Could not clear the ledger."); return; }
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[270] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={() => !submitting && onClose()}>
      <div className="w-full max-w-sm glass-strong rounded-2xl border-2 border-[oklch(0.62_0.24_25/0.6)] p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-bold mb-2 text-[oklch(0.62_0.24_25)]">Clear the entire Expenses Ledger</h3>
        <p className="text-sm text-muted-foreground mb-3">
          Permanently deletes all {count} settlement record{count === 1 ? "" : "s"} ({fmtMoney(total)} total) from this ledger.
          This does not affect the underlying supplier invoices or their outstanding balances — only the record that they were
          ever paid. This can't be undone.
        </p>
        <label className="text-xs uppercase tracking-widest text-muted-foreground">Type CLEAR LEDGER to confirm</label>
        <input
          value={confirmText} onChange={(e) => setConfirmText(e.target.value)}
          className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm font-mono mb-3"
          placeholder="CLEAR LEDGER"
        />
        <label className="text-xs uppercase tracking-widest text-muted-foreground">Your admin password</label>
        <input
          type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm"
        />
        {err && <div className="text-sm text-[oklch(0.62_0.24_25)] mt-2">{err}</div>}
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} disabled={submitting} className="px-3 py-1.5 rounded-lg text-sm bg-black/5 border border-black/10">Cancel</button>
          <button
            onClick={() => void handleSubmit()}
            disabled={!canSubmit || submitting}
            className="px-3 py-1.5 rounded-lg text-sm font-bold bg-[oklch(0.62_0.24_25/0.9)] text-white disabled:opacity-40"
          >
            {submitting ? "Clearing..." : "Clear Ledger"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Every waste/complimentary Ledger entry this month — spilled/damaged,
// customer returns, complimentary/VIP gifts, and cashier-routed voids
// still pending admin reconciliation. Each entry's amount is ALREADY
// the item's raw-material cost (COGS), not its menu price — the void
// system (server/lib/voids.js) computes and stores it that way at the
// moment the void happens, so this report is a straight read of
// already-correct data, not a recalculation.
function WastedComplimentaryLedger() {
  const { state } = useStore();
  const { startDate, setStartDate, endDate, setEndDate, generating, setGenerating, today } = useSectionDateRange();
  const { from: rangeStart, to: rangeEnd } = useMemo(() => rangeBusinessDayBounds(startDate, endDate), [startDate, endDate]);
  const rangeLabel = formatRangeLabel(startDate, endDate);
  const rangeShiftIds = useMemo(
    () => new Set(state.shifts.filter((sh) => sh.openedAt >= rangeStart && sh.openedAt <= rangeEnd).map((sh) => sh.id)),
    [state.shifts, rangeStart, rangeEnd],
  );

  const wasteEntries = useMemo(
    () => filterByBusinessDay(state.ledger.filter((l) => WASTE_LEDGER_CATEGORIES.has(l.category)), rangeShiftIds, rangeStart, rangeEnd)
      .sort((a, b) => b.ts - a.ts),
    [state.ledger, rangeShiftIds, rangeStart, rangeEnd],
  );
  const total = wasteEntries.reduce((a, l) => a + Number(l.amount), 0);
  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    wasteEntries.forEach((l) => map.set(l.category, (map.get(l.category) ?? 0) + Number(l.amount)));
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [wasteEntries]);

  const handleGeneratePdf = async () => {
    setGenerating(true);
    try {
      await generateSectionReportPdf({
        sectionTitle: "Wasted & Complimentary Ledger",
        rangeLabel,
        columns: [{ header: "Date & Time" }, { header: "Reason" }, { header: "Item" }, { header: "Cost EGP", align: "right" }, { header: "Logged By" }],
        rows: wasteEntries.map((l) => [new Date(l.ts).toLocaleString(), l.category, l.description || "—", fmtMoney(Number(l.amount)), l.staffUsername]),
        summaryLines: [
          { label: "Entries", value: String(wasteEntries.length) },
          { label: "Total at Cost", value: fmtMoney(total) },
          ...byCategory.map(([cat, amt]) => ({ label: cat, value: fmtMoney(amt) })),
        ],
        filenameBase: "Wasted_Complimentary_Ledger",
        startDate, endDate,
        emptyMessage: "No waste or comps logged in this date range.",
      });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="glass rounded-2xl p-6">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-[oklch(0.62_0.24_25)]" />
          <h2 className="text-lg font-semibold">Wasted &amp; Complimentary Ledger</h2>
        </div>
        <div className="text-sm font-mono font-bold text-[oklch(0.62_0.24_25)]">{fmtMoney(total)} at cost</div>
      </div>
      <div className="mb-3">
        <SectionDateRangeToolbar
          startDate={startDate} endDate={endDate}
          onStartDateChange={setStartDate} onEndDateChange={setEndDate}
          onGeneratePdf={() => void handleGeneratePdf()} generating={generating} maxDate={today}
        />
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Every spilled, rejected, or complimentary item in {rangeLabel}, valued at its raw-material cost — never its
        menu price. Never counted as revenue or as an operational expense.
      </p>

      {byCategory.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
          {byCategory.map(([cat, amt]) => (
            <div key={cat} className="bg-white/60 rounded-lg p-3 border border-black/8 flex justify-between items-center">
              <span className="text-sm">{cat}</span>
              <span className="font-mono text-sm font-bold text-[oklch(0.62_0.24_25)]">{fmtMoney(amt)}</span>
            </div>
          ))}
        </div>
      )}

      {wasteEntries.length === 0 ? (
        <div className="text-sm text-muted-foreground font-mono text-center py-6">No waste or comps logged in this date range.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground border-b border-black/10">
                <th className="pb-2 pr-3">Date &amp; Time</th>
                <th className="pb-2 pr-3">Reason</th>
                <th className="pb-2 pr-3">Item</th>
                <th className="pb-2 pr-3 text-right">Cost EGP</th>
                <th className="pb-2">Logged By</th>
              </tr>
            </thead>
            <tbody>
              {wasteEntries.map((l) => (
                <tr key={l.id} className="border-b border-black/5">
                  <td className="py-2 pr-3 font-mono">{new Date(l.ts).toLocaleString()}</td>
                  <td className="py-2 pr-3">{l.category}</td>
                  <td className="py-2 pr-3">{l.description || "—"}</td>
                  <td className="py-2 pr-3 text-right font-mono font-bold text-[oklch(0.62_0.24_25)]">{fmtMoney(Number(l.amount))}</td>
                  <td className="py-2">{l.staffUsername}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Formats a YYYY-MM month string as "October 2026" for the PDF's
// range label/header, without relying on a parsed Date's own locale
// timezone (a plain "YYYY-MM-01" Date is parsed as UTC midnight,
// which could roll back a day in some timezones) — only the
// month/year are actually needed here, so there's no date-boundary
// risk in just reading them off the string.
function formatMonthYearLabel(monthStr: string): string {
  const [y, m] = monthStr.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

// One Monthly Consolidated Shifts PDF Export, covering every shift
// (open or closed) whose openedAt falls within the selected calendar
// month — a single batch report for the whole month rather than
// per-shift exports, for handing to an owner/accountant in one file.
function MonthlyShiftsExportPanel() {
  const { state } = useStore();
  const [month, setMonth] = useState(() => cairoDateLabel(Date.now()).slice(0, 7));
  const [generating, setGenerating] = useState(false);

  const { from, to } = useMemo(() => monthBusinessDayBounds(month), [month]);

  // Every shift opened within the month, open or closed — the user
  // explicitly asked for both, so an in-progress shift still shows up
  // with "—" placeholders for whatever hasn't been finalized yet.
  const shiftsInMonth = useMemo(
    () => state.shifts.filter((sh) => sh.openedAt >= from && sh.openedAt <= to).sort((a, b) => a.openedAt - b.openedAt),
    [state.shifts, from, to],
  );

  const rows = useMemo(() => {
    return shiftsInMonth.map((shift) => {
      const sessions = state.sessions.filter((s) => s.shiftId === shift.id);
      const cashCollected = sessions.reduce((a, s) => a + s.cashAmount, 0);
      const digitalCollected = sessions.reduce((a, s) => a + s.visaAmount + s.instapayAmount, 0);
      const shiftLedger = state.ledger.filter((l) => l.shiftId === shift.id && l.status === "approved" && l.paidFromDrawer && l.direction === "outflow");
      const shiftExpenses = shiftLedger.reduce((a, l) => a + Number(l.amount), 0);
      const isOpen = !shift.closedAt;
      const status = isOpen ? "Open" : shift.forced ? "Force Closed" : "Closed";
      return {
        shift, cashCollected, digitalCollected, shiftExpenses, status, isOpen,
      };
    });
  }, [shiftsInMonth, state.sessions, state.ledger]);

  const monthlyTotals = useMemo(() => {
    const totalShifts = rows.length;
    const aggregateRevenue = rows.reduce((a, r) => a + r.cashCollected + r.digitalCollected, 0);
    const aggregateExpenses = rows.reduce((a, r) => a + r.shiftExpenses, 0);
    const netDiscrepancy = rows.reduce((a, r) => a + (r.shift.discrepancy ?? 0), 0);
    return { totalShifts, aggregateRevenue, aggregateExpenses, netDiscrepancy };
  }, [rows]);

  const handleGeneratePdf = async () => {
    setGenerating(true);
    try {
      const monthLabel = formatMonthYearLabel(month);
      const [y, m] = month.split("-").map(Number);
      const lastDayNum = new Date(y, m, 0).getDate();
      const startDate = `${month}-01`;
      const endDate = `${month}-${String(lastDayNum).padStart(2, "0")}`;

      await generateSectionReportPdf({
        sectionTitle: "Monthly Shifts Summary",
        rangeLabel: monthLabel,
        columns: [
          { header: "Shift ID / Date" },
          { header: "Opened By" },
          { header: "Closed By" },
          { header: "Opening Cash", align: "right" },
          { header: "Cash Revenue", align: "right" },
          { header: "Digital/Card Revenue", align: "right" },
          { header: "Shift Expenses", align: "right" },
          { header: "Expected Drawer", align: "right" },
          { header: "Actual Drawer", align: "right" },
          { header: "Discrepancy", align: "right" },
          { header: "Status" },
        ],
        rows: rows.map(({ shift, cashCollected, digitalCollected, shiftExpenses, status, isOpen }) => [
          `${shift.id.slice(0, 8)} — ${new Date(shift.openedAt).toLocaleDateString()}`,
          // This data model has one cashier owning a shift start-to-finish
          // (no separate opener/closer), so both columns show the same
          // cashier — kept as two columns to match the requested layout.
          shift.cashierUsername,
          isOpen ? "—" : shift.cashierUsername,
          fmtMoney(shift.openingBalance),
          fmtMoney(cashCollected),
          fmtMoney(digitalCollected),
          fmtMoney(shiftExpenses),
          shift.expectedCash !== null ? fmtMoney(shift.expectedCash) : "—",
          shift.closingActualCash !== null ? fmtMoney(shift.closingActualCash) : "—",
          shift.discrepancy !== null ? `${shift.discrepancy > 0 ? "+" : ""}${fmtMoney(shift.discrepancy)}` : "—",
          status,
        ]),
        summaryLines: [
          { label: "Total Shifts", value: String(monthlyTotals.totalShifts) },
          { label: "Aggregate Revenue", value: fmtMoney(monthlyTotals.aggregateRevenue) },
          { label: "Aggregate Expenses", value: fmtMoney(monthlyTotals.aggregateExpenses) },
          { label: "Net Discrepancy", value: `${monthlyTotals.netDiscrepancy > 0 ? "+" : ""}${fmtMoney(monthlyTotals.netDiscrepancy)}` },
        ],
        startDate,
        endDate,
        filename: `Monthly_Shifts_Report_${month}.pdf`,
        orientation: "landscape",
        emptyMessage: "No shifts opened in this month.",
      });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="glass rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <CalendarCheck className="w-5 h-5 text-[oklch(0.7_0.19_260)]" />
          <h2 className="text-lg font-semibold">Monthly Consolidated Shifts Export</h2>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <input
            type="month" value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="bg-white/70 border border-black/10 rounded-lg px-2.5 py-1.5 text-xs font-mono"
          />
          <button
            onClick={() => void handleGeneratePdf()}
            disabled={generating}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-gradient-to-r from-[oklch(0.7_0.19_260)] to-[oklch(0.65_0.24_305)] text-[#2b2416] font-bold disabled:opacity-50"
          >
            <FileDown className="w-3.5 h-3.5" /> {generating ? "Generating..." : "Download Monthly Shifts Summary PDF"}
          </button>
        </div>
      </div>
      <div className="text-xs text-muted-foreground font-mono">
        {rows.length} shift{rows.length === 1 ? "" : "s"} opened in {formatMonthYearLabel(month)} · Aggregate Revenue {fmtMoney(monthlyTotals.aggregateRevenue)} · Aggregate Expenses {fmtMoney(monthlyTotals.aggregateExpenses)}
      </div>
    </div>
  );
}

function ShiftHistoryPanel() {
  const { state, attachOrphanedToShift } = useStore();
  const isAdmin = state.currentUser?.role === "admin";
  const [range, setRange] = useState<RangeKey>("today");
  const [customFrom, setCustomFrom] = useState(() => new Date(startOfDay(Date.now())).toISOString().slice(0, 10));
  const [customTo, setCustomTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [reconciling, setReconciling] = useState(false);
  const [reconcileMsg, setReconcileMsg] = useState<string | null>(null);

  // Any session/expense with no shift attached at all — can only
  // happen from a checkout/expense submitted while no shift was open
  // (an admin bypassing the cashier Gatekeeper). This is the manual
  // safety net for whenever the post-open-shift prompt was dismissed,
  // or for orders that were already orphaned before that prompt
  // existed.
  const orphanedCount = useMemo(
    () => state.sessions.filter((s) => !s.shiftId).length + state.ledger.filter((l) => !l.shiftId && l.direction === "outflow" && l.paidFromDrawer && l.status === "approved").length,
    [state.sessions, state.ledger],
  );

  const handleReconcile = async () => {
    setReconcileMsg(null);
    if (!state.activeShiftId) { setReconcileMsg("Open a shift first — unassigned orders attach to whichever shift is currently active."); return; }
    setReconciling(true);
    try {
      const res = await attachOrphanedToShift();
      if (!res.ok) { setReconcileMsg(res.error ?? "Could not reconcile."); return; }
      setReconcileMsg(res.count ? `Attached ${res.count} record(s) totaling ${fmtMoney(res.total ?? 0)} to the current shift.` : "Nothing unassigned to attach.");
    } finally {
      setReconciling(false);
    }
  };

  const { from, to } = useMemo(() => {
    const now = Date.now();
    if (range === "today") return { from: startOfDay(now), to: now };
    if (range === "week") return { from: startOfWeek(now), to: now };
    if (range === "month") return { from: startOfMonth(now), to: now };
    return { from: new Date(customFrom).getTime(), to: new Date(customTo).getTime() + 86400000 - 1 };
  }, [range, customFrom, customTo]);

  // Closed shifts within the selected range — lets an admin find and
  // recalculate a specific past shift, not just today's.
  const shiftsInRange = useMemo(
    () => state.shifts.filter((sh) => sh.closedAt !== null && sh.closedAt >= from && sh.closedAt <= to).sort((a, b) => b.closedAt! - a.closedAt!),
    [state.shifts, from, to],
  );

  return (
    <div className="glass rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <History className="w-5 h-5 text-[oklch(0.7_0.19_260)]" />
          <h2 className="text-lg font-semibold">Shift History</h2>
        </div>
        {isAdmin && orphanedCount > 0 && (
          <button
            onClick={() => void handleReconcile()}
            disabled={reconciling}
            title="Scans for checks/expenses recorded while no shift was active and attaches them to the current shift"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wide bg-[oklch(0.85_0.18_85/0.25)] border border-[oklch(0.85_0.18_85/0.6)] text-[#5a4a10] disabled:opacity-60"
          >
            {reconciling ? "Reconciling..." : `Reconcile Unassigned Orders (${orphanedCount})`}
          </button>
        )}
        <div className="flex items-center gap-1 bg-white/60 rounded-lg p-1 border border-black/8">
          {(["today", "week", "month", "custom"] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-3 py-1.5 rounded-md text-xs uppercase tracking-widest font-semibold transition ${
                range === r ? "bg-[oklch(0.7_0.19_260/0.3)] text-[#2b2416]" : "text-muted-foreground hover:text-[#2b2416]"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {reconcileMsg && (
        <div className="mb-3 text-sm text-muted-foreground bg-white/60 border border-black/10 rounded-lg px-3 py-2">{reconcileMsg}</div>
      )}

      {range === "custom" && (
        <div className="flex items-center flex-wrap gap-2 mb-4 text-sm">
          <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="bg-white/70 border border-black/10 rounded px-2 py-1.5" />
          <span className="text-muted-foreground">to</span>
          <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="bg-white/70 border border-black/10 rounded px-2 py-1.5" />
        </div>
      )}

      {shiftsInRange.length === 0 ? (
        <div className="text-sm text-muted-foreground text-center py-6">No closed shifts in this range.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[32rem] overflow-y-auto">
          {shiftsInRange.map((sh) => (
            <ShiftCard
              key={sh.id}
              shift={sh}
              label={new Date(sh.openedAt).toLocaleDateString()}
              sessions={state.sessions.filter((s) => s.shiftId === sh.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ShiftCard({ shift, label, sessions }: { shift: Shift; label: string; sessions: Session[] }) {
  const { state } = useStore();
  const isAdmin = state.currentUser?.role === "admin";
  const isOpen = !shift.closedAt;
  const pendingVoids = state.voidRequests.filter((v) => v.shiftId === shift.id && v.status === "pending").length;
  const [showRecalc, setShowRecalc] = useState(false);
  const [showChecks, setShowChecks] = useState(false);
  const [viewingCheck, setViewingCheck] = useState<Session | null>(null);

  // Full reconciliation breakdown — every figure derived straight from
  // this shift's own sessions/ledger, the same source data
  // bizCloseActiveShift_ used to produce the stored expectedCash/
  // discrepancy in the first place, so this panel can never drift from
  // what was actually calculated at close time.
  const grossSales = sessions.reduce((a, s) => a + s.total, 0);
  const cashCollected = sessions.reduce((a, s) => a + s.cashAmount, 0);
  const digitalCollected = sessions.reduce((a, s) => a + s.visaAmount + s.instapayAmount, 0);
  const shiftLedger = state.ledger.filter((l) => l.shiftId === shift.id && l.status === "approved" && l.paidFromDrawer && l.direction === "outflow");
  const supplierPayments = shiftLedger.filter((l) => l.type === "supplierPayment").reduce((a, l) => a + Number(l.amount), 0);
  const operationalExpenses = shiftLedger.filter((l) => l.type !== "supplierPayment").reduce((a, l) => a + Number(l.amount), 0);
  const drawerOutflows = operationalExpenses + supplierPayments;
  const expectedCash = shift.expectedCash;
  const discrepancy = shift.discrepancy;
  const isReconciled = discrepancy !== null && Math.abs(discrepancy) < 0.005;
  const isShortage = discrepancy !== null && discrepancy < -0.005;
  const isSurplus = discrepancy !== null && discrepancy > 0.005;

  return (
    <div className="bg-white/60 rounded-lg p-4 border border-black/8">
      <div className="flex items-center justify-between mb-2">
        <div className="font-semibold">{label} · {shift.cashierUsername}</div>
        {isOpen ? (
          <span className="text-[10px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-full bg-[oklch(0.78_0.2_155/0.15)] text-[oklch(0.78_0.2_155)] border border-[oklch(0.78_0.2_155/0.5)]">Open</span>
        ) : (
          <span className="text-[10px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-full bg-black/5 text-muted-foreground border border-black/10">
            {shift.forced ? "Force Closed" : "Closed"}
          </span>
        )}
      </div>
      {pendingVoids > 0 && (
        <div className="mb-2 text-[10px] uppercase tracking-widest font-bold px-2 py-1 rounded bg-[oklch(0.62_0.24_25/0.15)] text-[oklch(0.62_0.24_25)] border border-[oklch(0.62_0.24_25/0.4)] inline-block">
          ⚠ {pendingVoids} Unapproved Void{pendingVoids > 1 ? "s" : ""} — awaiting admin approval, not a cash discrepancy
        </div>
      )}

      <div className="text-xs font-mono text-muted-foreground space-y-1 mb-3">
        <div className="flex justify-between"><span>Opened</span><span>{new Date(shift.openedAt).toLocaleTimeString()}</span></div>
        <div className="flex justify-between"><span>Closed</span><span>{shift.closedAt ? new Date(shift.closedAt).toLocaleTimeString() : "—"}</span></div>
      </div>

      {!isOpen && (
        <div className="rounded-xl border border-black/10 bg-white/50 divide-y divide-black/8 text-xs font-mono mb-2">
          {/* 1. Total Gross Sales */}
          <div className="px-3 py-2">
            <div className="text-[9px] uppercase tracking-widest text-muted-foreground mb-1">Total Gross Sales — إجمالي المبيعات</div>
            <div className="flex justify-between font-bold"><span>Room Time + Café/Beverage Orders</span><span>{fmtMoney(grossSales)}</span></div>
          </div>

          {/* 2. Payment Channel Breakdown */}
          <div className="px-3 py-2">
            <div className="text-[9px] uppercase tracking-widest text-muted-foreground mb-1">Payment Channels — تفاصيل طرق الدفع</div>
            <div className="flex justify-between"><span>Cash Collected</span><span>{fmtMoney(cashCollected)}</span></div>
            <div className="flex justify-between"><span>InstaPay / Visa / Digital</span><span>{fmtMoney(digitalCollected)}</span></div>
          </div>

          {/* 3. Drawer Outflows */}
          <div className="px-3 py-2">
            <div className="text-[9px] uppercase tracking-widest text-muted-foreground mb-1">Drawer Outflows — المصروفات النقدية من الدرج</div>
            <div className="flex justify-between"><span>Operational Expenses</span><span className="text-[oklch(0.62_0.24_25)]">−{fmtMoney(operationalExpenses)}</span></div>
            <div className="flex justify-between"><span>Supplier Payments</span><span className="text-[oklch(0.62_0.24_25)]">−{fmtMoney(supplierPayments)}</span></div>
          </div>

          {/* 4. Final Cash Drawer Reconciliation */}
          <div className="px-3 py-2 bg-black/[0.02]">
            <div className="text-[9px] uppercase tracking-widest text-muted-foreground mb-1">Final Cash Reconciliation — تقفيل الخزينة</div>
            <div className="flex justify-between"><span>Opening Balance (العهدة)</span><span>{fmtMoney(shift.openingBalance)}</span></div>
            <div className="flex justify-between"><span>+ Cash Collected</span><span>{fmtMoney(cashCollected)}</span></div>
            <div className="flex justify-between"><span>− Cash Expenses &amp; Supplier Outflows</span><span>{fmtMoney(drawerOutflows)}</span></div>
            {expectedCash !== null && (
              <div className="flex justify-between font-bold border-t border-black/10 mt-1 pt-1"><span>= Net Expected Cash (الصافي المتوقع)</span><span>{fmtMoney(expectedCash)}</span></div>
            )}
            {shift.closingActualCash !== null && (
              <div className="flex justify-between"><span>Actual Cash (الفعلية)</span><span>{fmtMoney(shift.closingActualCash)}</span></div>
            )}
          </div>
        </div>
      )}

      {!isOpen && discrepancy !== null && (
        <div className={`flex items-center justify-between rounded-lg px-3 py-2 border font-bold text-sm ${
          isReconciled ? "bg-[oklch(0.78_0.2_155/0.12)] border-[oklch(0.78_0.2_155/0.5)] text-[oklch(0.78_0.2_155)]"
          : isSurplus ? "bg-[oklch(0.85_0.18_85/0.2)] border-[oklch(0.85_0.18_85/0.6)] text-[oklch(0.6_0.15_85)]"
          : "bg-[oklch(0.62_0.24_25/0.15)] border-[oklch(0.62_0.24_25/0.5)] text-[oklch(0.62_0.24_25)]"
        }`}>
          <span className="uppercase tracking-wide text-xs">
            {isReconciled ? "Reconciled — العجز أو الزيادة صفر" : isSurplus ? "Surplus — زيادة" : "Deficit / Shortage — عجز"}
          </span>
          <span>{isReconciled ? fmtMoney(0) : `${discrepancy > 0 ? "+" : ""}${fmtMoney(discrepancy)}`}</span>
        </div>
      )}

      {isAdmin && !isOpen && (
        <button
          onClick={() => setShowRecalc(true)}
          className="mt-2 text-[10px] uppercase tracking-widest text-muted-foreground hover:text-[oklch(0.7_0.19_260)] flex items-center gap-1"
          title="Recalculate this shift's expected cash and discrepancy from current data"
        >
          <History className="w-3 h-3" /> Recalculate
        </button>
      )}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={() => setShowChecks((v) => !v)}
          className="mt-2 text-[10px] uppercase tracking-widest text-muted-foreground hover:text-[oklch(0.7_0.19_260)] flex items-center gap-1"
        >
          <History className="w-3 h-3" /> {showChecks ? "Hide" : "View"} Checks ({sessions.length})
        </button>
        {!isOpen && (
          <button
            onClick={() => {
              const shiftLedger = state.ledger.filter((l) => l.shiftId === shift.id);
              const { blob, filename } = generateShiftReportPdf({ shift, sessions, ledger: shiftLedger });
              downloadBlob(blob, filename);
            }}
            className="mt-2 text-[10px] uppercase tracking-widest text-muted-foreground hover:text-[oklch(0.7_0.19_260)] flex items-center gap-1"
            title="Regenerate and download this shift's PDF report"
          >
            <FileDown className="w-3 h-3" /> Download PDF
          </button>
        )}
      </div>
      {showChecks && (
        sessions.length === 0 ? (
          <div className="mt-2 text-xs text-muted-foreground text-center py-3">No checks in this shift.</div>
        ) : (
          <div className="mt-2 max-h-48 overflow-y-auto border border-black/8 rounded-lg divide-y divide-black/5">
            {sessions.slice().sort((a, b) => b.endedAt - a.endedAt).map((s) => (
              <button
                key={s.id} onClick={() => setViewingCheck(s)}
                className="w-full flex items-center justify-between px-3 py-1.5 text-xs hover:bg-[oklch(0.7_0.19_260/0.06)] text-left"
                title="Click to view full check details"
              >
                <span className="truncate">{s.roomName} · {new Date(s.endedAt).toLocaleTimeString()}</span>
                <span className="font-mono font-bold shrink-0 ml-2">{fmtMoney(s.total)}</span>
              </button>
            ))}
          </div>
        )
      )}
      {viewingCheck && <ReceiptModal session={viewingCheck} onClose={() => setViewingCheck(null)} />}
      {showRecalc && <RecalculateShiftModal shift={shift} onClose={() => setShowRecalc(false)} />}
    </div>
  );
}

function RecalculateShiftModal({ shift, onClose }: { shift: Shift; onClose: () => void }) {
  const { state, recalculateClosedShift } = useStore();
  const [confirmText, setConfirmText] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Live preview computed client-side, same formula the backend uses —
  // the actual applied numbers still always come from the server's own
  // fresh computation on confirm, never this preview directly.
  const shiftSessions = state.sessions.filter((s) => s.shiftId === shift.id);
  const cashSales = shiftSessions.reduce((a, s) => a + (Number(s.cashAmount) || 0), 0);
  const drawerExpenses = state.ledger
    .filter((l) => l.shiftId === shift.id && l.status === "approved" && l.paidFromDrawer && l.direction === "outflow")
    .reduce((a, l) => a + Number(l.amount), 0);
  const newExpectedCash = shift.openingBalance + cashSales - drawerExpenses;
  const actualCash = Number(shift.closingActualCash) || 0;
  const newDiscrepancy = actualCash - newExpectedCash;
  const willChange = shift.expectedCash === null || Math.abs(newExpectedCash - shift.expectedCash) >= 0.005;

  const canSubmit = confirmText === "RECALCULATE" && password.length > 0;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setErr(null);
    try {
      const res = await recalculateClosedShift(shift.id, confirmText, password);
      if (!res.ok) { setErr(res.error ?? "Could not recalculate"); return; }
      setDone(true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[220] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={() => !submitting && onClose()}>
      <div className="w-full max-w-sm glass-strong rounded-2xl border border-[oklch(0.7_0.19_260/0.5)] p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-bold mb-2">Recalculate this closed shift?</h3>
        <p className="text-sm text-muted-foreground mb-3">
          Re-runs the expected cash formula against current data and overwrites this shift's stored
          Expected Cash and Discrepancy. The Actual Cash counted at close-out is a historical fact and
          is never changed by this.
        </p>

        {done ? (
          <div className="text-sm text-[oklch(0.78_0.2_155)] font-semibold mb-3">
            Done — Expected Cash is now {fmtMoney(newExpectedCash)}, Discrepancy {fmtMoney(newDiscrepancy)}.
          </div>
        ) : (
          <>
            <div className="rounded-lg border border-black/10 bg-black/5 p-3 mb-3 text-xs font-mono space-y-1">
              <div className="flex justify-between"><span>Expected Cash</span><span>{fmtMoney(shift.expectedCash ?? 0)} → <strong className={willChange ? "text-[oklch(0.7_0.19_260)]" : ""}>{fmtMoney(newExpectedCash)}</strong></span></div>
              <div className="flex justify-between"><span>Discrepancy</span><span>{fmtMoney(shift.discrepancy ?? 0)} → <strong className={willChange ? "text-[oklch(0.7_0.19_260)]" : ""}>{fmtMoney(newDiscrepancy)}</strong></span></div>
              {!willChange && <div className="text-muted-foreground pt-1">No change — current data already matches the stored values.</div>}
            </div>

            <label className="text-xs uppercase tracking-widest text-muted-foreground">Type RECALCULATE to confirm</label>
            <input
              value={confirmText} onChange={(e) => setConfirmText(e.target.value)}
              className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm font-mono mb-3"
              placeholder="RECALCULATE"
            />
            <label className="text-xs uppercase tracking-widest text-muted-foreground">Your admin password</label>
            <input
              type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm"
            />
            {err && <div className="text-sm text-[oklch(0.62_0.24_25)] mt-2">{err}</div>}
          </>
        )}

        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} disabled={submitting} className="px-3 py-1.5 rounded-lg text-sm bg-black/5 border border-black/10">{done ? "Close" : "Cancel"}</button>
          {!done && (
            <button
              onClick={() => void handleSubmit()}
              disabled={!canSubmit || submitting}
              className="px-3 py-1.5 rounded-lg text-sm font-bold bg-gradient-to-r from-[oklch(0.7_0.19_260)] to-[oklch(0.65_0.24_305)] text-[#2b2416] disabled:opacity-40"
            >
              {submitting ? "Recalculating..." : "Recalculate"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function microTs(ts: number) {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} - ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function mapsUrl(lat: number, lng: number) {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

function AttendanceLog() {
  const { state } = useStore();

  // Shift number = the Nth shift THIS cashier has worked, oldest first.
  const shiftsByCashier = new Map<string, number>();
  const rows = state.shifts
    .slice()
    .sort((a, b) => a.openedAt - b.openedAt)
    .map((sh) => {
      const n = (shiftsByCashier.get(sh.cashierUsername) ?? 0) + 1;
      shiftsByCashier.set(sh.cashierUsername, n);
      return { ...sh, shiftNumber: n };
    })
    .sort((a, b) => b.openedAt - a.openedAt);

  return (
    <div className="glass rounded-2xl p-6">
      <div className="flex items-center gap-2 mb-4">
        <MapPin className="w-5 h-5 text-black" />
        <h2 className="text-lg font-semibold">Attendance &amp; Location Log</h2>
      </div>
      {rows.length === 0 ? (
        <div className="text-sm text-muted-foreground font-mono">No shifts recorded yet.</div>
      ) : (
        <div className="overflow-x-auto max-h-96 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-[#faf6ec]">
              <tr className="text-[10px] uppercase tracking-widest text-muted-foreground border-b border-black/8">
                <th className="text-left py-2 px-2">Staff</th>
                <th className="text-left py-2 px-2">Shift #</th>
                <th className="text-left py-2 px-2">Start</th>
                <th className="text-left py-2 px-2">End</th>
                <th className="text-left py-2 px-2">Opened At</th>
                <th className="text-left py-2 px-2">Closed At</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((sh) => (
                <tr key={sh.id} className="border-b border-black/8 hover:bg-black/5">
                  <td className="py-2 px-2 font-semibold">{sh.cashierUsername}</td>
                  <td className="py-2 px-2 font-mono">{sh.shiftNumber}</td>
                  <td className="py-2 px-2 font-mono text-xs text-muted-foreground">{microTs(sh.openedAt)}</td>
                  <td className="py-2 px-2 font-mono text-xs text-muted-foreground">{sh.closedAt ? microTs(sh.closedAt) : "— (open)"}</td>
                  <td className="py-2 px-2">
                    {sh.openedLat !== null && sh.openedLng !== null ? (
                      <a href={mapsUrl(sh.openedLat, sh.openedLng)} target="_blank" rel="noreferrer" className="text-[oklch(0.7_0.19_260)] hover:underline text-xs">View Location</a>
                    ) : <span className="text-xs text-muted-foreground">—</span>}
                  </td>
                  <td className="py-2 px-2">
                    {sh.closedLat !== null && sh.closedLng !== null ? (
                      <a href={mapsUrl(sh.closedLat, sh.closedLng)} target="_blank" rel="noreferrer" className="text-[oklch(0.7_0.19_260)] hover:underline text-xs">View Location</a>
                    ) : <span className="text-xs text-muted-foreground">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function generateDailyReport(
  shift: Shift,
  sessions: Session[],
  consumption: { name: string; unit: string; qty: number }[],
  totalRevenue: number,
  cashRevenue: number,
  visaRevenue: number,
  instapayRevenue: number,
  wasteExpense: number,
) {
  const win = window.open("", "_blank", "width=900,height=1200");
  if (!win) return;
  const opened = new Date(shift.openedAt);
  const closed = shift.closedAt ? new Date(shift.closedAt) : null;
  const openedLabel = opened.toLocaleString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const closedLabel = closed ? closed.toLocaleString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "Still open";
  win.document.write(`
<!DOCTYPE html><html><head><title>GLITCH Shift Report — ${shift.cashierUsername}</title>
<style>
  body { font-family: ui-sans-serif, system-ui, sans-serif; padding: 32px; color: #111; }
  h1 { margin: 0 0 4px; letter-spacing: 4px; }
  .sub { color: #666; text-transform: uppercase; letter-spacing: 3px; font-size: 11px; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; }
  th, td { border-bottom: 1px solid #ddd; padding: 8px; font-size: 13px; text-align: left; }
  th { background: #f5f5f5; text-transform: uppercase; letter-spacing: 1px; font-size: 10px; }
  .totals { margin-top: 16px; padding: 12px; background: #f5f5f5; border-radius: 8px; }
  .totals div { display: flex; justify-content: space-between; padding: 4px 0; font-family: ui-monospace, monospace; }
  .grand { font-weight: bold; border-top: 2px solid #111; margin-top: 6px; padding-top: 8px !important; font-size: 15px; }
  .meta { font-family: ui-monospace, monospace; font-size: 11px; color: #666; margin-top: 4px; }
</style></head><body>
<h1>GLITCH LOUNGE</h1>
<div class="sub">Shift Report — ${shift.cashierUsername}</div>
<div class="meta">
  Shift ID: ${shift.id}<br/>
  Start: ${openedLabel}<br/>
  End: ${closedLabel}
</div>
<div class="totals">
  <div class="grand"><span>TOTAL SHIFT REVENUE</span><span>${totalRevenue.toFixed(2)} EGP</span></div>
  <div><span>&nbsp;&nbsp;Cash</span><span>${cashRevenue.toFixed(2)} EGP</span></div>
  <div><span>&nbsp;&nbsp;Visa</span><span>${visaRevenue.toFixed(2)} EGP</span></div>
  <div><span>&nbsp;&nbsp;InstaPay</span><span>${instapayRevenue.toFixed(2)} EGP</span></div>
  <div><span>Order Count</span><span>${sessions.length}</span></div>
  <div><span>Wasted / Marketing Expense (excluded above)</span><span>${wasteExpense.toFixed(2)} EGP</span></div>
</div>
<h3 style="margin-top:24px">Shift Reconciliation</h3>
<table>
  <thead><tr><th>Cashier</th><th>Opened</th><th>Closed</th><th>Opening EGP</th><th>Expected</th><th>Actual</th><th>Discrepancy</th></tr></thead>
  <tbody>
    <tr>
      <td>${shift.cashierUsername}</td>
      <td>${opened.toLocaleString()}</td>
      <td>${closed ? closed.toLocaleString() : "Open"}</td>
      <td>${shift.openingBalance.toFixed(2)} EGP</td>
      <td>${shift.expectedCash !== null ? shift.expectedCash.toFixed(2) + " EGP" : "—"}</td>
      <td>${shift.closingActualCash !== null ? shift.closingActualCash.toFixed(2) + " EGP" : "—"}</td>
      <td>${shift.discrepancy !== null ? shift.discrepancy.toFixed(2) + " EGP" : "—"}</td>
    </tr>
  </tbody>
</table>
<h3 style="margin-top:24px">Material Consumption</h3>
<table>
  <thead><tr><th>Item</th><th>Consumed</th></tr></thead>
  <tbody>
    ${consumption.map((c) => `<tr><td>${c.name}</td><td>${c.qty}${c.unit}</td></tr>`).join("") || "<tr><td colspan=2>No orders this shift</td></tr>"}
  </tbody>
</table>
<h3 style="margin-top:24px">Sessions (${sessions.length})</h3>
<table>
  <thead><tr><th>Room</th><th>End</th><th>Payment</th><th>Cash</th><th>Visa</th><th>InstaPay</th><th>Total</th></tr></thead>
  <tbody>
    ${sessions.map((s) => `<tr>
      <td>${s.roomName}</td>
      <td>${new Date(s.endedAt).toLocaleString()}</td>
      <td>${s.paymentMethod.toUpperCase()}</td>
      <td>${s.cashAmount.toFixed(2)} EGP</td>
      <td>${s.visaAmount.toFixed(2)} EGP</td>
      <td>${s.instapayAmount.toFixed(2)} EGP</td>
      <td>${s.total.toFixed(2)} EGP</td>
    </tr>`).join("")}
  </tbody>
</table>
<script>window.onload = () => setTimeout(() => { if (window.electronAPI) { window.electronAPI.printSilent({ deviceName: localStorage.getItem("glitch-preferred-printer") || "" }).catch(() => window.print()); } else { window.print(); } }, 300);</script>
</body></html>`);
  win.document.close();
}
