import { useMemo, useState } from "react";
import { useStore, fmtMoney } from "@/lib/glitch-store";
import { Trophy, Medal, Flame, Zap } from "lucide-react";

type RangeKey = "shift" | "today" | "week" | "month";

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

interface ItemStat {
  menuItemId: string;
  name: string;
  category: string;
  unitsSold: number;
  revenue: number;
}

export function LeaderboardPage() {
  const { state } = useStore();
  const [range, setRange] = useState<RangeKey>("shift");

  // Real-time by construction, not by any special polling of its own:
  // state.sessions is already kept current by the store's existing
  // background poll (and instantly by the local action itself right
  // after any checkout), so this component simply re-renders and
  // re-sorts automatically the moment a new session lands — no manual
  // refresh, no extra infrastructure needed here.
  const rangeSessions = useMemo(() => {
    const now = Date.now();
    if (range === "shift") {
      if (!state.activeShiftId) return [];
      return state.sessions.filter((s) => s.shiftId === state.activeShiftId);
    }
    const from = range === "today" ? startOfDay(now) : range === "week" ? startOfWeek(now) : startOfMonth(now);
    return state.sessions.filter((s) => s.endedAt >= from && s.endedAt <= now);
  }, [state.sessions, state.activeShiftId, range]);

  const stats = useMemo(() => {
    const map = new Map<string, ItemStat>();
    rangeSessions.forEach((s) => {
      s.orders.forEach((o) => {
        // Synthetic line items (room-time charges, transfer charges) have
        // no matching menu entry — skip them, this is a MENU leaderboard.
        const menuItem = state.menu.find((m) => m.id === o.menuItemId);
        if (!menuItem) return;
        const existing = map.get(o.menuItemId);
        const revenue = o.qty * o.price;
        if (existing) {
          existing.unitsSold += o.qty;
          existing.revenue += revenue;
        } else {
          map.set(o.menuItemId, { menuItemId: o.menuItemId, name: menuItem.name, category: menuItem.category ?? "Extras", unitsSold: o.qty, revenue });
        }
      });
    });
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
  }, [rangeSessions, state.menu]);

  const totalRevenue = stats.reduce((a, s) => a + s.revenue, 0);
  // "Fast Mover" — high unit velocity that isn't already obvious from the
  // revenue ranking alone (e.g. a cheap item selling in bulk). Top 3 by
  // units sold, a genuinely different signal from the revenue-based rank.
  const topByUnits = new Set([...stats].sort((a, b) => b.unitsSold - a.unitsSold).slice(0, 3).map((s) => s.menuItemId));

  const rangeLabels: Record<RangeKey, string> = { shift: "Current Shift", today: "Today", week: "This Week", month: "This Month" };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Trophy className="w-8 h-8 text-[oklch(0.85_0.18_85)]" />
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Live Menu Leaderboard</h1>
            <p className="text-sm text-muted-foreground mt-1 font-mono uppercase tracking-widest">
              {rangeLabels[range]} · Ranked by Revenue
            </p>
          </div>
        </div>
        <div className="flex rounded-xl border border-black/10 overflow-hidden">
          {(["shift", "today", "week", "month"] as RangeKey[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-4 py-2.5 text-xs font-bold uppercase tracking-wide transition ${
                range === r ? "bg-gradient-to-r from-[oklch(0.7_0.19_260)] to-[oklch(0.65_0.24_305)] text-[#2b2416]" : "bg-white/60 text-muted-foreground hover:bg-white/80"
              }`}
            >
              {rangeLabels[r]}
            </button>
          ))}
        </div>
      </div>

      {range === "shift" && !state.activeShiftId ? (
        <div className="glass rounded-2xl p-12 text-center">
          <div className="text-sm text-muted-foreground font-mono">No active shift right now — open a shift, or switch to Today/Week/Month.</div>
        </div>
      ) : stats.length === 0 ? (
        <div className="glass rounded-2xl p-12 text-center">
          <div className="text-sm text-muted-foreground font-mono">No sales in this range yet.</div>
        </div>
      ) : (
        <div className="space-y-3">
          {stats.map((item, idx) => {
            const rank = idx + 1;
            const share = totalRevenue > 0 ? (item.revenue / totalRevenue) * 100 : 0;
            const isTopSeller = rank === 1;
            const isFastMover = topByUnits.has(item.menuItemId) && rank !== 1;
            const medalColor = rank === 1 ? "oklch(0.85 0.18 85)" : rank === 2 ? "oklch(0.75 0.02 260)" : rank === 3 ? "oklch(0.6 0.13 55)" : null;

            return (
              <div
                key={item.menuItemId}
                className={`glass rounded-2xl p-4 flex items-center gap-4 transition-all duration-500 ${
                  rank <= 3 ? "border-2" : "border border-black/8"
                }`}
                style={medalColor ? { borderColor: `${medalColor} / 0.6` } : undefined}
              >
                <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 font-mono font-black text-lg"
                  style={medalColor ? { background: `color-mix(in oklch, ${medalColor} 20%, transparent)`, color: medalColor, border: `2px solid color-mix(in oklch, ${medalColor} 60%, transparent)` } : { background: "rgba(0,0,0,0.05)" }}
                >
                  {rank <= 3 ? <Medal className="w-6 h-6" /> : `#${rank}`}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold truncate">{item.name}</span>
                    <span className="text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded bg-black/5 text-muted-foreground shrink-0">{item.category}</span>
                    {isTopSeller && (
                      <span className="text-[9px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-full bg-[oklch(0.62_0.24_25/0.15)] text-[oklch(0.62_0.24_25)] border border-[oklch(0.62_0.24_25/0.4)] flex items-center gap-1 shrink-0">
                        <Flame className="w-3 h-3" /> Top Seller
                      </span>
                    )}
                    {isFastMover && (
                      <span className="text-[9px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-full bg-[oklch(0.7_0.19_260/0.15)] text-[oklch(0.7_0.19_260)] border border-[oklch(0.7_0.19_260/0.4)] flex items-center gap-1 shrink-0">
                        <Zap className="w-3 h-3" /> Fast Mover
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 h-1.5 rounded-full bg-black/5 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[oklch(0.7_0.19_260)] to-[oklch(0.65_0.24_305)] transition-all duration-500"
                      style={{ width: `${Math.max(2, share)}%` }}
                    />
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <div className="font-mono font-bold text-lg">{fmtMoney(item.revenue)}</div>
                  <div className="text-[10px] text-muted-foreground font-mono">{item.unitsSold} sold · {share.toFixed(1)}%</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
