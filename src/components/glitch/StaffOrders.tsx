import { useState } from "react";
import { createPortal } from "react-dom";
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
        <Users className="w-7 h-7 text-[oklch(0.85_0.16_200)]" />
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Staff Orders</h1>
          <p className="text-sm text-muted-foreground mt-1 font-mono uppercase tracking-widest">
            Employee Consumption — Expense Ledger, Not Retail Revenue
          </p>
        </div>
      </div>

      <div className="glass rounded-2xl p-6 border border-[oklch(0.85_0.16_200/0.3)]">
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
              className="mt-1 w-full bg-black/40 border border-white/10 rounded-lg px-4 py-3 text-lg"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={() => setPickerOpen(true)}
              className="w-full py-3 rounded-lg bg-[oklch(0.7_0.19_260/0.2)] border border-[oklch(0.7_0.19_260/0.5)] text-[oklch(0.85_0.16_200)] font-bold uppercase tracking-wide text-sm"
            >
              + Add Items
            </button>
          </div>
        </div>

        {cartItems.length > 0 && (
          <div className="mt-4 space-y-2">
            {cartItems.map((c) => (
              <div key={c.menuItemId} className="flex items-center justify-between bg-black/30 rounded-lg p-3 border border-white/5">
                <span className="text-sm font-semibold">{c.item?.name}</span>
                <div className="flex items-center gap-2">
                  <button onClick={() => adjustCart(c.menuItemId, -1)} className="w-7 h-7 flex items-center justify-center rounded bg-white/5 border border-white/10 hover:bg-white/10"><Minus className="w-3.5 h-3.5" /></button>
                  <span className="w-6 text-center font-mono">{c.qty}</span>
                  <button onClick={() => adjustCart(c.menuItemId, 1)} className="w-7 h-7 flex items-center justify-center rounded bg-white/5 border border-white/10 hover:bg-white/10"><Plus className="w-3.5 h-3.5" /></button>
                  <span className="w-16 text-right font-mono text-sm">{fmtMoney((c.item?.price ?? 0) * c.qty)}</span>
                </div>
              </div>
            ))}
            <div className="flex justify-between text-sm font-mono pt-2 border-t border-white/10">
              <span className="text-muted-foreground">Total</span>
              <span className="font-bold text-lg">{fmtMoney(cartTotal)}</span>
            </div>
          </div>
        )}

        {err && <div className="mt-3 text-sm text-[oklch(0.75_0.22_25)]">{err}</div>}

        <button
          onClick={submit}
          disabled={submitting}
          className="w-full mt-4 py-4 rounded-xl bg-gradient-to-r from-[oklch(0.7_0.19_260)] to-[oklch(0.65_0.24_305)] text-white font-bold uppercase tracking-wide shadow-[0_0_20px_oklch(0.7_0.19_260/0.4)] disabled:opacity-50"
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

  return (
    <div className="glass rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Staff Consumption History</h2>
        <button onClick={() => refreshStaffOrders()} className="text-xs px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10">Refresh</button>
      </div>
      {state.staffOrders.length === 0 ? (
        <div className="text-sm text-muted-foreground font-mono">No staff orders logged yet.</div>
      ) : (
        <div className="overflow-x-auto max-h-96 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-[#0d0d14]">
              <tr className="text-[10px] uppercase tracking-widest text-muted-foreground border-b border-white/5">
                <th className="text-left py-2 px-2">Time</th>
                <th className="text-left py-2 px-2">Staff</th>
                <th className="text-left py-2 px-2">Items</th>
                <th className="text-left py-2 px-2">Logged By</th>
                <th className="text-right py-2 px-2">Amount</th>
              </tr>
            </thead>
            <tbody>
              {state.staffOrders.map((o) => (
                <tr key={o.id} className="border-b border-white/5 hover:bg-white/5">
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
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
          <div className="font-mono uppercase tracking-widest text-lg font-bold text-[oklch(0.85_0.16_200)]">Add Staff Order Items</div>
          <button onClick={onClose} className="w-10 h-10 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/15"><X className="w-6 h-6" /></button>
        </div>
        <div className="flex flex-wrap items-center gap-2 px-6 py-4 border-b border-white/10 shrink-0">
          {categoriesWithItems.map((cat) => (
            <button
              key={cat} onClick={() => setActiveCategory(cat)}
              className={`px-5 py-3 rounded-xl text-sm font-bold uppercase tracking-wide border-2 transition ${activeCategory === cat ? "bg-gradient-to-r from-[oklch(0.7_0.19_260)] to-[oklch(0.65_0.24_305)] text-white border-transparent" : "bg-white/5 border-white/10 text-muted-foreground"}`}
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
                className="flex flex-col items-start gap-2 p-5 rounded-2xl text-left border-2 bg-white/5 border-white/10 hover:border-[oklch(0.7_0.19_260/0.6)] hover:bg-[oklch(0.7_0.19_260/0.15)] active:scale-95 transition"
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
  return createPortal(
    <div className="print-root fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md glass-strong rounded-2xl border border-white/10 shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <div className="font-mono uppercase tracking-widest text-sm text-[oklch(0.85_0.16_200)]">Staff Check</div>
          <button onClick={onClose} className="text-muted-foreground hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        <div className="print-area p-6 font-mono text-sm bg-black/20">
          <div className="text-center mb-2 receipt-block">
            <div className="text-xl font-bold tracking-widest">GLITCH</div>
            <div className="text-sm font-bold uppercase tracking-[0.2em] mt-2 text-[oklch(0.82_0.16_85)]">STAFF CHECK</div>
            <div className="text-sm font-bold tracking-widest" dir="rtl">مسحوبات الموظفين</div>
          </div>
          <div className="border-t border-b border-dashed border-white/30 py-2 my-2 text-xs receipt-block">
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
          <div className="border-t border-double border-white/40 mt-3 pt-2 flex justify-between text-base font-bold receipt-block">
            <span>TOTAL (Staff Expense)</span><span>{fmtMoney(order.totalAmount)}</span>
          </div>
          <div className="text-center text-[10px] uppercase tracking-widest mt-4 opacity-70">Not a Retail Sale — Staff Consumption</div>
        </div>
        <div className="p-4 border-t border-white/10 flex justify-end gap-2 no-print">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm bg-white/5 hover:bg-white/10 border border-white/10">Close</button>
          <button
            onClick={() => window.print()}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm bg-gradient-to-r from-[oklch(0.85_0.16_200)] to-[oklch(0.7_0.19_260)] text-white font-semibold"
          >
            <Printer className="w-4 h-4" /> Print
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
