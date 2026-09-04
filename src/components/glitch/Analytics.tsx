import { useMemo } from "react";
import { useStore, fmtMoney } from "@/lib/glitch-store";
import type { Session, LedgerEntry } from "@/lib/glitch-store";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell, BarChart, Bar,
} from "recharts";
import { BarChart3, TrendingUp, Clock, Calendar, Percent, ShoppingBag } from "lucide-react";

function startOfDay(ts: number) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function startOfMonth(ts: number) {
  const d = new Date(ts);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function daysAgo(n: number) {
  return startOfDay(Date.now()) - n * 86400000;
}
function monthsAgoLabel(n: number) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - n);
  return d.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
}
function monthBounds(n: number) {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  d.setMonth(d.getMonth() - n);
  const from = d.getTime();
  const to = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999).getTime();
  return { from, to };
}

// Same exclusion rule used throughout Reports.tsx — waste/comp voids,
// staff consumption, unpaid entries, and supplier-debt settlements are
// never real same-period operational spend.
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

const PIE_COLORS = [
  "oklch(0.7 0.19 260)", "oklch(0.65 0.24 305)", "oklch(0.78 0.2 155)", "oklch(0.85 0.18 85)",
  "oklch(0.62 0.24 25)", "oklch(0.75 0.2 305)", "oklch(0.6 0.13 200)", "oklch(0.55 0.15 30)",
  "oklch(0.7 0.15 340)", "oklch(0.5 0.1 260)", "oklch(0.8 0.1 100)", "oklch(0.45 0.2 25)", "oklch(0.65 0.05 260)",
];

