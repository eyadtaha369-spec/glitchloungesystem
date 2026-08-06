import { useEffect, useMemo, useState } from "react";
import { useStore, fmtMoney, isToday, monthKey, MENU_CATEGORIES, WASTE_INVOICE_REASON_LABELS, type MenuItem, type MenuCategory, type Session, type WasteInvoice, type WasteInvoiceReason, type InventorySnapshot } from "@/lib/glitch-store";
import { printSmart } from "@/lib/print";
import { Plus, Trash2, Download, DollarSign, TrendingUp, TrendingDown, Check, RotateCcw, Pencil, X, Save, AlertOctagon, History, FileBarChart, Search, Printer } from "lucide-react";

export function InventoryPage() {
  const {
    state, addMenuItem, updateMenuItem, deleteMenuItem, setActualCash,
    activeShift, forceEndShift,
  } = useStore();

  const expectedToday = useMemo(
    () => state.sessions.filter((s) => isToday(s.endedAt)).reduce((a, s) => a + s.total, 0),
    [state.sessions],
  );
  const discrepancy = state.actualCashInput - expectedToday;

  // Item sales aggregation for today
  const salesToday = useMemo(() => {
    const map = new Map<string, { name: string; qty: number; revenue: number }>();
    state.sessions.filter((s) => isToday(s.endedAt)).forEach((s) => {
      s.orders.forEach((o) => {
        const cur = map.get(o.menuItemId) ?? { name: o.name, qty: 0, revenue: 0 };
        cur.qty += o.qty;
        cur.revenue += o.qty * o.price;
        map.set(o.menuItemId, cur);
      });
    });
    return Array.from(map.values());
  }, [state.sessions]);

  const months = useMemo(() => {
    const set = new Set<string>();
    state.sessions.forEach((s) => set.add(monthKey(s.endedAt)));
    if (set.size === 0) set.add(monthKey(Date.now()));
    return Array.from(set).sort().reverse();
  }, [state.sessions]);
  const [selectedMonth, setSelectedMonth] = useState(months[0]);

  const downloadReport = () => {
    const monthSessions = state.sessions.filter((s) => monthKey(s.endedAt) === selectedMonth);
    printReport(selectedMonth, monthSessions, state);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Inventory &amp; Recon</h1>
        <p className="text-sm text-muted-foreground mt-1 font-mono uppercase tracking-widest">
          Stock · Recipes · Financials
        </p>
      </div>

      <EmergencyResetPanel activeShift={activeShift} forceEndShift={forceEndShift} />

      {/* Cash reconciliation */}
      <div className="glass rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-[oklch(0.78_0.2_155)]" />
            <h2 className="text-lg font-semibold">Cash Reconciliation — Today</h2>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white/60 rounded-lg p-4 border border-black/8">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Expected</div>
            <div className="text-2xl font-mono font-bold mt-1 text-[oklch(0.7_0.19_260)]">{fmtMoney(expectedToday)}</div>
          </div>
          <div className="bg-white/60 rounded-lg p-4 border border-black/8">
            <label className="text-xs uppercase tracking-widest text-muted-foreground">Actual In Drawer</label>
            <input
              type="number"
              step="0.01"
              value={state.actualCashInput}
              onChange={(e) => setActualCash(parseFloat(e.target.value) || 0)}
              className="mt-1 w-full bg-transparent text-2xl font-mono font-bold outline-none text-[#2b2416]"
            />
          </div>
          <div className={`rounded-lg p-4 border ${
            Math.abs(discrepancy) < 0.005
              ? "bg-[oklch(0.78_0.2_155/0.1)] border-[oklch(0.78_0.2_155/0.5)]"
              : discrepancy < 0
                ? "bg-[oklch(0.62_0.24_25/0.1)] border-[oklch(0.62_0.24_25/0.5)]"
                : "bg-[oklch(0.78_0.2_155/0.1)] border-[oklch(0.78_0.2_155/0.5)]"
          }`}>
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Discrepancy</div>
            {Math.abs(discrepancy) < 0.005 ? (
              <div className="flex items-center gap-2 mt-1">
                <Check className="w-6 h-6 text-[oklch(0.78_0.2_155)]" />
                <span className="text-2xl font-mono font-bold text-[oklch(0.78_0.2_155)]">Balanced</span>
              </div>
            ) : discrepancy < 0 ? (
              <div className="flex items-center gap-2 mt-1">
                <TrendingDown className="w-6 h-6 text-[oklch(0.62_0.24_25)]" />
                <div>
                  <div className="text-2xl font-mono font-bold text-[oklch(0.62_0.24_25)]">{fmtMoney(discrepancy)}</div>
                  <div className="text-[10px] uppercase tracking-widest text-[oklch(0.62_0.24_25)]">Deficit · عجز</div>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 mt-1">
                <TrendingUp className="w-6 h-6 text-[oklch(0.78_0.2_155)]" />
                <div>
                  <div className="text-2xl font-mono font-bold text-[oklch(0.78_0.2_155)]">+{fmtMoney(discrepancy)}</div>
                  <div className="text-[10px] uppercase tracking-widest text-[oklch(0.78_0.2_155)]">Surplus · زيادة</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Stock inventory */}
      <InventoryAuditReportButton />
      <InventorySection />
      <InventoryResetPanel />

      {/* Recipes / Menu */}
      <RecipeMatchCheck />
      <RecipeManager onAdd={addMenuItem} onUpdate={updateMenuItem} onDelete={deleteMenuItem} />

      {/* Today's sales */}
      <div className="glass rounded-2xl p-6">
        <h2 className="text-lg font-semibold mb-4">End-Of-Day Sales Log</h2>
        {salesToday.length === 0 ? (
          <div className="text-sm text-muted-foreground font-mono">No completed orders today.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {salesToday.map((s) => (
              <div key={s.name} className="bg-white/60 rounded-lg p-4 border border-black/8">
                <div className="text-sm font-semibold">{s.name}</div>
                <div className="flex justify-between text-xs font-mono mt-2 text-muted-foreground">
                  <span>Qty: {s.qty}</span>
                  <span>{fmtMoney(s.revenue)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Monthly report */}
      <div className="glass rounded-2xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Monthly Report</h2>
            <p className="text-xs text-muted-foreground font-mono uppercase tracking-widest mt-0.5">
              Export a printable PDF for a full month
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm font-mono"
            >
              {months.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <button
              onClick={downloadReport}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-[oklch(0.7_0.19_260)] to-[oklch(0.65_0.24_305)] text-[#2b2416] text-sm font-semibold shadow-[0_0_20px_oklch(0.7_0.19_260/0.4)] hover:shadow-[0_0_30px_oklch(0.7_0.19_260/0.6)] transition"
            >
              <Download className="w-4 h-4" /> Download Report
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmergencyResetPanel({ activeShift, forceEndShift }: {
  activeShift: ReturnType<typeof useStore>["activeShift"];
  forceEndShift: ReturnType<typeof useStore>["forceEndShift"];
}) {
  const [confirmKey, setConfirmKey] = useState<string | null>(null);

  const run = async () => {
    await forceEndShift();
    setConfirmKey(null);
  };

  const buttons = [
    { key: "cash", label: "Reset Cash Reconciliation" },
    { key: "sales", label: "Reset End of Day Sales" },
    { key: "revenue", label: "Reset Revenue Today" },
  ];

  return (
    <div className="glass rounded-2xl p-6 border border-[oklch(0.62_0.24_25/0.35)]">
      <div className="flex items-center gap-2 mb-2">
        <AlertOctagon className="w-5 h-5 text-[oklch(0.62_0.24_25)]" />
        <h2 className="text-lg font-semibold">Emergency Reset</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        These force-close the currently open shift and start today's counters fresh. Nothing is deleted — the closed shift and its sales stay permanently in the History Archive on the Reports page. Use this only if the numbers are stuck or a cashier forgot to end their shift.
      </p>
      {!activeShift ? (
        <div className="text-xs font-mono text-muted-foreground">No active shift right now — nothing to reset.</div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {buttons.map((b) => (
            <div key={b.key}>
              {confirmKey === b.key ? (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Force close the active shift?</span>
                  <button onClick={run} className="px-3 py-1.5 rounded-lg bg-[oklch(0.62_0.24_25/0.2)] border border-[oklch(0.62_0.24_25/0.5)] text-[oklch(0.62_0.24_25)]">Confirm</button>
                  <button onClick={() => setConfirmKey(null)} className="px-3 py-1.5 rounded-lg bg-black/5 border border-black/10">Cancel</button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmKey(b.key)}
                  className="text-xs px-3 py-2 rounded-lg bg-[oklch(0.62_0.24_25/0.1)] border border-[oklch(0.62_0.24_25/0.4)] text-[oklch(0.62_0.24_25)] hover:bg-[oklch(0.62_0.24_25/0.2)] transition"
                >
                  {b.label}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function InventoryAuditReportButton() {
  const { state } = useStore();
  return (
    <div className="flex justify-end">
      <button
        onClick={() => printInventoryAuditReport(state)}
        className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-r from-[oklch(0.7_0.19_260)] to-[oklch(0.65_0.24_305)] text-[#2b2416] text-sm font-semibold shadow-[0_0_20px_oklch(0.7_0.19_260/0.4)]"
      >
        <FileBarChart className="w-4 h-4" /> Generate Inventory Audit Report
      </button>
    </div>
  );
}

function printInventoryAuditReport(state: ReturnType<typeof useStore>["state"]) {
  const win = window.open("", "_blank", "width=900,height=1200");
  if (!win) return;
  const today = new Date().toLocaleString();

  const rows = state.stock.map((s) => {
    const totalRestocked = state.restockLog.filter((r) => r.materialId === s.id).reduce((a, r) => a + r.qtyAdded, 0);
    // initialStock is the true lifetime total ever added (Procurement +
    // Restock's new-quantity portions, carryover never double-counted).
    // Starting Stock = whatever existed before any Restock-button events.
    const startingStock = Math.max(0, s.initialStock - totalRestocked);
    return {
      name: s.name, unit: s.unit, startingStock,
      totalRestocked, totalConsumed: s.used, remaining: s.remaining, unitCost: s.unitCost,
      valueOnHand: s.totalValue, valueConsumed: Math.round(s.used * s.unitCost * 100) / 100,
    };
  });
  const totalOnHand = rows.reduce((a, r) => a + r.valueOnHand, 0);
  const totalConsumedValue = rows.reduce((a, r) => a + r.valueConsumed, 0);

  const recentRestocks = state.restockLog.slice(0, 50);

  win.document.write(`
<!DOCTYPE html><html><head><title>Inventory Audit Report</title>
<style>
  body { font-family: ui-sans-serif, system-ui, sans-serif; padding: 32px; color: #111; }
  h1 { margin: 0 0 4px; letter-spacing: 4px; }
  .sub { color: #666; text-transform: uppercase; letter-spacing: 3px; font-size: 11px; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; }
  th, td { border-bottom: 1px solid #ddd; padding: 7px; font-size: 12px; text-align: left; }
  th { background: #f5f5f5; text-transform: uppercase; letter-spacing: 1px; font-size: 9px; }
  .totals { margin-top: 16px; padding: 12px; background: #f5f5f5; border-radius: 8px; }
  .totals div { display: flex; justify-content: space-between; padding: 4px 0; font-family: ui-monospace, monospace; }
  .grand { font-weight: bold; border-top: 2px solid #111; margin-top: 6px; padding-top: 8px !important; font-size: 14px; }
</style></head><body>
<h1>GLITCH LOUNGE</h1>
<div class="sub">Inventory Valuation &amp; Audit Report — ${today}</div>
<div class="totals">
  <div><span>Total Value On Hand</span><span>${totalOnHand.toFixed(2)} EGP</span></div>
  <div class="grand"><span>Lifetime Value Consumed</span><span>${totalConsumedValue.toFixed(2)} EGP</span></div>
</div>
<h3 style="margin-top:24px">Stock Valuation by Material</h3>
<table>
  <thead><tr><th>Material</th><th>Starting</th><th>Restocked</th><th>Consumed</th><th>Remaining</th><th>Unit Cost</th><th>Value On Hand</th><th>Value Consumed</th></tr></thead>
  <tbody>
    ${rows.map((r) => `<tr>
      <td>${r.name}</td>
      <td>${r.startingStock} ${r.unit}</td>
      <td>${r.totalRestocked} ${r.unit}</td>
      <td>${r.totalConsumed} ${r.unit}</td>
      <td>${r.remaining} ${r.unit}</td>
      <td>${r.unitCost.toFixed(2)} EGP</td>
      <td>${r.valueOnHand.toFixed(2)} EGP</td>
      <td>${r.valueConsumed.toFixed(2)} EGP</td>
    </tr>`).join("")}
  </tbody>
</table>
<h3 style="margin-top:24px">Recent Restock Activity (User Log)</h3>
<table>
  <thead><tr><th>Time</th><th>Material</th><th>Qty Added</th><th>Carryover</th><th>New Total</th><th>Unit Cost</th><th>Performed By</th></tr></thead>
  <tbody>
    ${recentRestocks.map((r) => `<tr>
      <td>${new Date(r.ts).toLocaleString()}</td>
      <td>${r.materialName}</td>
      <td>+${r.qtyAdded}</td>
      <td>${r.carryoverAdded}</td>
      <td>${r.newTotal}</td>
      <td>${r.unitCost.toFixed(2)} EGP</td>
      <td>${r.performedBy}</td>
    </tr>`).join("") || "<tr><td colspan=7>No restocks logged yet</td></tr>"}
  </tbody>
</table>
<script>window.onload = () => setTimeout(() => { if (window.electronAPI) { window.electronAPI.printSilent({ deviceName: localStorage.getItem("glitch-preferred-printer") || "" }).catch(() => window.print()); } else { window.print(); } }, 300);</script>
</body></html>`);
  win.document.close();
}

function InventoryResetPanel() {
  const { resetInventory } = useStore();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [password, setPassword] = useState("");
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const REQUIRED_PHRASE = "RESET INVENTORY";
  const canSubmit = confirmText.trim().toUpperCase() === REQUIRED_PHRASE && password.length > 0;

  const submit = async () => {
    if (!canSubmit) return;
    setRunning(true);
    setErr(null);
    try {
      const res = await resetInventory(password);
      if (!res.ok) { setErr(res.error ?? "Reset failed"); return; }
      setDone(true);
      setTimeout(() => window.location.reload(), 1800);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="rounded-2xl p-6 border-2 border-[oklch(0.62_0.24_25/0.5)] bg-[oklch(0.62_0.24_25/0.06)]">
      <div className="flex items-center gap-2 mb-2">
        <AlertOctagon className="w-5 h-5 text-[oklch(0.62_0.24_25)]" />
        <h2 className="text-lg font-bold text-[oklch(0.62_0.24_25)]">Danger Zone — Reset Entire Stock Inventory</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-4 max-w-2xl">
        Permanently deletes every raw material, stock batch, restock log entry, and waste invoice — a genuinely clean
        slate for the whole inventory system. This is <strong>different</strong> from the Production Reset in Setup,
        which deliberately keeps your materials as configuration — this deletes them too. Any menu item's recipe will
        point at materials that no longer exist until you rebuild it against your new material list.{" "}
        <strong>This cannot be undone.</strong>
      </p>
      <button
        onClick={() => setOpen(true)}
        className="px-4 py-2.5 rounded-lg bg-[oklch(0.62_0.24_25/0.15)] border-2 border-[oklch(0.62_0.24_25/0.6)] text-[oklch(0.62_0.24_25)] text-sm font-bold uppercase tracking-wide hover:bg-[oklch(0.62_0.24_25/0.25)]"
      >
        Reset Entire Stock Inventory
      </button>

      {open && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md" onClick={() => !running && setOpen(false)}>
          <div className="w-full max-w-md glass-strong rounded-2xl border-2 border-[oklch(0.62_0.24_25/0.6)]" onClick={(e) => e.stopPropagation()}>
            {done ? (
              <div className="p-6 text-center space-y-2">
                <div className="text-lg font-bold text-[oklch(0.78_0.2_155)]">Inventory Reset Complete</div>
                <p className="text-sm text-muted-foreground">Reloading with a clean slate...</p>
              </div>
            ) : (
              <>
                <div className="p-5 space-y-4">
                  <h3 className="text-lg font-bold text-[oklch(0.62_0.24_25)]">This is permanent.</h3>
                  <p className="text-sm text-muted-foreground">
                    Every raw material, batch, restock entry, and waste invoice will be deleted forever. Menu items,
                    rooms, shifts, sessions, and accounts are untouched — but menu recipes will need rebuilding
                    against whatever materials you add next.
                  </p>
                  <div>
                    <label className="text-xs uppercase tracking-widest text-muted-foreground">
                      Type <span className="font-bold text-[oklch(0.62_0.24_25)]">{REQUIRED_PHRASE}</span> to confirm
                    </label>
                    <input
                      value={confirmText} onChange={(e) => setConfirmText(e.target.value)}
                      className="mt-1 w-full bg-black/5 border border-black/10 rounded-lg px-3 py-2 text-sm font-mono"
                      placeholder={REQUIRED_PHRASE}
                    />
                  </div>
                  <div>
                    <label className="text-xs uppercase tracking-widest text-muted-foreground">Re-enter Your Admin Password</label>
                    <input
                      type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                      className="mt-1 w-full bg-black/5 border border-black/10 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  {err && <div className="text-sm text-[oklch(0.62_0.24_25)]">{err}</div>}
                </div>
                <div className="p-4 border-t border-black/8 flex justify-end gap-2">
                  <button onClick={() => setOpen(false)} disabled={running} className="px-4 py-2 rounded-lg text-sm bg-black/5 hover:bg-black/8 border border-black/10">Cancel</button>
                  <button
                    onClick={submit}
                    disabled={!canSubmit || running}
                    className="px-4 py-2 rounded-lg text-sm bg-[oklch(0.62_0.24_25)] text-white font-bold disabled:opacity-40"
                  >
                    {running ? "Wiping Inventory..." : "Permanently Reset"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function InventorySection() {
  const { inventorySnapshotMonths, refreshInventorySnapshotMonths, getInventorySnapshotsForMonth } = useStore();
  const [selectedMonth, setSelectedMonth] = useState<string>("current");
  const [archiveRows, setArchiveRows] = useState<InventorySnapshot[] | null>(null);
  const [archiveLoading, setArchiveLoading] = useState(false);

  useEffect(() => {
    void refreshInventorySnapshotMonths();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedMonth === "current") { setArchiveRows(null); return; }
    setArchiveLoading(true);
    getInventorySnapshotsForMonth(selectedMonth).then((rows) => { setArchiveRows(rows); setArchiveLoading(false); });
  }, [selectedMonth, getInventorySnapshotsForMonth]);

  const monthLabel = (m: string) => {
    const [y, mm] = m.split("-").map(Number);
    return new Date(y, mm - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  };

  return (
    <div>
      {inventorySnapshotMonths.length > 0 && (
        <div className="flex items-center gap-3 mb-3">
          <label className="text-xs uppercase tracking-widest text-muted-foreground">
            Select Month <span dir="rtl" className="opacity-70">اختر الشهر</span>
          </label>
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="bg-white/70 border border-black/10 rounded-lg px-3 py-1.5 text-sm"
          >
            <option value="current">Current (Live)</option>
            {inventorySnapshotMonths.map((m) => (
              <option key={m} value={m}>{monthLabel(m)}</option>
            ))}
          </select>
          {selectedMonth !== "current" && (
            <span className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full bg-[oklch(0.7_0.19_260/0.15)] border border-[oklch(0.7_0.19_260/0.5)] text-[oklch(0.7_0.19_260)]">
              Read-Only Archive
            </span>
          )}
        </div>
      )}
      {selectedMonth === "current" ? (
        <StockTable />
      ) : (
        <ArchiveStockTable month={selectedMonth} label={monthLabel(selectedMonth)} rows={archiveRows} loading={archiveLoading} />
      )}
    </div>
  );
}

function ArchiveStockTable({ month, label, rows, loading }: { month: string; label: string; rows: InventorySnapshot[] | null; loading: boolean }) {
  const totalValue = (rows || []).reduce((a, r) => a + r.totalValue, 0);
  return (
    <div className="glass rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold">Stock Inventory — {label}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Exact snapshot archived at the moment this period's Monthly Rollover ran — permanent, never edited after the fact.
          </p>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Total Stock Value ({label})</div>
          <div className="text-xl font-mono font-bold text-[oklch(0.78_0.2_155)]">{fmtMoney(totalValue)}</div>
        </div>
      </div>
      {loading ? (
        <div className="text-sm text-muted-foreground font-mono">Loading archive...</div>
      ) : !rows || rows.length === 0 ? (
        <div className="text-sm text-muted-foreground font-mono">No snapshot data for {label}.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-widest text-muted-foreground border-b border-black/8">
                <th className="text-left py-2 px-2">Item<br /><span dir="rtl" className="normal-case font-normal opacity-70">الصنف</span></th>
                <th className="text-left py-2 px-2">Unit<br /><span dir="rtl" className="normal-case font-normal opacity-70">الوحدة</span></th>
                <th className="text-left py-2 px-2">Category<br /><span dir="rtl" className="normal-case font-normal opacity-70">الفئة</span></th>
                <th className="text-right py-2 px-2">Opening Balance<br /><span dir="rtl" className="normal-case font-normal opacity-70">رصيد بداية الفترة</span></th>
                <th className="text-right py-2 px-2">Purchases<br /><span dir="rtl" className="normal-case font-normal opacity-70">المشتريات</span></th>
                <th className="text-right py-2 px-2">Sales &amp; Waste<br /><span dir="rtl" className="normal-case font-normal opacity-70">المبيعات والهالك</span></th>
                <th className="text-right py-2 px-2">System Balance<br /><span dir="rtl" className="normal-case font-normal opacity-70">الرصيد الدفتري</span></th>
                <th className="text-right py-2 px-2">Actual Count<br /><span dir="rtl" className="normal-case font-normal opacity-70">الجرد الفعلي</span></th>
                <th className="text-right py-2 px-2">Variance<br /><span dir="rtl" className="normal-case font-normal opacity-70">العجز / الزيادة</span></th>
                <th className="text-right py-2 px-2">Value</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const variance = r.finalActualCount !== null ? Math.round((r.finalActualCount - r.finalSystemBalance) * 100) / 100 : null;
                return (
                  <tr key={r.id} className="border-b border-black/8">
                    <td className="py-2 px-2 font-semibold">{r.materialName}</td>
                    <td className="py-2 px-2">
                      <span className="text-[10px] font-bold font-mono uppercase tracking-widest px-2 py-1 rounded bg-[oklch(0.82_0.16_85/0.25)] border border-[oklch(0.82_0.16_85/0.5)] text-[#2b2416]">{r.unit}</span>
                    </td>
                    <td className="py-2 px-2 text-muted-foreground">{r.category || "—"}</td>
                    <td className="py-2 px-2 text-right font-mono text-muted-foreground">{r.openingBalance}</td>
                    <td className="py-2 px-2 text-right font-mono text-[oklch(0.78_0.2_155)]">+{r.purchasesIn}</td>
                    <td className="py-2 px-2 text-right font-mono text-[oklch(0.62_0.24_25)]">-{r.salesWasteOut}</td>
                    <td className="py-2 px-2 text-right font-mono font-bold">{r.finalSystemBalance}</td>
                    <td className="py-2 px-2 text-right font-mono">{r.finalActualCount !== null ? r.finalActualCount : "—"}</td>
                    <td className={`py-2 px-2 text-right font-mono font-bold ${variance === null ? "text-muted-foreground" : variance < 0 ? "text-[oklch(0.62_0.24_25)]" : variance > 0 ? "text-[oklch(0.78_0.2_155)]" : "text-muted-foreground"}`}>
                      {variance === null ? "—" : variance === 0 ? "0" : variance > 0 ? `+${variance}` : variance}
                    </td>
                    <td className="py-2 px-2 text-right font-mono">{fmtMoney(r.totalValue)}</td>
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

function StockTable() {
  const { state, adjustStock, setAbsoluteStock, updateRawMaterial, setActualStock, rolloverInventory } = useStore();
  const [historyTarget, setHistoryTarget] = useState<{ id: string; name: string; unit: string } | null>(null);
  const [actualStockTarget, setActualStockTarget] = useState<{ id: string; name: string; unit: string; systemRemaining: number; input: string } | null>(null);
  const [editTarget, setEditTarget] = useState<{ id: string; name: string; unit: string; unitCost: number; minStock: number; remaining: number; category: string; storageLocation: string; lastPurchaseCost: number; openingStock: number } | null>(null);
  const [editingCostId, setEditingCostId] = useState<string | null>(null);
  const [editingUnitId, setEditingUnitId] = useState<string | null>(null);
  const [unitInput, setUnitInput] = useState("");
  const [costInput, setCostInput] = useState("");
  const [search, setSearch] = useState("");

  // "Total Inventory Value = SUM(Current Actual Stock * Most Recent
  // Purchase Unit Cost)" — falls back to systemBalance*unitCost per item
  // when no physical count has been entered yet for that specific item,
  // since a null actualCountValue would otherwise make it silently
  // undercount rather than reflect the best available number.
  const totalInventoryValue = state.stock.reduce((a, s) => a + (s.actualStock !== null ? s.actualStock : s.systemBalance) * s.lastPurchaseCost, 0);
  const filteredStock = state.stock.filter((s) => s.name.toLowerCase().includes(search.trim().toLowerCase()));
  const [rolloverConfirmOpen, setRolloverConfirmOpen] = useState(false);
  const [rolloverRunning, setRolloverRunning] = useState(false);
  const [rolloverErr, setRolloverErr] = useState<string | null>(null);

  const runRollover = async () => {
    setRolloverRunning(true);
    setRolloverErr(null);
    try {
      const res = await rolloverInventory();
      if (!res.ok) { setRolloverErr(res.error ?? "Rollover failed"); return; }
      setRolloverConfirmOpen(false);
    } finally {
      setRolloverRunning(false);
    }
  };

  return (
    <div className="glass rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold">Stock Inventory</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Computed from purchased batches (FIFO). Add materials on Setup, log real purchases on Procurement.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={() => setRolloverConfirmOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[oklch(0.82_0.16_85/0.15)] border border-[oklch(0.82_0.16_85/0.5)] text-[oklch(0.82_0.16_85)] text-xs font-bold uppercase tracking-wide hover:bg-[oklch(0.82_0.16_85/0.25)]"
            title="اعتماد الجرد وبداية فترة جديدة"
          >
            <RotateCcw className="w-3.5 h-3.5" /> اعتماد الجرد وبداية فترة جديدة
          </button>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">قيمة المخزون (Total Stock Value)</div>
            <div className="text-xl font-mono font-bold text-[oklch(0.78_0.2_155)]">{fmtMoney(totalInventoryValue)}</div>
          </div>
        </div>
      </div>

      {rolloverConfirmOpen && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md" onClick={() => !rolloverRunning && setRolloverConfirmOpen(false)}>
          <div className="w-full max-w-md glass-strong rounded-2xl border-2 border-[oklch(0.82_0.16_85/0.6)]" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 space-y-3">
              <h3 className="text-lg font-bold text-[oklch(0.82_0.16_85)]">اعتماد الجرد وبداية فترة جديدة</h3>
              <p className="text-sm text-muted-foreground">
                Requires a real physical count (Actual Stock) entered for every single material first — this won't
                proceed until all of them are filled in. For each one, that count becomes the new, locked Opening
                Balance. This period's full audit (Opening, Remaining, Actual, Variance) is permanently archived
                before anything resets, and Purchases/Out counters return to zero for the new period.
              </p>
              <p className="text-sm font-semibold text-[oklch(0.62_0.24_25)]">This cannot be undone.</p>
              {rolloverErr && <p className="text-sm text-[oklch(0.62_0.24_25)] bg-[oklch(0.62_0.24_25/0.1)] rounded-lg p-3">{rolloverErr}</p>}
            </div>
            <div className="p-4 border-t border-black/8 flex justify-end gap-2">
              <button onClick={() => setRolloverConfirmOpen(false)} disabled={rolloverRunning} className="px-4 py-2 rounded-lg text-sm bg-black/5 hover:bg-black/8 border border-black/10">Cancel</button>
              <button
                onClick={() => void runRollover()}
                disabled={rolloverRunning}
                className="px-4 py-2 rounded-lg text-sm bg-[oklch(0.82_0.16_85)] text-black font-bold disabled:opacity-40"
              >
                {rolloverRunning ? "Rolling over..." : "Confirm Rollover"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="relative mb-4">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search inventory by name..."
          className="w-full bg-white/70 border border-black/10 rounded-lg pl-9 pr-9 py-2 text-sm"
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-[#2b2416]"
            title="Clear search"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {state.stock.length === 0 ? (
        <div className="text-sm text-muted-foreground font-mono">No raw materials yet — add one on the Setup page.</div>
      ) : filteredStock.length === 0 ? (
        <div className="text-sm text-muted-foreground font-mono">No items match &quot;{search}&quot;.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-widest text-muted-foreground border-b border-black/8">
                <th className="text-left py-2 px-2">Item<br /><span dir="rtl" className="normal-case font-normal opacity-70">الصنف</span></th>
                <th className="text-left py-2 px-2">Unit<br /><span dir="rtl" className="normal-case font-normal opacity-70">الوحدة</span></th>
                <th className="text-right py-2 px-2">Opening Balance<br /><span dir="rtl" className="normal-case font-normal opacity-70">رصيد بداية الفترة</span></th>
                <th className="text-right py-2 px-2">Remaining<br /><span dir="rtl" className="normal-case font-normal opacity-70">المتبقي الدفتري</span></th>
                <th className="text-right py-2 px-2">Actual Stock<br /><span dir="rtl" className="normal-case font-normal opacity-70">الجرد الفعلي</span></th>
                <th className="text-right py-2 px-2">Variance Qty<br /><span dir="rtl" className="normal-case font-normal opacity-70">عجز/زيادة كمية</span></th>
                <th className="text-right py-2 px-2">Variance Value<br /><span dir="rtl" className="normal-case font-normal opacity-70">عجز/زيادة فلوس</span></th>
                <th className="text-right py-2 px-2">Min<br /><span dir="rtl" className="normal-case font-normal opacity-70">الحد الأدنى</span></th>
                <th className="text-center py-2 px-2">Status<br /><span dir="rtl" className="normal-case font-normal opacity-70">الحالة</span></th>
                <th className="text-right py-2 px-2">Last Purchase Cost<br /><span dir="rtl" className="normal-case font-normal opacity-70">تكلفة آخر شراء</span></th>
                <th className="text-right py-2 px-2">Stock Value<br /><span dir="rtl" className="normal-case font-normal opacity-70">قيمة المخزون</span></th>
                <th className="py-2 px-2">Actions<br /><span dir="rtl" className="normal-case font-normal opacity-70">إجراءات</span></th>
              </tr>
            </thead>
            <tbody>
              {filteredStock.map((s) => {
                // Actual Stock is a PURE manual-entry field — it must
                // never silently show the system's own calculated number
                // as if it were a real physical count. Status and Stock
                // Value both compare/derive from Remaining (the
                // calculated figure), not from whatever's in Actual Stock.
                const hasActualCount = s.actualStock !== null;
                const varianceQty = hasActualCount ? Math.round((s.actualStock! - s.systemBalance) * 100) / 100 : null;
                const varianceValue = varianceQty !== null ? Math.round(varianceQty * s.lastPurchaseCost * 100) / 100 : null;
                const status = s.systemBalance <= 0 ? { label: "نَفَد", labelEn: "Out", color: "oklch(0.62_0.24_25)" }
                  : s.systemBalance < s.minStock ? { label: "قليل", labelEn: "Low", color: "oklch(0.82_0.16_85)" }
                  : { label: "متوفر", labelEn: "Available", color: "oklch(0.78_0.2_155)" };
                return (
                  <tr key={s.id} className="border-b border-black/8 hover:bg-black/5">
                    <td className="py-2 px-2 font-semibold">{s.name}</td>
                    <td className="py-2 px-2">
                      <span className="text-[10px] font-bold font-mono uppercase tracking-widest px-2 py-1 rounded bg-[oklch(0.82_0.16_85/0.25)] border border-[oklch(0.82_0.16_85/0.5)] text-[#2b2416]">{s.unit}</span>
                    </td>
                    <td className="py-2 px-2 text-right font-mono text-muted-foreground">{s.openingStock}</td>
                    <td className="py-2 px-2 text-right font-mono font-bold">{s.systemBalance}</td>
                    <td className="py-2 px-2 text-right">
                      <button
                        onClick={() => setActualStockTarget({ id: s.id, name: s.name, unit: s.unit, systemRemaining: s.remaining, input: s.actualStock !== null ? String(s.actualStock) : "" })}
                        className="font-mono hover:underline decoration-dotted"
                      >
                        {hasActualCount ? s.actualStock : <span className="text-muted-foreground">— enter —</span>}
                      </button>
                    </td>
                    <td className={`py-2 px-2 text-right font-mono ${varianceQty === null ? "text-muted-foreground" : varianceQty < 0 ? "text-[oklch(0.62_0.24_25)]" : varianceQty > 0 ? "text-[oklch(0.78_0.2_155)]" : "text-muted-foreground"}`}>
                      {varianceQty === null ? "—" : varianceQty > 0 ? `+${varianceQty}` : varianceQty}
                    </td>
                    <td className={`py-2 px-2 text-right font-mono ${varianceValue === null ? "text-muted-foreground" : varianceValue < 0 ? "text-[oklch(0.62_0.24_25)]" : varianceValue > 0 ? "text-[oklch(0.78_0.2_155)]" : "text-muted-foreground"}`}>
                      {varianceValue === null ? "—" : varianceValue > 0 ? `+${fmtMoney(varianceValue)}` : fmtMoney(varianceValue)}
                    </td>
                    <td className="py-2 px-2 text-right font-mono text-muted-foreground">{s.minStock}</td>
                    <td className="py-2 px-2 text-center">
                      <span
                        className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full border"
                        style={{ color: status.color, borderColor: status.color, backgroundColor: `color-mix(in oklch, ${status.color} 15%, transparent)` }}
                        title={status.labelEn}
                      >
                        {status.label}
                      </span>
                    </td>
                    <td className="py-2 px-2 text-right font-mono">{fmtMoney(s.lastPurchaseCost)}</td>
                    <td className="py-2 px-2 text-right font-mono">{fmtMoney(s.systemBalance * s.lastPurchaseCost)}</td>
                    <td className="py-2 px-2 text-right whitespace-nowrap">
                      <button
                        onClick={() => setEditTarget({ id: s.id, name: s.name, unit: s.unit, unitCost: s.unitCost, minStock: s.minStock, remaining: s.remaining, category: s.category, storageLocation: s.storageLocation, lastPurchaseCost: s.lastPurchaseCost, openingStock: s.openingStock })}
                        className="text-[10px] uppercase tracking-widest px-2 py-1 rounded bg-[oklch(0.82_0.16_85/0.15)] border border-[oklch(0.82_0.16_85/0.4)] text-[oklch(0.82_0.16_85)] hover:bg-[oklch(0.82_0.16_85/0.25)] mr-1.5"
                        title="Edit this entry"
                      >
                        <Pencil className="w-3.5 h-3.5 inline mr-1" />Edit
                      </button>
                      <button
                        onClick={() => setHistoryTarget({ id: s.id, name: s.name, unit: s.unit })}
                        className="text-[10px] uppercase tracking-widest px-2 py-1 rounded bg-black/5 border border-black/10 hover:bg-black/8 text-muted-foreground hover:text-[#2b2416] mr-1.5"
                        title="History"
                      >
                        <History className="w-3.5 h-3.5 inline" />
                      </button>
                      <button
                        onClick={() => setActualStockTarget({ id: s.id, name: s.name, unit: s.unit, systemRemaining: s.remaining, input: s.actualStock !== null ? String(s.actualStock) : "" })}
                        className="text-[10px] uppercase tracking-widest px-2 py-1 rounded bg-black/5 border border-black/10 hover:bg-black/8 text-muted-foreground hover:text-[#2b2416]"
                        title="Record a physical count (الجرد الفعلي)"
                      >
                        Count
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {historyTarget && <MaterialHistoryModal target={historyTarget} onClose={() => setHistoryTarget(null)} />}
      {actualStockTarget && (
        <ActualStockModal target={actualStockTarget} setActualStock={setActualStock} onClose={() => setActualStockTarget(null)} />
      )}
      {editTarget && (
        <EditMaterialModal target={editTarget} updateRawMaterial={updateRawMaterial} setAbsoluteStock={setAbsoluteStock} onClose={() => setEditTarget(null)} />
      )}
    </div>
  );
}

function EditMaterialModal({ target, updateRawMaterial, setAbsoluteStock, onClose }: {
  target: { id: string; name: string; unit: string; unitCost: number; minStock: number; remaining: number; category: string; storageLocation: string; lastPurchaseCost: number; openingStock: number };
  updateRawMaterial: ReturnType<typeof useStore>["updateRawMaterial"];
  setAbsoluteStock: ReturnType<typeof useStore>["setAbsoluteStock"];
  onClose: () => void;
}) {
  const [name, setName] = useState(target.name);
  const [unit, setUnit] = useState(target.unit);
  const [unitCost, setUnitCost] = useState(String(target.unitCost));
  const [minStock, setMinStock] = useState(String(target.minStock));
  const [quantity, setQuantity] = useState(String(target.remaining));
  const [category, setCategory] = useState(target.category);
  const [storageLocation, setStorageLocation] = useState(target.storageLocation);
  const [lastPurchaseCost, setLastPurchaseCost] = useState(String(target.lastPurchaseCost));
  const [openingStock, setOpeningStock] = useState(String(target.openingStock));
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const newQty = parseFloat(quantity);
  // Display-only preview — the REAL delta is computed server-side, fresh,
  // at save time (see setAbsoluteStock). This local number can go stale
  // the instant a sale/void/other change happens while this modal is
  // open; that's fine for a preview, but must never be what's actually
  // sent to the server — that was the bug.
  const qtyDeltaPreview = isNaN(newQty) ? 0 : Math.round((newQty - target.remaining) * 100) / 100;
  const valuationPreview = (isNaN(newQty) ? target.remaining : newQty) * (parseFloat(unitCost) || 0);

  const submit = async () => {
    setErr(null);
    if (!name.trim()) { setErr("Name is required."); return; }
    if (!unit.trim()) { setErr("Unit is required."); return; }
    if (isNaN(newQty) || newQty < 0) { setErr("Enter a valid quantity."); return; }
    setSubmitting(true);
    try {
      const patch: Record<string, string | number> = {};
      if (name.trim() !== target.name) patch.name = name.trim();
      if (unit.trim() !== target.unit) patch.unit = unit.trim();
      if ((parseFloat(unitCost) || 0) !== target.unitCost) patch.unitCost = parseFloat(unitCost) || 0;
      if ((parseFloat(minStock) || 0) !== target.minStock) patch.minStockAlert = parseFloat(minStock) || 0;
      if (category.trim() !== target.category) patch.category = category.trim();
      if (storageLocation.trim() !== target.storageLocation) patch.storageLocation = storageLocation.trim();
      if ((parseFloat(lastPurchaseCost) || 0) !== target.lastPurchaseCost) patch.lastPurchaseCost = parseFloat(lastPurchaseCost) || 0;
      if ((parseFloat(openingStock) || 0) !== target.openingStock) patch.openingStock = parseFloat(openingStock) || 0;

      if (Object.keys(patch).length > 0) {
        const patchRes = await updateRawMaterial(target.id, patch);
        if (!patchRes.ok) { setErr(patchRes.error ?? "Update failed"); return; }
      }
      // Always call this when the quantity field was touched, even if it
      // happens to match the stale preview — the server decides the real
      // delta from the live number, not this component.
      if (newQty !== target.remaining) {
        const res = await setAbsoluteStock(target.id, newQty, "Edited via Inventory Edit modal");
        if (!res.ok) { setErr(res.error ?? "Quantity correction failed"); return; }
      }
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md glass-strong rounded-2xl border border-[oklch(0.82_0.16_85/0.5)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-black/8">
          <div className="font-mono uppercase tracking-widest text-xs text-[oklch(0.82_0.16_85)]">Edit Inventory Entry</div>
          <button onClick={onClose} className="text-muted-foreground hover:text-[#2b2416]"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="text-xs uppercase tracking-widest text-muted-foreground">Raw Material Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs uppercase tracking-widest text-muted-foreground">Opening Balance (رصيد بداية الفترة)</label>
              <input type="number" step="0.01" value={openingStock} onChange={(e) => setOpeningStock(e.target.value)} className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm font-mono" />
              <p className="text-[10px] text-muted-foreground mt-1">Changing this moves real stock by the same amount — it's not just a label.</p>
            </div>
            <div>
              <label className="text-xs uppercase tracking-widest text-muted-foreground">Current Stock Quantity</label>
              <input type="number" step="0.01" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm font-mono" />
            </div>
            <div>
              <label className="text-xs uppercase tracking-widest text-muted-foreground">Unit of Measurement</label>
              <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="e.g. g, kg, ml, L, pcs, box, علبة..." className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs uppercase tracking-widest text-muted-foreground">Unit Cost</label>
              <input type="number" step="0.01" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm font-mono" />
            </div>
            <div>
              <label className="text-xs uppercase tracking-widest text-muted-foreground">Min Alert Threshold</label>
              <input type="number" step="0.01" value={minStock} onChange={(e) => setMinStock(e.target.value)} className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm font-mono" />
            </div>
            <div>
              <label className="text-xs uppercase tracking-widest text-muted-foreground">Category (الفئة)</label>
              <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Beverages, Dairy..." className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs uppercase tracking-widest text-muted-foreground">Storage Location (مكان التخزين)</label>
              <input value={storageLocation} onChange={(e) => setStorageLocation(e.target.value)} placeholder="e.g. Shelf A2, Fridge 1..." className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs uppercase tracking-widest text-muted-foreground">Last Purchase Cost (تكلفة آخر شراء)</label>
              <input type="number" step="0.01" value={lastPurchaseCost} onChange={(e) => setLastPurchaseCost(e.target.value)} className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm font-mono" />
              <p className="text-[10px] text-muted-foreground mt-1">Normally auto-updates from Procurement/restock — edit here only to correct a mistake.</p>
            </div>
          </div>

          <div className="rounded-lg bg-black/5 border border-black/8 p-3 text-xs font-mono space-y-1">
            {qtyDeltaPreview !== 0 && !isNaN(newQty) && (
              <div className={`flex justify-between font-bold ${qtyDeltaPreview < 0 ? "text-[oklch(0.62_0.24_25)]" : "text-[oklch(0.78_0.2_155)]"}`}>
                <span>Quantity Correction (est.)</span><span>{qtyDeltaPreview > 0 ? "+" : ""}{qtyDeltaPreview} {unit}</span>
              </div>
            )}
            <div className="flex justify-between text-muted-foreground">
              <span>New Stock Valuation</span><span>{fmtMoney(valuationPreview)}</span>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Name/unit/cost/min-alert changes and any quantity correction are recorded separately in the Audit Log with your username, timestamp, and before/after values.
          </p>
          {err && <div className="text-xs text-[oklch(0.62_0.24_25)]">{err}</div>}
        </div>
        <div className="p-4 border-t border-black/8 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm bg-black/5 hover:bg-black/8 border border-black/10">Cancel</button>
          <button
            onClick={submit}
            disabled={submitting}
            className="px-4 py-2 rounded-lg text-sm bg-gradient-to-r from-[oklch(0.82_0.16_85)] to-[oklch(0.82_0.16_85)] text-[#2b2416] font-bold disabled:opacity-60"
          >
            {submitting ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ActualStockModal({ target, setActualStock, onClose }: {
  target: { id: string; name: string; unit: string; systemRemaining: number; input: string };
  setActualStock: ReturnType<typeof useStore>["setActualStock"];
  onClose: () => void;
}) {
  const [value, setValue] = useState(target.input);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const num = parseFloat(value);
  const valid = !isNaN(num) && num >= 0;
  const variance = valid ? Math.round((num - target.systemRemaining) * 100) / 100 : 0;

  const confirmAndSave = async () => {
    setSubmitting(true);
    setErr(null);
    try {
      const res = await setActualStock(target.id, num);
      if (!res.ok) { setErr(res.error ?? "Could not save"); return; }
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-sm glass-strong rounded-2xl border border-black/10" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-black/8">
          <div className="font-mono uppercase tracking-widest text-xs text-muted-foreground">
            {confirming ? "Confirm Variance" : `Actual Stock — ${target.name}`}
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-[#2b2416]"><X className="w-4 h-4" /></button>
        </div>

        {!confirming ? (
          <>
            <div className="p-4 space-y-3">
              <div className="text-xs text-muted-foreground">System-calculated remaining: <span className="font-mono font-bold">{target.systemRemaining} {target.unit}</span></div>
              <div>
                <label className="text-xs uppercase tracking-widest text-muted-foreground">
                  Physically Counted Quantity ({target.unit})
                </label>
                <input
                  type="number" step="0.01" autoFocus value={value}
                  onChange={(e) => setValue(e.target.value)}
                  className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-3 text-lg font-mono text-center"
                />
              </div>
              {valid && variance !== 0 && (
                <div className={`text-sm font-bold text-center ${variance < 0 ? "text-[oklch(0.62_0.24_25)]" : "text-[oklch(0.78_0.2_155)]"}`}>
                  {variance < 0 ? `${Math.abs(variance)} ${target.unit} Deficit (عجز)` : `+${variance} ${target.unit} Surplus`}
                </div>
              )}
              {err && <div className="text-xs text-[oklch(0.62_0.24_25)]">{err}</div>}
            </div>
            <div className="p-4 border-t border-black/8 flex justify-end gap-2">
              <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm bg-black/5 hover:bg-black/8 border border-black/10">Cancel</button>
              <button
                onClick={() => setConfirming(true)}
                disabled={!valid}
                className="px-4 py-2 rounded-lg text-sm bg-[oklch(0.82_0.16_85/0.25)] border border-[oklch(0.82_0.16_85/0.6)] font-semibold disabled:opacity-50"
              >
                Continue
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="p-4 space-y-3 text-center">
              <p className="text-sm">
                Are you sure you want to set Actual Stock for <strong>{target.name}</strong> to{" "}
                <strong>{num} {target.unit}</strong>?
              </p>
              {variance !== 0 ? (
                <p className={`text-sm font-bold ${variance < 0 ? "text-[oklch(0.62_0.24_25)]" : "text-[oklch(0.78_0.2_155)]"}`}>
                  This will record a {variance < 0 ? "deficit" : "surplus"} of {Math.abs(variance)} {target.unit}.
                </p>
              ) : (
                <p className="text-sm text-[oklch(0.78_0.2_155)]">This matches the system figure exactly — no variance.</p>
              )}
              {err && <div className="text-xs text-[oklch(0.62_0.24_25)]">{err}</div>}
            </div>
            <div className="p-4 border-t border-black/8 flex justify-end gap-2">
              <button onClick={() => setConfirming(false)} className="px-4 py-2 rounded-lg text-sm bg-black/5 hover:bg-black/8 border border-black/10">Back</button>
              <button
                onClick={confirmAndSave}
                disabled={submitting}
                className="px-4 py-2 rounded-lg text-sm bg-gradient-to-r from-[oklch(0.82_0.16_85)] to-[oklch(0.82_0.16_85)] text-[#2b2416] font-bold disabled:opacity-60"
              >
                {submitting ? "Saving..." : "Confirm & Save"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function MaterialHistoryModal({ target, onClose }: { target: { id: string; name: string; unit: string }; onClose: () => void }) {
  const { state } = useStore();
  const restocks = state.restockLog.filter((r) => r.materialId === target.id).sort((a, b) => b.ts - a.ts);

  // Usage summary: cross-reference every session's + staff order's items
  // against this material's recipe usage, so "which products consumed it"
  // is a real answer, not a guess.
  const usage = useMemo(() => {
    const map = new Map<string, number>();
    const tally = (menuItemId: string, name: string, qty: number) => {
      const item = state.menu.find((m) => m.id === menuItemId);
      if (!item) return;
      const ing = item.ingredients.find((i) => i.stockId === target.id);
      if (!ing) return;
      map.set(name, (map.get(name) ?? 0) + ing.qty * qty);
    };
    state.sessions.forEach((s) => s.orders.forEach((o) => tally(o.menuItemId, o.name, o.qty)));
    state.staffOrders.forEach((so) => so.items.forEach((o) => tally(o.menuItemId, o.name, o.qty)));
    return Array.from(map.entries()).map(([name, qty]) => ({ name, qty })).sort((a, b) => b.qty - a.qty);
  }, [state.sessions, state.staffOrders, state.menu, target.id]);

  const totalUsage = usage.reduce((a, u) => a + u.qty, 0);

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto glass-strong rounded-2xl border border-black/10" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-black/10">
          <div className="flex items-center gap-2 font-mono uppercase tracking-widest text-xs text-[oklch(0.7_0.19_260)]">
            <History className="w-4 h-4" /> {target.name} — History
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-[#2b2416]"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-6">
          <div>
            <h3 className="text-sm font-semibold mb-2">Restock Log</h3>
            {restocks.length === 0 ? (
              <div className="text-xs text-muted-foreground font-mono">No restocks logged yet for this material.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[9px] uppercase tracking-widest text-muted-foreground border-b border-black/8">
                      <th className="text-left py-1.5 px-2">Time</th>
                      <th className="text-right py-1.5 px-2">Qty Added</th>
                      <th className="text-right py-1.5 px-2">Carryover</th>
                      <th className="text-right py-1.5 px-2">New Total</th>
                      <th className="text-right py-1.5 px-2">Unit Cost</th>
                      <th className="text-left py-1.5 px-2">By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {restocks.map((r) => (
                      <tr key={r.id} className="border-b border-black/8">
                        <td className="py-1.5 px-2 font-mono text-muted-foreground">{new Date(r.ts).toLocaleString()}</td>
                        <td className="py-1.5 px-2 text-right font-mono text-[oklch(0.78_0.2_155)]">+{r.qtyAdded}</td>
                        <td className="py-1.5 px-2 text-right font-mono">{r.carryoverAdded}</td>
                        <td className="py-1.5 px-2 text-right font-mono font-bold">{r.newTotal}</td>
                        <td className="py-1.5 px-2 text-right font-mono">{fmtMoney(r.unitCost)}</td>
                        <td className="py-1.5 px-2">{r.performedBy}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold">Usage Summary — by Product</h3>
              <span className="text-xs font-mono text-muted-foreground">Total: {totalUsage} {target.unit}</span>
            </div>
            {usage.length === 0 ? (
              <div className="text-xs text-muted-foreground font-mono">No consumption recorded yet.</div>
            ) : (
              <div className="space-y-1.5">
                {usage.map((u) => (
                  <div key={u.name} className="flex items-center justify-between text-xs font-mono bg-white/60 rounded-lg px-3 py-2 border border-black/8">
                    <span>{u.name}</span>
                    <span>{u.qty.toFixed(2)} {target.unit}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function RecipeMatchCheck() {
  const { state } = useStore();

  // Directly answers "does the recipe match the stock inventory" —
  // computed from data already loaded, no extra fetch needed. Two
  // distinct failure modes: a menu item with NO recipe at all (selling
  // it deducts nothing from stock, silently), and a recipe pointing at
  // a stockId that no material currently has (a broken/stale link —
  // can happen if a material was renamed via bulk import and the old
  // one deleted, or never existed with that id to begin with).
  const validStockIds = useMemo(() => new Set(state.stock.map((s) => s.id)), [state.stock]);
  const { noRecipe, brokenLinks } = useMemo(() => {
    const noRecipe: MenuItem[] = [];
    const brokenLinks: { item: MenuItem; missingIds: string[] }[] = [];
    state.menu.forEach((m) => {
      if (!m.ingredients || m.ingredients.length === 0) { noRecipe.push(m); return; }
      const missing = m.ingredients.filter((i) => !validStockIds.has(i.stockId)).map((i) => i.stockId);
      if (missing.length > 0) brokenLinks.push({ item: m, missingIds: Array.from(new Set(missing)) });
    });
    return { noRecipe, brokenLinks };
  }, [state.menu, validStockIds]);

  const allGood = noRecipe.length === 0 && brokenLinks.length === 0;

  return (
    <div className={`glass rounded-2xl p-6 border-2 ${allGood ? "border-[oklch(0.78_0.2_155/0.4)]" : "border-[oklch(0.82_0.16_85/0.5)]"}`}>
      <div className="flex items-center gap-2 mb-2">
        {allGood ? <Check className="w-5 h-5 text-[oklch(0.78_0.2_155)]" /> : <AlertOctagon className="w-5 h-5 text-[oklch(0.82_0.16_85)]" />}
        <h2 className="text-lg font-semibold">Recipe ↔ Inventory Match Check</h2>
      </div>
      {allGood ? (
        <p className="text-sm text-muted-foreground">
          Every menu item's recipe correctly links to a material that currently exists in Stock Inventory —
          checked {state.menu.length} menu item(s) against {state.stock.length} material(s).
        </p>
      ) : (
        <div className="space-y-3">
          {noRecipe.length > 0 && (
            <div>
              <div className="text-sm font-bold text-[oklch(0.82_0.16_85)] mb-1">
                {noRecipe.length} menu item(s) with no recipe at all — selling these deducts nothing from stock:
              </div>
              <div className="text-sm text-muted-foreground">{noRecipe.map((m) => m.name).join(", ")}</div>
            </div>
          )}
          {brokenLinks.length > 0 && (
            <div>
              <div className="text-sm font-bold text-[oklch(0.62_0.24_25)] mb-1">
                {brokenLinks.length} menu item(s) reference a material that no longer exists — their recipe needs rebuilding:
              </div>
              <ul className="text-sm text-muted-foreground list-disc list-inside">
                {brokenLinks.map(({ item }) => (
                  <li key={item.id}>{item.name}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-xs text-muted-foreground">Fix these in Menu &amp; Recipes below by re-selecting the correct material for each ingredient.</p>
        </div>
      )}
    </div>
  );
}

function RecipeManager({ onAdd, onUpdate, onDelete }: {
  onAdd: (m: MenuItem) => void;
  onUpdate: (id: string, patch: Partial<MenuItem>) => void;
  onDelete: (id: string) => void;
}) {
  const { state } = useStore();
  const [showForm, setShowForm] = useState(false);
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [price, setPrice] = useState(0);
  const [category, setCategory] = useState<MenuCategory>(MENU_CATEGORIES[0]);
  const [ings, setIngs] = useState<{ stockId: string; qty: number }[]>([]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPrice, setEditPrice] = useState(0);
  const [editCategory, setEditCategory] = useState<MenuCategory>(MENU_CATEGORIES[0]);
  const [editIngs, setEditIngs] = useState<{ stockId: string; qty: number }[]>([]);
  const [editErr, setEditErr] = useState<string | null>(null);

  const save = () => {
    if (!id || !name) return;
    const incomplete = ings.filter((i) => (i.stockId && !(i.qty > 0)) || (!i.stockId && i.qty > 0));
    if (incomplete.length > 0) {
      setEditErr(`${incomplete.length} ingredient row${incomplete.length === 1 ? " has" : "s have"} a quantity but no material selected (or vice versa) — fix or remove ${incomplete.length === 1 ? "it" : "them"} before saving, or it will silently not be included.`);
      return;
    }
    setEditErr(null);
    onAdd({ id, name, price, category, ingredients: ings.filter((i) => i.stockId && i.qty > 0) });
    setId(""); setName(""); setPrice(0); setCategory(MENU_CATEGORIES[0]); setIngs([]); setShowForm(false);
  };

  const beginEdit = (m: MenuItem) => {
    setEditingId(m.id);
    setEditName(m.name);
    setEditPrice(m.price);
    setEditCategory(m.category ?? MENU_CATEGORIES[0]);
    setEditIngs(m.ingredients.map((i) => ({ ...i })));
    setEditErr(null);
  };
  const saveEdit = () => {
    if (!editingId || !editName) return;
    // Previously, an ingredient row with a quantity typed in but no
    // material actually selected (still on the "select stock..."
    // placeholder) was silently dropped on save — the recipe would save
    // as if that ingredient never existed, with no warning at all. Block
    // the save and say so plainly instead.
    const incomplete = editIngs.filter((i) => (i.stockId && !(i.qty > 0)) || (!i.stockId && i.qty > 0));
    if (incomplete.length > 0) {
      setEditErr(`${incomplete.length} ingredient row${incomplete.length === 1 ? " has" : "s have"} a quantity but no material selected (or vice versa) — fix or remove ${incomplete.length === 1 ? "it" : "them"} before saving, or it will silently not be included.`);
      return;
    }
    setEditErr(null);
    onUpdate(editingId, { name: editName, price: editPrice, category: editCategory, ingredients: editIngs.filter((i) => i.stockId && i.qty > 0) });
    setEditingId(null);
  };

  return (
    <div className="glass rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Menu &amp; Recipes</h2>
        <button onClick={() => setShowForm((v) => !v)} className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg bg-black/5 border border-black/10 hover:bg-black/8">
          <Plus className="w-4 h-4" /> Add Menu Item
        </button>
      </div>

      {showForm && (
        <div className="mb-4 p-4 rounded-lg bg-white/60 border border-black/8 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <input placeholder="id (e.g. cappuccino)" value={id} onChange={(e) => setId(e.target.value)} className="bg-white/70 rounded px-3 py-2 text-sm border border-black/10" />
            <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} className="bg-white/70 rounded px-3 py-2 text-sm border border-black/10" />
            <input type="number" step="0.5" placeholder="Price" value={price} onChange={(e) => setPrice(+e.target.value)} className="bg-white/70 rounded px-3 py-2 text-sm border border-black/10" />
            <select value={category} onChange={(e) => setCategory(e.target.value as MenuCategory)} className="bg-white/70 rounded px-3 py-2 text-sm border border-black/10">
              {MENU_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Ingredients</div>
            {ings.map((ing, idx) => {
              const incomplete = (ing.stockId && !(ing.qty > 0)) || (!ing.stockId && ing.qty > 0);
              return (
                <div key={idx} className={`grid grid-cols-3 gap-2 ${incomplete ? "ring-2 ring-[oklch(0.62_0.24_25)] rounded" : ""}`}>
                  <select value={ing.stockId} onChange={(e) => setIngs(ings.map((x, i) => i === idx ? { ...x, stockId: e.target.value } : x))} className="bg-white/70 rounded px-2 py-1.5 text-sm border border-black/10">
                    <option value="">select stock...</option>
                    {state.stock.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.unit})</option>)}
                  </select>
                  <input type="number" placeholder="qty per unit" value={ing.qty} onChange={(e) => setIngs(ings.map((x, i) => i === idx ? { ...x, qty: +e.target.value } : x))} className="bg-white/70 rounded px-2 py-1.5 text-sm border border-black/10" />
                  <button onClick={() => setIngs(ings.filter((_, i) => i !== idx))} className="text-xs text-muted-foreground hover:text-[oklch(0.62_0.24_25)]">Remove</button>
                </div>
              );
            })}
            <button onClick={() => setIngs([...ings, { stockId: "", qty: 0 }])} className="text-xs px-3 py-1.5 rounded bg-black/5 border border-black/10">+ Ingredient</button>
          </div>
          {editErr && <div className="text-xs text-[oklch(0.62_0.24_25)] bg-[oklch(0.62_0.24_25/0.1)] rounded-lg p-2">{editErr}</div>}
          <button onClick={save} className="py-2 px-4 rounded bg-[oklch(0.7_0.19_260/0.2)] border border-[oklch(0.7_0.19_260/0.5)] text-sm">Save Menu Item</button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {state.menu.map((m) => {
          const isEditing = editingId === m.id;
          if (isEditing) {
            return (
              <div key={m.id} className="bg-white/60 rounded-lg p-4 border border-[oklch(0.7_0.19_260/0.5)] space-y-2">
                <input value={editName} onChange={(e) => setEditName(e.target.value)} className="w-full bg-white/70 rounded px-2 py-1.5 text-sm border border-black/10 font-semibold" placeholder="Name" />
                <input type="number" step="0.5" value={editPrice} onChange={(e) => setEditPrice(+e.target.value)} className="w-full bg-white/70 rounded px-2 py-1.5 text-sm border border-black/10 font-mono" placeholder="Price" />
                <select value={editCategory} onChange={(e) => setEditCategory(e.target.value as MenuCategory)} className="w-full bg-white/70 rounded px-2 py-1.5 text-xs border border-black/10">
                  {MENU_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <div className="space-y-1.5">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Ingredients</div>
                  {editIngs.map((ing, idx) => {
                    const incomplete = (ing.stockId && !(ing.qty > 0)) || (!ing.stockId && ing.qty > 0);
                    return (
                      <div key={idx} className={`grid grid-cols-3 gap-1.5 ${incomplete ? "ring-2 ring-[oklch(0.62_0.24_25)] rounded" : ""}`}>
                        <select value={ing.stockId} onChange={(e) => setEditIngs(editIngs.map((x, i) => i === idx ? { ...x, stockId: e.target.value } : x))} className="bg-white/70 rounded px-2 py-1 text-xs border border-black/10">
                          <option value="">select stock...</option>
                          {state.stock.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.unit})</option>)}
                        </select>
                        <input type="number" placeholder="qty" value={ing.qty} onChange={(e) => setEditIngs(editIngs.map((x, i) => i === idx ? { ...x, qty: +e.target.value } : x))} className="bg-white/70 rounded px-2 py-1 text-xs border border-black/10" />
                        <button onClick={() => setEditIngs(editIngs.filter((_, i) => i !== idx))} className="text-xs text-muted-foreground hover:text-[oklch(0.62_0.24_25)]">Remove</button>
                      </div>
                    );
                  })}
                  <button onClick={() => setEditIngs([...editIngs, { stockId: "", qty: 0 }])} className="text-xs px-2 py-1 rounded bg-black/5 border border-black/10">+ Ingredient</button>
                </div>
                {editErr && <div className="text-xs text-[oklch(0.62_0.24_25)] bg-[oklch(0.62_0.24_25/0.1)] rounded-lg p-2">{editErr}</div>}
                <div className="flex items-center gap-2 pt-1">
                  <button onClick={saveEdit} className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded bg-[oklch(0.78_0.2_155/0.2)] border border-[oklch(0.78_0.2_155/0.5)] text-[oklch(0.78_0.2_155)]"><Save className="w-3.5 h-3.5" /> Save</button>
                  <button onClick={() => { setEditingId(null); setEditErr(null); }} className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded bg-black/5 border border-black/10"><X className="w-3.5 h-3.5" /> Cancel</button>
                </div>
              </div>
            );
          }
          return (
            <div key={m.id} className="bg-white/60 rounded-lg p-4 border border-black/8">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-semibold">{m.name}</div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="font-mono text-xs text-[oklch(0.7_0.19_260)]">{fmtMoney(m.price)}</span>
                    <span className="text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded bg-black/5 text-muted-foreground">{m.category ?? "Extras"}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => beginEdit(m)} className="text-muted-foreground hover:text-[oklch(0.7_0.19_260)]"><Pencil className="w-4 h-4" /></button>
                  <button onClick={() => onDelete(m.id)} className="text-muted-foreground hover:text-[oklch(0.62_0.24_25)]"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
              <div className="mt-3 text-xs font-mono space-y-0.5 text-muted-foreground">
                {m.ingredients.map((ing) => {
                  const stk = state.stock.find((s) => s.id === ing.stockId);
                  return <div key={ing.stockId}>· {ing.qty}{stk?.unit ?? ""} {stk?.name ?? ing.stockId}</div>;
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function printReport(month: string, sessions: Session[], state: ReturnType<typeof useStore>["state"]) {
  const totalRev = sessions.reduce((a, s) => a + s.total, 0);
  const totalTime = sessions.reduce((a, s) => a + s.timeCost, 0);
  const totalOrders = sessions.reduce((a, s) => a + s.ordersCost, 0);
  const win = window.open("", "_blank", "width=900,height=1200");
  if (!win) return;
  win.document.write(`
<!DOCTYPE html><html><head><title>GLITCH Report ${month}</title>
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
<div class="sub">Monthly Report — ${month}</div>
<div class="totals">
  <div><span>Total Time Revenue</span><span>${totalTime.toFixed(2)} EGP</span></div>
  <div><span>Total Orders Revenue</span><span>${totalOrders.toFixed(2)} EGP</span></div>
  <div class="grand"><span>GRAND TOTAL</span><span>${totalRev.toFixed(2)} EGP</span></div>
  <div><span>Sessions</span><span>${sessions.length}</span></div>
</div>
<h3 style="margin-top:24px">Sessions</h3>
<table>
  <thead><tr><th>Room</th><th>Start</th><th>End</th><th>Time (EGP)</th><th>Orders (EGP)</th><th>Total</th></tr></thead>
  <tbody>
    ${sessions.map((s) => `<tr>
      <td>${s.roomName}</td>
      <td>${new Date(s.startedAt).toLocaleString()}</td>
      <td>${new Date(s.endedAt).toLocaleString()}</td>
      <td>${s.timeCost.toFixed(2)} EGP</td>
      <td>${s.ordersCost.toFixed(2)} EGP</td>
      <td><strong>${s.total.toFixed(2)} EGP</strong></td>
    </tr>`).join("")}
  </tbody>
</table>
<h3 style="margin-top:24px">Stock Snapshot</h3>
<table>
  <thead><tr><th>Item</th><th>Unit</th><th>Initial</th><th>Used</th><th>Remaining</th></tr></thead>
  <tbody>
    ${state.stock.map((s) => `<tr><td>${s.name}</td><td>${s.unit}</td><td>${s.initialStock}</td><td>${s.used}</td><td>${s.initialStock - s.used}</td></tr>`).join("")}
  </tbody>
</table>
<script>window.onload = () => setTimeout(() => { if (window.electronAPI) { window.electronAPI.printSilent({ deviceName: localStorage.getItem("glitch-preferred-printer") || "" }).catch(() => window.print()); } else { window.print(); } }, 300);</script>
</body></html>`);
  win.document.close();
}
