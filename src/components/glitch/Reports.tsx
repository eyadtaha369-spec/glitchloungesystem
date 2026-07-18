import { useMemo, useState } from "react";
import { useStore, fmtMoney, isToday } from "@/lib/glitch-store";
import type { Shift, Session } from "@/lib/glitch-store";
import { FileDown, TrendingUp, Users2, Boxes, History } from "lucide-react";

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
  const { state } = useStore();

  const todaySessions = useMemo(() => state.sessions.filter((s) => isToday(s.endedAt)), [state.sessions]);
  const todayShifts = useMemo(
    () => state.shifts.filter((sh) => isToday(sh.openedAt)).sort((a, b) => a.openedAt - b.openedAt),
    [state.shifts],
  );

  const totalRevenue = todaySessions.reduce((a, s) => a + s.total, 0);
  const cashRevenue = todaySessions.filter((s) => s.paymentMethod === "cash").reduce((a, s) => a + s.total, 0);
  const visaRevenue = todaySessions.filter((s) => s.paymentMethod === "visa").reduce((a, s) => a + s.total, 0);

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
          <p className="text-sm text-muted-foreground mt-1 font-mono uppercase tracking-widest">All shifts · Today</p>
        </div>
        <button
          onClick={() => generateDailyReport(todayShifts, todaySessions, consumption, totalRevenue, cashRevenue, visaRevenue)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-r from-[oklch(0.7_0.19_260)] to-[oklch(0.65_0.24_305)] text-white text-sm font-semibold shadow-[0_0_20px_oklch(0.7_0.19_260/0.4)]"
        >
          <FileDown className="w-4 h-4" /> Generate Daily Report
        </button>
      </div>

      {/* Total revenue */}
      <div className="glass rounded-2xl p-6">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="w-5 h-5 text-[oklch(0.78_0.2_155)]" />
          <h2 className="text-lg font-semibold">Total Revenue — Today</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-black/30 rounded-lg p-4 border border-white/5">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Combined</div>
            <div className="text-2xl font-mono font-bold mt-1">{fmtMoney(totalRevenue)}</div>
          </div>
          <div className="bg-black/30 rounded-lg p-4 border border-white/5">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Cash</div>
            <div className="text-2xl font-mono font-bold mt-1 text-[oklch(0.78_0.2_155)]">{fmtMoney(cashRevenue)}</div>
          </div>
          <div className="bg-black/30 rounded-lg p-4 border border-white/5">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Visa</div>
            <div className="text-2xl font-mono font-bold mt-1 text-[oklch(0.85_0.16_200)]">{fmtMoney(visaRevenue)}</div>
          </div>
        </div>
      </div>

      {/* Shift comparison */}
      <div className="glass rounded-2xl p-6">
        <div className="flex items-center gap-2 mb-4">
          <Users2 className="w-5 h-5 text-[oklch(0.85_0.16_200)]" />
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
              <div key={c.name} className="bg-black/30 rounded-lg p-3 border border-white/5 flex justify-between items-center">
                <span className="text-sm">{c.name}</span>
                <span className="font-mono text-sm text-[oklch(0.82_0.16_85)]">{c.qty}{c.unit}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <HistoryLog />
    </div>
  );
}

