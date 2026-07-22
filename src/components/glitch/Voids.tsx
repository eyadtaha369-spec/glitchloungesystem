import { useState } from "react";
import { useStore, fmtMoney, VOID_REASON_LABELS } from "@/lib/glitch-store";
import type { VoidRequest, VoidReason } from "@/lib/glitch-store";
import { ShieldAlert, CheckCircle2, XCircle, Clock, Printer, AlertTriangle, Settings } from "lucide-react";

function startOfDay(ts: number) { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); }
function startOfWeek(ts: number) { const d = new Date(ts); d.setDate(d.getDate() - d.getDay()); d.setHours(0, 0, 0, 0); return d.getTime(); }
function startOfMonth(ts: number) { const d = new Date(ts); d.setDate(1); d.setHours(0, 0, 0, 0); return d.getTime(); }

// DD/MM/YYYY - HH:MM:SS - Weekday, exactly as specified.
function microTimestamp(ts: number) {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const weekday = d.toLocaleDateString(undefined, { weekday: "long" });
  return `${date} - ${time} - ${weekday}`;
}

export function VoidsPage() {
  const { state } = useStore();
  const pending = state.voidRequests.filter((v) => v.status === "pending");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Void Audit Ledger</h1>
        <p className="text-sm text-muted-foreground mt-1 font-mono uppercase tracking-widest">Anti-Collusion &amp; Fraud Control</p>
      </div>

      <FraudAlertPanel />

      {pending.length > 0 && <PendingVoidsPanel requests={pending} />}

      <FullLedgerPanel />
    </div>
  );
}

