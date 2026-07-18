import { useMemo, useState } from "react";
import { useStore, fmtMoney, isToday, monthKey, type MenuItem, type Session } from "@/lib/glitch-store";
import { Plus, Trash2, Download, DollarSign, TrendingUp, TrendingDown, Check, RotateCcw, Pencil, X, Save } from "lucide-react";

export function InventoryPage() {
  const {
    state, updateStockItem, addStockItem, deleteStockItem, restockAll,
    addMenuItem, updateMenuItem, deleteMenuItem, setActualCash,
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

      {/* Cash reconciliation */}
      <div className="glass rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-[oklch(0.78_0.2_155)]" />
            <h2 className="text-lg font-semibold">Cash Reconciliation — Today</h2>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-black/30 rounded-lg p-4 border border-white/5">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Expected</div>
            <div className="text-2xl font-mono font-bold mt-1 text-[oklch(0.85_0.16_200)]">{fmtMoney(expectedToday)}</div>
          </div>
          <div className="bg-black/30 rounded-lg p-4 border border-white/5">
            <label className="text-xs uppercase tracking-widest text-muted-foreground">Actual In Drawer</label>
            <input
              type="number"
              step="0.01"
              value={state.actualCashInput}
              onChange={(e) => setActualCash(parseFloat(e.target.value) || 0)}
              className="mt-1 w-full bg-transparent text-2xl font-mono font-bold outline-none text-white"
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
      <StockTable
        onUpdate={updateStockItem}
        onAdd={addStockItem}
        onDelete={deleteStockItem}
        onRestockAll={restockAll}
      />

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
              <div key={s.name} className="bg-black/30 rounded-lg p-4 border border-white/5">
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
              className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm font-mono"
            >
              {months.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <button
              onClick={downloadReport}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-[oklch(0.7_0.19_260)] to-[oklch(0.65_0.24_305)] text-white text-sm font-semibold shadow-[0_0_20px_oklch(0.7_0.19_260/0.4)] hover:shadow-[0_0_30px_oklch(0.7_0.19_260/0.6)] transition"
            >
              <Download className="w-4 h-4" /> Download Report
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StockTable({ onUpdate, onAdd, onDelete, onRestockAll }: {
  onUpdate: ReturnType<typeof useStore>["updateStockItem"];
  onAdd: ReturnType<typeof useStore>["addStockItem"];
  onDelete: ReturnType<typeof useStore>["deleteStockItem"];
  onRestockAll: ReturnType<typeof useStore>["restockAll"];
}) {
  const { state } = useStore();
  const [showAdd, setShowAdd] = useState(false);
  const [confirmRestock, setConfirmRestock] = useState(false);
  const [form, setForm] = useState({ id: "", name: "", unit: "pcs", initialStock: 0, minStock: 0 });

  const doRestock = () => {
    onRestockAll();
    setConfirmRestock(false);
  };

  return (
    <div className="glass rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Stock Inventory</h2>
        <div className="flex items-center gap-2">
          {confirmRestock ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Reset all "Used" to 0?</span>
              <button onClick={doRestock} className="px-3 py-1.5 rounded-lg bg-[oklch(0.78_0.2_155/0.2)] border border-[oklch(0.78_0.2_155/0.5)] text-[oklch(0.78_0.2_155)]">Confirm</button>
              <button onClick={() => setConfirmRestock(false)} className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10">Cancel</button>
            </div>
          ) : (
            <button onClick={() => setConfirmRestock(true)} className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10">
              <RotateCcw className="w-4 h-4" /> Restock All
            </button>
          )}
          <button onClick={() => setShowAdd((v) => !v)} className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10">
            <Plus className="w-4 h-4" /> Add Item
          </button>
        </div>
      </div>

      {showAdd && (
        <div className="mb-4 p-4 rounded-lg bg-black/30 border border-white/5 grid grid-cols-2 md:grid-cols-6 gap-2">
          <input placeholder="id" value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} className="col-span-1 bg-black/40 rounded px-2 py-1.5 text-sm border border-white/10" />
          <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="col-span-2 bg-black/40 rounded px-2 py-1.5 text-sm border border-white/10" />
          <input placeholder="unit" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} className="bg-black/40 rounded px-2 py-1.5 text-sm border border-white/10" />
          <input type="number" placeholder="initial" value={form.initialStock} onChange={(e) => setForm({ ...form, initialStock: +e.target.value })} className="bg-black/40 rounded px-2 py-1.5 text-sm border border-white/10" />
          <input type="number" placeholder="min" value={form.minStock} onChange={(e) => setForm({ ...form, minStock: +e.target.value })} className="bg-black/40 rounded px-2 py-1.5 text-sm border border-white/10" />
          <button
            className="col-span-2 md:col-span-6 py-1.5 rounded bg-[oklch(0.7_0.19_260/0.2)] border border-[oklch(0.7_0.19_260/0.5)] text-sm"
            onClick={() => {
              if (!form.id || !form.name) return;
              onAdd(form);
              setForm({ id: "", name: "", unit: "pcs", initialStock: 0, minStock: 0 });
              setShowAdd(false);
            }}
          >Save Item</button>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-widest text-muted-foreground border-b border-white/5">
              <th className="text-left py-2 px-2">Item</th>
              <th className="text-left py-2 px-2">Unit</th>
              <th className="text-right py-2 px-2">Initial</th>
              <th className="text-right py-2 px-2">Used</th>
              <th className="text-right py-2 px-2">Remaining</th>
              <th className="text-right py-2 px-2">Min</th>
              <th className="py-2 px-2"></th>
            </tr>
          </thead>
          <tbody>
            {state.stock.map((s) => {
              const remaining = s.initialStock - s.used;
              const low = remaining < s.minStock || remaining < s.initialStock * 0.2;
              return (
                <tr key={s.id} className="border-b border-white/5 hover:bg-white/5">
                  <td className="py-2 px-2 font-semibold">{s.name}</td>
                  <td className="py-2 px-2 font-mono text-xs text-muted-foreground">{s.unit}</td>
                  <td className="py-2 px-2 text-right">
                    <input
                      type="number"
                      value={s.initialStock}
                      onChange={(e) => onUpdate(s.id, { initialStock: +e.target.value })}
                      className="w-24 bg-transparent text-right font-mono outline-none focus:bg-black/40 rounded px-1"
                    />
                  </td>
                  <td className="py-2 px-2 text-right font-mono">{s.used}</td>
                  <td className={`py-2 px-2 text-right font-mono font-bold ${low ? "text-[oklch(0.75_0.22_25)]" : "text-[oklch(0.78_0.2_155)]"}`}>
                    {remaining} {low && "⚠"}
                  </td>
                  <td className="py-2 px-2 text-right">
                    <input
                      type="number"
                      value={s.minStock}
                      onChange={(e) => onUpdate(s.id, { minStock: +e.target.value })}
                      className="w-20 bg-transparent text-right font-mono outline-none focus:bg-black/40 rounded px-1"
                    />
                  </td>
                  <td className="py-2 px-2 text-right">
                    <button onClick={() => onDelete(s.id)} className="text-muted-foreground hover:text-[oklch(0.75_0.22_25)]"><Trash2 className="w-4 h-4" /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
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
  const [ings, setIngs] = useState<{ stockId: string; qty: number }[]>([]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPrice, setEditPrice] = useState(0);
  const [editIngs, setEditIngs] = useState<{ stockId: string; qty: number }[]>([]);

  const save = () => {
    if (!id || !name) return;
    onAdd({ id, name, price, ingredients: ings.filter((i) => i.stockId && i.qty > 0) });
    setId(""); setName(""); setPrice(0); setIngs([]); setShowForm(false);
  };

  const beginEdit = (m: MenuItem) => {
    setEditingId(m.id);
    setEditName(m.name);
    setEditPrice(m.price);
    setEditIngs(m.ingredients.map((i) => ({ ...i })));
  };
  const saveEdit = () => {
    if (!editingId || !editName) return;
    onUpdate(editingId, { name: editName, price: editPrice, ingredients: editIngs.filter((i) => i.stockId && i.qty > 0) });
    setEditingId(null);
  };

  return (
    <div className="glass rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Menu &amp; Recipes</h2>
        <button onClick={() => setShowForm((v) => !v)} className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10">
          <Plus className="w-4 h-4" /> Add Menu Item
        </button>
      </div>

      {showForm && (
        <div className="mb-4 p-4 rounded-lg bg-black/30 border border-white/5 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <input placeholder="id (e.g. cappuccino)" value={id} onChange={(e) => setId(e.target.value)} className="bg-black/40 rounded px-3 py-2 text-sm border border-white/10" />
            <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} className="bg-black/40 rounded px-3 py-2 text-sm border border-white/10" />
            <input type="number" step="0.5" placeholder="Price" value={price} onChange={(e) => setPrice(+e.target.value)} className="bg-black/40 rounded px-3 py-2 text-sm border border-white/10" />
          </div>
          <div className="space-y-2">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Ingredients</div>
            {ings.map((ing, idx) => (
              <div key={idx} className="grid grid-cols-3 gap-2">
                <select value={ing.stockId} onChange={(e) => setIngs(ings.map((x, i) => i === idx ? { ...x, stockId: e.target.value } : x))} className="bg-black/40 rounded px-2 py-1.5 text-sm border border-white/10">
                  <option value="">select stock...</option>
                  {state.stock.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.unit})</option>)}
                </select>
                <input type="number" placeholder="qty per unit" value={ing.qty} onChange={(e) => setIngs(ings.map((x, i) => i === idx ? { ...x, qty: +e.target.value } : x))} className="bg-black/40 rounded px-2 py-1.5 text-sm border border-white/10" />
                <button onClick={() => setIngs(ings.filter((_, i) => i !== idx))} className="text-xs text-muted-foreground hover:text-[oklch(0.75_0.22_25)]">Remove</button>
              </div>
            ))}
            <button onClick={() => setIngs([...ings, { stockId: "", qty: 0 }])} className="text-xs px-3 py-1.5 rounded bg-white/5 border border-white/10">+ Ingredient</button>
          </div>
          <button onClick={save} className="py-2 px-4 rounded bg-[oklch(0.7_0.19_260/0.2)] border border-[oklch(0.7_0.19_260/0.5)] text-sm">Save Menu Item</button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {state.menu.map((m) => {
          const isEditing = editingId === m.id;
          if (isEditing) {
            return (
              <div key={m.id} className="bg-black/30 rounded-lg p-4 border border-[oklch(0.7_0.19_260/0.5)] space-y-2">
                <input value={editName} onChange={(e) => setEditName(e.target.value)} className="w-full bg-black/40 rounded px-2 py-1.5 text-sm border border-white/10 font-semibold" placeholder="Name" />
                <input type="number" step="0.5" value={editPrice} onChange={(e) => setEditPrice(+e.target.value)} className="w-full bg-black/40 rounded px-2 py-1.5 text-sm border border-white/10 font-mono" placeholder="Price" />
                <div className="space-y-1.5">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Ingredients</div>
                  {editIngs.map((ing, idx) => (
                    <div key={idx} className="grid grid-cols-3 gap-1.5">
                      <select value={ing.stockId} onChange={(e) => setEditIngs(editIngs.map((x, i) => i === idx ? { ...x, stockId: e.target.value } : x))} className="bg-black/40 rounded px-2 py-1 text-xs border border-white/10">
                        <option value="">select stock...</option>
                        {state.stock.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.unit})</option>)}
                      </select>
                      <input type="number" placeholder="qty" value={ing.qty} onChange={(e) => setEditIngs(editIngs.map((x, i) => i === idx ? { ...x, qty: +e.target.value } : x))} className="bg-black/40 rounded px-2 py-1 text-xs border border-white/10" />
                      <button onClick={() => setEditIngs(editIngs.filter((_, i) => i !== idx))} className="text-xs text-muted-foreground hover:text-[oklch(0.75_0.22_25)]">Remove</button>
                    </div>
                  ))}
                  <button onClick={() => setEditIngs([...editIngs, { stockId: "", qty: 0 }])} className="text-xs px-2 py-1 rounded bg-white/5 border border-white/10">+ Ingredient</button>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <button onClick={saveEdit} className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded bg-[oklch(0.78_0.2_155/0.2)] border border-[oklch(0.78_0.2_155/0.5)] text-[oklch(0.78_0.2_155)]"><Save className="w-3.5 h-3.5" /> Save</button>
                  <button onClick={() => setEditingId(null)} className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded bg-white/5 border border-white/10"><X className="w-3.5 h-3.5" /> Cancel</button>
                </div>
              </div>
            );
          }
          return (
            <div key={m.id} className="bg-black/30 rounded-lg p-4 border border-white/5">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-semibold">{m.name}</div>
                  <div className="font-mono text-xs text-[oklch(0.85_0.16_200)] mt-0.5">{fmtMoney(m.price)}</div>
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
  <div><span>Total Time Revenue</span><span>$${totalTime.toFixed(2)}</span></div>
  <div><span>Total Orders Revenue</span><span>$${totalOrders.toFixed(2)}</span></div>
  <div class="grand"><span>GRAND TOTAL</span><span>$${totalRev.toFixed(2)}</span></div>
  <div><span>Sessions</span><span>${sessions.length}</span></div>
</div>
<h3 style="margin-top:24px">Sessions</h3>
<table>
  <thead><tr><th>Room</th><th>Start</th><th>End</th><th>Time $</th><th>Orders $</th><th>Total</th></tr></thead>
  <tbody>
    ${sessions.map((s) => `<tr>
      <td>${s.roomName}</td>
      <td>${new Date(s.startedAt).toLocaleString()}</td>
      <td>${new Date(s.endedAt).toLocaleString()}</td>
      <td>$${s.timeCost.toFixed(2)}</td>
      <td>$${s.ordersCost.toFixed(2)}</td>
      <td><strong>$${s.total.toFixed(2)}</strong></td>
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