function ShiftCard({ shift, label, sessions }: { shift: Shift; label: string; sessions: Session[] }) {
  const revenue = sessions.reduce((a, s) => a + s.total, 0);
  const isOpen = !shift.closedAt;
  const discrepancy = shift.discrepancy;
  return (
    <div className="bg-black/30 rounded-lg p-4 border border-white/5">
      <div className="flex items-center justify-between mb-2">
        <div className="font-semibold">{label} · {shift.cashierUsername}</div>
        {isOpen ? (
          <span className="text-[10px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-full bg-[oklch(0.78_0.2_155/0.15)] text-[oklch(0.78_0.2_155)] border border-[oklch(0.78_0.2_155/0.5)]">Open</span>
        ) : (
          <span className="text-[10px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-full bg-white/5 text-muted-foreground border border-white/10">
            {shift.forced ? "Force Closed" : "Closed"}
          </span>
        )}
      </div>
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
          <div className={`flex justify-between font-bold ${Math.abs(discrepancy) < 0.005 ? "text-[oklch(0.78_0.2_155)]" : "text-[oklch(0.75_0.22_25)]"}`}>
            <span>Discrepancy</span><span>{fmtMoney(discrepancy)}</span>
          </div>
        )}
      </div>
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
          <History className="w-5 h-5 text-[oklch(0.85_0.16_200)]" />
          <h2 className="text-lg font-semibold">Shift History Archive</h2>
        </div>
        <div className="flex items-center gap-1 bg-black/30 rounded-lg p-1 border border-white/5">
          {(["day", "week", "month"] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-3 py-1.5 rounded-md text-xs uppercase tracking-widest font-semibold transition ${
                range === r ? "bg-[oklch(0.7_0.19_260/0.3)] text-white" : "text-muted-foreground hover:text-white"
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
              <tr className="text-[10px] uppercase tracking-widest text-muted-foreground border-b border-white/5">
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
                  <tr key={sh.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="py-2 px-2 font-semibold">{sh.cashierUsername}</td>
                    <td className="py-2 px-2 font-mono text-xs text-muted-foreground">{new Date(sh.openedAt).toLocaleString()}</td>
                    <td className="py-2 px-2 font-mono text-xs text-muted-foreground">{sh.closedAt ? new Date(sh.closedAt).toLocaleString() : "—"}</td>
                    <td className="py-2 px-2 text-right font-mono">{fmtMoney(revenue)}</td>
                    <td className={`py-2 px-2 text-right font-mono ${sh.discrepancy !== null && Math.abs(sh.discrepancy) >= 0.005 ? "text-[oklch(0.75_0.22_25)]" : ""}`}>
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
) {
  const win = window.open("", "_blank", "width=900,height=1200");
  if (!win) return;
  const today = new Date().toLocaleDateString();
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
  .grand { font-weight: bold; border-top: 2px solid #111; margin-top: 6px; padding-top: 8px !important; }
</style></head><body>
<h1>GLITCH LOUNGE</h1>
<div class="sub">Daily Owner Report — ${today}</div>
<div class="totals">
  <div><span>Cash Revenue</span><span>$${cashRevenue.toFixed(2)}</span></div>
  <div><span>Visa Revenue</span><span>$${visaRevenue.toFixed(2)}</span></div>
  <div class="grand"><span>TOTAL REVENUE</span><span>$${totalRevenue.toFixed(2)}</span></div>
</div>
<h3 style="margin-top:24px">Shift Comparison</h3>
<table>
  <thead><tr><th>Cashier</th><th>Opened</th><th>Closed</th><th>Opening $</th><th>Expected</th><th>Actual</th><th>Discrepancy</th></tr></thead>
  <tbody>
    ${shifts.map((sh) => `<tr>
      <td>${sh.cashierUsername}</td>
      <td>${new Date(sh.openedAt).toLocaleTimeString()}</td>
      <td>${sh.closedAt ? new Date(sh.closedAt).toLocaleTimeString() : "Open"}</td>
      <td>$${sh.openingBalance.toFixed(2)}</td>
      <td>${sh.expectedCash !== null ? "$" + sh.expectedCash.toFixed(2) : "—"}</td>
      <td>${sh.closingActualCash !== null ? "$" + sh.closingActualCash.toFixed(2) : "—"}</td>
      <td>${sh.discrepancy !== null ? "$" + sh.discrepancy.toFixed(2) : "—"}</td>
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
  <thead><tr><th>Room</th><th>End</th><th>Payment</th><th>Total</th></tr></thead>
  <tbody>
    ${sessions.map((s) => `<tr>
      <td>${s.roomName}</td>
      <td>${new Date(s.endedAt).toLocaleTimeString()}</td>
      <td>${s.paymentMethod.toUpperCase()}</td>
      <td>$${s.total.toFixed(2)}</td>
    </tr>`).join("")}
  </tbody>
</table>
<script>window.onload = () => setTimeout(() => window.print(), 300);</script>
</body></html>`);
  win.document.close();
}