function FraudAlertPanel() {
  const { state, activeShift, setFraudThreshold } = useStore();
  const [editingThreshold, setEditingThreshold] = useState(false);
  const [thresholdInput, setThresholdInput] = useState(String(state.fraudThresholdPercent));

  const todayStart = startOfDay(Date.now());
  const todaySessions = state.sessions.filter((s) => s.endedAt >= todayStart);
  const todayVoids = state.voidRequests.filter((v) => v.ts >= todayStart && v.status === "approved");
  const totalSales = todaySessions.reduce((a, s) => a + s.total, 0);
  const totalVoidedValue = todayVoids.reduce((a, v) => a + v.billValue, 0);
  const wastePercent = totalSales > 0 ? (totalVoidedValue / totalSales) * 100 : (totalVoidedValue > 0 ? 100 : 0);
  const flagged = wastePercent > state.fraudThresholdPercent;

  const groups = new Map<string, { cashier: string; waiter: string; count: number; value: number }>();
  todayVoids.forEach((v) => {
    const key = `${v.cashierUsername}::${v.waiterName || "—"}`;
    const g = groups.get(key) ?? { cashier: v.cashierUsername, waiter: v.waiterName || "—", count: 0, value: 0 };
    g.count += 1;
    g.value += v.billValue;
    groups.set(key, g);
  });

  return (
    <div className={`glass rounded-2xl p-6 border ${flagged ? "border-[oklch(0.62_0.24_25/0.6)]" : "border-white/10"}`}>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div className="flex items-center gap-2">
          {flagged ? <AlertTriangle className="w-5 h-5 text-[oklch(0.75_0.22_25)] animate-pulse-glow" /> : <ShieldAlert className="w-5 h-5 text-[oklch(0.78_0.2_155)]" />}
          <h2 className="text-lg font-semibold">{flagged ? "Staff Collusion & Fraud Alert" : "Fraud Risk — Normal"}</h2>
        </div>
        <button onClick={() => setEditingThreshold((v) => !v)} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10">
          <Settings className="w-3.5 h-3.5" /> Threshold: {state.fraudThresholdPercent}%
        </button>
      </div>

      {editingThreshold && (
        <div className="mb-4 flex items-center gap-2">
          <input type="number" step="0.1" value={thresholdInput} onChange={(e) => setThresholdInput(e.target.value)} className="w-24 bg-black/40 border border-white/10 rounded px-2 py-1.5 text-sm font-mono" />
          <span className="text-sm text-muted-foreground">% of daily sales</span>
          <button
            onClick={async () => { await setFraudThreshold(parseFloat(thresholdInput) || 0); setEditingThreshold(false); }}
            className="text-xs px-3 py-1.5 rounded bg-[oklch(0.7_0.19_260/0.2)] border border-[oklch(0.7_0.19_260/0.5)]"
          >Save</button>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="bg-black/30 rounded-lg p-3 border border-white/5">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Today's Sales</div>
          <div className="text-lg font-mono font-bold mt-1">{fmtMoney(totalSales)}</div>
        </div>
        <div className="bg-black/30 rounded-lg p-3 border border-white/5">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Voided Value</div>
          <div className="text-lg font-mono font-bold mt-1 text-[oklch(0.82_0.16_85)]">{fmtMoney(totalVoidedValue)}</div>
        </div>
        <div className="bg-black/30 rounded-lg p-3 border border-white/5">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Waste %</div>
          <div className={`text-lg font-mono font-bold mt-1 ${flagged ? "text-[oklch(0.75_0.22_25)]" : "text-[oklch(0.78_0.2_155)]"}`}>{wastePercent.toFixed(2)}%</div>
        </div>
        <div className="bg-black/30 rounded-lg p-3 border border-white/5">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Active Shift</div>
          <div className="text-lg font-mono font-bold mt-1">{activeShift?.cashierUsername ?? "—"}</div>
        </div>
      </div>

      {flagged && groups.size > 0 && (
        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Tickets grouped by staff involved</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {Array.from(groups.values()).map((g) => (
              <div key={`${g.cashier}-${g.waiter}`} className="bg-[oklch(0.62_0.24_25/0.08)] border border-[oklch(0.62_0.24_25/0.3)] rounded-lg p-3 text-sm">
                <div className="font-semibold">Cashier: {g.cashier} · Waiter: {g.waiter}</div>
                <div className="text-xs text-muted-foreground font-mono mt-1">{g.count} void(s) · {fmtMoney(g.value)} lost</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PendingVoidsPanel({ requests }: { requests: VoidRequest[] }) {
  const { approveVoid, denyVoid } = useStore();

  return (
    <div className="glass rounded-2xl p-6 border border-[oklch(0.82_0.16_85/0.4)]">
      <div className="flex items-center gap-2 mb-4">
        <Clock className="w-5 h-5 text-[oklch(0.82_0.16_85)]" />
        <h2 className="text-lg font-semibold">Pending Void Approvals</h2>
        <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-[oklch(0.82_0.16_85/0.2)] text-[oklch(0.82_0.16_85)] border border-[oklch(0.82_0.16_85/0.5)]">{requests.length}</span>
      </div>
      <div className="space-y-3">
        {requests.map((v) => (
          <div key={v.id} className="bg-black/30 rounded-lg p-4 border border-white/5">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <div className="font-semibold text-sm">{v.qty}x {v.itemName} — {v.roomName}</div>
                <div className="text-xs text-muted-foreground font-mono">{microTimestamp(v.ts)}</div>
              </div>
              <div className="font-mono font-bold">{fmtMoney(v.billValue)}</div>
            </div>
            <div className="mt-2 text-xs text-muted-foreground grid grid-cols-2 md:grid-cols-4 gap-2">
              <div><span className="uppercase tracking-widest text-[10px]">Reason</span><div className="text-foreground">{VOID_REASON_LABELS[v.reason as VoidReason]}</div></div>
              <div><span className="uppercase tracking-widest text-[10px]">Cashier</span><div className="text-foreground">{v.cashierUsername}</div></div>
              <div><span className="uppercase tracking-widest text-[10px]">Waiter</span><div className="text-foreground">{v.waiterName || "—"}</div></div>
              <div><span className="uppercase tracking-widest text-[10px]">Status</span><div className="text-[oklch(0.82_0.16_85)]">Pending Approval</div></div>
            </div>
            <div className="flex items-center gap-2 mt-3">
              <button onClick={() => approveVoid(v.id)} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-[oklch(0.78_0.2_155/0.2)] border border-[oklch(0.78_0.2_155/0.5)] text-[oklch(0.78_0.2_155)]">
                <CheckCircle2 className="w-3.5 h-3.5" /> Approve
              </button>
              <button onClick={() => denyVoid(v.id)} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-white/5 border border-white/10 hover:bg-[oklch(0.62_0.24_25/0.15)]">
                <XCircle className="w-3.5 h-3.5" /> Deny
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FullLedgerPanel() {
  const { state } = useStore();
  const all = state.voidRequests;

  const printSummary = (label: string, cutoff: number) => {
    const items = all.filter((v) => v.ts >= cutoff);
    const totalCount = items.length;
    const totalLost = items.reduce((a, v) => a + v.billValue, 0);
    const approved = items.filter((v) => v.status === "approved");
    const pending = items.filter((v) => v.status === "pending");
    const denied = items.filter((v) => v.status === "denied");
    const byReason = new Map<string, { count: number; value: number }>();
    items.forEach((v) => {
      const label2 = VOID_REASON_LABELS[v.reason as VoidReason] ?? v.reason;
      const g = byReason.get(label2) ?? { count: 0, value: 0 };
      g.count += 1; g.value += v.billValue;
      byReason.set(label2, g);
    });

    const win = window.open("", "_blank", "width=900,height=1200");
    if (!win) return;
    win.document.write(`
<!DOCTYPE html><html><head><title>Void Summary — ${label}</title>
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
<div class="sub">Void Summary — ${label} — ${new Date().toLocaleString()}</div>
<div class="totals">
  <div><span>Total Voids</span><span>${totalCount}</span></div>
  <div><span>Approved</span><span>${approved.length}</span></div>
  <div><span>Pending Approval</span><span>${pending.length}</span></div>
  <div><span>Denied</span><span>${denied.length}</span></div>
  <div class="grand"><span>TOTAL EGP LOST</span><span>${totalLost.toFixed(2)}</span></div>
</div>
<h3 style="margin-top:24px">Breakdown by Reason</h3>
<table>
  <thead><tr><th>Reason</th><th>Count</th><th>Value Lost</th></tr></thead>
  <tbody>
    ${Array.from(byReason.entries()).map(([r, g]) => `<tr><td>${r}</td><td>${g.count}</td><td>${g.value.toFixed(2)}</td></tr>`).join("") || "<tr><td colspan=3>No voids in this range</td></tr>"}
  </tbody>
</table>
<h3 style="margin-top:24px">All Void Tickets</h3>
<table>
  <thead><tr><th>Timestamp</th><th>Room</th><th>Item</th><th>Reason</th><th>Cashier</th><th>Waiter</th><th>Status</th><th>Value</th></tr></thead>
  <tbody>
    ${items.map((v) => `<tr>
      <td>${microTimestamp(v.ts)}</td>
      <td>${v.roomName}</td>
      <td>${v.qty}x ${v.itemName}</td>
      <td>${VOID_REASON_LABELS[v.reason as VoidReason] ?? v.reason}</td>
      <td>${v.cashierUsername}</td>
      <td>${v.waiterName || "—"}</td>
      <td>${v.status === "approved" ? "Approved" : v.status === "pending" ? "Pending Approval" : "Denied"}</td>
      <td>${v.billValue.toFixed(2)}</td>
    </tr>`).join("")}
  </tbody>
</table>
<script>window.onload = () => setTimeout(() => window.print(), 300);</script>
</body></html>`);
    win.document.close();
  };

  return (
    <div className="glass rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h2 className="text-lg font-semibold">Full Void Ledger</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => printSummary("Today", startOfDay(Date.now()))} className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10">
            <Printer className="w-3.5 h-3.5" /> Print Today's Summary
          </button>
          <button onClick={() => printSummary("This Week", startOfWeek(Date.now()))} className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10">
            <Printer className="w-3.5 h-3.5" /> Print Week's Summary
          </button>
          <button onClick={() => printSummary("This Month", startOfMonth(Date.now()))} className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10">
            <Printer className="w-3.5 h-3.5" /> Print Month's Summary
          </button>
        </div>
      </div>

      {all.length === 0 ? (
        <div className="text-sm text-muted-foreground font-mono">No void requests logged yet.</div>
      ) : (
        <div className="overflow-x-auto max-h-96 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-[#0d0d14]">
              <tr className="text-[10px] uppercase tracking-widest text-muted-foreground border-b border-white/5">
                <th className="text-left py-2 px-2">Timestamp</th>
                <th className="text-left py-2 px-2">Item(s)</th>
                <th className="text-left py-2 px-2">Reason</th>
                <th className="text-left py-2 px-2">Cashier</th>
                <th className="text-left py-2 px-2">Waiter</th>
                <th className="text-right py-2 px-2">Bill Amount</th>
                <th className="text-right py-2 px-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {all.slice().sort((a, b) => b.ts - a.ts).map((v) => (
                <tr key={v.id} className="border-b border-white/5 hover:bg-white/5">
                  <td className="py-2 px-2 font-mono text-xs text-muted-foreground">{microTimestamp(v.ts)}</td>
                  <td className="py-2 px-2 text-xs">{v.qty}x {v.itemName} <span className="text-muted-foreground">({v.roomName})</span></td>
                  <td className="py-2 px-2 text-xs">{VOID_REASON_LABELS[v.reason as VoidReason] ?? v.reason}</td>
                  <td className="py-2 px-2 text-xs">{v.cashierUsername}</td>
                  <td className="py-2 px-2 text-xs">{v.waiterName || "—"}</td>
                  <td className="py-2 px-2 text-right font-mono">{fmtMoney(v.billValue)}</td>
                  <td className="py-2 px-2 text-right text-xs uppercase tracking-widest">
                    {v.status === "approved" ? (
                      <span className="text-[oklch(0.78_0.2_155)]">Approved</span>
                    ) : v.status === "pending" ? (
                      <span className="text-[oklch(0.82_0.16_85)]">Pending Approval</span>
                    ) : (
                      <span className="text-muted-foreground">Denied</span>
                    )}
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
