import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import logo from "@/assets/glitch-logo-mark.png";
import { printSmart } from "@/lib/print";
import { useStore, fmtMoney, MENU_CATEGORIES } from "@/lib/glitch-store";
import type { MenuItem, MenuCategory, StaffOrder } from "@/lib/glitch-store";
import { Users, Plus, Minus, X, Printer } from "lucide-react";

export function StaffOrdersPage() {
  const { state } = useStore();
  const isAdmin = state.currentUser?.role === "admin";
  const [staffName, setStaffName] = useState("");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [pickerOpen, setPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<StaffOrder | null>(null);
  const { submitStaffOrder } = useStore();

  const cartItems = Object.entries(cart).map(([menuItemId, qty]) => {
    const item = state.menu.find((m) => m.id === menuItemId);
    return { menuItemId, qty, item };
  }).filter((c) => c.item);
  const cartTotal = cartItems.reduce((a, c) => a + (c.item?.price ?? 0) * c.qty, 0);

  const adjustCart = (menuItemId: string, delta: number) => {
    setCart((prev) => {
      const next = Math.max(0, (prev[menuItemId] ?? 0) + delta);
      const copy = { ...prev };
      if (next === 0) delete copy[menuItemId];
      else copy[menuItemId] = next;
      return copy;
    });
  };

  const submit = async () => {
    setErr(null);
    if (!staffName.trim()) { setErr("Enter the staff member's name."); return; }
    if (cartItems.length === 0) { setErr("Add at least one item."); return; }
    setSubmitting(true);
    try {
      const res = await submitStaffOrder({
        staffName: staffName.trim(),
        items: cartItems.map((c) => ({ menuItemId: c.menuItemId, qty: c.qty })),
      });
      if (!res.ok) { setErr(res.error ?? "Could not log staff order"); return; }
      if (res.staffOrder) setReceipt(res.staffOrder);
      setCart({});
      setStaffName("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Users className="w-7 h-7 text-[oklch(0.7_0.19_260)]" />
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Staff Orders</h1>
          <p className="text-sm text-muted-foreground mt-1 font-mono uppercase tracking-widest">
            Employee Consumption — Expense Ledger, Not Retail Revenue
          </p>
        </div>
      </div>

      <div className="glass rounded-2xl p-6 border border-[oklch(0.7_0.19_260/0.3)]">
        <p className="text-xs text-muted-foreground mb-4">
          Items keep standard menu prices for accurate costing and inventory deduction, but the total is logged as a
          Staff Consumption Expense — it never counts toward sales revenue.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs uppercase tracking-widest text-muted-foreground">Staff Member</label>
            <input
              value={staffName} onChange={(e) => setStaffName(e.target.value)}
              placeholder="Name"
              className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-4 py-3 text-lg"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={() => setPickerOpen(true)}
              className="w-full py-3 rounded-lg bg-[oklch(0.7_0.19_260/0.2)] border border-[oklch(0.7_0.19_260/0.5)] text-[oklch(0.7_0.19_260)] font-bold uppercase tracking-wide text-sm"
            >
              + Add Items
            </button>
          </div>
        </div>

        {cartItems.length > 0 && (
          <div className="mt-4 space-y-2">
            {cartItems.map((c) => (
              <div key={c.menuItemId} className="flex items-center justify-between bg-white/60 rounded-lg p-3 border border-black/8">
                <span className="text-sm font-semibold">{c.item?.name}</span>
                <div className="flex items-center gap-2">
                  <button onClick={() => adjustCart(c.menuItemId, -1)} className="w-7 h-7 flex items-center justify-center rounded bg-black/5 border border-black/10 hover:bg-black/8"><Minus className="w-3.5 h-3.5" /></button>
                  <span className="w-6 text-center font-mono">{c.qty}</span>
                  <button onClick={() => adjustCart(c.menuItemId, 1)} className="w-7 h-7 flex items-center justify-center rounded bg-black/5 border border-black/10 hover:bg-black/8"><Plus className="w-3.5 h-3.5" /></button>
                  <span className="w-16 text-right font-mono text-sm">{fmtMoney((c.item?.price ?? 0) * c.qty)}</span>
                </div>
              </div>
            ))}
            <div className="flex justify-between text-sm font-mono pt-2 border-t border-black/10">
              <span className="text-muted-foreground">Total</span>
              <span className="font-bold text-lg">{fmtMoney(cartTotal)}</span>
            </div>
          </div>
        )}

        {err && <div className="mt-3 text-sm text-[oklch(0.62_0.24_25)]">{err}</div>}

        <button
          onClick={submit}
          disabled={submitting}
          className="w-full mt-4 py-4 rounded-xl bg-gradient-to-r from-[oklch(0.7_0.19_260)] to-[oklch(0.65_0.24_305)] text-[#2b2416] font-bold uppercase tracking-wide shadow-[0_0_20px_oklch(0.7_0.19_260/0.4)] disabled:opacity-50"
        >
          {submitting ? "Logging..." : "Log Staff Order & Print Check"}
        </button>
      </div>

      {isAdmin && <StaffOrderHistory />}

      {pickerOpen && (
        <StaffItemPickerModal
          menu={state.menu}
          onClose={() => setPickerOpen(false)}
          onPick={(id) => adjustCart(id, 1)}
        />
      )}
      {receipt && <StaffReceiptModal order={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
}

function StaffOrderHistory() {
  const { state, refreshStaffOrders } = useStore();
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const filtered = useMemo(() => {
    const fromTs = fromDate ? new Date(fromDate).setHours(0, 0, 0, 0) : null;
    const toTs = toDate ? new Date(toDate).setHours(23, 59, 59, 999) : null;
    return state.staffOrders
      .filter((o) => (fromTs === null || o.ts >= fromTs) && (toTs === null || o.ts <= toTs))
      .sort((a, b) => b.ts - a.ts);
  }, [state.staffOrders, fromDate, toDate]);

  const filteredTotal = filtered.reduce((a, o) => a + o.totalAmount, 0);

  return (
    <div className="glass rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h2 className="text-lg font-semibold">Staff Consumption History</h2>
        <button onClick={() => refreshStaffOrders()} className="text-xs px-3 py-1.5 rounded-lg bg-black/5 border border-black/10 hover:bg-black/8">Refresh</button>
      </div>

      <div className="flex flex-wrap items-end gap-3 mb-4 p-3 rounded-xl bg-black/5 border border-black/8">
        <div>
          <label className="text-[10px] uppercase tracking-widest text-muted-foreground">From</label>
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="mt-1 block bg-white/70 border border-black/10 rounded-lg px-2 py-1.5 text-xs" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-widest text-muted-foreground">To</label>
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="mt-1 block bg-white/70 border border-black/10 rounded-lg px-2 py-1.5 text-xs" />
        </div>
        {(fromDate || toDate) && (
          <button onClick={() => { setFromDate(""); setToDate(""); }} className="text-xs px-3 py-1.5 rounded-lg bg-black/5 border border-black/10 hover:bg-black/8 text-muted-foreground">
            Clear
          </button>
        )}
        <div className="ml-auto flex items-center gap-3">
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{fromDate || toDate ? "Selected Total" : "All-Time Total"}</div>
            <div className="text-sm font-mono font-bold">{fmtMoney(filteredTotal)}</div>
          </div>
          <button
            onClick={() => printStaffOrdersReport(filtered, fromDate, toDate)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-[oklch(0.82_0.16_85)] to-[oklch(0.82_0.16_85)] text-[#2b2416] text-xs font-bold uppercase tracking-wide shadow-[0_0_16px_oklch(0.82_0.16_85/0.4)]"
          >
            <Printer className="w-3.5 h-3.5" /> Generate Report
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="text-sm text-muted-foreground font-mono">No staff orders in this range.</div>
      ) : (
        <div className="overflow-x-auto max-h-96 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-[#faf6ec]">
              <tr className="text-[10px] uppercase tracking-widest text-muted-foreground border-b border-black/8">
                <th className="text-left py-2 px-2">Time</th>
                <th className="text-left py-2 px-2">Staff</th>
                <th className="text-left py-2 px-2">Items</th>
                <th className="text-left py-2 px-2">Logged By</th>
                <th className="text-right py-2 px-2">Amount</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((o) => (
                <tr key={o.id} className="border-b border-black/8 hover:bg-black/5">
                  <td className="py-2 px-2 font-mono text-xs text-muted-foreground">{new Date(o.ts).toLocaleString()}</td>
                  <td className="py-2 px-2 font-semibold">{o.staffName}</td>
                  <td className="py-2 px-2 text-xs">{o.items.map((i) => `${i.qty}x ${i.name}`).join(", ")}</td>
                  <td className="py-2 px-2 text-xs">{o.processedBy}</td>
                  <td className="py-2 px-2 text-right font-mono">{fmtMoney(o.totalAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StaffItemPickerModal({ menu, onClose, onPick }: { menu: MenuItem[]; onClose: () => void; onPick: (id: string) => void }) {
  const categoriesWithItems = MENU_CATEGORIES.filter((cat) => menu.some((m) => m.category === cat));
  const [activeCategory, setActiveCategory] = useState<MenuCategory | null>(categoriesWithItems[0] ?? null);
  const itemsInCategory = activeCategory ? menu.filter((m) => m.category === activeCategory) : [];

  return createPortal(
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md no-print" onClick={onClose}>
      <div className="w-full max-w-4xl h-[80vh] glass-strong rounded-3xl border-2 border-[oklch(0.7_0.19_260/0.5)] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/10 shrink-0">
          <div className="font-mono uppercase tracking-widest text-lg font-bold text-[oklch(0.7_0.19_260)]">Add Staff Order Items</div>
          <button onClick={onClose} className="w-10 h-10 flex items-center justify-center rounded-full bg-black/5 hover:bg-black/10"><X className="w-6 h-6" /></button>
        </div>
        <div className="flex flex-wrap items-center gap-2 px-6 py-4 border-b border-black/10 shrink-0">
          {categoriesWithItems.map((cat) => (
            <button
              key={cat} onClick={() => setActiveCategory(cat)}
              className={`px-5 py-3 rounded-xl text-sm font-bold uppercase tracking-wide border-2 transition ${activeCategory === cat ? "bg-gradient-to-r from-[oklch(0.7_0.19_260)] to-[oklch(0.65_0.24_305)] text-[#2b2416] border-transparent" : "bg-black/5 border-black/10 text-muted-foreground"}`}
            >
              {cat}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {itemsInCategory.map((m) => (
              <button
                key={m.id} onClick={() => onPick(m.id)}
                className="flex flex-col items-start gap-2 p-5 rounded-2xl text-left border-2 bg-black/5 border-black/10 hover:border-[oklch(0.7_0.19_260/0.6)] hover:bg-[oklch(0.7_0.19_260/0.15)] active:scale-95 transition"
              >
                <span className="text-lg font-bold leading-tight">{m.name}</span>
                <span className="text-2xl font-mono font-black text-[oklch(0.78_0.2_155)]">{fmtMoney(m.price)}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function StaffReceiptModal({ order, onClose }: { order: StaffOrder; onClose: () => void }) {
  const [logoReady, setLogoReady] = useState(false);
  useEffect(() => {
    const img = new Image();
    img.onload = () => setLogoReady(true);
    img.src = logo;
    if (img.complete) setLogoReady(true);
  }, []);
  return createPortal(
    <div className="print-root fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-lg glass-strong rounded-2xl border border-black/10 shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-black/10">
          <div className="font-mono uppercase tracking-widest text-sm text-[oklch(0.7_0.19_260)]">Staff Check</div>
          <button onClick={onClose} className="text-muted-foreground hover:text-[#2b2416]"><X className="w-4 h-4" /></button>
        </div>
        <div className="print-area p-6 font-mono text-sm bg-white/50">
          <div className="text-center mb-2 receipt-block">
            <img src={logo} alt="GLITCH" className="w-36 h-auto mx-auto receipt-logo" />
            <div className="text-xl font-bold tracking-widest mt-1">GLITCH</div>
            <div className="text-sm font-bold uppercase tracking-[0.2em] mt-2 text-[oklch(0.82_0.16_85)]">STAFF CHECK</div>
            <div className="text-sm font-bold tracking-widest" dir="rtl">مسحوبات الموظفين</div>
          </div>
          <div className="border-t border-b border-dashed border-black/20 py-2 my-2 text-xs receipt-block">
            <div className="flex justify-between"><span>Staff Member</span><span className="font-bold">{order.staffName}</span></div>
            <div className="flex justify-between"><span>Time</span><span>{new Date(order.ts).toLocaleString()}</span></div>
            <div className="flex justify-between"><span>Logged By</span><span>{order.processedBy}</span></div>
          </div>
          <div className="mt-2 space-y-1">
            {order.items.map((o) => (
              <div key={o.menuItemId} className="flex justify-between receipt-line">
                <span>{o.qty}× {o.name}</span>
                <span>{fmtMoney(o.qty * o.price)}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-double border-black/25 mt-3 pt-2 flex justify-between text-base font-bold receipt-block receipt-total">
            <span>TOTAL (Staff Expense)</span><span>{fmtMoney(order.totalAmount)}</span>
          </div>
          <div className="text-center text-sm font-bold uppercase tracking-widest mt-4">Not a Retail Sale — Staff Consumption</div>
        </div>
        <div className="p-4 border-t border-black/10 flex justify-end gap-2 no-print">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm bg-black/5 hover:bg-black/8 border border-black/10">Close</button>
          <button
            onClick={() => void printSmart()}
            disabled={!logoReady}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm bg-gradient-to-r from-[oklch(0.7_0.19_260)] to-[oklch(0.7_0.19_260)] text-[#2b2416] font-semibold disabled:opacity-60"
          >
            <Printer className="w-4 h-4" /> {logoReady ? "Print" : "Preparing..."}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function printStaffOrdersReport(orders: StaffOrder[], fromDate: string, toDate: string) {
  const win = window.open("", "_blank", "width=900,height=1200");
  if (!win) return;
  const label = fromDate || toDate ? `${fromDate || "…"} to ${toDate || "…"}` : "All Time";
  const total = orders.reduce((a, o) => a + o.totalAmount, 0);
  const byStaff = new Map<string, number>();
  orders.forEach((o) => byStaff.set(o.staffName, (byStaff.get(o.staffName) ?? 0) + o.totalAmount));

  win.document.write(`
<!DOCTYPE html><html><head><title>Staff Orders Report</title>
<style>
  body { font-family: ui-sans-serif, system-ui, sans-serif; padding: 32px; color: #111; }
  h1 { margin: 0 0 4px; letter-spacing: 4px; }
  .sub { color: #666; text-transform: uppercase; letter-spacing: 3px; font-size: 11px; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; }
  th, td { border-bottom: 1px solid #ddd; padding: 7px; font-size: 12px; text-align: left; }
  th { background: #f5f5f5; text-transform: uppercase; letter-spacing: 1px; font-size: 9px; }
  .totals { margin-top: 16px; padding: 12px; background: #f5f5f5; border-radius: 8px; }
  .totals div { display: flex; justify-content: space-between; padding: 4px 0; font-family: ui-monospace, monospace; }
  .grand { font-weight: bold; border-top: 2px solid #111; margin-top: 6px; padding-top: 8px !important; font-size: 15px; }
</style></head><body>
<h1>GLITCH LOUNGE</h1>
<div class="sub">Staff Orders Report — ${label}</div>
<div class="totals">
  <div class="grand"><span>TOTAL STAFF CONSUMPTION EXPENSE</span><span>${total.toFixed(2)} EGP</span></div>
  <div><span>Total Orders</span><span>${orders.length}</span></div>
</div>
<h3 style="margin-top:24px">By Staff Member</h3>
<table>
  <thead><tr><th>Staff</th><th>Total</th></tr></thead>
  <tbody>
    ${Array.from(byStaff.entries()).sort((a, b) => b[1] - a[1]).map(([name, amt]) => `<tr><td>${name}</td><td>${amt.toFixed(2)} EGP</td></tr>`).join("") || "<tr><td colspan=2>No orders</td></tr>"}
  </tbody>
</table>
<h3 style="margin-top:24px">All Orders</h3>
<table>
  <thead><tr><th>Time</th><th>Staff</th><th>Items</th><th>Logged By</th><th>Amount</th></tr></thead>
  <tbody>
    ${orders.map((o) => `<tr>
      <td>${new Date(o.ts).toLocaleString()}</td>
      <td>${o.staffName}</td>
      <td>${o.items.map((i) => `${i.qty}x ${i.name}`).join(", ")}</td>
      <td>${o.processedBy}</td>
      <td>${o.totalAmount.toFixed(2)} EGP</td>
    </tr>`).join("") || "<tr><td colspan=5>No orders in this range</td></tr>"}
  </tbody>
</table>
<script>window.onload = () => setTimeout(() => { if (window.electronAPI) { window.electronAPI.printSilent({ deviceName: localStorage.getItem("glitch-preferred-printer") || "" }).catch(() => window.print()); } else { window.print(); } }, 300);</script>
</body></html>`);
  win.document.close();
}
