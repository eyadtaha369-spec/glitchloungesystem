import { useMemo, useState } from "react";
import { useStore, fmtMoney, isToday, monthKey, MENU_CATEGORIES, type MenuItem, type MenuCategory, type Session } from "@/lib/glitch-store";
import { Plus, Trash2, Download, DollarSign, TrendingUp, TrendingDown, Check, RotateCcw, Pencil, X, Save, AlertOctagon, History, PackagePlus, FileBarChart } from "lucide-react";

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
            <div className="text-2xl font-mono font-bold mt-1 text-[oklch(0.85_0.16_200)]">{fmtMoney(expectedToday)}</div>
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
                <TrendingDown className="w-6 h-6 text-[oklch(0.75_0.22_25)]" />
                <div>
                  <div className="text-2xl font-mono font-bold text-[oklch(0.75_0.22_25)]">{fmtMoney(discrepancy)}</div>
                  <div className="text-[10px] uppercase tracking-widest text-[oklch(0.75_0.22_25)]">Deficit · عجز</div>
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
      <StockTable />

      {/* Recipes / Menu */}
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
        <AlertOctagon className="w-5 h-5 text-[oklch(0.75_0.22_25)]" />
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
                  <button onClick={run} className="px-3 py-1.5 rounded-lg bg-[oklch(0.62_0.24_25/0.2)] border border-[oklch(0.62_0.24_25/0.5)] text-[oklch(0.75_0.22_25)]">Confirm</button>
                  <button onClick={() => setConfirmKey(null)} className="px-3 py-1.5 rounded-lg bg-black/5 border border-black/10">Cancel</button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmKey(b.key)}
                  className="text-xs px-3 py-2 rounded-lg bg-[oklch(0.62_0.24_25/0.1)] border border-[oklch(0.62_0.24_25/0.4)] text-[oklch(0.75_0.22_25)] hover:bg-[oklch(0.62_0.24_25/0.2)] transition"
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
<script>window.onload = () => setTimeout(() => window.print(), 300);</script>
</body></html>`);
  win.document.close();
}

function StockTable() {
  const { state, adjustStock, restockMaterial, updateRawMaterial, setActualStock } = useStore();
  const [adjustTarget, setAdjustTarget] = useState<{ id: string; name: string; unit: string } | null>(null);
  const [restockTarget, setRestockTarget] = useState<{ id: string; name: string; unit: string; unitCost: number } | null>(null);
  const [historyTarget, setHistoryTarget] = useState<{ id: string; name: string; unit: string } | null>(null);
  const [actualStockTarget, setActualStockTarget] = useState<{ id: string; name: string; unit: string; systemRemaining: number; input: string } | null>(null);
  const [editTarget, setEditTarget] = useState<{ id: string; name: string; unit: string; unitCost: number; minStock: number; remaining: number } | null>(null);
  const [editingCostId, setEditingCostId] = useState<string | null>(null);
  const [editingUnitId, setEditingUnitId] = useState<string | null>(null);
  const [unitInput, setUnitInput] = useState("");
  const [costInput, setCostInput] = useState("");

  const totalInventoryValue = state.stock.reduce((a, s) => a + s.totalValue, 0);

  return (
    <div className="glass rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold">Stock Inventory</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Computed from purchased batches (FIFO). Add materials on Setup, log real purchases on Procurement.
          </p>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Total Inventory Value</div>
          <div className="text-xl font-mono font-bold text-[oklch(0.78_0.2_155)]">{fmtMoney(totalInventoryValue)}</div>
        </div>
      </div>

      {state.stock.length === 0 ? (
        <div className="text-sm text-muted-foreground font-mono">No raw materials yet — add one on the Setup page.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-widest text-muted-foreground border-b border-black/8">
                <th className="text-left py-2 px-2">Item</th>
                <th className="text-left py-2 px-2">Unit</th>
                <th className="text-right py-2 px-2">Unit Cost</th>
                <th className="text-right py-2 px-2">Remaining</th>
                <th className="text-right py-2 px-2">Used Since Restock</th>
                <th className="text-right py-2 px-2">Stock Value</th>
                <th className="text-right py-2 px-2">Actual Stock<br /><span dir="rtl" className="normal-case font-normal opacity-70">المخزون الفعلي</span></th>
                <th className="text-right py-2 px-2">Min</th>
                <th className="py-2 px-2"></th>
              </tr>
            </thead>
            <tbody>
              {state.stock.map((s) => {
                const low = s.remaining < s.minStock || (s.initialStock > 0 && s.remaining < s.initialStock * 0.2);
                return (
                  <tr key={s.id} className="border-b border-black/8 hover:bg-black/5">
                    <td className="py-2 px-2 font-semibold">{s.name}</td>
                    <td className="py-2 px-2 font-mono text-xs text-muted-foreground">
                      {editingUnitId === s.id ? (
                        <div className="flex items-center gap-1">
                          <input
                            autoFocus value={unitInput}
                            onChange={(e) => setUnitInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && unitInput.trim()) { void updateRawMaterial(s.id, { unit: unitInput.trim() }); setEditingUnitId(null); }
                              if (e.key === "Escape") setEditingUnitId(null);
                            }}
                            className="w-16 bg-white/70 border border-black/10 rounded px-2 py-1 text-xs"
                          />
                          <button
                            onClick={() => { if (unitInput.trim()) { void updateRawMaterial(s.id, { unit: unitInput.trim() }); setEditingUnitId(null); } }}
                            className="text-[oklch(0.62_0.16_155)]"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setEditingUnitId(s.id); setUnitInput(s.unit); }}
                          className="hover:underline decoration-dotted"
                          title="Changing this only relabels the unit — existing recorded quantities are not converted"
                        >
                          {s.unit}
                        </button>
                      )}
                    </td>
                    <td className="py-2 px-2 text-right font-mono">
                      {editingCostId === s.id ? (
                        <div className="flex items-center justify-end gap-1">
                          <input
                            autoFocus type="number" step="0.01" value={costInput}
                            onChange={(e) => setCostInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") { void updateRawMaterial(s.id, { unitCost: parseFloat(costInput) || 0 }); setEditingCostId(null); }
                              if (e.key === "Escape") setEditingCostId(null);
                            }}
                            className="w-20 bg-white/70 border border-black/10 rounded px-2 py-1 text-xs text-right"
                          />
                          <button onClick={() => { void updateRawMaterial(s.id, { unitCost: parseFloat(costInput) || 0 }); setEditingCostId(null); }} className="text-[oklch(0.78_0.2_155)]"><Check className="w-3.5 h-3.5" /></button>
                        </div>
                      ) : (
                        <button onClick={() => { setEditingCostId(s.id); setCostInput(String(s.unitCost)); }} className="hover:underline decoration-dotted">
                          {fmtMoney(s.unitCost)}
                        </button>
                      )}
                    </td>
                    <td className={`py-2 px-2 text-right font-mono font-bold ${low ? "text-[oklch(0.75_0.22_25)]" : "text-[oklch(0.78_0.2_155)]"}`}>
                      {s.remaining} {low && "⚠"}
                    </td>
                    <td className="py-2 px-2 text-right font-mono text-muted-foreground">{s.usedSinceRestock}</td>
                    <td className="py-2 px-2 text-right font-mono">{fmtMoney(s.totalValue)}</td>
                    <td className="py-2 px-2 text-right">
                      <button
                        onClick={() => setActualStockTarget({ id: s.id, name: s.name, unit: s.unit, systemRemaining: s.remaining, input: s.actualStock !== null ? String(s.actualStock) : "" })}
                        className="font-mono hover:underline decoration-dotted"
                      >
                        {s.actualStock !== null ? `${s.actualStock} ${s.unit}` : <span className="text-muted-foreground">— set —</span>}
                      </button>
                      {s.variance !== null && s.variance !== 0 && (
                        <div className={`text-[10px] font-bold uppercase tracking-widest mt-0.5 ${s.variance < 0 ? "text-[oklch(0.58_0.22_25)]" : "text-[oklch(0.62_0.16_155)]"}`}>
                          {s.variance < 0 ? `${Math.abs(s.variance)} Deficit عجز` : `+${s.variance} Surplus`}
                        </div>
                      )}
                    </td>
                    <td className="py-2 px-2 text-right font-mono text-muted-foreground">{s.minStock}</td>
                    <td className="py-2 px-2 text-right whitespace-nowrap">
                      <button
                        onClick={() => setEditTarget({ id: s.id, name: s.name, unit: s.unit, unitCost: s.unitCost, minStock: s.minStock, remaining: s.remaining })}
                        className="text-[10px] uppercase tracking-widest px-2 py-1 rounded bg-[oklch(0.72_0.14_85/0.15)] border border-[oklch(0.72_0.14_85/0.4)] text-[oklch(0.72_0.14_85)] hover:bg-[oklch(0.72_0.14_85/0.25)] mr-1.5"
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
                        onClick={() => setAdjustTarget({ id: s.id, name: s.name, unit: s.unit })}
                        className="text-[10px] uppercase tracking-widest px-2 py-1 rounded bg-black/5 border border-black/10 hover:bg-black/8 text-muted-foreground hover:text-[#2b2416] mr-1.5"
                        title="Waste / Correction / Opening Balance"
                      >
                        Adjust
                      </button>
                      <button
                        onClick={() => setRestockTarget({ id: s.id, name: s.name, unit: s.unit, unitCost: s.unitCost })}
                        className="text-[10px] uppercase tracking-widest px-2 py-1 rounded bg-[oklch(0.7_0.19_260/0.15)] border border-[oklch(0.7_0.19_260/0.4)] text-[oklch(0.85_0.16_200)] hover:bg-[oklch(0.7_0.19_260/0.25)]"
                      >
                        <PackagePlus className="w-3.5 h-3.5 inline mr-1" />Restock
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {adjustTarget && (
        <AdjustStockModal target={adjustTarget} adjustStock={adjustStock} onClose={() => setAdjustTarget(null)} />
      )}
      {restockTarget && (
        <RestockModal target={restockTarget} currentRemaining={state.stock.find((s) => s.id === restockTarget.id)?.remaining ?? 0} restockMaterial={restockMaterial} onClose={() => setRestockTarget(null)} />
      )}
      {historyTarget && <MaterialHistoryModal target={historyTarget} onClose={() => setHistoryTarget(null)} />}
      {actualStockTarget && (
        <ActualStockModal target={actualStockTarget} setActualStock={setActualStock} onClose={() => setActualStockTarget(null)} />
      )}
      {editTarget && (
        <EditMaterialModal target={editTarget} updateRawMaterial={updateRawMaterial} adjustStock={adjustStock} onClose={() => setEditTarget(null)} />
      )}
    </div>
  );
}

function EditMaterialModal({ target, updateRawMaterial, adjustStock, onClose }: {
  target: { id: string; name: string; unit: string; unitCost: number; minStock: number; remaining: number };
  updateRawMaterial: ReturnType<typeof useStore>["updateRawMaterial"];
  adjustStock: ReturnType<typeof useStore>["adjustStock"];
  onClose: () => void;
}) {
  const [name, setName] = useState(target.name);
  const [unit, setUnit] = useState(target.unit);
  const [unitCost, setUnitCost] = useState(String(target.unitCost));
  const [minStock, setMinStock] = useState(String(target.minStock));
  const [quantity, setQuantity] = useState(String(target.remaining));
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const newQty = parseFloat(quantity);
  const qtyDelta = isNaN(newQty) ? 0 : Math.round((newQty - target.remaining) * 100) / 100;
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

      if (Object.keys(patch).length > 0) {
        await updateRawMaterial(target.id, patch);
      }
      if (qtyDelta !== 0) {
        const res = await adjustStock(target.id, qtyDelta, "correction", "Edited via Inventory Edit modal (was " + target.remaining + ", corrected to " + newQty + ")");
        if (!res.ok) { setErr(res.error ?? "Quantity correction failed"); return; }
      }
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md glass-strong rounded-2xl border border-[oklch(0.72_0.14_85/0.5)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-black/8">
          <div className="font-mono uppercase tracking-widest text-xs text-[oklch(0.72_0.14_85)]">Edit Inventory Entry</div>
          <button onClick={onClose} className="text-muted-foreground hover:text-[#2b2416]"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="text-xs uppercase tracking-widest text-muted-foreground">Raw Material Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs uppercase tracking-widest text-muted-foreground">Current Stock Quantity</label>
              <input type="number" step="0.01" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm font-mono" />
            </div>
            <div>
              <label className="text-xs uppercase tracking-widest text-muted-foreground">Unit of Measurement</label>
              <input value={unit} onChange={(e) => setUnit(e.target.value)} className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs uppercase tracking-widest text-muted-foreground">Unit Cost</label>
              <input type="number" step="0.01" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm font-mono" />
            </div>
            <div>
              <label className="text-xs uppercase tracking-widest text-muted-foreground">Min Alert Threshold</label>
              <input type="number" step="0.01" value={minStock} onChange={(e) => setMinStock(e.target.value)} className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm font-mono" />
            </div>
          </div>

          <div className="rounded-lg bg-black/5 border border-black/8 p-3 text-xs font-mono space-y-1">
            {qtyDelta !== 0 && !isNaN(newQty) && (
              <div className={`flex justify-between font-bold ${qtyDelta < 0 ? "text-[oklch(0.58_0.22_25)]" : "text-[oklch(0.62_0.16_155)]"}`}>
                <span>Quantity Correction</span><span>{qtyDelta > 0 ? "+" : ""}{qtyDelta} {unit}</span>
              </div>
            )}
            <div className="flex justify-between text-muted-foreground">
              <span>New Stock Valuation</span><span>{fmtMoney(valuationPreview)}</span>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Name/unit/cost/min-alert changes and any quantity correction are recorded separately in the Audit Log with your username, timestamp, and before/after values.
          </p>
          {err && <div className="text-xs text-[oklch(0.58_0.22_25)]">{err}</div>}
        </div>
        <div className="p-4 border-t border-black/8 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm bg-black/5 hover:bg-black/8 border border-black/10">Cancel</button>
          <button
            onClick={submit}
            disabled={submitting}
            className="px-4 py-2 rounded-lg text-sm bg-gradient-to-r from-[oklch(0.72_0.14_85)] to-[oklch(0.8_0.11_90)] text-[#2b2416] font-bold disabled:opacity-60"
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
                <div className={`text-sm font-bold text-center ${variance < 0 ? "text-[oklch(0.58_0.22_25)]" : "text-[oklch(0.62_0.16_155)]"}`}>
                  {variance < 0 ? `${Math.abs(variance)} ${target.unit} Deficit (عجز)` : `+${variance} ${target.unit} Surplus`}
                </div>
              )}
              {err && <div className="text-xs text-[oklch(0.58_0.22_25)]">{err}</div>}
            </div>
            <div className="p-4 border-t border-black/8 flex justify-end gap-2">
              <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm bg-black/5 hover:bg-black/8 border border-black/10">Cancel</button>
              <button
                onClick={() => setConfirming(true)}
                disabled={!valid}
                className="px-4 py-2 rounded-lg text-sm bg-[oklch(0.72_0.14_85/0.25)] border border-[oklch(0.72_0.14_85/0.6)] font-semibold disabled:opacity-50"
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
                <p className={`text-sm font-bold ${variance < 0 ? "text-[oklch(0.58_0.22_25)]" : "text-[oklch(0.62_0.16_155)]"}`}>
                  This will record a {variance < 0 ? "deficit" : "surplus"} of {Math.abs(variance)} {target.unit}.
                </p>
              ) : (
                <p className="text-sm text-[oklch(0.62_0.16_155)]">This matches the system figure exactly — no variance.</p>
              )}
              {err && <div className="text-xs text-[oklch(0.58_0.22_25)]">{err}</div>}
            </div>
            <div className="p-4 border-t border-black/8 flex justify-end gap-2">
              <button onClick={() => setConfirming(false)} className="px-4 py-2 rounded-lg text-sm bg-black/5 hover:bg-black/8 border border-black/10">Back</button>
              <button
                onClick={confirmAndSave}
                disabled={submitting}
                className="px-4 py-2 rounded-lg text-sm bg-gradient-to-r from-[oklch(0.72_0.14_85)] to-[oklch(0.8_0.11_90)] text-[#2b2416] font-bold disabled:opacity-60"
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

function AdjustStockModal({ target, adjustStock, onClose }: {
  target: { id: string; name: string; unit: string };
  adjustStock: ReturnType<typeof useStore>["adjustStock"];
  onClose: () => void;
}) {
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState<"waste" | "correction" | "opening_balance">("correction");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    const deltaQty = parseFloat(delta);
    if (!deltaQty) { setErr("Enter a non-zero amount (negative to remove, positive to add)."); return; }
    setSubmitting(true);
    setErr(null);
    try {
      const res = await adjustStock(target.id, deltaQty, reason, note || undefined);
      if (!res.ok) { setErr(res.error ?? "Adjustment failed"); return; }
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-sm glass-strong rounded-2xl border border-black/10" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-black/10">
          <div className="font-mono uppercase tracking-widest text-xs text-muted-foreground">Adjust {target.name}</div>
          <button onClick={onClose} className="text-muted-foreground hover:text-[#2b2416]"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="text-xs uppercase tracking-widest text-muted-foreground">
              Adjustment ({target.unit}) — negative removes, positive adds
            </label>
            <input
              type="number" step="0.01" autoFocus value={delta}
              onChange={(e) => setDelta(e.target.value)}
              placeholder="e.g. -50 or 100"
              className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm font-mono"
            />
          </div>
          <div>
            <label className="text-xs uppercase tracking-widest text-muted-foreground">Reason</label>
            <select value={reason} onChange={(e) => setReason(e.target.value as typeof reason)} className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm">
              <option value="correction">Stock Count Correction</option>
              <option value="waste">Waste</option>
              <option value="opening_balance">Opening Balance</option>
            </select>
          </div>
          <div>
            <label className="text-xs uppercase tracking-widest text-muted-foreground">Note (optional)</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm" />
          </div>
          {reason === "waste" && (
            <p className="text-[11px] text-[oklch(0.82_0.16_85)]">Waste removals post their cost to the financial ledger under Operational Waste / Damaged Goods.</p>
          )}
          {err && <div className="text-xs text-[oklch(0.75_0.22_25)]">{err}</div>}
        </div>
        <div className="p-4 border-t border-black/10 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm bg-black/5 hover:bg-black/8 border border-black/10">Cancel</button>
          <button onClick={submit} disabled={submitting} className="px-4 py-2 rounded-lg text-sm bg-[oklch(0.7_0.19_260/0.2)] border border-[oklch(0.7_0.19_260/0.5)] font-semibold disabled:opacity-60">
            {submitting ? "Saving..." : "Apply Adjustment"}
          </button>
        </div>
      </div>
    </div>
  );
}

function RestockModal({ target, currentRemaining, restockMaterial, onClose }: {
  target: { id: string; name: string; unit: string; unitCost: number };
  currentRemaining: number;
  restockMaterial: ReturnType<typeof useStore>["restockMaterial"];
  onClose: () => void;
}) {
  const [qtyAdded, setQtyAdded] = useState("");
  const [unitCost, setUnitCost] = useState(String(target.unitCost));
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const addedNum = parseFloat(qtyAdded) || 0;
  const newTotal = currentRemaining + addedNum;

  const submit = async () => {
    if (addedNum <= 0) { setErr("Enter a quantity greater than zero."); return; }
    setSubmitting(true);
    setErr(null);
    try {
      const res = await restockMaterial(target.id, addedNum, parseFloat(unitCost) || 0);
      if (!res.ok) { setErr(res.error ?? "Restock failed"); return; }
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-sm glass-strong rounded-2xl border border-[oklch(0.7_0.19_260/0.4)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-black/10">
          <div className="font-mono uppercase tracking-widest text-xs text-[oklch(0.85_0.16_200)]">Restock {target.name}</div>
          <button onClick={onClose} className="text-muted-foreground hover:text-[#2b2416]"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="text-xs uppercase tracking-widest text-muted-foreground">New Quantity ({target.unit})</label>
            <input
              type="number" step="0.01" autoFocus value={qtyAdded}
              onChange={(e) => setQtyAdded(e.target.value)}
              placeholder="e.g. 5000"
              className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm font-mono"
            />
          </div>
          <div>
            <label className="text-xs uppercase tracking-widest text-muted-foreground">Unit Cost ({target.unit})</label>
            <input
              type="number" step="0.01" value={unitCost}
              onChange={(e) => setUnitCost(e.target.value)}
              className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm font-mono"
            />
          </div>

          {/* Live carryover math */}
          <div className="rounded-lg bg-white/60 border border-black/8 p-3 text-xs font-mono space-y-1">
            <div className="flex justify-between"><span className="text-muted-foreground">Remaining (carryover)</span><span>{currentRemaining} {target.unit}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">New Restock</span><span>+{addedNum} {target.unit}</span></div>
            <div className="flex justify-between border-t border-black/10 pt-1 mt-1 font-bold text-[oklch(0.78_0.2_155)]">
              <span>New Total Stock</span><span>{newTotal} {target.unit}</span>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            The old remaining stock is folded into a single fresh batch — "used since restock" resets to 0 from this point.
          </p>
          {err && <div className="text-xs text-[oklch(0.75_0.22_25)]">{err}</div>}
        </div>
        <div className="p-4 border-t border-black/10 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm bg-black/5 hover:bg-black/8 border border-black/10">Cancel</button>
          <button onClick={submit} disabled={submitting} className="px-4 py-2 rounded-lg text-sm bg-[oklch(0.7_0.19_260/0.2)] border border-[oklch(0.7_0.19_260/0.5)] font-semibold disabled:opacity-60">
            {submitting ? "Saving..." : "Confirm Restock"}
          </button>
        </div>
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
          <div className="flex items-center gap-2 font-mono uppercase tracking-widest text-xs text-[oklch(0.85_0.16_200)]">
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

  const save = () => {
    if (!id || !name) return;
    onAdd({ id, name, price, category, ingredients: ings.filter((i) => i.stockId && i.qty > 0) });
    setId(""); setName(""); setPrice(0); setCategory(MENU_CATEGORIES[0]); setIngs([]); setShowForm(false);
  };

  const beginEdit = (m: MenuItem) => {
    setEditingId(m.id);
    setEditName(m.name);
    setEditPrice(m.price);
    setEditCategory(m.category ?? MENU_CATEGORIES[0]);
    setEditIngs(m.ingredients.map((i) => ({ ...i })));
  };
  const saveEdit = () => {
    if (!editingId || !editName) return;
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
            {ings.map((ing, idx) => (
              <div key={idx} className="grid grid-cols-3 gap-2">
                <select value={ing.stockId} onChange={(e) => setIngs(ings.map((x, i) => i === idx ? { ...x, stockId: e.target.value } : x))} className="bg-white/70 rounded px-2 py-1.5 text-sm border border-black/10">
                  <option value="">select stock...</option>
                  {state.stock.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.unit})</option>)}
                </select>
                <input type="number" placeholder="qty per unit" value={ing.qty} onChange={(e) => setIngs(ings.map((x, i) => i === idx ? { ...x, qty: +e.target.value } : x))} className="bg-white/70 rounded px-2 py-1.5 text-sm border border-black/10" />
                <button onClick={() => setIngs(ings.filter((_, i) => i !== idx))} className="text-xs text-muted-foreground hover:text-[oklch(0.75_0.22_25)]">Remove</button>
              </div>
            ))}
            <button onClick={() => setIngs([...ings, { stockId: "", qty: 0 }])} className="text-xs px-3 py-1.5 rounded bg-black/5 border border-black/10">+ Ingredient</button>
          </div>
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
                  {editIngs.map((ing, idx) => (
                    <div key={idx} className="grid grid-cols-3 gap-1.5">
                      <select value={ing.stockId} onChange={(e) => setEditIngs(editIngs.map((x, i) => i === idx ? { ...x, stockId: e.target.value } : x))} className="bg-white/70 rounded px-2 py-1 text-xs border border-black/10">
                        <option value="">select stock...</option>
                        {state.stock.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.unit})</option>)}
                      </select>
                      <input type="number" placeholder="qty" value={ing.qty} onChange={(e) => setEditIngs(editIngs.map((x, i) => i === idx ? { ...x, qty: +e.target.value } : x))} className="bg-white/70 rounded px-2 py-1 text-xs border border-black/10" />
                      <button onClick={() => setEditIngs(editIngs.filter((_, i) => i !== idx))} className="text-xs text-muted-foreground hover:text-[oklch(0.75_0.22_25)]">Remove</button>
                    </div>
                  ))}
                  <button onClick={() => setEditIngs([...editIngs, { stockId: "", qty: 0 }])} className="text-xs px-2 py-1 rounded bg-black/5 border border-black/10">+ Ingredient</button>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <button onClick={saveEdit} className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded bg-[oklch(0.78_0.2_155/0.2)] border border-[oklch(0.78_0.2_155/0.5)] text-[oklch(0.78_0.2_155)]"><Save className="w-3.5 h-3.5" /> Save</button>
                  <button onClick={() => setEditingId(null)} className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded bg-black/5 border border-black/10"><X className="w-3.5 h-3.5" /> Cancel</button>
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
                    <span className="font-mono text-xs text-[oklch(0.85_0.16_200)]">{fmtMoney(m.price)}</span>
                    <span className="text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded bg-black/5 text-muted-foreground">{m.category ?? "Extras"}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => beginEdit(m)} className="text-muted-foreground hover:text-[oklch(0.85_0.16_200)]"><Pencil className="w-4 h-4" /></button>
                  <button onClick={() => onDelete(m.id)} className="text-muted-foreground hover:text-[oklch(0.75_0.22_25)]"><Trash2 className="w-4 h-4" /></button>
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
<script>window.onload = () => setTimeout(() => window.print(), 300);</script>
</body></html>`);
  win.document.close();
}
