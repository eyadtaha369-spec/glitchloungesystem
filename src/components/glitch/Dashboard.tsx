import { useEffect, useState } from "react";
import { useStore, fmtMoney, isToday } from "@/lib/glitch-store";
import { Activity, DollarSign, Gamepad2, AlertTriangle, Circle } from "lucide-react";
import { ShiftBar } from "./ShiftBar";

export function Dashboard() {
  const { state, computeElapsed, activeShift } = useStore();
  const [, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick((n) => n + 1), 1000); return () => clearInterval(id); }, []);

  const isAdmin = state.currentUser?.role === "admin";
  const activeRooms = state.rooms.filter((r) => r.status === "active");
  const available = state.rooms.length - activeRooms.length;

  // Cashiers only ever see numbers for their OWN active shift — the previous
  // shift's sales and stats are fully hidden the moment it's closed. Admins
  // see the full day (and can drill into full history on the Reports page).
  const visibleSessions = isAdmin
    ? state.sessions.filter((s) => isToday(s.endedAt))
    : state.sessions.filter((s) => activeShift && s.shiftId === activeShift.id);
  const revenueLabel = isAdmin ? "Revenue Today" : "Revenue This Shift";
  const revenueToday = visibleSessions.reduce((a, s) => a + s.total, 0);

  const stockAlerts = state.stock.filter((s) => {
    const remaining = s.initialStock - s.used;
    return remaining < s.minStock || remaining < s.initialStock * 0.2;
  });

  // Revenue by room (from completed sessions). Admins see all-time performance
  // per room; cashiers only see what happened during their own shift.
  const roomSessionPool = isAdmin ? state.sessions : visibleSessions;
  const revByRoom = state.rooms.map((r) => {
    const past = roomSessionPool.filter((s) => s.roomId === r.id).reduce((a, s) => a + s.total, 0);
    let live = 0;
    if (r.status === "active" && r.startedAt) {
      const dur = computeElapsed(r);
      live = (dur / 3600) * r.hourlyRate + r.orders.reduce((a, o) => a + o.qty * o.price, 0);
    }
    return { room: r, total: past + live, live };
  });
  const maxRev = Math.max(1, ...revByRoom.map((x) => x.total));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Command Deck</h1>
        <p className="text-sm text-muted-foreground mt-1 font-mono uppercase tracking-widest">Realtime Lounge Metrics</p>
      </div>

      <ShiftBar />

      {/* Metric cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard
          label="Active Rooms"
          value={`${activeRooms.length} / ${state.rooms.length}`}
          icon={Gamepad2}
          accent="cyan"
        />
        <MetricCard
          label={revenueLabel}
          value={fmtMoney(revenueToday)}
          icon={DollarSign}
          accent="green"
        />
        <MetricCard
          label="Available Rooms"
          value={String(available)}
          icon={Circle}
          accent="blue"
        />
        <MetricCard
          label="Stock Alerts"
          value={String(stockAlerts.length)}
          icon={AlertTriangle}
          accent={stockAlerts.length > 0 ? "red" : "blue"}
          pulse={stockAlerts.length > 0}
        />
      </div>

      {/* Analytics grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Revenue chart */}
        <div className="lg:col-span-2 glass rounded-2xl p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-semibold">Revenue By Room</h2>
              <p className="text-xs text-muted-foreground font-mono uppercase tracking-widest mt-0.5">Completed + live</p>
            </div>
            <div className="text-xs text-muted-foreground font-mono">MAX {fmtMoney(maxRev)}</div>
          </div>
          <div className="space-y-3">
            {revByRoom.map(({ room, total, live }) => {
              const pct = (total / maxRev) * 100;
              return (
                <div key={room.id} className="flex items-center gap-3">
                  <div className={`w-16 text-xs font-mono ${room.isVip ? "text-[oklch(0.82_0.16_85)]" : "text-muted-foreground"}`}>
                    {room.name}
                  </div>
                  <div className="flex-1 h-3 bg-black/40 rounded-full overflow-hidden relative">
                    <div
                      className={`h-full rounded-full transition-all ${
                        room.isVip
                          ? "bg-gradient-to-r from-[oklch(0.82_0.16_85)] to-[oklch(0.65_0.24_305)]"
                          : "bg-gradient-to-r from-[oklch(0.85_0.16_200)] to-[oklch(0.7_0.19_260)]"
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                    {live > 0 && (
                      <div className="absolute inset-y-0 right-1 flex items-center">
                        <span className="w-1.5 h-1.5 rounded-full bg-[oklch(0.78_0.2_155)] animate-pulse-glow" />
                      </div>
                    )}
                  </div>
                  <div className="w-24 text-right text-sm font-mono">{fmtMoney(total)}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Activity feed */}
        <div className="glass rounded-2xl p-6 flex flex-col">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="w-4 h-4 text-[oklch(0.85_0.16_200)]" />
            <h2 className="text-lg font-semibold">Activity Feed</h2>
          </div>
          <div className="flex-1 overflow-y-auto space-y-2 max-h-[420px] pr-1">
            {(() => {
              const visibleActivity = isAdmin
                ? state.activity
                : state.activity.filter((a) => activeShift && a.ts >= activeShift.openedAt);
              if (visibleActivity.length === 0) {
                return <div className="text-sm text-muted-foreground font-mono">No activity yet.</div>;
              }
              return visibleActivity.slice(0, 30).map((a) => (
                <div key={a.id} className="text-sm p-3 rounded-lg bg-black/30 border border-white/5 hover:border-[oklch(0.7_0.19_260/0.35)] transition">
                  <div className="text-foreground">{a.message}</div>
                  <div className="text-[10px] font-mono text-muted-foreground mt-1 uppercase tracking-wider">
                    {new Date(a.ts).toLocaleTimeString()}
                  </div>
                </div>
              ));
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value, icon: Icon, accent, pulse }: {
  label: string; value: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: "blue" | "cyan" | "purple" | "gold" | "green" | "red";
  pulse?: boolean;
}) {
  const map = {
    blue: "from-[oklch(0.7_0.19_260/0.15)] border-[oklch(0.7_0.19_260/0.4)] text-[oklch(0.7_0.19_260)]",
    cyan: "from-[oklch(0.85_0.16_200/0.15)] border-[oklch(0.85_0.16_200/0.4)] text-[oklch(0.85_0.16_200)]",
    purple: "from-[oklch(0.65_0.24_305/0.15)] border-[oklch(0.65_0.24_305/0.4)] text-[oklch(0.65_0.24_305)]",
    gold: "from-[oklch(0.82_0.16_85/0.15)] border-[oklch(0.82_0.16_85/0.4)] text-[oklch(0.82_0.16_85)]",
    green: "from-[oklch(0.78_0.2_155/0.15)] border-[oklch(0.78_0.2_155/0.4)] text-[oklch(0.78_0.2_155)]",
    red: "from-[oklch(0.68_0.25_25/0.15)] border-[oklch(0.68_0.25_25/0.4)] text-[oklch(0.68_0.25_25)]",
  };
  return (
    <div className={`glass rounded-2xl p-5 border bg-gradient-to-br to-transparent ${map[accent]} ${pulse ? "animate-pulse-red" : ""}`}>
      <div className="flex items-start justify-between">
        <div className="text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
        <Icon className={`w-5 h-5 ${map[accent].split(" ").pop()}`} />
      </div>
      <div className="mt-3 text-3xl font-bold font-mono">{value}</div>
    </div>
  );
}
