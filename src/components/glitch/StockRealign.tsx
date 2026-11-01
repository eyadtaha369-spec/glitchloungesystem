import { useEffect, useMemo, useState } from "react";
import { X, Scale, History } from "lucide-react";
import { useStore, fmtMoney } from "@/lib/glitch-store";
import type { StockTrace } from "@/backend/finance";
import { fmtQty } from "@/lib/stock-entry";

// Admin-only "Stock Re-alignment": type what is ACTUALLY on the shelf for
// each material; saving makes the system balance equal that count exactly
// (batches adjusted FIFO), logs INVENTORY_AUDIT_ADJUSTMENT per material,
// and from then on every POS sale / recipe deduction starts from it.
export function StockRealignModal({ onClose }: { onClose: () => void }) {
  const { state, realignStock } = useStore();
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [note, setNote] = useState("");
  const [ack, setAck] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  const rows = state.stock.filter((s) => s.name.toLowerCase().includes(search.trim().toLowerCase()));
  const entered = state.stock
    .map((s) => ({ s, raw: counts[s.id] }))
    .filter((r) => r.raw !== undefined && r.raw.trim() !== "");
  const invalid = entered.filter((r) => !isFinite(Number(r.raw)) || Number(r.raw) < 0);
  const changes = entered.filter((r) => isFinite(Number(r.raw)) && Math.abs(Number(r.raw) - r.s.systemBalance) > 1e-9);
  const netValue = changes.reduce((a, r) => a + (Number(r.raw) - r.s.systemBalance) * r.s.unitCost, 0);

  const save = async () => {
    setErr(null);
    if (entered.length === 0) { setErr("Enter at least one physical count."); return; }
    if (invalid.length > 0) { setErr(`Fix the invalid count for ${invalid[0].s.name}.`); return; }
    if (!note.trim()) { setErr("Add a short audit note (e.g. the date of the physical count)."); return; }
    setSaving(true);
    const res = await realignStock(entered.map((r) => ({ materialId: r.s.id, actualStock: Number(r.raw) })), note.trim());
    setSaving(false);
    if (!res.ok) { setErr(res.error ?? "Could not save the counts."); return; }
    setDone(res.adjusted ?? entered.length);
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={() => !saving && onClose()}>
      <div className="w-full max-w-3xl max-h-[90vh] flex flex-col glass-strong rounded-2xl border border-black/10 bg-white" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-black/10">
          <div className="flex items-center gap-2 font-mono uppercase tracking-widest text-xs font-bold"><Scale className="w-4 h-4" /> Stock Re-alignment / إعادة ضبط المخزون</div>
          <button onClick={onClose} disabled={saving}><X className="w-4 h-4" /></button>
        </div>
        {done !== null ? (
          <div className="p-6 text-center space-y-3">
            <p className="text-base font-semibold">Done — {done} material(s) now match your physical count.</p>
            <p className="text-sm text-muted-foreground">These numbers are the new starting point for every POS order and recipe deduction from now on. Each change was logged as INVENTORY_AUDIT_ADJUSTMENT.</p>
            <button onClick={onClose} className="px-4 py-2 rounded-lg bg-[#2b2416] text-white text-sm font-semibold">Close</button>
          </div>
        ) : (
          <>
            <div className="p-4 space-y-3 overflow-y-auto">
              <p className="text-xs text-muted-foreground">
                Type the real quantity you counted, in each material's own unit. Leave a row empty to leave it untouched. Saving <b>overwrites the system balance</b> with your count.
              </p>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search material..." className="w-full bg-white border border-black/15 rounded-lg px-3 py-2 text-sm" />
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-widest text-muted-foreground border-b border-black/10">
                    <th className="text-left py-1.5 px-2">Material</th>
                    <th className="text-right py-1.5 px-2">System now</th>
                    <th className="text-right py-1.5 px-2">Physical count</th>
                    <th className="text-right py-1.5 px-2">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => {
                    const raw = counts[s.id] ?? "";
                    const n = Number(raw);
                    const has = raw.trim() !== "";
                    const bad = has && (!isFinite(n) || n < 0);
                    const diff = has && !bad ? n - s.systemBalance : null;
                    return (
                      <tr key={s.id} className="border-b border-black/8">
                        <td className="py-1.5 px-2 font-semibold">{s.name} <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-black/10 border border-black/20 ml-1">{s.unit}</span></td>
                        <td className="py-1.5 px-2 text-right font-mono text-muted-foreground">{fmtQty(s.systemBalance)}</td>
                        <td className="py-1.5 px-2 text-right">
                          <input type="number" inputMode="decimal" min="0" step="any" value={raw} onChange={(e) => setCounts({ ...counts, [s.id]: e.target.value })} className={`w-28 text-right font-mono bg-white border-2 rounded-lg px-2 py-1 ${bad ? "border-red-500" : "border-blue-300"}`} />
                        </td>
                        <td className={`py-1.5 px-2 text-right font-mono ${diff === null ? "text-muted-foreground" : diff < 0 ? "text-red-600" : diff > 0 ? "text-green-700" : ""}`}>
                          {diff === null ? "—" : diff > 0 ? `+${fmtQty(diff)}` : fmtQty(diff)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="p-4 border-t border-black/10 space-y-2">
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Audit note (required) — e.g. Physical count, 1 Nov" className="w-full bg-white border border-black/15 rounded-lg px-3 py-2 text-sm" />
              <p className="text-xs font-mono">
                {entered.length} counted · {changes.length} will change · value impact <b className={netValue < 0 ? "text-red-600" : "text-green-700"}>{fmtMoney(netValue)}</b>
              </p>
              <label className="flex items-start gap-2 text-xs font-semibold cursor-pointer">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 w-4 h-4" />
                I understand this replaces the system stock with my physical count and becomes the new baseline for all future sales.
              </label>
              {err && <p className="text-xs font-semibold text-red-700">{err}</p>}
              <button onClick={() => void save()} disabled={!ack || saving || entered.length === 0} className="w-full py-2.5 rounded-lg bg-[#2b2416] text-white text-sm font-semibold disabled:opacity-40">
                {saving ? "Saving..." : `Save physical count (${entered.length})`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// "Where did the units go?" -- for one material: stock added vs what
// orders consumed, with the gap spelled out.
export function StockTraceModal({ target, onClose }: { target: { id: string; name: string; unit: string }; onClose: () => void }) {
  const { getStockTrace } = useStore();
  const [trace, setTrace] = useState<StockTrace | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getStockTrace(target.id)
      .then((t) => { if (alive) { if (t.ok) setTrace(t); else setErr(t.error ?? "Could not load the trace."); } })
      .catch((e) => { if (alive) setErr(e instanceof Error ? e.message : "Could not load the trace."); });
    return () => { alive = false; };
  }, [getStockTrace, target.id]);

  const sourceLabel = useMemo(() => ({
    stockedBatch: "Purchase (stocked batch)", dailyFresh: "Purchase / expense", restock: "Restock", openingStock: "Opening stock",
    supplierInvoice: "Supplier invoice", invoice: "Supplier invoice", orderRestore: "Order change returned to stock",
    auditAdjustment: "Audit surplus", auditBaseline: "Re-alignment surplus",
  } as Record<string, string>), []);
  const u = target.unit;
  const sm = trace?.summary;

  return (
    <div className="fixed inset-0 z-[310] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-3xl max-h-[88vh] overflow-y-auto rounded-2xl border border-black/10 bg-white" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-black/10 sticky top-0 bg-white">
          <div className="flex items-center gap-2 font-mono uppercase tracking-widest text-xs font-bold"><History className="w-4 h-4" /> {target.name} — Stock Trace</div>
          <button onClick={onClose}><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-5 text-sm">
          {err && <p className="text-red-700 font-semibold">{err}</p>}
          {!trace && !err && <p className="text-muted-foreground">Loading...</p>}
          {trace && sm && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <Stat label="Stock added (purchases / opening)" value={`+${fmtQty(sm.added)} ${u}`} tone="good" />
                <Stat label="Returned / audit surplus" value={`+${fmtQty(sm.returned)} ${u}`} tone="good" />
                <Stat label="Total used up" value={`-${fmtQty(sm.totalUsed)} ${u}`} tone="bad" />
                <Stat label="In stock now" value={`${fmtQty(trace.remaining)} ${u}`} />
              </div>
              <div className="rounded-lg border border-black/10 p-3 space-y-1 font-mono text-xs">
                <div className="font-sans text-sm font-bold mb-1">Where the {fmtQty(sm.totalUsed)} {u} used went</div>
                <Line label="Consumed by orders (current recipe × items sold)" v={sm.byOrders} u={u} />
                <Line label="Waste invoices" v={sm.byWaste} u={u} />
                <Line label="Audit / re-alignment write-offs" v={sm.byAuditWriteOff} u={u} />
                <div className={`flex justify-between pt-1 border-t border-black/10 font-bold ${Math.abs(sm.unexplained) > 0.001 ? "text-red-700" : "text-green-700"}`}>
                  <span>Unexplained</span><span>{fmtQty(sm.unexplained)} {u}</span>
                </div>
                {Math.abs(sm.unexplained) > 0.001 && (
                  <p className="font-sans text-[11px] text-muted-foreground pt-1">
                    Unexplained usually means: stock was entered in the wrong unit (e.g. 5 instead of 5,000 {u}), a recipe was edited after the sales, staff meals, or waste/marketing logs. Orders are measured with today's recipe.
                  </p>
                )}
              </div>
              {trace.recipes.length > 0 && (
                <div>
                  <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-1">Recipes using it (per item sold)</div>
                  <div className="flex flex-wrap gap-1.5">{trace.recipes.map((r, i) => <span key={i} className="text-xs px-2 py-1 rounded-full bg-black/5 border border-black/10">{r.itemName}: <b>{fmtQty(r.perUnit)} {u}</b></span>)}</div>
                </div>
              )}
              <div>
                <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-1">Batches (oldest first)</div>
                <table className="w-full text-xs">
                  <thead><tr className="text-[9px] uppercase tracking-widest text-muted-foreground border-b border-black/10">
                    <th className="text-left py-1 px-2">Date</th><th className="text-left py-1 px-2">Source</th><th className="text-right py-1 px-2">Added</th><th className="text-right py-1 px-2">Left</th><th className="text-right py-1 px-2">Cost / {u}</th>
                  </tr></thead>
                  <tbody>{trace.batches.map((b) => (
                    <tr key={b.id} className="border-b border-black/8">
                      <td className="py-1 px-2 font-mono text-muted-foreground">{new Date(b.ts).toLocaleString()}</td>
                      <td className="py-1 px-2">{sourceLabel[b.source] ?? b.source}</td>
                      <td className="py-1 px-2 text-right font-mono">{fmtQty(b.qtyPurchased)}</td>
                      <td className="py-1 px-2 text-right font-mono font-bold">{fmtQty(b.qtyRemaining)}</td>
                      <td className="py-1 px-2 text-right font-mono">{fmtQty(b.unitCost)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              <div>
                <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-1">Orders that consumed it ({trace.orderRowCount}{trace.orderRowCount > trace.orderRows.length ? `, latest ${trace.orderRows.length} shown` : ""})</div>
                {trace.orderRows.length === 0 ? <p className="text-xs text-muted-foreground">No recorded order has used this material.</p> : (
                  <table className="w-full text-xs">
                    <thead><tr className="text-[9px] uppercase tracking-widest text-muted-foreground border-b border-black/10">
                      <th className="text-left py-1 px-2">When</th><th className="text-left py-1 px-2">Order</th><th className="text-left py-1 px-2">Item</th><th className="text-right py-1 px-2">Qty</th><th className="text-right py-1 px-2">Used</th>
                    </tr></thead>
                    <tbody>{trace.orderRows.map((r, i) => (
                      <tr key={i} className="border-b border-black/8">
                        <td className="py-1 px-2 font-mono text-muted-foreground">{new Date(r.ts).toLocaleString()}</td>
                        <td className="py-1 px-2">{r.ref}</td><td className="py-1 px-2">{r.itemName}</td>
                        <td className="py-1 px-2 text-right font-mono">{r.orderQty}×{fmtQty(r.perUnit)}</td>
                        <td className="py-1 px-2 text-right font-mono font-bold">{fmtQty(r.consumed)} {u}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                )}
              </div>
              {(trace.audits.length > 0 || trace.wasteInvoices.length > 0) && (
                <div>
                  <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-1">Counts, adjustments & waste</div>
                  <ul className="text-xs space-y-0.5 font-mono">
                    {trace.audits.map((a, i) => <li key={"a" + i}>{new Date(a.ts).toLocaleString()} — count by {a.actor}: system {fmtQty(a.expectedStock ?? 0)} → physical {fmtQty(a.actualStock ?? 0)} ({(a.variance ?? 0) > 0 ? "+" : ""}{fmtQty(a.variance ?? 0)} {u})</li>)}
                    {trace.wasteInvoices.map((w, i) => <li key={"w" + i}>{new Date(w.ts).toLocaleString()} — waste {fmtQty(w.qty)} {u} ({w.reason})</li>)}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-lg border border-black/10 p-2">
      <div className="text-[9px] uppercase tracking-widest text-muted-foreground leading-tight">{label}</div>
      <div className={`mt-1 font-mono font-bold ${tone === "good" ? "text-green-700" : tone === "bad" ? "text-red-600" : ""}`}>{value}</div>
    </div>
  );
}
function Line({ label, v, u }: { label: string; v: number; u: string }) {
  return <div className="flex justify-between"><span className="font-sans">{label}</span><span>{fmtQty(v)} {u}</span></div>;
}
