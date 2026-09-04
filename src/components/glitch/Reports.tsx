import { useEffect, useMemo, useState } from "react";
import { useStore, fmtMoney } from "@/lib/glitch-store";
import type { Shift, Session, LedgerEntry } from "@/lib/glitch-store";
import { FileDown, TrendingUp, Users2, Boxes, History, Wallet, MapPin, Sunrise, CalendarCheck, AlertTriangle, Trash2 } from "lucide-react";
import { ReceiptModal } from "./Rooms";

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
    l.category !== "Staff Consumption Expense" &&
    l.status === "approved" &&
    l.paymentStatus !== "unpaid" &&
    !WASTE_LEDGER_CATEGORIES.has(l.category)
  );
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

  // Total Revenue by Date — shift-first, business-day bound (8 AM to
  // 8 AM, this café's confirmed real cycle), independent of the Shift
  // selector above, which is a separate tool for printing one
  // specific shift's own end-of-shift report.
  const [selectedReportDate, setSelectedReportDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const { from: reportDayStart, to: reportDayEnd } = useMemo(() => businessDayBounds(selectedReportDate), [selectedReportDate]);
  const reportDayShiftIds = useMemo(
    () => new Set(state.shifts.filter((sh) => sh.openedAt >= reportDayStart && sh.openedAt <= reportDayEnd).map((sh) => sh.id)),
    [state.shifts, reportDayStart, reportDayEnd],
  );

  const daySessions = useMemo(
    () => filterByBusinessDay(state.sessions, reportDayShiftIds, reportDayStart, reportDayEnd),
    [state.sessions, reportDayShiftIds, reportDayStart, reportDayEnd],
  );
  const dayExpenseEntries = useMemo(
    () => filterByBusinessDay(state.ledger.filter(isOperationalExpense), reportDayShiftIds, reportDayStart, reportDayEnd),
    [state.ledger, reportDayShiftIds, reportDayStart, reportDayEnd],
  );
  const dayRevenue = daySessions.reduce((a, s) => a + s.total, 0);
  const dayExpensesTotal = dayExpenseEntries.reduce((a, l) => a + Number(l.amount), 0);
  const dayNetProfit = dayRevenue - dayExpensesTotal;


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

      <BusinessDayPanel />

      <WasteMarketingPanel allEntries={state.ledger.filter((l) => l.category === "Marketing / Waste Expense")} />

      {/* Total Revenue by Date — a specific calendar day's own numbers,
          independent of the Shift selector above (which is a separate
          tool for printing one specific shift's end-of-shift report) */}
      <div className="glass rounded-2xl p-6 border border-[oklch(0.78_0.2_155/0.4)]">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-1">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-[oklch(0.78_0.2_155)]" />
            <h2 className="text-lg font-semibold">Total Revenue by Date</h2>
          </div>
          <div>
            <input
              type="date" value={selectedReportDate} max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setSelectedReportDate(e.target.value)}
              className="bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm font-mono"
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Orders closed and expenses logged on {new Date(selectedReportDate + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", year: "numeric" })}.
          Staff Orders and voided items are never counted here.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white/60 rounded-lg p-4 border border-black/8">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Selected Day Revenue</div>
            <div className="text-2xl font-mono font-bold mt-1 text-[oklch(0.78_0.2_155)]">{fmtMoney(dayRevenue)}</div>
          </div>
          <div className="bg-white/60 rounded-lg p-4 border border-black/8">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Selected Day Expenses</div>
            <div className="text-2xl font-mono font-bold mt-1 text-[oklch(0.62_0.24_25)]">{fmtMoney(dayExpensesTotal)}</div>
          </div>
          <div className={`rounded-lg p-4 border ${dayNetProfit >= 0 ? "bg-[oklch(0.78_0.2_155/0.1)] border-[oklch(0.78_0.2_155/0.4)]" : "bg-[oklch(0.62_0.24_25/0.1)] border-[oklch(0.62_0.24_25/0.4)]"}`}>
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Selected Day Net Profit</div>
            <div className={`text-2xl font-mono font-bold mt-1 ${dayNetProfit >= 0 ? "text-[oklch(0.78_0.2_155)]" : "text-[oklch(0.62_0.24_25)]"}`}>{fmtMoney(dayNetProfit)}</div>
          </div>
        </div>
      </div>

      {/* Order History — this specific date only */}
      <div className="glass rounded-2xl p-6">
        <div className="flex items-center gap-2 mb-4">
          <History className="w-5 h-5 text-[oklch(0.7_0.19_260)]" />
          <h2 className="text-lg font-semibold">Order History — {new Date(selectedReportDate + "T00:00:00").toLocaleDateString()}</h2>
        </div>
        {daySessions.length === 0 ? (
          <div className="text-sm text-muted-foreground font-mono text-center py-6">No closed orders on this date.</div>
        ) : (
          <div className="overflow-x-auto overflow-y-auto max-h-[32rem] border border-black/8 rounded-xl">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white/95 backdrop-blur-sm">
                <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground border-b border-black/10">
                  <th className="pb-2 pt-3 pl-3 pr-3">Order ID</th>
                  <th className="pb-2 pt-3 pr-3">Room/Table</th>
                  <th className="pb-2 pt-3 pr-3">Time</th>
                  <th className="pb-2 pt-3 pr-3">Payment</th>
                  <th className="pb-2 pt-3 pr-3 text-right">Subtotal</th>
                  <th className="pb-2 pt-3 pr-3 text-right">Discount</th>
                  <th className="pb-2 pt-3 pr-3 text-right">Total EGP</th>
                </tr>
              </thead>
              <tbody>
                {daySessions.sort((a, b) => b.endedAt - a.endedAt).map((s) => (
                  <tr key={s.id} className="border-b border-black/5">
                    <td className="py-2 pl-3 pr-3 font-mono text-xs text-muted-foreground">{s.id.slice(0, 12)}</td>
                    <td className="py-2 pr-3">{s.roomName}</td>
                    <td className="py-2 pr-3 font-mono">{new Date(s.endedAt).toLocaleTimeString()}</td>
                    <td className="py-2 pr-3 uppercase">{s.paymentMethod.replace(/_/g, " ")}</td>
                    <td className="py-2 pr-3 text-right font-mono">{fmtMoney(s.total + (s.discountAmount || 0))}</td>
                    <td className="py-2 pr-3 text-right font-mono text-[oklch(0.62_0.24_25)]">{s.discountAmount ? "-" + fmtMoney(s.discountAmount) : "—"}</td>
                    <td className="py-2 pr-3 text-right font-mono font-bold">{fmtMoney(s.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Expenses History — this specific date only, same exclusions as
          the KPI card above (no Staff Orders, no voids) */}
      <div className="glass rounded-2xl p-6">
        <div className="flex items-center gap-2 mb-4">
          <Wallet className="w-5 h-5 text-[oklch(0.62_0.24_25)]" />
          <h2 className="text-lg font-semibold">Expenses History — {new Date(selectedReportDate + "T00:00:00").toLocaleDateString()}</h2>
        </div>
        {dayExpenseEntries.length === 0 ? (
          <div className="text-sm text-muted-foreground font-mono text-center py-6">No expenses logged on this date.</div>
        ) : (
          <div className="overflow-x-auto overflow-y-auto max-h-[32rem] border border-black/8 rounded-xl">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white/95 backdrop-blur-sm">
                <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground border-b border-black/10">
                  <th className="pb-2 pt-3 pl-3 pr-3">Expense ID</th>
                  <th className="pb-2 pt-3 pr-3">Description / Category</th>
                  <th className="pb-2 pt-3 pr-3 text-right">Amount EGP</th>
                  <th className="pb-2 pt-3 pr-3">Payment Source</th>
                  <th className="pb-2 pt-3 pr-3">Recorded Time</th>
                </tr>
              </thead>
              <tbody>
                {dayExpenseEntries.sort((a, b) => b.ts - a.ts).map((l) => (
                  <tr key={l.id} className="border-b border-black/5">
                    <td className="py-2 pl-3 pr-3 font-mono text-xs text-muted-foreground">{l.id.slice(0, 12)}</td>
                    <td className="py-2 pr-3">{l.description || l.category}</td>
                    <td className="py-2 pr-3 text-right font-mono font-bold text-[oklch(0.62_0.24_25)]">{fmtMoney(Number(l.amount))}</td>
                    <td className="py-2 pr-3">{l.paymentSource ?? "—"}</td>
                    <td className="py-2 pr-3 font-mono">{new Date(l.ts).toLocaleTimeString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* This shift's own reconciliation card */}
      <div className="glass rounded-2xl p-6">
        <div className="flex items-center gap-2 mb-4">
          <Users2 className="w-5 h-5 text-[oklch(0.7_0.19_260)]" />
          <h2 className="text-lg font-semibold">Shift Reconciliation</h2>
        </div>
        {!selectedShift ? (
          <div className="text-sm text-muted-foreground font-mono">No shift selected.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ShiftCard shift={selectedShift} label={isViewingActiveShift ? "Active Shift" : "Closed Shift"} sessions={shiftSessions} />
          </div>
        )}
      </div>

      {/* Material consumption */}
      <div className="glass rounded-2xl p-6">
        <div className="flex items-center gap-2 mb-4">
          <Boxes className="w-5 h-5 text-black" />
          <h2 className="text-lg font-semibold">Material Consumption — This Shift</h2>
        </div>
        {consumption.length === 0 ? (
          <div className="text-sm text-muted-foreground font-mono">No orders completed this shift.</div>
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

      <HistoryLog />
      <AttendanceLog />
      <MonthlyReconciliationDashboard selectedDate={selectedReportDate} onDateChange={setSelectedReportDate} />
      <MonthlyExpensesLedger selectedDate={selectedReportDate} />
      <WastedComplimentaryLedger selectedDate={selectedReportDate} />
      <PnLLedgerPanel />
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

  return (
    <div className="glass rounded-2xl p-6 border border-[oklch(0.62_0.24_25/0.4)]">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-1">
        <div className="flex items-center gap-2">
          <Trash2 className="w-5 h-5 text-[oklch(0.62_0.24_25)]" />
          <h2 className="text-lg font-semibold">Wasted / Marketing Expense — Audit Summary</h2>
        </div>
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
function MonthlyReconciliationDashboard({ selectedDate, onDateChange }: { selectedDate: string; onDateChange: (date: string) => void }) {
  const { state } = useStore();
  const { from: dayStart, to: dayEnd } = useMemo(() => businessDayBounds(selectedDate), [selectedDate]);
  const dayLabel = new Date(dayStart).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", year: "numeric" });

  // Shift-first: a business day is defined by which shifts OPENED
  // within this 8 AM-to-8 AM window, not by re-deriving a calendar
  // date from each record's own timestamp — this is what keeps a
  // shift that opens late (and runs past midnight, or even past 8 AM)
  // fully counted on the day it started, never split across two.
  const dayShiftIds = useMemo(
    () => new Set(state.shifts.filter((sh) => sh.openedAt >= dayStart && sh.openedAt <= dayEnd).map((sh) => sh.id)),
    [state.shifts, dayStart, dayEnd],
  );
  const totalRevenue = useMemo(
    () => filterByBusinessDay(state.sessions, dayShiftIds, dayStart, dayEnd).reduce((a, s) => a + s.total, 0),
    [state.sessions, dayShiftIds, dayStart, dayEnd],
  );

  // Operational expenses and supplier purchases for this business day
  // — already includes procurement/supplier invoices (the source of
  // COGS), so this deliberately does NOT add a separate COGS term
  // below -- doing so would double-count the same raw-material spend.
  const totalExpenses = useMemo(
    () => filterByBusinessDay(state.ledger.filter(isOperationalExpense), dayShiftIds, dayStart, dayEnd)
      .reduce((a, l) => a + Number(l.amount), 0),
    [state.ledger, dayShiftIds, dayStart, dayEnd],
  );

  // Fixed recurring costs (rent, salaries, utilities, internet, etc.)
  // are a flat MONTHLY definition, not a dated transaction log, so
  // there's no way to know which day within the month they were
  // "spent" on — prorated evenly across the days in this date's month
  // for a sensible daily figure, clearly labeled as such.
  const daysInMonth = useMemo(() => new Date(new Date(dayStart).getFullYear(), new Date(dayStart).getMonth() + 1, 0).getDate(), [dayStart]);
  const totalFixedExpenses = useMemo(
    () => state.recurringExpenses.filter((r) => r.active).reduce((a, r) => a + Number(r.amount), 0) / daysInMonth,
    [state.recurringExpenses, daysInMonth],
  );

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
          type="date" value={selectedDate} max={new Date().toISOString().slice(0, 10)}
          onChange={(e) => onDateChange(e.target.value)}
          className="bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm font-mono"
        />
      </div>
      <p className="text-xs text-muted-foreground mb-4">{dayLabel} — by each shift's own start time; fixed monthly costs shown as a per-day share</p>

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
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Fixed Costs (per-day share)</div>
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

// Automatically logged the instant a deferred/credit supplier invoice
// (or any outstanding balance) is settled via Record Payment — this
// IS the settlement itself (every supplierPayment Ledger entry), not a
// separate write path, so there's no way for a settlement to happen
// without appearing here. Deliberately excluded from Daily/Monthly
// Expenses above, since it settles a debt incurred whenever the
// original invoice was logged, not a new expense today.
function MonthlyExpensesLedger({ selectedDate }: { selectedDate: string }) {
  const { state } = useStore();
  const { from: dayStart, to: dayEnd } = useMemo(() => businessDayBounds(selectedDate), [selectedDate]);
  const dayLabel = new Date(dayStart).toLocaleDateString();
  const dayShiftIds = useMemo(
    () => new Set(state.shifts.filter((sh) => sh.openedAt >= dayStart && sh.openedAt <= dayEnd).map((sh) => sh.id)),
    [state.shifts, dayStart, dayEnd],
  );

  const settlements = useMemo(
    () => filterByBusinessDay(state.ledger.filter((l) => l.type === "supplierPayment"), dayShiftIds, dayStart, dayEnd)
      .sort((a, b) => b.ts - a.ts),
    [state.ledger, dayShiftIds, dayStart, dayEnd],
  );
  const total = settlements.reduce((a, l) => a + Number(l.amount), 0);

  return (
    <div className="glass rounded-2xl p-6">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
        <div className="flex items-center gap-2">
          <Wallet className="w-5 h-5 text-[oklch(0.65_0.24_305)]" />
          <h2 className="text-lg font-semibold">Expenses Ledger</h2>
        </div>
        <div className="text-sm font-mono font-bold text-[oklch(0.65_0.24_305)]">{fmtMoney(total)} settled on {dayLabel}</div>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Every deferred/credit supplier invoice or outstanding balance settled via Record Payment on {dayLabel} —
        logged automatically the instant it's paid.
      </p>
      {settlements.length === 0 ? (
        <div className="text-sm text-muted-foreground font-mono text-center py-6">No settlements recorded on {dayLabel}.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground border-b border-black/10">
                <th className="pb-2 pr-3">Date &amp; Time</th>
                <th className="pb-2 pr-3">Supplier</th>
                <th className="pb-2 pr-3">Description</th>
                <th className="pb-2 pr-3 text-right">Amount EGP</th>
                <th className="pb-2 pr-3">Payment Source</th>
                <th className="pb-2">Settled By</th>
              </tr>
            </thead>
            <tbody>
              {settlements.map((l) => {
                const supplier = state.suppliers.find((s) => s.id === l.supplierId);
                return (
                  <tr key={l.id} className="border-b border-black/5">
                    <td className="py-2 pr-3 font-mono">{new Date(l.ts).toLocaleString()}</td>
                    <td className="py-2 pr-3 font-semibold">{supplier?.name ?? "—"}</td>
                    <td className="py-2 pr-3">{l.description || "—"}</td>
                    <td className="py-2 pr-3 text-right font-mono font-bold text-[oklch(0.65_0.24_305)]">{fmtMoney(Number(l.amount))}</td>
                    <td className="py-2 pr-3">{l.paymentSource ?? "—"}</td>
                    <td className="py-2">{l.staffUsername}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
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
function WastedComplimentaryLedger({ selectedDate }: { selectedDate: string }) {
  const { state } = useStore();
  const { from: dayStart, to: dayEnd } = useMemo(() => businessDayBounds(selectedDate), [selectedDate]);
  const dayLabel = new Date(dayStart).toLocaleDateString();
  const dayShiftIds = useMemo(
    () => new Set(state.shifts.filter((sh) => sh.openedAt >= dayStart && sh.openedAt <= dayEnd).map((sh) => sh.id)),
    [state.shifts, dayStart, dayEnd],
  );

  const wasteEntries = useMemo(
    () => filterByBusinessDay(state.ledger.filter((l) => WASTE_LEDGER_CATEGORIES.has(l.category)), dayShiftIds, dayStart, dayEnd)
      .sort((a, b) => b.ts - a.ts),
    [state.ledger, dayShiftIds, dayStart, dayEnd],
  );
  const total = wasteEntries.reduce((a, l) => a + Number(l.amount), 0);
  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    wasteEntries.forEach((l) => map.set(l.category, (map.get(l.category) ?? 0) + Number(l.amount)));
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [wasteEntries]);

  return (
    <div className="glass rounded-2xl p-6">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-[oklch(0.62_0.24_25)]" />
          <h2 className="text-lg font-semibold">Wasted &amp; Complimentary Ledger</h2>
        </div>
        <div className="text-sm font-mono font-bold text-[oklch(0.62_0.24_25)]">{fmtMoney(total)} at cost on {dayLabel}</div>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Every spilled, rejected, or complimentary item on {dayLabel}, valued at its raw-material cost — never its
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
        <div className="text-sm text-muted-foreground font-mono text-center py-6">No waste or comps logged on {dayLabel}.</div>
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

function PnLLedgerPanel() {
  const { state } = useStore();
  const [range, setRange] = useState<RangeKey>("today");
  const [customFrom, setCustomFrom] = useState(() => new Date(startOfDay(Date.now())).toISOString().slice(0, 10));
  const [customTo, setCustomTo] = useState(() => new Date().toISOString().slice(0, 10));

  const { from, to } = useMemo(() => {
    const now = Date.now();
    if (range === "today") return { from: startOfDay(now), to: now };
    if (range === "week") return { from: startOfWeek(now), to: now };
    if (range === "month") return { from: startOfMonth(now), to: now };
    return { from: new Date(customFrom).getTime(), to: new Date(customTo).getTime() + 86400000 - 1 };
  }, [range, customFrom, customTo]);

  const ledgerInRange = useMemo(
    () => state.ledger.filter((l) => l.ts >= from && l.ts <= to && l.status === "approved"),
    [state.ledger, from, to],
  );
  const sessionsInRange = useMemo(
    () => state.sessions.filter((s) => s.endedAt >= from && s.endedAt <= to),
    [state.sessions, from, to],
  );
  // Closed shifts within the selected range — lets an admin find and
  // recalculate a specific past shift, not just today's (the existing
  // Shift Comparison section elsewhere on this page only ever shows
  // today's shifts).
  const shiftsInRange = useMemo(
    () => state.shifts.filter((sh) => sh.closedAt !== null && sh.closedAt >= from && sh.closedAt <= to).sort((a, b) => b.closedAt! - a.closedAt!),
    [state.shifts, from, to],
  );

  const exportCsv = () => {
    const rows = [
      ["Timestamp", "Type", "Direction", "Category", "Description", "Amount", "Staff", "Status", "Supplier", "Material", "Qty", "Unit Cost"],
      ...ledgerInRange.map((l) => [
        new Date(l.ts).toISOString(), l.type, l.direction, l.category, l.description,
        String(l.amount), l.staffUsername, l.status, l.supplierId ?? "", l.materialId ?? "",
        l.qty !== null ? String(l.qty) : "", l.unitCost !== null ? String(l.unitCost) : "",
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `glitch-ledger-${range}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="glass rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Wallet className="w-5 h-5 text-[oklch(0.78_0.2_155)]" />
          <h2 className="text-lg font-semibold">Detailed Ledger &amp; History</h2>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
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
          <button onClick={exportCsv} className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg bg-black/5 border border-black/10 hover:bg-black/8">
            <FileDown className="w-3.5 h-3.5" /> Export CSV
          </button>
        </div>
      </div>

      {range === "custom" && (
        <div className="flex items-center flex-wrap gap-2 mb-4 text-sm">
          <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="bg-white/70 border border-black/10 rounded px-2 py-1.5" />
          <span className="text-muted-foreground">to</span>
          <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="bg-white/70 border border-black/10 rounded px-2 py-1.5" />
        </div>
      )}

      {ledgerInRange.length === 0 ? (
        <div className="text-sm text-muted-foreground font-mono">No ledger entries in this range.</div>
      ) : (
        <div className="overflow-x-auto max-h-96 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-[#faf6ec]">
              <tr className="text-[10px] uppercase tracking-widest text-muted-foreground border-b border-black/8">
                <th className="text-left py-2 px-2">Time</th>
                <th className="text-left py-2 px-2">Type</th>
                <th className="text-left py-2 px-2">Description</th>
                <th className="text-left py-2 px-2">Staff</th>
                <th className="text-right py-2 px-2">Amount</th>
              </tr>
            </thead>
            <tbody>
              {ledgerInRange.slice().sort((a, b) => b.ts - a.ts).map((l) => (
                <tr key={l.id} className="border-b border-black/8 hover:bg-black/5">
                  <td className="py-2 px-2 font-mono text-xs text-muted-foreground">{new Date(l.ts).toLocaleString()}</td>
                  <td className="py-2 px-2 text-xs uppercase tracking-widest text-muted-foreground">{l.category}</td>
                  <td className="py-2 px-2 text-xs">{l.description || "—"}</td>
                  <td className="py-2 px-2 text-xs">{l.staffUsername}</td>
                  <td className={`py-2 px-2 text-right font-mono font-semibold ${l.direction === "inflow" ? "text-[oklch(0.78_0.2_155)]" : "text-[oklch(0.62_0.24_25)]"}`}>
                    {l.direction === "inflow" ? "+" : "-"}{fmtMoney(l.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <OrderHistorySection sessions={sessionsInRange} />
      <ShiftHistorySection shifts={shiftsInRange} sessions={state.sessions} />
    </div>
  );
}

function OrderHistorySection({ sessions }: { sessions: Session[] }) {
  const { state } = useStore();
  const isAdmin = state.currentUser?.role === "admin";
  const [open, setOpen] = useState(false);
  const [viewingSession, setViewingSession] = useState<Session | null>(null);
  const [reopenTarget, setReopenTarget] = useState<Session | null>(null);
  const sorted = [...sessions].sort((a, b) => b.endedAt - a.endedAt);

  return (
    <div className="mt-6 pt-6 border-t border-black/8">
      <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-2 text-sm font-semibold text-[oklch(0.7_0.19_260)]">
        <History className="w-4 h-4" /> Order History ({sorted.length}) {open ? "▲" : "▼"}
      </button>
      {open && (
        sorted.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-6">No closed checks in this range.</div>
        ) : (
          <div className="mt-3 overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-[#faf6ec]">
                <tr className="text-[10px] uppercase tracking-widest text-muted-foreground border-b border-black/8">
                  <th className="text-left py-2 px-2">#</th>
                  <th className="text-left py-2 px-2">Closed</th>
                  <th className="text-left py-2 px-2">Room/Table</th>
                  <th className="text-left py-2 px-2">Payment</th>
                  <th className="text-right py-2 px-2">Total</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((s) => (
                  <tr key={s.id} onClick={() => setViewingSession(s)} className="border-b border-black/8 hover:bg-black/5 cursor-pointer">
                    <td className="py-2 px-2 font-mono text-xs text-muted-foreground">#{s.orderNumber}</td>
                    <td className="py-2 px-2 font-mono text-xs text-muted-foreground">{new Date(s.endedAt).toLocaleString()}</td>
                    <td className="py-2 px-2 font-semibold">{s.roomName}</td>
                    <td className="py-2 px-2 text-xs">{s.paymentMethod}</td>
                    <td className="py-2 px-2 text-right font-mono font-bold">{fmtMoney(s.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
      {viewingSession && (
        <ReceiptModal
          session={viewingSession}
          onClose={() => setViewingSession(null)}
          onReopen={isAdmin ? () => { setReopenTarget(viewingSession); setViewingSession(null); } : undefined}
        />
      )}
      {reopenTarget && <ReopenCheckModal session={reopenTarget} onClose={() => setReopenTarget(null)} />}
    </div>
  );
}

// Reuses ShiftCard (which already has the admin-only Recalculate
// button built in) so a shift from ANY past day, not just today, can
// be found and corrected — the Shift Comparison section elsewhere on
// this page only ever shows today's shifts.
function ShiftHistorySection({ shifts, sessions }: { shifts: Shift[]; sessions: Session[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-6 pt-6 border-t border-black/8">
      <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-2 text-sm font-semibold text-[oklch(0.7_0.19_260)]">
        <History className="w-4 h-4" /> Shift History ({shifts.length}) {open ? "▲" : "▼"}
      </button>
      {open && (
        shifts.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-6">No closed shifts in this range.</div>
        ) : (
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[32rem] overflow-y-auto">
            {shifts.map((sh) => (
              <ShiftCard
                key={sh.id}
                shift={sh}
                label={new Date(sh.openedAt).toLocaleDateString()}
                sessions={sessions.filter((s) => s.shiftId === sh.id)}
              />
            ))}
          </div>
        )
      )}
    </div>
  );
}

function ReopenCheckModal({ session, onClose }: { session: Session; onClose: () => void }) {
  const { state, reopenSession } = useStore();
  const room = state.rooms.find((r) => r.id === session.roomId);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setErr(null);
    try {
      const res = await reopenSession(session.id);
      if (!res.ok) { setErr(res.error ?? "Could not reopen this check"); return; }
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[220] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={() => !submitting && onClose()}>
      <div className="w-full max-w-sm glass-strong rounded-2xl border border-[oklch(0.7_0.19_260/0.5)] p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-bold mb-2">Reopen check #{session.orderNumber}?</h3>
        <p className="text-sm text-muted-foreground mb-3">
          {room?.name ?? session.roomName} will become active again with its original orders restored, and this
          check's {fmtMoney(session.total)} is removed from past revenue totals until it's checked out again.
          {room?.status === "active" && (
            <span className="block mt-2 font-bold text-[oklch(0.62_0.24_25)]">
              {room.name} currently has a different active session — this will fail until it's freed up.
            </span>
          )}
        </p>
        {err && <div className="text-sm text-[oklch(0.62_0.24_25)] mb-3">{err}</div>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} disabled={submitting} className="px-3 py-1.5 rounded-lg text-sm bg-black/5 border border-black/10">Cancel</button>
          <button
            onClick={() => void submit()}
            disabled={submitting}
            className="px-3 py-1.5 rounded-lg text-sm font-bold bg-gradient-to-r from-[oklch(0.7_0.19_260)] to-[oklch(0.65_0.24_305)] text-[#2b2416] disabled:opacity-50"
          >
            {submitting ? "Reopening..." : "Reopen Check"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ShiftCard({ shift, label, sessions }: { shift: Shift; label: string; sessions: Session[] }) {
  const { state } = useStore();
  const isAdmin = state.currentUser?.role === "admin";
  const revenue = sessions.reduce((a, s) => a + s.total, 0);
  const isOpen = !shift.closedAt;
  const discrepancy = shift.discrepancy;
  const pendingVoids = state.voidRequests.filter((v) => v.shiftId === shift.id && v.status === "pending").length;
  const [showRecalc, setShowRecalc] = useState(false);
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
          ⚠ {pendingVoids} Unapproved Discrepanc{pendingVoids > 1 ? "ies" : "y"}
        </div>
      )}
      <div className="text-xs font-mono text-muted-foreground space-y-1">
        <div className="flex justify-between"><span>Opened</span><span>{new Date(shift.openedAt).toLocaleTimeString()}</span></div>
        <div className="flex justify-between"><span>Closed</span><span>{shift.closedAt ? new Date(shift.closedAt).toLocaleTimeString() : "—"}</span></div>
        <div className="flex justify-between"><span>Opening Balance</span><span>{fmtMoney(shift.openingBalance)}</span></div>
        <div className="flex justify-between"><span>Revenue</span><span>{fmtMoney(revenue)}</span></div>
        {shift.expectedCash !== null && (
          <div className="flex justify-between"><span>Expected Cash</span><span>{fmtMoney(shift.expectedCash)}</span></div>
        )}
        {shift.closingActualCash !== null && (
          <div className="flex justify-between"><span>Actual Cash</span><span>{fmtMoney(shift.closingActualCash)}</span></div>
        )}
        {discrepancy !== null && (
          <div className={`flex justify-between font-bold ${Math.abs(discrepancy) < 0.005 ? "text-[oklch(0.78_0.2_155)]" : "text-[oklch(0.62_0.24_25)]"}`}>
            <span>Discrepancy</span><span>{fmtMoney(discrepancy)}</span>
          </div>
        )}
      </div>
      {isAdmin && !isOpen && (
        <button
          onClick={() => setShowRecalc(true)}
          className="mt-2 text-[10px] uppercase tracking-widest text-muted-foreground hover:text-[oklch(0.7_0.19_260)] flex items-center gap-1"
          title="Recalculate this shift's expected cash and discrepancy from current data"
        >
          <History className="w-3 h-3" /> Recalculate
        </button>
      )}
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

function HistoryLog() {
  const { state } = useStore();
  const [range, setRange] = useState<"day" | "week" | "month">("day");

  const filtered = useMemo(() => {
    const now = Date.now();
    const cutoff = range === "day" ? startOfDay(now) : range === "week" ? startOfWeek(now) : startOfMonth(now);
    return state.shifts
      .filter((sh) => sh.closedAt !== null && sh.openedAt >= cutoff)
      .sort((a, b) => b.openedAt - a.openedAt);
  }, [state.shifts, range]);

  return (
    <div className="glass rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <History className="w-5 h-5 text-[oklch(0.7_0.19_260)]" />
          <h2 className="text-lg font-semibold">Shift History Archive</h2>
        </div>
        <div className="flex items-center gap-1 bg-white/60 rounded-lg p-1 border border-black/8">
          {(["day", "week", "month"] as const).map((r) => (
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

      {filtered.length === 0 ? (
        <div className="text-sm text-muted-foreground font-mono">No closed shifts in this range.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-widest text-muted-foreground border-b border-black/8">
                <th className="text-left py-2 px-2">Cashier</th>
                <th className="text-left py-2 px-2">Opened</th>
                <th className="text-left py-2 px-2">Closed</th>
                <th className="text-right py-2 px-2">Revenue</th>
                <th className="text-right py-2 px-2">Discrepancy</th>
                <th className="text-right py-2 px-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((sh) => {
                const revenue = state.sessions.filter((s) => s.shiftId === sh.id).reduce((a, s) => a + s.total, 0);
                return (
                  <tr key={sh.id} className="border-b border-black/8 hover:bg-black/5">
                    <td className="py-2 px-2 font-semibold">{sh.cashierUsername}</td>
                    <td className="py-2 px-2 font-mono text-xs text-muted-foreground">{new Date(sh.openedAt).toLocaleString()}</td>
                    <td className="py-2 px-2 font-mono text-xs text-muted-foreground">{sh.closedAt ? new Date(sh.closedAt).toLocaleString() : "—"}</td>
                    <td className="py-2 px-2 text-right font-mono">{fmtMoney(revenue)}</td>
                    <td className={`py-2 px-2 text-right font-mono ${sh.discrepancy !== null && Math.abs(sh.discrepancy) >= 0.005 ? "text-[oklch(0.62_0.24_25)]" : ""}`}>
                      {sh.discrepancy !== null ? fmtMoney(sh.discrepancy) : "—"}
                    </td>
                    <td className="py-2 px-2 text-right text-xs uppercase tracking-widest text-muted-foreground">
                      {sh.forced ? "Force Closed" : "Normal"}
                    </td>
                  </tr>
                );
              })}
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