export function AnalyticsPage() {
  const { state } = useStore();

  const monthStart = useMemo(() => startOfMonth(Date.now()), []);
  const monthSessions = useMemo(() => state.sessions.filter((s) => s.endedAt >= monthStart), [state.sessions, monthStart]);
  const monthExpenseEntries = useMemo(() => state.ledger.filter((l) => isOperationalExpense(l) && l.ts >= monthStart), [state.ledger, monthStart]);

  // ---- KPI cards (scoped to this calendar month) ----
  const monthRevenue = monthSessions.reduce((a, s) => a + s.total, 0);
  const monthExpenses = monthExpenseEntries.reduce((a, l) => a + Number(l.amount), 0);
  const aov = monthSessions.length > 0 ? monthRevenue / monthSessions.length : 0;
  const netProfit = monthRevenue - monthExpenses;
  const profitMarginPct = monthRevenue > 0 ? (netProfit / monthRevenue) * 100 : 0;

  const hourlyTotals = useMemo(() => {
    const totals = Array.from({ length: 24 }, (_, h) => ({ hour: h, revenue: 0, orders: 0 }));
    monthSessions.forEach((s) => {
      const h = new Date(s.endedAt).getHours();
      totals[h].revenue += s.total;
      totals[h].orders += 1;
    });
    return totals;
  }, [monthSessions]);
  const peakHour = useMemo(() => hourlyTotals.reduce((a, b) => (b.revenue > a.revenue ? b : a), hourlyTotals[0]), [hourlyTotals]);

  const dailyTotals = useMemo(() => {
    const map = new Map<string, number>();
    monthSessions.forEach((s) => {
      const key = new Date(startOfDay(s.endedAt)).toLocaleDateString();
      map.set(key, (map.get(key) ?? 0) + s.total);
    });
    return map;
  }, [monthSessions]);
  const highestGrossingDay = useMemo(() => {
    return Array.from(dailyTotals.entries()).reduce<{ day: string; revenue: number } | null>(
      (best, [day, revenue]) => (!best || revenue > best.revenue ? { day, revenue } : best),
      null,
    );
  }, [dailyTotals]);

  // ---- Category revenue distribution (this month) ----
  const categoryData = useMemo(() => {
    const map = new Map<string, number>();
    monthSessions.forEach((s) => {
      let roomTimeShare = s.timeCost;
      s.orders.forEach((o) => {
        const menuItem = state.menu.find((m) => m.id === o.menuItemId);
        const cat = menuItem?.category ?? "Extras";
        map.set(cat, (map.get(cat) ?? 0) + o.qty * o.price);
      });
      if (roomTimeShare > 0) map.set("Room Time", (map.get("Room Time") ?? 0) + roomTimeShare);
    });
    return Array.from(map.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [monthSessions, state.menu]);

  // ---- Payment method split (this month) — Staff Allowance shown
  // separately for comparison, never as part of real payment totals. ----
  const paymentSplitData = useMemo(() => {
    const cash = monthSessions.reduce((a, s) => a + s.cashAmount, 0);
    const visa = monthSessions.reduce((a, s) => a + s.visaAmount, 0);
    const instapay = monthSessions.reduce((a, s) => a + s.instapayAmount, 0);
    const staffAllowance = state.ledger
      .filter((l) => l.category === "Staff Consumption Expense" && l.ts >= monthStart)
      .reduce((a, l) => a + Number(l.amount), 0);
    return [
      { name: "Cash", value: cash },
      { name: "Visa", value: visa },
      { name: "InstaPay", value: instapay },
      { name: "Staff Allowance", value: staffAllowance },
    ];
  }, [monthSessions, state.ledger, monthStart]);

  // ---- Room/Table profitability (this month) ----
  const roomProfitData = useMemo(() => {
    const map = new Map<string, number>();
    monthSessions.forEach((s) => {
      map.set(s.roomName, (map.get(s.roomName) ?? 0) + s.total);
    });
    return Array.from(map.entries()).map(([name, revenue]) => ({ name, revenue })).sort((a, b) => b.revenue - a.revenue).slice(0, 12);
  }, [monthSessions]);

  // ---- Days comparison: today vs yesterday vs same day last week ----
  const daysComparison = useMemo(() => {
    const revenueOn = (from: number, to: number) => state.sessions.filter((s) => s.endedAt >= from && s.endedAt < to).reduce((a, s) => a + s.total, 0);
    const today = daysAgo(0);
    return [
      { name: "Same Day Last Week", revenue: revenueOn(daysAgo(7), daysAgo(6)) },
      { name: "Yesterday", revenue: revenueOn(daysAgo(1), daysAgo(0)) },
      { name: "Today", revenue: revenueOn(today, today + 86400000) },
    ];
  }, [state.sessions]);

  // ---- Weeks comparison: current week vs previous 3 weeks ----
  const weeksComparison = useMemo(() => {
    const now = Date.now();
    const thisWeekStart = (() => {
      const d = new Date();
      d.setDate(d.getDate() - d.getDay());
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    })();
    const weeks: { name: string; revenue: number }[] = [];
    for (let i = 3; i >= 0; i--) {
      const from = thisWeekStart - i * 7 * 86400000;
      const to = i === 0 ? now : from + 7 * 86400000;
      const revenue = state.sessions.filter((s) => s.endedAt >= from && s.endedAt < to).reduce((a, s) => a + s.total, 0);
      weeks.push({ name: i === 0 ? "This Week" : `${i} Week${i > 1 ? "s" : ""} Ago`, revenue });
    }
    return weeks;
  }, [state.sessions]);

  // ---- Months comparison: last 6 months, revenue/expenses/net profit ----
  const monthsComparison = useMemo(() => {
    const months: { name: string; revenue: number; expenses: number; netProfit: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const { from, to } = monthBounds(i);
      const revenue = state.sessions.filter((s) => s.endedAt >= from && s.endedAt <= to).reduce((a, s) => a + s.total, 0);
      const expenses = state.ledger.filter((l) => isOperationalExpense(l) && l.ts >= from && l.ts <= to).reduce((a, l) => a + Number(l.amount), 0);
      months.push({ name: monthsAgoLabel(i), revenue, expenses, netProfit: revenue - expenses });
    }
    return months;
  }, [state.sessions, state.ledger]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <BarChart3 className="w-8 h-8 text-[oklch(0.7_0.19_260)]" />
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Executive Analytics</h1>
          <p className="text-sm text-muted-foreground mt-1 font-mono uppercase tracking-widest">
            {new Date().toLocaleDateString(undefined, { month: "long", year: "numeric" })} — Admin Only
          </p>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon={ShoppingBag} label="Average Order Value" value={fmtMoney(aov)} sub={`${monthSessions.length} orders this month`} />
        <KpiCard icon={Clock} label="Peak Hour" value={peakHour.revenue > 0 ? `${String(peakHour.hour).padStart(2, "0")}:00` : "—"} sub={peakHour.revenue > 0 ? `${fmtMoney(peakHour.revenue)} revenue` : "No data yet"} />
        <KpiCard icon={Calendar} label="Highest Grossing Day" value={highestGrossingDay ? fmtMoney(highestGrossingDay.revenue) : "—"} sub={highestGrossingDay?.day ?? "No data yet"} />
        <KpiCard
          icon={Percent} label="Profit Margin"
          value={`${profitMarginPct.toFixed(1)}%`}
          sub={fmtMoney(netProfit) + " net this month"}
          accent={netProfit >= 0 ? "oklch(0.78 0.2 155)" : "oklch(0.62 0.24 25)"}
        />
      </div>

      {/* Revenue & Orders Timeline */}
      <div className="glass rounded-2xl p-6 min-w-0">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="w-5 h-5 text-[oklch(0.7_0.19_260)]" />
          <h2 className="text-lg font-semibold">Revenue &amp; Orders Timeline (by Hour)</h2>
        </div>
        <p className="text-xs text-muted-foreground mb-4">Hourly breakdown across this month's orders — reveals peak lounge hours.</p>
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={hourlyTotals} margin={{ left: 8, right: 16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.08)" />
            <XAxis dataKey="hour" tickFormatter={(h) => `${String(h).padStart(2, "0")}:00`} tick={{ fontSize: 11 }} />
            <YAxis yAxisId="revenue" tick={{ fontSize: 11 }} />
            <YAxis yAxisId="orders" orientation="right" tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip formatter={(v: number, name: string) => [name === "Revenue (EGP)" ? fmtMoney(v) : v, name]} labelFormatter={(h) => `${String(h).padStart(2, "0")}:00`} />
            <Legend />
            <Line yAxisId="revenue" type="monotone" dataKey="revenue" name="Revenue (EGP)" stroke="oklch(0.7 0.19 260)" strokeWidth={2} dot={false} />
            <Line yAxisId="orders" type="monotone" dataKey="orders" name="Orders" stroke="oklch(0.78 0.2 155)" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Category Revenue Distribution */}
        <div className="glass rounded-2xl p-6 min-w-0">
          <h2 className="text-lg font-semibold mb-1">Category Revenue Distribution</h2>
          <p className="text-xs text-muted-foreground mb-4">Share of this month's revenue by menu category, including Room Time.</p>
          {categoryData.length === 0 ? (
            <div className="text-sm text-muted-foreground font-mono text-center py-16">No sales this month yet.</div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie data={categoryData} dataKey="value" nameKey="name" innerRadius={60} outerRadius={100} paddingAngle={2}>
                  {categoryData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v: number) => fmtMoney(v)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Payment Method Split */}
        <div className="glass rounded-2xl p-6 min-w-0">
          <h2 className="text-lg font-semibold mb-1">Payment Method Split</h2>
          <p className="text-xs text-muted-foreground mb-4">This month — Staff Allowance shown for comparison, not counted as revenue.</p>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={paymentSplitData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.08)" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: number) => fmtMoney(v)} />
              <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                {paymentSplitData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Room/Table Profitability */}
      <div className="glass rounded-2xl p-6 min-w-0">
        <h2 className="text-lg font-semibold mb-1">Room / Table Profitability</h2>
        <p className="text-xs text-muted-foreground mb-4">Total revenue generated per Room/Table this month.</p>
        {roomProfitData.length === 0 ? (
          <div className="text-sm text-muted-foreground font-mono text-center py-16">No sales this month yet.</div>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(280, roomProfitData.length * 34)}>
            <BarChart data={roomProfitData} layout="vertical" margin={{ left: 24 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.08)" />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={100} />
              <Tooltip formatter={(v: number) => fmtMoney(v)} />
              <Bar dataKey="revenue" fill="oklch(0.7 0.19 260)" radius={[0, 6, 6, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Comparative Analytics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="glass rounded-2xl p-6 min-w-0">
          <h2 className="text-lg font-semibold mb-1">Days Comparison</h2>
          <p className="text-xs text-muted-foreground mb-4">Today vs. yesterday vs. the same day last week.</p>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={daysComparison}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.08)" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: number) => fmtMoney(v)} />
              <Bar dataKey="revenue" name="Revenue" fill="oklch(0.78 0.2 155)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="glass rounded-2xl p-6 min-w-0">
          <h2 className="text-lg font-semibold mb-1">Weeks Comparison</h2>
          <p className="text-xs text-muted-foreground mb-4">This week vs. the previous three weeks.</p>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={weeksComparison}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.08)" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: number) => fmtMoney(v)} />
              <Bar dataKey="revenue" name="Revenue" fill="oklch(0.7 0.19 260)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="glass rounded-2xl p-6 min-w-0">
        <h2 className="text-lg font-semibold mb-1">Months Comparison</h2>
        <p className="text-xs text-muted-foreground mb-4">Month-over-month revenue, expenses, and net profit — last 6 months.</p>
        <div className="overflow-x-auto">
          <div className="min-w-[560px]">
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={monthsComparison}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.08)" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => fmtMoney(v)} />
                <Legend />
                <Bar dataKey="revenue" name="Revenue" fill="oklch(0.78 0.2 155)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="expenses" name="Expenses" fill="oklch(0.62 0.24 25)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="netProfit" name="Net Profit" fill="oklch(0.7 0.19 260)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, sub, accent }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; sub: string; accent?: string }) {
  return (
    <div className="glass rounded-2xl p-5 border border-black/8">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="w-4 h-4" />
        <span className="text-[10px] uppercase tracking-widest">{label}</span>
      </div>
      <div className="text-2xl font-mono font-bold mt-2" style={accent ? { color: accent } : undefined}>{value}</div>
      <div className="text-[11px] text-muted-foreground font-mono mt-1">{sub}</div>
    </div>
  );
}
