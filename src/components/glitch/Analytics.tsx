import { useMemo, useState } from "react";
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
    const totals = Array.from({ length: 24 }, (_, h) => ({ hour: h, revenue: 0, roomRevenue: 0, itemRevenue: 0, orders: 0 }));
    monthSessions.forEach((s) => {
      const h = new Date(s.endedAt).getHours();
      totals[h].revenue += s.total;
      totals[h].roomRevenue += s.timeCost;
      totals[h].itemRevenue += s.total - s.timeCost;
      totals[h].orders += 1;
    });
    return totals;
  }, [monthSessions]);
  const peakHour = useMemo(() => hourlyTotals.reduce((a, b) => (b.revenue > a.revenue ? b : a), hourlyTotals[0]), [hourlyTotals]);

  // ---- Revenue by Day of Month (this calendar month) ----
  const dayOfMonthTotals = useMemo(() => {
    const daysInThisMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
    const totals = Array.from({ length: daysInThisMonth }, (_, i) => ({ day: i + 1, revenue: 0, roomRevenue: 0, itemRevenue: 0 }));
    monthSessions.forEach((s) => {
      const d = new Date(s.endedAt).getDate();
      totals[d - 1].revenue += s.total;
      totals[d - 1].roomRevenue += s.timeCost;
      totals[d - 1].itemRevenue += s.total - s.timeCost;
    });
    return totals;
  }, [monthSessions]);
  const peakDay = useMemo(() => dayOfMonthTotals.reduce((a, b) => (b.revenue > a.revenue ? b : a), dayOfMonthTotals[0]), [dayOfMonthTotals]);

  // ---- Revenue by Month (this calendar year) ----
  const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthOfYearTotals = useMemo(() => {
    const thisYear = new Date().getFullYear();
    const totals = MONTH_NAMES.map((name) => ({ month: name, revenue: 0, roomRevenue: 0, itemRevenue: 0 }));
    state.sessions.forEach((s) => {
      const d = new Date(s.endedAt);
      if (d.getFullYear() !== thisYear) return;
      const m = d.getMonth();
      totals[m].revenue += s.total;
      totals[m].roomRevenue += s.timeCost;
      totals[m].itemRevenue += s.total - s.timeCost;
    });
    return totals;
  }, [state.sessions]);
  const peakMonth = useMemo(() => monthOfYearTotals.reduce((a, b) => (b.revenue > a.revenue ? b : a), monthOfYearTotals[0]), [monthOfYearTotals]);

  // ---- Revenue by Year (every year with any recorded activity) ----
  const yearTotals = useMemo(() => {
    const map = new Map<number, { revenue: number; roomRevenue: number; itemRevenue: number }>();
    state.sessions.forEach((s) => {
      const y = new Date(s.endedAt).getFullYear();
      const entry = map.get(y) ?? { revenue: 0, roomRevenue: 0, itemRevenue: 0 };
      entry.revenue += s.total;
      entry.roomRevenue += s.timeCost;
      entry.itemRevenue += s.total - s.timeCost;
      map.set(y, entry);
    });
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]).map(([year, v]) => ({ year: String(year), ...v }));
  }, [state.sessions]);
  const peakYear = useMemo(() => (yearTotals.length ? yearTotals.reduce((a, b) => (b.revenue > a.revenue ? b : a), yearTotals[0]) : null), [yearTotals]);

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

  // Level 2 drill-down: which specific items make up whichever category
  // slice is currently selected. "Room Time" has no individual items to
  // break down (it's not a menu category at all), so it's excluded from
  // selection entirely rather than showing an empty/confusing table.
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const categoryItemBreakdown = useMemo(() => {
    if (!selectedCategory || selectedCategory === "Room Time") return [];
    const map = new Map<string, { name: string; qty: number; revenue: number }>();
    monthSessions.forEach((s) => {
      s.orders.forEach((o) => {
        const menuItem = state.menu.find((m) => m.id === o.menuItemId);
        const cat = menuItem?.category ?? "Extras";
        if (cat !== selectedCategory) return;
        const existing = map.get(o.menuItemId);
        const revenue = o.qty * o.price;
        if (existing) { existing.qty += o.qty; existing.revenue += revenue; }
        else map.set(o.menuItemId, { name: menuItem?.name ?? o.name, qty: o.qty, revenue });
      });
    });
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
  }, [selectedCategory, monthSessions, state.menu]);

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
        <p className="text-xs text-muted-foreground mb-4">
          Hourly breakdown across this month — reveals peak lounge hours. Room Time and Item/Beverage revenue are
          broken out separately so both are always visible, alongside the combined total.
        </p>
        <ResponsiveContainer width="100%" height={340}>
          <LineChart data={hourlyTotals} margin={{ left: 8, right: 16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.08)" />
            <XAxis dataKey="hour" tickFormatter={(h) => `${String(h).padStart(2, "0")}:00`} tick={{ fontSize: 11 }} />
            <YAxis yAxisId="revenue" tick={{ fontSize: 11 }} tickFormatter={(v: number) => v.toLocaleString()} width={70} />
            <YAxis yAxisId="orders" orientation="right" tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip formatter={(v: number, name: string) => [name === "Orders" ? v : fmtMoney(v), name]} labelFormatter={(h) => `${String(h).padStart(2, "0")}:00`} />
            <Legend />
            <Line yAxisId="revenue" type="monotone" dataKey="revenue" name="Total Revenue (EGP)" stroke="oklch(0.7 0.19 260)" strokeWidth={2.5} dot={false} />
            <Line yAxisId="revenue" type="monotone" dataKey="roomRevenue" name="Room Time Revenue (EGP)" stroke="oklch(0.65 0.24 305)" strokeWidth={1.5} dot={false} strokeDasharray="4 3" />
            <Line yAxisId="revenue" type="monotone" dataKey="itemRevenue" name="Item/Beverage Revenue (EGP)" stroke="oklch(0.85 0.18 85)" strokeWidth={1.5} dot={false} strokeDasharray="4 3" />
            <Line yAxisId="orders" type="monotone" dataKey="orders" name="Orders" stroke="oklch(0.78 0.2 155)" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Revenue by Day of Month */}
      <div className="glass rounded-2xl p-6 min-w-0">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="w-5 h-5 text-[oklch(0.78_0.2_155)]" />
          <h2 className="text-lg font-semibold">Revenue by Day of Month</h2>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          {new Date().toLocaleDateString(undefined, { month: "long", year: "numeric" })} — the highest-grossing day is labeled directly on the chart.
          Total Revenue always combines Room Time and Item/Beverage sales.
        </p>
        <ResponsiveContainer width="100%" height={340}>
          <LineChart data={dayOfMonthTotals} margin={{ top: 30, left: 8, right: 16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.08)" />
            <XAxis dataKey="day" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => v.toLocaleString()} width={70} domain={[0, (max: number) => Math.ceil(max * 1.15)]} />
            <Tooltip formatter={(v: number) => fmtMoney(v)} labelFormatter={(d) => `Day ${d}`} />
            <Legend />
            <Line
              type="monotone" dataKey="revenue" name="Total Revenue (EGP)" stroke="oklch(0.78 0.2 155)" strokeWidth={2.5} dot={false}
              label={renderPeakLabel(peakDay.revenue, "oklch(0.78 0.2 155)")}
            />
            <Line type="monotone" dataKey="roomRevenue" name="Room Time Revenue (EGP)" stroke="oklch(0.65 0.24 305)" strokeWidth={1.5} dot={false} strokeDasharray="4 3" />
            <Line type="monotone" dataKey="itemRevenue" name="Item/Beverage Revenue (EGP)" stroke="oklch(0.85 0.18 85)" strokeWidth={1.5} dot={false} strokeDasharray="4 3" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Revenue by Month */}
      <div className="glass rounded-2xl p-6 min-w-0">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="w-5 h-5 text-[oklch(0.65_0.24_305)]" />
          <h2 className="text-lg font-semibold">Revenue by Month</h2>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          {new Date().getFullYear()} — the highest-grossing month is labeled directly on the chart.
        </p>
        <ResponsiveContainer width="100%" height={360}>
          <LineChart data={monthOfYearTotals} margin={{ top: 30, left: 8, right: 16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.08)" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => v.toLocaleString()} width={80} domain={[0, (max: number) => Math.ceil(max * 1.15)]} />
            <Tooltip formatter={(v: number) => fmtMoney(v)} />
            <Legend />
            <Line
              type="monotone" dataKey="revenue" name="Total Revenue (EGP)" stroke="oklch(0.65 0.24 305)" strokeWidth={2.5} dot={{ r: 3 }}
              label={renderPeakLabel(peakMonth.revenue, "oklch(0.65 0.24 305)")}
            />
            <Line type="monotone" dataKey="roomRevenue" name="Room Time Revenue (EGP)" stroke="oklch(0.7 0.19 260)" strokeWidth={1.5} dot={false} strokeDasharray="4 3" />
            <Line type="monotone" dataKey="itemRevenue" name="Item/Beverage Revenue (EGP)" stroke="oklch(0.85 0.18 85)" strokeWidth={1.5} dot={false} strokeDasharray="4 3" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Revenue by Year */}
      <div className="glass rounded-2xl p-6 min-w-0">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="w-5 h-5 text-[oklch(0.85_0.18_85)]" />
          <h2 className="text-lg font-semibold">Revenue by Year</h2>
        </div>
        <p className="text-xs text-muted-foreground mb-4">Every year with recorded activity — the highest-grossing year is labeled directly on the chart.</p>
        {yearTotals.length === 0 || !peakYear ? (
          <div className="text-sm text-muted-foreground font-mono text-center py-16">No historical data yet.</div>
        ) : (
          <ResponsiveContainer width="100%" height={340}>
            <LineChart data={yearTotals} margin={{ top: 30, left: 8, right: 16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.08)" />
              <XAxis dataKey="year" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => v.toLocaleString()} width={80} domain={[0, (max: number) => Math.ceil(max * 1.15)]} />
              <Tooltip formatter={(v: number) => fmtMoney(v)} />
              <Legend />
              <Line
                type="monotone" dataKey="revenue" name="Total Revenue (EGP)" stroke="oklch(0.85 0.18 85)" strokeWidth={2.5} dot={{ r: 4 }}
                label={renderPeakLabel(peakYear.revenue, "oklch(0.6 0.15 85)")}
              />
              <Line type="monotone" dataKey="roomRevenue" name="Room Time Revenue (EGP)" stroke="oklch(0.7 0.19 260)" strokeWidth={1.5} dot={false} strokeDasharray="4 3" />
              <Line type="monotone" dataKey="itemRevenue" name="Item/Beverage Revenue (EGP)" stroke="oklch(0.65 0.24 305)" strokeWidth={1.5} dot={false} strokeDasharray="4 3" />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Category Revenue Distribution — full width, per explicit request
          to remove Payment Method Split and give this the space instead */}
      <div className="glass rounded-2xl p-6 min-w-0">
        <h2 className="text-lg font-semibold mb-1">Category Revenue Distribution</h2>
        <p className="text-xs text-muted-foreground mb-4">
          Share of this month's revenue by menu category, including Room Time. Click a slice or legend entry for an item-level breakdown.
        </p>
        {categoryData.length === 0 ? (
          <div className="text-sm text-muted-foreground font-mono text-center py-16">No sales this month yet.</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-6 items-center">
            <ResponsiveContainer width="100%" height={420}>
              <PieChart>
                <Pie
                  data={categoryData} dataKey="value" nameKey="name" innerRadius={90} outerRadius={160} paddingAngle={2}
                  onClick={(d: { name: string }) => setSelectedCategory((prev) => (prev === d.name ? null : d.name))}
                  cursor="pointer"
                  label={(entry: { name: string; percent: number }) => `${entry.name} ${(entry.percent * 100).toFixed(0)}%`}
                  labelLine={{ strokeWidth: 1 }}
                >
                  {categoryData.map((entry, i) => (
                    <Cell
                      key={i}
                      fill={PIE_COLORS[i % PIE_COLORS.length]}
                      stroke={selectedCategory === entry.name ? "#2b2416" : undefined}
                      strokeWidth={selectedCategory === entry.name ? 3 : undefined}
                    />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number) => fmtMoney(v)} contentStyle={{ fontSize: 14 }} />
              </PieChart>
            </ResponsiveContainer>

            {/* Larger, easier-to-inspect legend as its own list rather than
                recharts' compact built-in Legend, per the explicit request
                for bigger, clearer category/product breakdown legends */}
            <div className="flex flex-col gap-2 lg:min-w-[240px]">
              {categoryData.map((entry, i) => (
                <button
                  key={entry.name}
                  onClick={() => setSelectedCategory((prev) => (prev === entry.name ? null : entry.name))}
                  className={`flex items-center justify-between gap-4 px-3 py-2.5 rounded-lg border text-left transition ${
                    selectedCategory === entry.name ? "border-[#2b2416] bg-black/5" : "border-black/8 bg-white/50 hover:bg-white/80"
                  }`}
                >
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                    {entry.name}
                  </span>
                  <span className="font-mono text-sm font-bold">{fmtMoney(entry.value)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {selectedCategory && (
          <div className="mt-4 pt-4 border-t border-black/10">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold">{selectedCategory} — Item Breakdown</h3>
              <button onClick={() => setSelectedCategory(null)} className="text-xs text-muted-foreground hover:text-[#2b2416] underline">Clear</button>
            </div>
            {selectedCategory === "Room Time" ? (
              <div className="text-xs text-muted-foreground font-mono text-center py-4">Room Time is billed by duration, not individual items.</div>
            ) : categoryItemBreakdown.length === 0 ? (
              <div className="text-xs text-muted-foreground font-mono text-center py-4">No items sold in this category this month.</div>
            ) : (
              <div className="max-h-56 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white/95">
                    <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground border-b border-black/10">
                      <th className="py-1.5 pr-2">Item</th>
                      <th className="py-1.5 pr-2 text-right">Qty Sold</th>
                      <th className="py-1.5 text-right">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {categoryItemBreakdown.map((item) => (
                      <tr key={item.name} className="border-b border-black/5">
                        <td className="py-1.5 pr-2">{item.name}</td>
                        <td className="py-1.5 pr-2 text-right font-mono">{item.qty}</td>
                        <td className="py-1.5 text-right font-mono font-semibold">{fmtMoney(item.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
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

// Renders a value label ONLY above the single highest point on a Line
// — everything else on the line stays clean with no label, so the
// peak is immediately readable without hovering, without cluttering
// every other point on the chart.
function renderPeakLabel(peakValue: number, color: string) {
  return (props: { x?: number; y?: number; value?: number }) => {
    const { x, y, value } = props;
    if (x === undefined || y === undefined || value === undefined || Math.abs(value - peakValue) > 0.5 || value === 0) return <g />;
    return (
      <text x={x} y={y - 12} textAnchor="middle" fontSize={12} fontWeight={700} fill={color} fontFamily="monospace">
        {fmtMoney(value)}
      </text>
    );
  };
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
