import { useEffect, useMemo, useState } from "react";
import { useStore, fmtMoney } from "@/lib/glitch-store";
import type { Shift, Session, LedgerEntry } from "@/lib/glitch-store";
import { FileDown, TrendingUp, Users2, Boxes, History, Wallet, MapPin, Sunrise, CalendarCheck, AlertTriangle, Trash2 } from "lucide-react";

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

  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const isViewingToday = useMemo(() => {
    const d = new Date();
    const todayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return selectedDate === todayStr;
  }, [selectedDate]);

  const dayStart = useMemo(() => new Date(selectedDate + "T00:00:00").getTime(), [selectedDate]);
  const dayEnd = dayStart + 86400000;
  const inSelectedDay = (ts: number) => ts >= dayStart && ts < dayEnd;

  const todaySessions = useMemo(() => state.sessions.filter((s) => inSelectedDay(s.endedAt)), [state.sessions, dayStart]);
  const wasteEntries = useMemo(
    () => state.ledger.filter((l) => l.category === "Marketing / Waste Expense" && inSelectedDay(l.ts)),
    [state.ledger, dayStart],
  );
  const todayShifts = useMemo(
    () => state.shifts.filter((sh) => inSelectedDay(sh.openedAt)).sort((a, b) => a.openedAt - b.openedAt),
    [state.shifts, dayStart],
  );

  // Exact aggregation: cashAmount + visaAmount + instapayAmount always sums
  // to session.total for every session (pure or mixed), so summing these
  // three fields across all of today's sessions IS the definitive Total
  // Daily Revenue — no separate "combined" calculation needed.
  const cashRevenue = todaySessions.reduce((a, s) => a + s.cashAmount, 0);
  const visaRevenue = todaySessions.reduce((a, s) => a + s.visaAmount, 0);
  const instapayRevenue = todaySessions.reduce((a, s) => a + s.instapayAmount, 0);
  const totalRevenue = cashRevenue + visaRevenue + instapayRevenue;

  // Material consumption today, derived from today's orders × recipes —
  // NOT from stock.used, since that's cumulative since last restock, not
  // scoped to today.
  const consumption = useMemo(() => {
    const map = new Map<string, number>();
    todaySessions.forEach((s) => {
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
  }, [todaySessions, state.menu, state.stock]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Owner Reports</h1>
          <p className="text-sm text-muted-foreground mt-1 font-mono uppercase tracking-widest">
            All shifts · {isViewingToday ? "Today" : new Date(selectedDate + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", year: "numeric" })}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div>
            <label className="text-[10px] uppercase tracking-widest text-muted-foreground block">End of Day — Select Date</label>
            <input
              type="date" value={selectedDate} max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="mt-0.5 bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm font-mono"
            />
          </div>
          <button
            onClick={() => generateDailyReport(todayShifts, todaySessions, consumption, totalRevenue, cashRevenue, visaRevenue, instapayRevenue, selectedDate, wasteEntries.reduce((a, e) => a + e.amount, 0))}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-r from-[oklch(0.82_0.16_85)] to-[oklch(0.82_0.16_85)] text-[#2b2416] text-sm font-semibold shadow-[0_0_20px_oklch(0.82_0.16_85/0.4)] self-end"
          >
            <FileDown className="w-4 h-4" /> Generate Report
          </button>
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs font-mono text-muted-foreground">
        <span>{todaySessions.length} order{todaySessions.length === 1 ? "" : "s"} on this day</span>
        <span>·</span>
        <span>{todayShifts.length} shift{todayShifts.length === 1 ? "" : "s"}</span>
      </div>

      <BusinessDayPanel />

      <WasteMarketingPanel allEntries={state.ledger.filter((l) => l.category === "Marketing / Waste Expense")} />

      {/* Total Daily Revenue — the definitive benchmark, before any expenses */}
      <div className="glass rounded-2xl p-6 border border-[oklch(0.78_0.2_155/0.4)]">
        <div className="flex items-center gap-2 mb-1">
          <TrendingUp className="w-5 h-5 text-[oklch(0.78_0.2_155)]" />
          <h2 className="text-lg font-semibold">Total Daily Revenue</h2>
        </div>
        <p className="text-xs text-muted-foreground mb-4">Cash + Visa + InstaPay, combined across every pure and mixed-method sale — before expenses.</p>
        <div className="text-4xl font-mono font-bold mb-4">{fmtMoney(totalRevenue)}</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white/60 rounded-lg p-4 border border-black/8">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Cash</div>
            <div className="text-2xl font-mono font-bold mt-1 text-[oklch(0.78_0.2_155)]">{fmtMoney(cashRevenue)}</div>
          </div>
          <div className="bg-white/60 rounded-lg p-4 border border-black/8">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Visa</div>
            <div className="text-2xl font-mono font-bold mt-1 text-[oklch(0.7_0.19_260)]">{fmtMoney(visaRevenue)}</div>
          </div>
          <div className="bg-white/60 rounded-lg p-4 border border-black/8">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">InstaPay</div>
            <div className="text-2xl font-mono font-bold mt-1 text-[oklch(0.75_0.2_305)]">{fmtMoney(instapayRevenue)}</div>
          </div>
        </div>
      </div>

      {/* Shift comparison */}
      <div className="glass rounded-2xl p-6">
        <div className="flex items-center gap-2 mb-4">
          <Users2 className="w-5 h-5 text-[oklch(0.7_0.19_260)]" />
          <h2 className="text-lg font-semibold">Shift Comparison — Today</h2>
        </div>
        {todayShifts.length === 0 ? (
          <div className="text-sm text-muted-foreground font-mono">No shifts opened today.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {todayShifts.map((sh, idx) => (
              <ShiftCard key={sh.id} shift={sh} label={`Shift ${idx + 1}`} sessions={state.sessions.filter((s) => s.shiftId === sh.id)} />
            ))}
          </div>
        )}
      </div>

      {/* Material consumption */}
      <div className="glass rounded-2xl p-6">
        <div className="flex items-center gap-2 mb-4">
          <Boxes className="w-5 h-5 text-[oklch(0.82_0.16_85)]" />
          <h2 className="text-lg font-semibold">Material Consumption — Today</h2>
        </div>
        {consumption.length === 0 ? (
          <div className="text-sm text-muted-foreground font-mono">No orders completed today.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {consumption.map((c) => (
              <div key={c.name} className="bg-white/60 rounded-lg p-3 border border-black/8 flex justify-between items-center">
                <span className="text-sm">{c.name}</span>
                <span className="font-mono text-sm text-[oklch(0.82_0.16_85)]">{c.qty}{c.unit}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <HistoryLog />
      <AttendanceLog />
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
    <div className="glass rounded-2xl p-6 border border-[oklch(0.82_0.16_85/0.5)]">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
        <div className="flex items-center gap-2">
          <Sunrise className="w-5 h-5 text-[oklch(0.82_0.16_85)]" />
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
        <div className="flex items-center gap-2 text-xs text-[oklch(0.82_0.16_85)] mb-3">
          <AlertTriangle className="w-3.5 h-3.5" /> Close the active shift first — a business day can't close while a shift is still running.
        </div>
      )}

      <button
        onClick={() => setConfirmOpen(true)}
        disabled={!canClose}
        className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-r from-[oklch(0.82_0.16_85)] to-[oklch(0.82_0.16_85)] text-[#2b2416] text-sm font-bold uppercase tracking-wide shadow-[0_0_20px_oklch(0.82_0.16_85/0.4)] disabled:opacity-40"
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
          <div className="w-full max-w-md glass-strong rounded-2xl border border-[oklch(0.82_0.16_85/0.5)]" onClick={(e) => e.stopPropagation()}>
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
                className="px-4 py-2 rounded-lg text-sm bg-gradient-to-r from-[oklch(0.82_0.16_85)] to-[oklch(0.82_0.16_85)] text-[#2b2416] font-bold disabled:opacity-60"
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

  const totalRevenue = sessionsInRange.reduce((a, s) => a + s.total, 0);
  const totalCogs = sessionsInRange.reduce((a, s) => a + (s.cogs || 0), 0);
  const totalExpenses = ledgerInRange.filter((l) => l.direction === "outflow" && l.type !== "sale").reduce((a, l) => a + Number(l.amount), 0);
  const netProfit = totalRevenue - (totalCogs + totalExpenses);

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
          <h2 className="text-lg font-semibold">Executive Ledger &amp; P&amp;L</h2>
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
        <div className="flex items-center gap-2 mb-4 text-sm">
          <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="bg-white/70 border border-black/10 rounded px-2 py-1.5" />
          <span className="text-muted-foreground">to</span>
          <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="bg-white/70 border border-black/10 rounded px-2 py-1.5" />
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="bg-white/60 rounded-lg p-4 border border-black/8">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Revenue</div>
          <div className="text-xl font-mono font-bold mt-1">{fmtMoney(totalRevenue)}</div>
        </div>
        <div className="bg-white/60 rounded-lg p-4 border border-black/8">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">COGS</div>
          <div className="text-xl font-mono font-bold mt-1 text-[oklch(0.82_0.16_85)]">{fmtMoney(totalCogs)}</div>
        </div>
        <div className="bg-white/60 rounded-lg p-4 border border-black/8">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Other Expenses</div>
          <div className="text-xl font-mono font-bold mt-1 text-[oklch(0.62_0.24_25)]">{fmtMoney(totalExpenses)}</div>
        </div>
        <div className={`rounded-lg p-4 border ${netProfit >= 0 ? "bg-[oklch(0.78_0.2_155/0.1)] border-[oklch(0.78_0.2_155/0.4)]" : "bg-[oklch(0.62_0.24_25/0.1)] border-[oklch(0.62_0.24_25/0.4)]"}`}>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Net Profit</div>
          <div className={`text-xl font-mono font-bold mt-1 ${netProfit >= 0 ? "text-[oklch(0.78_0.2_155)]" : "text-[oklch(0.62_0.24_25)]"}`}>{fmtMoney(netProfit)}</div>
        </div>
      </div>

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
    </div>
  );
}

function ShiftCard({ shift, label, sessions }: { shift: Shift; label: string; sessions: Session[] }) {
  const { state } = useStore();
  const revenue = sessions.reduce((a, s) => a + s.total, 0);
  const isOpen = !shift.closedAt;
  const discrepancy = shift.discrepancy;
  const pendingVoids = state.voidRequests.filter((v) => v.shiftId === shift.id && v.status === "pending").length;
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
        <MapPin className="w-5 h-5 text-[oklch(0.82_0.16_85)]" />
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
  shifts: Shift[],
  sessions: Session[],
  consumption: { name: string; unit: string; qty: number }[],
  totalRevenue: number,
  cashRevenue: number,
  visaRevenue: number,
  instapayRevenue: number,
  selectedDate: string,
  wasteExpense: number,
) {
  const win = window.open("", "_blank", "width=900,height=1200");
  if (!win) return;
  const today = new Date(selectedDate + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  win.document.write(`
<!DOCTYPE html><html><head><title>GLITCH Daily Report ${today}</title>
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
</style></head><body>
<h1>GLITCH LOUNGE</h1>
<div class="sub">End of Day Sales Log — ${today}</div>
<div class="totals">
  <div class="grand"><span>TOTAL DAILY REVENUE</span><span>${totalRevenue.toFixed(2)} EGP</span></div>
  <div><span>&nbsp;&nbsp;Cash</span><span>${cashRevenue.toFixed(2)} EGP</span></div>
  <div><span>&nbsp;&nbsp;Visa</span><span>${visaRevenue.toFixed(2)} EGP</span></div>
  <div><span>&nbsp;&nbsp;InstaPay</span><span>${instapayRevenue.toFixed(2)} EGP</span></div>
  <div><span>Order Count</span><span>${sessions.length}</span></div>
  <div><span>Wasted / Marketing Expense (excluded above)</span><span>${wasteExpense.toFixed(2)} EGP</span></div>
</div>
<h3 style="margin-top:24px">Shift Comparison</h3>
<table>
  <thead><tr><th>Cashier</th><th>Opened</th><th>Closed</th><th>Opening EGP</th><th>Expected</th><th>Actual</th><th>Discrepancy</th></tr></thead>
  <tbody>
    ${shifts.map((sh) => `<tr>
      <td>${sh.cashierUsername}</td>
      <td>${new Date(sh.openedAt).toLocaleTimeString()}</td>
      <td>${sh.closedAt ? new Date(sh.closedAt).toLocaleTimeString() : "Open"}</td>
      <td>${sh.openingBalance.toFixed(2)} EGP</td>
      <td>${sh.expectedCash !== null ? sh.expectedCash.toFixed(2) + " EGP" : "—"}</td>
      <td>${sh.closingActualCash !== null ? sh.closingActualCash.toFixed(2) + " EGP" : "—"}</td>
      <td>${sh.discrepancy !== null ? sh.discrepancy.toFixed(2) + " EGP" : "—"}</td>
    </tr>`).join("")}
  </tbody>
</table>
<h3 style="margin-top:24px">Material Consumption</h3>
<table>
  <thead><tr><th>Item</th><th>Consumed</th></tr></thead>
  <tbody>
    ${consumption.map((c) => `<tr><td>${c.name}</td><td>${c.qty}${c.unit}</td></tr>`).join("") || "<tr><td colspan=2>No orders today</td></tr>"}
  </tbody>
</table>
<h3 style="margin-top:24px">Sessions (${sessions.length})</h3>
<table>
  <thead><tr><th>Room</th><th>End</th><th>Payment</th><th>Cash</th><th>Visa</th><th>InstaPay</th><th>Total</th></tr></thead>
  <tbody>
    ${sessions.map((s) => `<tr>
      <td>${s.roomName}</td>
      <td>${new Date(s.endedAt).toLocaleTimeString()}</td>
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
