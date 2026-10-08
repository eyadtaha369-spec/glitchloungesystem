import { useEffect, useMemo, useRef, useState } from "react";
import { useStore, fmtMoney } from "@/lib/glitch-store";
import type { LedgerEntry, PaymentSource, SupplierLedgerEntry } from "@/lib/glitch-store";
import { CheckCircle2, XCircle, Clock, ShieldAlert, Package, Wallet, CalendarClock, HandCoins, FileBarChart, History, Search, Pencil, Trash2 } from "lucide-react";

const TYPE_LABEL: Record<string, string> = {
  stockedBatch: "Stocked Batch (bulk delivery)",
  // Historical label only — kept so already-logged Daily Fresh Sheet
  // purchases (from before this tab was replaced by Advances & Monthly
  // Loans) still display correctly in Purchase History.
  dailyFresh: "Daily Fresh Sheet (perishables)",
  midShiftPurchase: "Expenses",
};

const PAYMENT_SOURCE_LABELS: Record<PaymentSource, string> = {
  cash_drawer: "Cash Drawer / من الدرج",
  out_of_pocket: "Out of Pocket / من الجيب",
  monthly_payment: "Monthly Payment / دفع شهري",
};
const PAYMENT_SOURCE_ICONS: Record<PaymentSource, typeof Wallet> = {
  cash_drawer: Wallet,
  out_of_pocket: HandCoins,
  monthly_payment: CalendarClock,
};
// "supplierPayment" included so a settled deferred invoice (سداد فاتورة
// آجلة) shows up in Purchase History alongside direct cash purchases,
// not just in the Expenses History report — see PurchaseRowActions and
// ReportModal below for the type-specific handling this requires.
const PROCUREMENT_TYPES = new Set(["stockedBatch", "dailyFresh", "midShiftPurchase", "supplierPayment"]);

export function ProcurementPage() {
  const { state, refreshLedger } = useStore();
  const isAdmin = state.currentUser?.role === "admin";
  // Same reasoning as Reports/Voids: pending approvals and the purchase
  // history both come from the ledger, admin-only and loaded once per
  // session — refresh on every visit rather than depending on some
  // other session's action to have pushed a refresh into this one.
  useEffect(() => {
    if (isAdmin) void refreshLedger();
  }, [isAdmin, refreshLedger]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Procurement</h1>
        <p className="text-sm text-muted-foreground mt-1 font-mono uppercase tracking-widest">
          Log Purchases &amp; Expenses
        </p>
      </div>

      {!isAdmin && (
        <div className="glass rounded-2xl p-4 border border-black/40 flex items-start gap-3">
          <ShieldAlert className="w-5 h-5 text-black shrink-0 mt-0.5" />
          <p className="text-sm text-muted-foreground">
            Your submissions go to <strong className="text-foreground">Pending Approval</strong>. Stock and cash are not affected until an admin reviews and approves the receipt.
          </p>
        </div>
      )}

      <SubmitPurchaseForm />
      <SupplierAccountsPanel />

      {isAdmin && <PendingApprovals />}
      {isAdmin && <PurchaseHistory />}
    </div>
  );
}

function SubmitPurchaseForm() {
  const [tab, setTab] = useState<"stockedBatch" | "expenses" | "supplierInvoice" | "advances">("stockedBatch");
  return (
    <div className="glass rounded-2xl p-6">
      <div className="flex items-center gap-2 mb-4">
        <Package className="w-5 h-5 text-[oklch(0.7_0.19_260)]" />
        <h2 className="text-lg font-semibold">Log a Purchase</h2>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
        {([
          ["stockedBatch", TYPE_LABEL.stockedBatch],
          ["expenses", "Expenses"],
          ["supplierInvoice", "Supplier Invoice"],
          ["advances", "السلف والخصومات الشهرية"],
        ] as const).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            dir={t === "advances" ? "rtl" : "ltr"}
            className={`text-xs py-2.5 px-3 rounded-lg border transition ${
              tab === t
                ? "bg-[oklch(0.7_0.19_260/0.2)] border-[oklch(0.7_0.19_260/0.5)] text-[#2b2416]"
                : "bg-black/5 border-black/10 text-muted-foreground hover:bg-black/8"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "expenses" ? <ExpenseSubmitForm /> : tab === "supplierInvoice" ? <SupplierInvoiceForm /> : tab === "advances" ? <AdvancesForm /> : <MaterialPurchaseForm purchaseType={tab} />}
    </div>
  );
}

// Type-to-filter combobox — with 70+ materials (many in Arabic), a
// plain <select> means scrolling through a long list or relying on
// native type-to-jump, which works less reliably with Arabic/RTL text
// than a real search box does.
// Exported so Reports.tsx's Fixed Monthly Cost form can reuse the same
// searchable material picker, instead of duplicating it, when the
// admin optionally ties a monthly expense to an inventory purchase.
export function SearchableMaterialSelect({ materials, value, onChange, placeholder }: {
  materials: { id: string; name: string; unit: string }[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = materials.find((m) => m.id === value);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return materials;
    return materials.filter((m) => m.name.toLowerCase().includes(q));
  }, [materials, query]);

  return (
    <div className="relative" ref={containerRef}>
      <div className="relative">
        <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <input
          value={open ? query : (selected ? `${selected.name} (${selected.unit})` : "")}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => { setQuery(""); setOpen(true); }}
          placeholder={placeholder || "Search material..."}
          dir="auto"
          className="w-full bg-white/70 border border-black/10 rounded-lg pl-8 pr-3 py-2 text-sm"
        />
      </div>
      {open && (
        <div className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto rounded-lg border border-black/10 bg-white shadow-lg">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">No materials match "{query}"</div>
          ) : (
            filtered.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => { onChange(m.id); setQuery(""); setOpen(false); }}
                dir="auto"
                className={`w-full text-left px-3 py-2 text-sm hover:bg-black/5 ${m.id === value ? "bg-black/5 font-semibold" : ""}`}
              >
                {m.name} <span className="text-muted-foreground">({m.unit})</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function MaterialPurchaseForm({ purchaseType }: { purchaseType: "dailyFresh" | "stockedBatch" }) {
  const { state, activeShift, submitPurchase } = useStore();
  const isAdmin = state.currentUser?.role === "admin";

  const [materialId, setMaterialId] = useState("");
  const [qty, setQty] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [description, setDescription] = useState("");
  const [paymentStatus, setPaymentStatus] = useState<"paid" | "unpaid">("paid");
  const [paymentSource, setPaymentSource] = useState<PaymentSource | "">("");
  // خيارات طريقة الخصم — only shown/meaningful for Out of Pocket: a Cash
  // Drawer purchase is physically tied to whichever shift's drawer the
  // cash came out of, and a Monthly Payment is ALWAYS monthly scope on
  // its own (see the onClick below), so there's nothing to choose in
  // either case. Mirrors RecordSupplierPaymentForm's own expenseScope
  // toggle.
  const [expenseScope, setExpenseScope] = useState<"daily_shift" | "monthly">("daily_shift");
  const showExpenseScope = paymentStatus === "paid" && paymentSource === "out_of_pocket";
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // Admin-only: assign this purchase to an already-closed shift instead
  // of the current one, backdating it into that shift's own
  // totals/reports — mirrors ExpenseSubmitForm's Shift/Date selector.
  const [targetMode, setTargetMode] = useState<"current" | "past">("current");
  const [targetShiftId, setTargetShiftId] = useState("");
  const closedShifts = [...state.shifts]
    .filter((s) => s.closedAt !== null)
    .sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0));

  const material = state.materials.find((m) => m.id === materialId);
  const total = (parseFloat(qty) || 0) * (parseFloat(unitCost) || 0);

  const reset = () => {
    setMaterialId(""); setQty(""); setUnitCost(""); setSupplierId(""); setDescription(""); setPaymentStatus("paid"); setPaymentSource("");
    setExpenseScope("daily_shift");
    setTargetMode("current"); setTargetShiftId("");
  };

  const submit = async () => {
    setResult(null);
    if (!materialId || !qty || !unitCost) { setResult({ kind: "err", text: "Material, quantity, and unit cost are required." }); return; }
    if (paymentStatus === "paid" && !paymentSource) { setResult({ kind: "err", text: "Select a payment source, or mark this Unpaid instead." }); return; }
    if (isAdmin && targetMode === "past" && !targetShiftId) { setResult({ kind: "err", text: "Select which closed shift this purchase belongs to." }); return; }
    setSubmitting(true);
    try {
      const res = await submitPurchase({
        purchaseType,
        materialId,
        qty: parseFloat(qty),
        unitCost: parseFloat(unitCost),
        supplierId: supplierId || undefined,
        category: TYPE_LABEL[purchaseType],
        description,
        paymentStatus,
        paymentSource: paymentStatus === "paid" ? (paymentSource as PaymentSource) : undefined,
        expenseScope: paymentSource === "monthly_payment" ? "monthly" : showExpenseScope ? expenseScope : undefined,
        targetShiftId: isAdmin && targetMode === "past" ? targetShiftId : undefined,
      });
      if (!res.ok) { setResult({ kind: "err", text: res.error ?? "Submission failed" }); return; }
      setResult({
        kind: "ok",
        text: isAdmin && targetMode === "past"
          ? `Backdated — ${fmtMoney(total)} added to that closed shift's inventory/expenses, and its expected cash/discrepancy was recalculated.`
          : res.status === "approved"
          ? paymentStatus === "unpaid"
            ? `Approved instantly — ${fmtMoney(total)} added to inventory, recorded as unpaid until settled.`
            : `Approved instantly — ${fmtMoney(total)} added to inventory.`
          : `Submitted for admin approval — ${fmtMoney(total)} is pending, no stock or cash effect yet.`,
      });
      reset();
    } catch (e) {
      // A genuine unexpected failure (network drop, etc.) — without this,
      // the button would silently stop spinning with no message at all.
      setResult({ kind: "err", text: e instanceof Error ? e.message : "Something went wrong — please try again." });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      {isAdmin && (
        <div className="mb-4">
          <label className="text-xs uppercase tracking-widest text-muted-foreground">Shift / Date</label>
          <div className="grid grid-cols-2 gap-2 mt-1">
            <button
              type="button"
              onClick={() => { setTargetMode("current"); setTargetShiftId(""); }}
              className={`text-sm font-semibold py-2.5 px-3 rounded-lg border transition ${
                targetMode === "current"
                  ? "bg-[oklch(0.78_0.2_155/0.2)] border-[oklch(0.78_0.2_155/0.6)] text-[oklch(0.78_0.2_155)]"
                  : "bg-black/5 border-black/10 text-muted-foreground hover:bg-black/8"
              }`}
            >
              Current Active Shift
            </button>
            <button
              type="button"
              onClick={() => setTargetMode("past")}
              className={`text-sm font-semibold py-2.5 px-3 rounded-lg border transition ${
                targetMode === "past"
                  ? "bg-black/20 border-black/60 text-white"
                  : "bg-black/5 border-black/10 text-muted-foreground hover:bg-black/8"
              }`}
            >
              Past Closed Shift / Date
            </button>
          </div>
          {targetMode === "past" && (
            <div className="mt-2">
              <select
                value={targetShiftId}
                onChange={(e) => setTargetShiftId(e.target.value)}
                className="w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm"
              >
                <option value="">Select a closed shift...</option>
                {closedShifts.map((s) => (
                  <option key={s.id} value={s.id}>
                    {businessDayLabelForTs(s.openedAt)} — {s.cashierUsername}, opened {new Date(s.openedAt).toLocaleString()} (Shift #{s.id})
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-black mt-1.5">
                Stock still arrives now, but this expense reports under that shift's day (shown above), and its expected cash/discrepancy is recalculated immediately.
              </p>
            </div>
          )}
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="text-xs uppercase tracking-widest text-muted-foreground">Material</label>
          <div className="mt-1">
            <SearchableMaterialSelect materials={state.materials} value={materialId} onChange={setMaterialId} />
          </div>
        </div>
        <div>
          <label className="text-xs uppercase tracking-widest text-muted-foreground">Supplier (optional)</label>
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm">
            <option value="">None</option>
            {state.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs uppercase tracking-widest text-muted-foreground">Quantity {material ? `(${material.unit})` : ""}</label>
          <input type="number" step="0.01" value={qty} onChange={(e) => setQty(e.target.value)} className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm font-mono" />
        </div>
        <div>
          <label className="text-xs uppercase tracking-widest text-muted-foreground">Unit Cost</label>
          <input type="number" step="0.01" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm font-mono" />
        </div>
        <div className="md:col-span-2">
          <label className="text-xs uppercase tracking-widest text-muted-foreground">Description (optional)</label>
          <input value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm" />
        </div>

        <div className="md:col-span-2">
          <label className="text-xs uppercase tracking-widest text-muted-foreground">Payment Status / حالة الدفع</label>
          <div className="grid grid-cols-2 gap-2 mt-1">
            <button
              type="button"
              onClick={() => setPaymentStatus("paid")}
              className={`text-sm font-semibold py-2.5 px-3 rounded-lg border transition ${
                paymentStatus === "paid"
                  ? "bg-[oklch(0.78_0.2_155/0.2)] border-[oklch(0.78_0.2_155/0.6)] text-[oklch(0.78_0.2_155)]"
                  : "bg-black/5 border-black/10 text-muted-foreground hover:bg-black/8"
              }`}
            >
              Paid
            </button>
            <button
              type="button"
              onClick={() => { setPaymentStatus("unpaid"); setPaymentSource(""); }}
              className={`text-sm font-semibold py-2.5 px-3 rounded-lg border transition ${
                paymentStatus === "unpaid"
                  ? "bg-black/20 border-black/60 text-black"
                  : "bg-black/5 border-black/10 text-muted-foreground hover:bg-black/8"
              }`}
            >
              Unpaid (Debt)
            </button>
          </div>
        </div>

        {paymentStatus === "paid" ? (
          <div className="md:col-span-2">
            <label className="text-xs uppercase tracking-widest text-muted-foreground">Payment Source / طريقة الدفع (required)</label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-1">
              {(Object.keys(PAYMENT_SOURCE_LABELS) as PaymentSource[]).map((src) => {
                const Icon = PAYMENT_SOURCE_ICONS[src];
                return (
                  <button
                    key={src}
                    type="button"
                    onClick={() => { setPaymentSource(src); setExpenseScope(src === "monthly_payment" ? "monthly" : "daily_shift"); }}
                    className={`flex items-center gap-2 text-xs py-2.5 px-3 rounded-lg border transition ${
                      paymentSource === src
                        ? "bg-black/20 border-black/60 text-[#2b2416] font-semibold"
                        : "bg-black/5 border-black/10 text-muted-foreground hover:bg-black/8"
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" /> {PAYMENT_SOURCE_LABELS[src]}
                  </button>
                );
              })}
            </div>
            {paymentSource === "cash_drawer" && (
              <p className="text-[11px] text-black mt-1.5">Deducts from the active shift's expected cash.</p>
            )}
            {!activeShift && paymentSource === "cash_drawer" && (
              <p className="text-[11px] text-black mt-1.5">No active shift — this won't be tied to a specific shift's drawer.</p>
            )}
            {paymentSource === "monthly_payment" && (
              <p className="text-[11px] text-black mt-1.5">Deducted from this month's revenue — never tied to a shift's drawer, and counted under Fixed Monthly Costs in the Monthly P&L.</p>
            )}
            {showExpenseScope && (
              <div className="mt-3">
                <label className="text-xs uppercase tracking-widest text-muted-foreground">خيارات طريقة الخصم — Deduct this purchase from</label>
                <div className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {EXPENSE_SCOPE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setExpenseScope(opt.value)}
                      title={opt.hint}
                      className={`text-left py-2 px-3 rounded-lg border transition ${
                        expenseScope === opt.value
                          ? "bg-[oklch(0.7_0.19_260/0.2)] border-[oklch(0.7_0.19_260/0.6)] text-[#2b2416]"
                          : "bg-white/70 border-black/10 text-muted-foreground hover:bg-black/8"
                      }`}
                    >
                      <div className="text-sm font-bold" dir="rtl">{opt.labelAr}</div>
                      <div className="text-[10px] uppercase tracking-widest mt-0.5">{opt.labelEn}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="md:col-span-2 text-xs text-muted-foreground bg-black/5 border border-black/8 rounded-lg p-3">
            The material still arrives and lands in inventory immediately — this just means no money has left the
            drawer or safe yet. Won't affect any shift's cash total until it's settled on the
            <strong> Unpaid Expenses</strong> page.
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center gap-2 text-sm font-mono">
        <span className="text-muted-foreground">Total:</span>
        <span className="font-bold text-lg">{fmtMoney(total)}</span>
      </div>

      {result && (
        <div className={`mt-4 text-sm p-3 rounded-lg border ${result.kind === "ok" ? "bg-[oklch(0.78_0.2_155/0.1)] border-[oklch(0.78_0.2_155/0.4)] text-[oklch(0.78_0.2_155)]" : "bg-[oklch(0.62_0.24_25/0.1)] border-[oklch(0.62_0.24_25/0.4)] text-[oklch(0.62_0.24_25)]"}`}>
          {result.text}
        </div>
      )}

      <button
        onClick={submit}
        disabled={submitting}
        className="mt-4 w-full py-3 rounded-lg bg-gradient-to-r from-[oklch(0.7_0.19_260)] to-[oklch(0.65_0.24_305)] text-[#2b2416] font-semibold text-sm disabled:opacity-60"
      >
        {submitting ? "Submitting..." : isAdmin ? "Submit & Approve" : "Submit for Approval"}
      </button>
    </div>
  );
}

// Genuinely separate from material purchases — free-text item/category
// (not tied to Raw Materials), no inventory or batch interaction, and a
// Paid/Unpaid toggle that conditionally shows Payment Source (unpaid
// means no money has moved yet, so there's nothing to pick a source for).
function ExpenseSubmitForm() {
  const { state, activeShift, submitExpense, submitBackdatedExpense } = useStore();
  const isAdmin = state.currentUser?.role === "admin";

  const [itemName, setItemName] = useState("");
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [paymentStatus, setPaymentStatus] = useState<"paid" | "unpaid">("paid");
  const [paymentSource, setPaymentSource] = useState<PaymentSource | "">("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // Admin-only: assign this expense to an already-closed shift instead of
  // the current one, backdating it into that shift's own totals/reports.
  const [targetMode, setTargetMode] = useState<"current" | "past">("current");
  const [targetShiftId, setTargetShiftId] = useState("");
  const closedShifts = [...state.shifts]
    .filter((s) => s.closedAt !== null)
    .sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0));

  // Optional Inventory Sync — this general/daily expense is actually a
  // stock purchase (a cleaning supply, an ingredient bought via petty
  // cash...), so it can update stock the same way a Daily/Stocked
  // Purchase or a Fixed Monthly Cost does. Mirrors
  // FixedMonthlyCostFormModal's own Inventory Sync fields exactly, down
  // to the amount being derived (never separately entered) once linked.
  const [linkInventory, setLinkInventory] = useState(false);
  const [materialId, setMaterialId] = useState("");
  const [qty, setQty] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const material = state.materials.find((m) => m.id === materialId);
  const inventoryTotal = (parseFloat(qty) || 0) * (parseFloat(unitCost) || 0);

  const reset = () => {
    setItemName(""); setCategory(""); setAmount(""); setNotes(""); setSupplierId(""); setPaymentStatus("paid"); setPaymentSource("");
    setTargetMode("current"); setTargetShiftId("");
    setLinkInventory(false); setMaterialId(""); setQty(""); setUnitCost("");
  };

  const submit = async () => {
    setResult(null);
    if (!itemName) { setResult({ kind: "err", text: "Item/expense description is required." }); return; }
    if (linkInventory) {
      if (!materialId) { setResult({ kind: "err", text: "Select which material this stock purchase is for." }); return; }
      if (!(parseFloat(qty) > 0)) { setResult({ kind: "err", text: "Enter a valid quantity." }); return; }
      if (!(parseFloat(unitCost) > 0)) { setResult({ kind: "err", text: "Enter a valid unit price." }); return; }
    } else if (!amount) {
      setResult({ kind: "err", text: "Amount is required." }); return;
    }
    if (paymentStatus === "paid" && !paymentSource) { setResult({ kind: "err", text: "Select a payment source, or mark this Unpaid instead." }); return; }
    if (isAdmin && targetMode === "past" && !targetShiftId) { setResult({ kind: "err", text: "Select which closed shift this expense belongs to." }); return; }
    setSubmitting(true);
    const displayTotal = linkInventory ? inventoryTotal : parseFloat(amount);
    try {
      if (isAdmin && targetMode === "past") {
        const res = await submitBackdatedExpense({
          itemName,
          category: category || undefined,
          amount: linkInventory ? inventoryTotal : parseFloat(amount),
          notes: notes || undefined,
          supplierId: supplierId || undefined,
          paymentStatus,
          paymentSource: paymentStatus === "paid" ? (paymentSource as PaymentSource) : undefined,
          targetShiftId,
          materialId: linkInventory ? materialId : undefined,
          qty: linkInventory ? parseFloat(qty) : undefined,
          unitCost: linkInventory ? parseFloat(unitCost) : undefined,
        });
        if (!res.ok) { setResult({ kind: "err", text: res.error ?? "Submission failed" }); return; }
        setResult({ kind: "ok", text: `Backdated — ${fmtMoney(displayTotal)} added to that closed shift, and its expected cash/discrepancy was recalculated.` });
        reset();
        return;
      }
      const res = await submitExpense({
        itemName,
        category: category || undefined,
        amount: linkInventory ? inventoryTotal : parseFloat(amount),
        notes: notes || undefined,
        supplierId: supplierId || undefined,
        paymentStatus,
        paymentSource: paymentStatus === "paid" ? (paymentSource as PaymentSource) : undefined,
        materialId: linkInventory ? materialId : undefined,
        qty: linkInventory ? parseFloat(qty) : undefined,
        unitCost: linkInventory ? parseFloat(unitCost) : undefined,
      });
      if (!res.ok) { setResult({ kind: "err", text: res.error ?? "Submission failed" }); return; }
      setResult({
        kind: "ok",
        text: res.status === "approved"
          ? paymentStatus === "unpaid"
            ? `Logged — ${fmtMoney(displayTotal)} recorded as unpaid, showing on the Unpaid Expenses page until settled.`
            : `Approved instantly — ${fmtMoney(displayTotal)}${linkInventory ? " added to inventory" : " recorded"}.`
          : `Submitted for admin approval — ${fmtMoney(displayTotal)} is pending, no effect yet.`,
      });
      reset();
    } catch (e) {
      setResult({ kind: "err", text: e instanceof Error ? e.message : "Something went wrong — please try again." });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      {isAdmin && (
        <div className="mb-4">
          <label className="text-xs uppercase tracking-widest text-muted-foreground">Shift / Date</label>
          <div className="grid grid-cols-2 gap-2 mt-1">
            <button
              type="button"
              onClick={() => { setTargetMode("current"); setTargetShiftId(""); }}
              className={`text-sm font-semibold py-2.5 px-3 rounded-lg border transition ${
                targetMode === "current"
                  ? "bg-[oklch(0.78_0.2_155/0.2)] border-[oklch(0.78_0.2_155/0.6)] text-[oklch(0.78_0.2_155)]"
                  : "bg-black/5 border-black/10 text-muted-foreground hover:bg-black/8"
              }`}
            >
              Current Active Shift
            </button>
            <button
              type="button"
              onClick={() => setTargetMode("past")}
              className={`text-sm font-semibold py-2.5 px-3 rounded-lg border transition ${
                targetMode === "past"
                  ? "bg-black/20 border-black/60 text-white"
                  : "bg-black/5 border-black/10 text-muted-foreground hover:bg-black/8"
              }`}
            >
              Past Closed Shift / Date
            </button>
          </div>
          {targetMode === "past" && (
            <div className="mt-2">
              <select
                value={targetShiftId}
                onChange={(e) => setTargetShiftId(e.target.value)}
                className="w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm"
              >
                <option value="">Select a closed shift...</option>
                {closedShifts.map((s) => (
                  <option key={s.id} value={s.id}>
                    {businessDayLabelForTs(s.openedAt)} — {s.cashierUsername}, opened {new Date(s.openedAt).toLocaleString()} (Shift #{s.id})
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-black mt-1.5">
                This expense will be dated to the day shown above (that shift's own business day) and inserted into that shift's expense log; its expected cash / discrepancy will be recalculated. Logged as an admin action.
              </p>
            </div>
          )}
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="text-xs uppercase tracking-widest text-muted-foreground">Item / Expense Name</label>
          <input value={itemName} onChange={(e) => setItemName(e.target.value)} placeholder="e.g. Printer paper, delivery fee, repairs..." className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="text-xs uppercase tracking-widest text-muted-foreground">Category (optional)</label>
          <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Office Supplies, Maintenance..." className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="text-xs uppercase tracking-widest text-muted-foreground">Amount (EGP)</label>
          <input
            type="number" step="0.01" value={linkInventory ? inventoryTotal.toFixed(2) : amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={linkInventory}
            className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm font-mono disabled:opacity-60"
          />
          {linkInventory && (
            <p className="text-[11px] text-muted-foreground mt-1">Calculated automatically from quantity × unit price below.</p>
          )}
        </div>
        <div>
          <label className="text-xs uppercase tracking-widest text-muted-foreground">Supplier (optional)</label>
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm">
            <option value="">None</option>
            {state.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="text-xs uppercase tracking-widest text-muted-foreground">Notes (optional)</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm" />
        </div>

        <div className="md:col-span-2">
          <label className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground cursor-pointer">
            <input type="checkbox" checked={linkInventory} onChange={(e) => setLinkInventory(e.target.checked)} className="w-3.5 h-3.5" />
            Inventory Sync — this expense is for a stock purchase (optional)
          </label>
          {linkInventory && (
            <div className="mt-2 rounded-lg bg-black/[0.03] border border-black/10 p-3 space-y-3">
              <div>
                <label className="text-xs uppercase tracking-widest text-muted-foreground">Material</label>
                <div className="mt-1">
                  <SearchableMaterialSelect materials={state.materials} value={materialId} onChange={setMaterialId} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs uppercase tracking-widest text-muted-foreground">Quantity {material ? `(${material.unit})` : ""}</label>
                  <input type="number" min="0" step="0.01" value={qty} onChange={(e) => setQty(e.target.value)} className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm font-mono" />
                </div>
                <div>
                  <label className="text-xs uppercase tracking-widest text-muted-foreground">Unit Price</label>
                  <input type="number" min="0" step="0.01" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm font-mono" />
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Adds {qty || "0"} {material?.unit ?? ""} of {material?.name ?? "the selected material"} to stock
                {isAdmin ? " immediately" : " once an admin approves this"}, and shows up in Inventory's stock-movement history — same as a Daily Expense material purchase.
              </p>
            </div>
          )}
        </div>

        <div className="md:col-span-2">
          <label className="text-xs uppercase tracking-widest text-muted-foreground">Payment Status / حالة الدفع</label>
          <div className="grid grid-cols-2 gap-2 mt-1">
            <button
              type="button"
              onClick={() => setPaymentStatus("paid")}
              className={`text-sm font-semibold py-2.5 px-3 rounded-lg border transition ${
                paymentStatus === "paid"
                  ? "bg-[oklch(0.78_0.2_155/0.2)] border-[oklch(0.78_0.2_155/0.6)] text-[oklch(0.78_0.2_155)]"
                  : "bg-black/5 border-black/10 text-muted-foreground hover:bg-black/8"
              }`}
            >
              Paid
            </button>
            <button
              type="button"
              onClick={() => { setPaymentStatus("unpaid"); setPaymentSource(""); }}
              className={`text-sm font-semibold py-2.5 px-3 rounded-lg border transition ${
                paymentStatus === "unpaid"
                  ? "bg-black/20 border-black/60 text-white"
                  : "bg-black/5 border-black/10 text-muted-foreground hover:bg-black/8"
              }`}
            >
              Unpaid (Debt)
            </button>
          </div>
        </div>

        {paymentStatus === "paid" ? (
          <div className="md:col-span-2">
            <label className="text-xs uppercase tracking-widest text-muted-foreground">Payment Source / طريقة الدفع (required)</label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-1">
              {(Object.keys(PAYMENT_SOURCE_LABELS) as PaymentSource[]).map((src) => {
                const Icon = PAYMENT_SOURCE_ICONS[src];
                return (
                  <button
                    key={src}
                    type="button"
                    onClick={() => setPaymentSource(src)}
                    className={`flex items-center gap-2 text-xs py-2.5 px-3 rounded-lg border transition ${
                      paymentSource === src
                        ? "bg-black/20 border-black/60 text-[#2b2416] font-semibold"
                        : "bg-black/5 border-black/10 text-muted-foreground hover:bg-black/8"
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" /> {PAYMENT_SOURCE_LABELS[src]}
                  </button>
                );
              })}
            </div>
            {paymentSource === "cash_drawer" && (
              <p className="text-[11px] text-black mt-1.5">Deducts from the active shift's expected cash.</p>
            )}
            {!activeShift && paymentSource === "cash_drawer" && (
              <p className="text-[11px] text-black mt-1.5">No active shift — this won't be tied to a specific shift's drawer.</p>
            )}
            {paymentSource === "monthly_payment" && (
              <p className="text-[11px] text-black mt-1.5">Deducted from this month's revenue — never tied to a shift's drawer, and counted under Fixed Monthly Costs in the Monthly P&L.</p>
            )}
          </div>
        ) : (
          <div className="md:col-span-2 text-xs text-muted-foreground bg-black/5 border border-black/8 rounded-lg p-3">
            No money has left the drawer or safe yet — this won't affect any shift's cash total until it's settled on the
            <strong> Unpaid Expenses</strong> page.
          </div>
        )}
      </div>

      {result && (
        <div className={`mt-4 text-sm p-3 rounded-lg border ${result.kind === "ok" ? "bg-[oklch(0.78_0.2_155/0.1)] border-[oklch(0.78_0.2_155/0.4)] text-[oklch(0.78_0.2_155)]" : "bg-[oklch(0.62_0.24_25/0.1)] border-[oklch(0.62_0.24_25/0.4)] text-[oklch(0.62_0.24_25)]"}`}>
          {result.text}
        </div>
      )}

      <button
        onClick={submit}
        disabled={submitting}
        className="mt-4 w-full py-3 rounded-lg bg-gradient-to-r from-[oklch(0.7_0.19_260)] to-[oklch(0.65_0.24_305)] text-[#2b2416] font-semibold text-sm disabled:opacity-60"
      >
        {submitting ? "Submitting..." : isAdmin && targetMode === "past" ? "Add to Closed Shift" : isAdmin ? "Submit & Approve" : "Submit for Approval"}
      </button>
    </div>
  );
}

// This café's local date, Africa/Cairo -- same reasoning as every
// other date default/picker-bound in this app (Reports.tsx's
// cairoDateLabel): the browser's own timezone shouldn't decide which
// calendar day "today" defaults to.
const CAIRO_TZ_FORMATTER = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" });
function cairoDateLabel(ts: number): string {
  return CAIRO_TZ_FORMATTER.format(new Date(ts));
}

// The REAL fix for the "shift date 2026-09-29 saves as 2026-09-28"
// report: the backend (expenseDateForShift_ in Code.gs/shifts.js)
// has always correctly dated a shift-linked expense by that shift's
// OWN business day -- businessDayLabelForTs_(shift.openedAt), using
// this café's real 8:00 AM-to-8:00 AM operating cycle with a 30-min
// grace window (mirrors Reports.tsx's businessDayBounds exactly) --
// NOT by the raw calendar date of whatever timestamp happens to be
// nearby. The actual bug was here on the frontend: the "Past Closed
// Shift" picker below used to show each shift by its CLOSE time
// (new Date(s.closedAt).toLocaleString(), in the viewing browser's
// own timezone) rather than by that same business-day label. An
// overnight shift that opened at, say, 1 AM on the 29th belongs to
// the 28th's business day (same rule a 1 AM customer sale would
// follow) -- but its closedAt could easily read "Sep 29" in the
// dropdown, leading an admin to reasonably expect an expense picked
// against it to land on the 29th, when it was always correctly going
// to land on the 28th. Showing the SAME label here that the backend
// will actually save under removes that mismatch entirely, with no
// backend change needed since the backend was never wrong.
const BUSINESS_DAY_GRACE_MS = 8 * 3600000 - 30 * 60000;
function businessDayLabelForTs(ts: number): string {
  return cairoDateLabel(ts - BUSINESS_DAY_GRACE_MS);
}

// السلف والخصومات الشهرية — Advances & Monthly Loans. Admin-only,
// deliberately the simplest form in this file: a single free-text
// recipient name (not tied to a Staff Member record, since suppliers
// can receive advances too) and a plain calendar date, no shift
// binding at all -- recordStaffAdvance_ never touches a shift's drawer
// or Daily Net Sales, so there's nothing here to pick a payment source
// or shift for. Shows up afterward in Reports' Advances & Monthly
// Loans panel, and is deducted from Net Profit only at month-end.
function AdvancesForm() {
  const { recordStaffAdvance } = useStore();
  const [recipientName, setRecipientName] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(() => cairoDateLabel(Date.now()));
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const reset = () => {
    setRecipientName(""); setAmount(""); setReason(""); setDate(cairoDateLabel(Date.now()));
  };

  const submit = async () => {
    setResult(null);
    if (!recipientName.trim()) { setResult({ kind: "err", text: "Enter the employee/recipient's name." }); return; }
    if (!(parseFloat(amount) > 0)) { setResult({ kind: "err", text: "Enter a valid advance amount." }); return; }
    setSubmitting(true);
    try {
      const res = await recordStaffAdvance({ recipientName: recipientName.trim(), amount: parseFloat(amount), reason: reason.trim() || undefined, date });
      if (!res.ok) { setResult({ kind: "err", text: res.error ?? "Could not log this advance." }); return; }
      setResult({ kind: "ok", text: `Logged — ${fmtMoney(parseFloat(amount))} to ${recipientName.trim()}. Deducted only from Monthly Net Profit at month-end, never from today's shift.` });
      reset();
    } catch (e) {
      setResult({ kind: "err", text: e instanceof Error ? e.message : "Something went wrong — please try again." });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div className="mb-4 text-xs text-muted-foreground bg-black/5 border border-black/8 rounded-lg p-3" dir="rtl">
        مستقلة تماماً عن إيراد اليوم — لا يتم خصمها من درج النقدية الخاص بالشيفت الحالي أو من صافي المبيعات اليومية.
        تُخصم فقط من الإيرادات/الأرباح الشهرية في نهاية الشهر.
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="text-xs uppercase tracking-widest text-muted-foreground">Employee / Recipient Name — اسم الموظف / المستلم</label>
          <input value={recipientName} onChange={(e) => setRecipientName(e.target.value)} dir="auto" className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="text-xs uppercase tracking-widest text-muted-foreground">Advance Amount EGP — مبلغ السلفة</label>
          <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm font-mono" />
        </div>
        <div>
          <label className="text-xs uppercase tracking-widest text-muted-foreground">Date — تاريخ الحركة</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} max={cairoDateLabel(Date.now())} className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm font-mono" />
        </div>
        <div>
          <label className="text-xs uppercase tracking-widest text-muted-foreground">Notes / Reason — السبب / البيان (optional)</label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} dir="auto" className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm" />
        </div>
      </div>

      {result && (
        <div className={`mt-4 text-sm p-3 rounded-lg border ${result.kind === "ok" ? "bg-[oklch(0.78_0.2_155/0.1)] border-[oklch(0.78_0.2_155/0.4)] text-[oklch(0.78_0.2_155)]" : "bg-[oklch(0.62_0.24_25/0.1)] border-[oklch(0.62_0.24_25/0.4)] text-[oklch(0.62_0.24_25)]"}`}>
          {result.text}
        </div>
      )}

      <button
        onClick={() => void submit()}
        disabled={submitting}
        className="mt-4 w-full py-3 rounded-lg bg-gradient-to-r from-[oklch(0.7_0.19_260)] to-[oklch(0.65_0.24_305)] text-[#2b2416] font-semibold text-sm disabled:opacity-60"
      >
        {submitting ? "Saving..." : "Log Advance / تسجيل السلفة"}
      </button>
    </div>
  );
}

// tracked: true  -- "بند مخزني" / Standard Material (In Stock): picked
//   from the materials dropdown, updates stock (Batches + RawMaterials
//   cost) exactly like before.
// tracked: false -- "بند غير مخزني" / Custom Expense (Non-Stock): a
//   free-typed name (cleaning supplies, maintenance, etc.) that counts
//   toward the invoice total and the supplier's balance/ledger but
//   never touches inventory -- no Batches row, no RawMaterials update,
//   so it can never show up in a shift's physical-count/discrepancy
//   audit.
type InvoiceLineItem = { tracked: boolean; materialId: string; itemName: string; qty: string; unitPrice: string };

function SupplierInvoiceForm() {
  const { state, activeShift, submitPurchaseInvoice } = useStore();

  const [supplierId, setSupplierId] = useState("");
  // cairoDateLabel(Date.now()), NOT new Date().toISOString().slice(0,10)
  // -- toISOString() reads off the UTC calendar date, which is still
  // YESTERDAY from midnight to 2:59 AM Cairo time (UTC+3 in summer,
  // +2 in winter) -- this defaulted the picker to the wrong day for
  // anyone opening this form in the small hours.
  const [invoiceDate, setInvoiceDate] = useState(() => cairoDateLabel(Date.now()));
  const [paymentType, setPaymentType] = useState<"cash" | "deferred">("cash");
  const [paymentSource, setPaymentSource] = useState<PaymentSource | "">("");
  const [items, setItems] = useState<InvoiceLineItem[]>([{ tracked: true, materialId: "", itemName: "", qty: "", unitPrice: "" }]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const supplier = state.suppliers.find((s) => s.id === supplierId);
  const total = items.reduce((a, it) => a + (parseFloat(it.qty) || 0) * (parseFloat(it.unitPrice) || 0), 0);

  const updateItem = (idx: number, patch: Partial<InvoiceLineItem>) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };
  const addLine = () => setItems((prev) => [...prev, { tracked: true, materialId: "", itemName: "", qty: "", unitPrice: "" }]);
  const removeLine = (idx: number) => setItems((prev) => prev.filter((_, i) => i !== idx));

  const reset = () => {
    setSupplierId(""); setInvoiceDate(cairoDateLabel(Date.now())); setPaymentType("cash"); setPaymentSource("");
    setItems([{ tracked: true, materialId: "", itemName: "", qty: "", unitPrice: "" }]);
  };

  const submit = async () => {
    setResult(null);
    if (!supplierId) { setResult({ kind: "err", text: "Select a supplier." }); return; }
    const validItems = items.filter((it) => (it.tracked ? !!it.materialId : !!it.itemName.trim()) && parseFloat(it.qty) > 0);
    if (validItems.length === 0) { setResult({ kind: "err", text: "Add at least one line item with a material (or item name) and quantity." }); return; }
    if (paymentType === "cash" && !paymentSource) { setResult({ kind: "err", text: "Select a payment source, or mark this Deferred instead." }); return; }
    // A blank unit price used to be silently coerced to 0 below, which
    // let an invoice save (and then report) as EGP 0.00 -- most visibly
    // for Monthly Payment invoices, where the amount IS the whole point.
    // Every line needs an explicit price, and the invoice as a whole
    // can't total zero.
    if (validItems.some((it) => it.unitPrice.trim() === "" || !(parseFloat(it.unitPrice) >= 0))) {
      setResult({ kind: "err", text: "Enter a unit price for every line item." });
      return;
    }
    const invoiceTotal = validItems.reduce((a, it) => a + parseFloat(it.qty) * parseFloat(it.unitPrice), 0);
    if (!(invoiceTotal > 0)) { setResult({ kind: "err", text: "The invoice total can't be 0.00 — check the quantities and unit prices." }); return; }
    setSubmitting(true);
    try {
      const res = await submitPurchaseInvoice({
        supplierId,
        supplierName: supplier?.name || "",
        // Send the plain "YYYY-MM-DD" string as-is -- NOT
        // new Date(invoiceDate).getTime() -- so the backend (which
        // anchors it at Cairo noon via resolveDateInput_/
        // cairoMiddayTimestamp_) is the only place a timestamp gets
        // constructed, instead of also doing it here where the result
        // would depend on this browser's own system timezone.
        invoiceDate,
        paymentType,
        paymentSource: paymentType === "cash" ? (paymentSource as PaymentSource) : undefined,
        items: validItems.map((it) => (
          it.tracked
            ? { materialId: it.materialId, qty: parseFloat(it.qty), unitPrice: parseFloat(it.unitPrice) || 0 }
            // No materialId at all -- this is what tells the backend to
            // skip Batches/RawMaterials entirely for this line, not just
            // an empty string (which would fail the "material not found"
            // check instead of being treated as non-stock).
            : { itemName: it.itemName.trim(), qty: parseFloat(it.qty), unitPrice: parseFloat(it.unitPrice) || 0 }
        )),
      });
      if (!res.ok) { setResult({ kind: "err", text: res.error ?? "Submission failed" }); return; }
      setResult({
        kind: "ok",
        text: paymentType === "deferred"
          ? `Invoice logged — ${fmtMoney(res.totalAmount ?? total)} added to inventory, added to ${supplier?.name}'s outstanding balance.`
          : `Invoice logged — ${fmtMoney(res.totalAmount ?? total)} added to inventory and paid.`,
      });
      reset();
    } catch (e) {
      setResult({ kind: "err", text: e instanceof Error ? e.message : "Something went wrong — please try again." });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <div>
          <label className="text-xs uppercase tracking-widest text-muted-foreground">Supplier</label>
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm">
            <option value="">Select supplier...</option>
            {state.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs uppercase tracking-widest text-muted-foreground">Invoice Date</label>
          <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm" />
        </div>
      </div>

      <div className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">Line Items</div>
      <div className="space-y-2">
        {items.map((it, idx) => {
          const subtotal = (parseFloat(it.qty) || 0) * (parseFloat(it.unitPrice) || 0);
          return (
            <div key={idx} className="bg-black/5 border border-black/8 rounded-lg p-2 space-y-2">
              <div className="flex rounded-lg border border-black/10 overflow-hidden w-fit text-[11px] font-semibold">
                <button
                  type="button"
                  onClick={() => updateItem(idx, { tracked: true })}
                  className={`px-2.5 py-1 transition ${it.tracked ? "bg-[oklch(0.78_0.2_155/0.25)] text-[oklch(0.78_0.2_155)]" : "bg-white/70 text-muted-foreground hover:bg-black/8"}`}
                >
                  Standard Material / بند مخزني
                </button>
                <button
                  type="button"
                  onClick={() => updateItem(idx, { tracked: false })}
                  className={`px-2.5 py-1 border-l border-black/10 transition ${!it.tracked ? "bg-black/20 text-[#2b2416]" : "bg-white/70 text-muted-foreground hover:bg-black/8"}`}
                >
                  Custom Expense (Non-Stock) / بند غير مخزني
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-[1fr_100px_120px_110px_32px] gap-2 items-center">
                {it.tracked ? (
                  <SearchableMaterialSelect materials={state.materials} value={it.materialId} onChange={(id) => updateItem(idx, { materialId: id })} />
                ) : (
                  <input
                    type="text" placeholder="Item name (e.g. cleaning supplies, maintenance)"
                    value={it.itemName} onChange={(e) => updateItem(idx, { itemName: e.target.value })}
                    className="bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm"
                  />
                )}
                <input type="number" step="0.01" placeholder="Qty" value={it.qty} onChange={(e) => updateItem(idx, { qty: e.target.value })} className="bg-white/70 border border-black/10 rounded-lg px-2 py-2 text-sm font-mono" />
                <input type="number" step="0.01" placeholder="Unit price" value={it.unitPrice} onChange={(e) => updateItem(idx, { unitPrice: e.target.value })} className="bg-white/70 border border-black/10 rounded-lg px-2 py-2 text-sm font-mono" />
                <div className="text-sm font-mono font-semibold text-right px-1">{fmtMoney(subtotal)}</div>
                <button type="button" onClick={() => removeLine(idx)} disabled={items.length === 1} className="text-muted-foreground hover:text-[oklch(0.62_0.24_25)] disabled:opacity-30 justify-self-center">
                  <XCircle className="w-4 h-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <button type="button" onClick={addLine} className="mt-2 text-xs px-3 py-1.5 rounded-lg bg-black/5 border border-black/10 hover:bg-black/8">+ Add Item</button>

      <div className="mt-4">
        <label className="text-xs uppercase tracking-widest text-muted-foreground">Payment Type / نوع الدفع</label>
        <div className="grid grid-cols-2 gap-2 mt-1">
          <button
            type="button"
            onClick={() => setPaymentType("cash")}
            className={`text-sm font-semibold py-2.5 px-3 rounded-lg border transition ${
              paymentType === "cash"
                ? "bg-[oklch(0.78_0.2_155/0.2)] border-[oklch(0.78_0.2_155/0.6)] text-[oklch(0.78_0.2_155)]"
                : "bg-black/5 border-black/10 text-muted-foreground hover:bg-black/8"
            }`}
          >
            Cash / كاش
          </button>
          <button
            type="button"
            onClick={() => { setPaymentType("deferred"); setPaymentSource(""); }}
            className={`text-sm font-semibold py-2.5 px-3 rounded-lg border transition ${
              paymentType === "deferred"
                ? "bg-black/20 border-black/60 text-black"
                : "bg-black/5 border-black/10 text-muted-foreground hover:bg-black/8"
            }`}
          >
            Deferred / آجل
          </button>
        </div>
      </div>

      {paymentType === "cash" ? (
        <div className="mt-3">
          <label className="text-xs uppercase tracking-widest text-muted-foreground">Payment Source / طريقة الدفع (required)</label>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-1">
            {(Object.keys(PAYMENT_SOURCE_LABELS) as PaymentSource[]).map((src) => {
              const Icon = PAYMENT_SOURCE_ICONS[src];
              return (
                <button
                  key={src}
                  type="button"
                  onClick={() => setPaymentSource(src)}
                  className={`flex items-center gap-2 text-xs py-2.5 px-3 rounded-lg border transition ${
                    paymentSource === src
                      ? "bg-black/20 border-black/60 text-[#2b2416] font-semibold"
                      : "bg-black/5 border-black/10 text-muted-foreground hover:bg-black/8"
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" /> {PAYMENT_SOURCE_LABELS[src]}
                </button>
              );
            })}
          </div>
          {paymentSource === "cash_drawer" && (
            <p className="text-[11px] text-black mt-1.5">Deducts from the active shift's expected cash.</p>
          )}
          {!activeShift && paymentSource === "cash_drawer" && (
            <p className="text-[11px] text-black mt-1.5">No active shift — this won't be tied to a specific shift's drawer.</p>
          )}
          {paymentSource === "monthly_payment" && (
            <p className="text-[11px] text-black mt-1.5">Deducted from this month's revenue — never tied to a shift's drawer, and counted under Fixed Monthly Costs in the Monthly P&L.</p>
          )}
        </div>
      ) : (
        <div className="mt-3 text-xs text-muted-foreground bg-black/5 border border-black/8 rounded-lg p-3">
          Materials still arrive and land in inventory immediately — the full invoice amount is added to{" "}
          {supplier?.name ? <strong>{supplier.name}</strong> : "the supplier"}'s outstanding balance instead of
          affecting any shift's cash. Settle it later from the supplier's account statement.
        </div>
      )}

      <div className="mt-4 flex items-center gap-2 text-sm font-mono">
        <span className="text-muted-foreground">Total:</span>
        <span className="font-bold text-lg">{fmtMoney(total)}</span>
      </div>

      {result && (
        <div className={`mt-4 text-sm p-3 rounded-lg border ${result.kind === "ok" ? "bg-[oklch(0.78_0.2_155/0.1)] border-[oklch(0.78_0.2_155/0.4)] text-[oklch(0.78_0.2_155)]" : "bg-[oklch(0.62_0.24_25/0.1)] border-[oklch(0.62_0.24_25/0.4)] text-[oklch(0.62_0.24_25)]"}`}>
          {result.text}
        </div>
      )}

      <button
        onClick={submit}
        disabled={submitting}
        className="mt-4 w-full py-3 rounded-lg bg-gradient-to-r from-[oklch(0.7_0.19_260)] to-[oklch(0.65_0.24_305)] text-[#2b2416] font-semibold text-sm disabled:opacity-60"
      >
        {submitting ? "Submitting..." : "Save Invoice"}
      </button>
    </div>
  );
}

function SupplierAccountsPanel() {
  const { state, supplierBalances, refreshSupplierBalances } = useStore();
  const [openSupplierId, setOpenSupplierId] = useState<string | null>(null);

  useEffect(() => {
    void refreshSupplierBalances();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const suppliersWithBalance = state.suppliers
    .map((s) => ({ ...s, balance: supplierBalances[s.id] || 0 }))
    .filter((s) => s.balance > 0.01)
    .sort((a, b) => b.balance - a.balance);

  const totalOwed = suppliersWithBalance.reduce((a, s) => a + s.balance, 0);

  return (
    <div className="glass rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <History className="w-5 h-5 text-[oklch(0.7_0.19_260)]" />
          <h2 className="text-lg font-semibold">Supplier Accounts — كشف حساب الموردين</h2>
        </div>
        {totalOwed > 0 && (
          <div className="text-sm font-mono">
            <span className="text-muted-foreground">Total owed: </span>
            <span className="font-bold text-[oklch(0.62_0.24_25)]">{fmtMoney(totalOwed)}</span>
          </div>
        )}
      </div>

      {suppliersWithBalance.length === 0 ? (
        <div className="text-sm text-muted-foreground text-center py-6">No outstanding balances with any supplier.</div>
      ) : (
        <div className="space-y-2">
          {suppliersWithBalance.map((s) => (
            <button
              key={s.id}
              onClick={() => setOpenSupplierId(s.id)}
              className="w-full flex items-center justify-between px-4 py-3 rounded-lg bg-black/5 border border-black/8 hover:bg-black/8 text-left"
            >
              <span className="font-semibold">{s.name}</span>
              <span className="font-mono font-bold text-[oklch(0.62_0.24_25)]">{fmtMoney(s.balance)}</span>
            </button>
          ))}
        </div>
      )}

      {/* Every supplier gets a statement, even with zero balance — a
          fully paid-off history is still worth reviewing. */}
      <div className="mt-4 pt-4 border-t border-black/8">
        <label className="text-xs uppercase tracking-widest text-muted-foreground">View any supplier's full statement</label>
        <select
          value=""
          onChange={(e) => e.target.value && setOpenSupplierId(e.target.value)}
          className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm"
        >
          <option value="">Select supplier...</option>
          {state.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      {openSupplierId && <SupplierStatementModal supplierId={openSupplierId} onClose={() => setOpenSupplierId(null)} />}
    </div>
  );
}

function SupplierStatementModal({ supplierId, onClose }: { supplierId: string; onClose: () => void }) {
  const { state, getSupplierLedger, recordSupplierPayment, refreshSupplierBalances, deleteSupplierInvoice } = useStore();
  const isAdmin = state.currentUser?.role === "admin";
  const supplier = state.suppliers.find((s) => s.id === supplierId);

  const [entries, setEntries] = useState<SupplierLedgerEntry[]>([]);
  const [currentBalance, setCurrentBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showPayForm, setShowPayForm] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await getSupplierLedger(supplierId);
      if (res.ok && res.ledger) {
        setEntries(res.ledger.entries);
        setCurrentBalance(res.ledger.currentBalance);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierId]);

  return (
    // Lightened from a heavy bg-black/70 overlay: the admin recording a
    // payment here often needs to glance at the underlying page (another
    // supplier's balance, a different invoice) without the whole
    // background going dark. A near-transparent backdrop plus a solid,
    // clearly-bordered dialog of its own (below) gives separation from
    // the page without obscuring it.
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/10 backdrop-blur-[1px]" onClick={onClose}>
      <div className="w-[90vw] max-w-[1200px] max-h-[90vh] flex flex-col bg-white border border-black/15 shadow-2xl rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-5 border-b border-black/8 shrink-0">
          <div>
            <h3 className="text-xl font-bold">{supplier?.name || "Supplier"}</h3>
            <p className="text-sm text-muted-foreground">Account Statement</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-full flex items-center justify-center bg-black/5 hover:bg-black/10 text-muted-foreground hover:text-[#2b2416]" aria-label="Close">
            <XCircle className="w-6 h-6" />
          </button>
        </div>

        <div className="px-6 py-4 border-b border-black/8 flex items-center justify-between shrink-0">
          <div>
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Outstanding Balance</div>
            <div className={`text-3xl font-mono font-bold ${currentBalance > 0.01 ? "text-[oklch(0.62_0.24_25)]" : "text-[oklch(0.78_0.2_155)]"}`}>
              {fmtMoney(currentBalance)}
            </div>
          </div>
          <button
            onClick={() => setShowPayForm((v) => !v)}
            className="px-5 py-3 rounded-xl text-base font-bold bg-[oklch(0.78_0.2_155/0.15)] border-2 border-[oklch(0.78_0.2_155/0.5)] text-[oklch(0.78_0.2_155)] hover:bg-[oklch(0.78_0.2_155/0.25)]"
          >
            Record Payment
          </button>
        </div>

        {showPayForm && (
          <RecordSupplierPaymentForm
            supplierId={supplierId}
            outstandingInvoices={entries.filter((e) => e.type === "invoice" && e.paymentType === "deferred")}
            onDone={async () => {
              setShowPayForm(false);
              await load();
              await refreshSupplierBalances();
            }}
            onCancel={() => setShowPayForm(false)}
          />
        )}

        {/* min-h-0 is the actual fix for the clipping/overlap bug reported
            here: a flex child defaults to min-height:auto, which lets it
            grow to fit ALL its content and ignore the ancestor's
            max-h-[90vh] -- without it, a long ledger history just pushes
            this dialog taller than the viewport instead of scrolling
            inside it, and with this modal's deliberately near-transparent
            backdrop (bg-black/10, see SupplierStatementModal's own
            lightened backdrop), the overflow visually bleeds into the
            Pending Approvals / Purchase History page sections sitting
            behind it. Same root cause and fix as the Edit Invoice Modal. */}
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto px-6 py-5">
          {loading ? (
            <div className="text-sm text-muted-foreground text-center py-6">Loading...</div>
          ) : entries.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-6">No transactions with this supplier yet.</div>
          ) : (
            <table className="w-full text-sm min-w-[720px]">
              <thead className="sticky top-0 bg-white/95 backdrop-blur-sm">
                <tr className="text-left text-xs uppercase tracking-widest text-muted-foreground border-b border-black/10">
                  <th className="py-3 pr-3">Date</th>
                  <th className="py-3 pr-3">Type</th>
                  <th className="py-3 pr-3">Description</th>
                  <th className="py-3 pr-3 text-right">Debit</th>
                  <th className="py-3 pr-3 text-right">Credit</th>
                  <th className="py-3 pr-3 text-right">Balance</th>
                  <th className="py-3 pl-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="border-b border-black/5">
                    <td className="py-3 pr-3 text-muted-foreground font-mono">{new Date(e.ts).toLocaleDateString()}</td>
                    <td className="py-3 pr-3">
                      <span className={`px-2 py-1 rounded text-xs font-semibold ${e.type === "invoice" ? "bg-[oklch(0.62_0.24_25/0.12)] text-[oklch(0.62_0.24_25)]" : "bg-[oklch(0.78_0.2_155/0.12)] text-[oklch(0.78_0.2_155)]"}`}>
                        {e.type === "invoice" ? (e.paymentType === "cash" ? "Invoice (Cash)" : "Invoice") : "Payment"}
                      </span>
                    </td>
                    <td className="py-3 pr-3 max-w-sm truncate" title={e.description}>{e.description}</td>
                    <td className="py-3 pr-3 text-right font-mono">{e.debit > 0 ? fmtMoney(e.debit) : "—"}</td>
                    <td className="py-3 pr-3 text-right font-mono">{e.credit > 0 ? fmtMoney(e.credit) : "—"}</td>
                    <td className="py-3 pr-3 text-right font-mono font-semibold">{fmtMoney(e.runningBalance)}</td>
                    <td className="py-3 pl-3 text-right">
                      {isAdmin && (
                        <div className="flex items-center justify-end gap-3">
                          {e.type === "invoice" && (
                            <EditInvoiceButton entry={e} onSaved={async () => { await load(); await refreshSupplierBalances(); }} />
                          )}
                          {e.type === "invoice" ? (
                            <DeleteInvoiceButton invoiceId={e.id} onDeleted={async () => { await load(); await refreshSupplierBalances(); }} />
                          ) : (
                            <DeletePaymentButton paymentId={e.id} onDeleted={async () => { await load(); await refreshSupplierBalances(); }} />
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function DeleteInvoiceButton({ invoiceId, onDeleted }: { invoiceId: string; onDeleted: () => void }) {
  const { deleteSupplierInvoice } = useStore();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showForce, setShowForce] = useState(false);
  const blocked = !!err && err.toLowerCase().includes("already been used");

  const doDelete = async () => {
    setDeleting(true);
    setErr(null);
    try {
      const res = await deleteSupplierInvoice(invoiceId);
      if (!res.ok) { setErr(res.error ?? "Delete failed"); return; }
      setConfirming(false);
      onDeleted();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong — please try again.");
    } finally {
      setDeleting(false);
    }
  };

  if (!confirming) {
    return (
      <button onClick={() => setConfirming(true)} className="text-muted-foreground hover:text-[oklch(0.62_0.24_25)]" title="Delete invoice">
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    );
  }

  if (showForce) {
    return (
      <ForceDeleteInvoiceModal
        invoiceId={invoiceId}
        onClose={() => { setShowForce(false); setConfirming(false); }}
        onDeleted={() => { setShowForce(false); setConfirming(false); onDeleted(); }}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-[260] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={() => !deleting && setConfirming(false)}>
      <div className="w-full max-w-sm glass-strong rounded-2xl border border-[oklch(0.62_0.24_25/0.5)] p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-bold mb-2">Delete Invoice #{invoiceId}?</h3>
        <p className="text-sm text-muted-foreground mb-3">
          Are you sure? This will revert inventory stock levels and remove it from the supplier's balance. If any
          item on it has already been used in a sale, this will be blocked automatically.
        </p>
        {err && <div className="text-sm text-[oklch(0.62_0.24_25)] mb-3">{err}</div>}
        {blocked && (
          <button onClick={() => setShowForce(true)} className="text-xs font-semibold text-[oklch(0.62_0.24_25)] underline mb-3">
            Force delete anyway (bypasses this check)
          </button>
        )}
        <div className="flex justify-end gap-2">
          <button onClick={() => setConfirming(false)} disabled={deleting} className="px-3 py-1.5 rounded-lg text-sm bg-black/5 border border-black/10">Cancel</button>
          <button onClick={() => void doDelete()} disabled={deleting} className="px-3 py-1.5 rounded-lg text-sm font-bold bg-[oklch(0.62_0.24_25/0.15)] border border-[oklch(0.62_0.24_25/0.5)] text-[oklch(0.62_0.24_25)] disabled:opacity-50">
            {deleting ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ForceDeleteInvoiceModal({ invoiceId, onClose, onDeleted }: { invoiceId: string; onClose: () => void; onDeleted: () => void }) {
  const { forceDeleteSupplierInvoice } = useStore();
  const [confirmText, setConfirmText] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const canSubmit = confirmText === "FORCE DELETE" && password.length > 0;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setErr(null);
    try {
      const res = await forceDeleteSupplierInvoice(invoiceId, confirmText, password);
      if (!res.ok) { setErr(res.error ?? "Could not force-delete."); return; }
      onDeleted();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[270] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={() => !submitting && onClose()}>
      <div className="w-full max-w-sm glass-strong rounded-2xl border-2 border-[oklch(0.62_0.24_25/0.6)] p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-bold mb-2 text-[oklch(0.62_0.24_25)]">Force delete this invoice</h3>
        <p className="text-sm text-muted-foreground mb-3">
          This bypasses the check that stock from this invoice has already been used in a sale. Those past sales
          are not affected — but the record of where that stock came from will be gone. This can't be undone.
        </p>
        <label className="text-xs uppercase tracking-widest text-muted-foreground">Type FORCE DELETE to confirm</label>
        <input
          value={confirmText} onChange={(e) => setConfirmText(e.target.value)}
          className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm font-mono mb-3"
          placeholder="FORCE DELETE"
        />
        <label className="text-xs uppercase tracking-widest text-muted-foreground">Your admin password</label>
        <input
          type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm"
        />
        {err && <div className="text-sm text-[oklch(0.62_0.24_25)] mt-2">{err}</div>}
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} disabled={submitting} className="px-3 py-1.5 rounded-lg text-sm bg-black/5 border border-black/10">Cancel</button>
          <button
            onClick={() => void handleSubmit()}
            disabled={!canSubmit || submitting}
            className="px-3 py-1.5 rounded-lg text-sm font-bold bg-[oklch(0.62_0.24_25/0.9)] text-white disabled:opacity-40"
          >
            {submitting ? "Deleting..." : "Force Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DeletePaymentButton({ paymentId, onDeleted }: { paymentId: string; onDeleted: () => void }) {
  const { deleteSupplierPayment } = useStore();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const doDelete = async () => {
    setDeleting(true);
    setErr(null);
    try {
      const res = await deleteSupplierPayment(paymentId);
      if (!res.ok) { setErr(res.error ?? "Delete failed"); return; }
      setConfirming(false);
      onDeleted();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong — please try again.");
    } finally {
      setDeleting(false);
    }
  };

  if (!confirming) {
    return (
      <button onClick={() => setConfirming(true)} className="text-muted-foreground hover:text-[oklch(0.62_0.24_25)]" title="Delete payment">
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-[260] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={() => !deleting && setConfirming(false)}>
      <div className="w-full max-w-sm glass-strong rounded-2xl border border-[oklch(0.62_0.24_25/0.5)] p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-bold mb-2">Delete this payment?</h3>
        <p className="text-sm text-muted-foreground mb-3">
          This will remove it from the supplier's balance and delete its matching expense entry.
        </p>
        {err && <div className="text-sm text-[oklch(0.62_0.24_25)] mb-3">{err}</div>}
        <div className="flex justify-end gap-2">
          <button onClick={() => setConfirming(false)} disabled={deleting} className="px-3 py-1.5 rounded-lg text-sm bg-black/5 border border-black/10">Cancel</button>
          <button onClick={() => void doDelete()} disabled={deleting} className="px-3 py-1.5 rounded-lg text-sm font-bold bg-[oklch(0.62_0.24_25/0.15)] border border-[oklch(0.62_0.24_25/0.5)] text-[oklch(0.62_0.24_25)] disabled:opacity-50">
            {deleting ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditInvoiceButton({ entry, onSaved }: { entry: SupplierLedgerEntry; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className="text-muted-foreground hover:text-[oklch(0.7_0.19_260)]" title="Edit invoice">
        <Pencil className="w-3.5 h-3.5" />
      </button>
      {open && <EditInvoiceModal entry={entry} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); onSaved(); }} />}
    </>
  );
}

function EditInvoiceModal({ entry, onClose, onSaved }: { entry: SupplierLedgerEntry; onClose: () => void; onSaved: () => void }) {
  const { state, updateSupplierInvoice } = useStore();
  const [items, setItems] = useState(() => (entry.items ?? []).map((it) => ({ ...it })));
  // cairoDateLabel, NOT new Date(...).toISOString().slice(0,10) -- see
  // the matching comment on SupplierInvoiceForm's invoiceDate above;
  // reopening this modal on an entry whose stored moment falls between
  // midnight and ~3 AM Cairo time would otherwise show the day BEFORE
  // the one actually on file.
  const [invoiceDateInput, setInvoiceDateInput] = useState(() => cairoDateLabel(entry.invoiceDate ?? entry.ts));
  const [paymentType, setPaymentType] = useState<"cash" | "deferred">(entry.paymentType ?? "deferred");
  const [supplierId, setSupplierId] = useState(entry.supplierId ?? "");
  const [referenceNumber, setReferenceNumber] = useState(entry.referenceNumber ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const newTotal = items.reduce((a, it) => a + it.qty * it.unitPrice, 0);

  const handleSave = async () => {
    setSaving(true);
    setErr(null);
    try {
      const chosenSupplier = state.suppliers.find((s) => s.id === supplierId);
      const res = await updateSupplierInvoice({
        invoiceId: entry.id,
        items: items.map((it) => ({ id: it.id, qty: it.qty, unitPrice: it.unitPrice })),
        // Plain string, not new Date(invoiceDateInput + "T00:00:00").getTime()
        // -- see submit() in SupplierInvoiceForm for why that's the bug.
        invoiceDate: invoiceDateInput,
        paymentType,
        supplierId: supplierId || undefined,
        supplierName: chosenSupplier?.name,
        referenceNumber: referenceNumber.trim() || undefined,
      });
      if (!res.ok) { setErr(res.error ?? "Could not save changes."); return; }
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    // Centered, constrained to 85% of the viewport height so it never
    // grows taller than the screen on a short/zoomed-in window.
    // z-[9999] is deliberately the highest value in this file -- this
    // is a leaf modal (nothing else ever needs to layer above it), so
    // there's no ceiling to stay under the way EditInvoiceModal itself
    // has to stay under nothing but above the SupplierStatementModal
    // it's opened from.
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => !saving && onClose()}>
      <div
        className="w-full max-w-2xl max-h-[85vh] flex flex-col bg-white shadow-2xl rounded-2xl border-2 border-[oklch(0.7_0.19_260/0.6)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-black/10 shrink-0 bg-white">
          <h3 className="text-lg font-bold text-[#2b2416]">Edit Invoice</h3>
        </div>

        {/* min-h-0 is the actual fix for the clipping bug: without it, a
            flex child with overflow-y-auto still grows to fit all its
            content instead of respecting the column's max-h-[85vh],
            which is what was pushing the Save/Cancel footer off-screen
            on longer invoices. With it, only this middle section
            scrolls and the header/footer (both shrink-0) stay fixed in
            place — functionally the same guarantee "sticky" would give,
            since they're flex siblings outside the scrolling area, not
            stacked on top of it. */}
        <div className="flex-1 min-h-0 overflow-y-auto p-6 bg-white">
          <label className="text-xs font-semibold uppercase tracking-widest text-[#2b2416]/70">Transaction Date</label>
          <input
            type="date" value={invoiceDateInput} onChange={(e) => setInvoiceDateInput(e.target.value)}
            className="mt-1 w-full bg-white border border-black/20 rounded-lg px-3 py-2.5 text-base text-[#2b2416] mb-4 focus:outline-none focus:ring-2 focus:ring-[oklch(0.7_0.19_260/0.6)]"
          />

          <label className="text-xs font-semibold uppercase tracking-widest text-[#2b2416]/70">Supplier</label>
          <select
            value={supplierId} onChange={(e) => setSupplierId(e.target.value)}
            className="mt-1 w-full bg-white border border-black/20 rounded-lg px-3 py-2.5 text-base text-[#2b2416] mb-4 focus:outline-none focus:ring-2 focus:ring-[oklch(0.7_0.19_260/0.6)]"
          >
            {state.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>

          <label className="text-xs font-semibold uppercase tracking-widest text-[#2b2416]/70">Invoice Reference Number (optional)</label>
          <input
            value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)}
            placeholder="e.g. INV-2026-0431"
            className="mt-1 w-full bg-white border border-black/20 rounded-lg px-3 py-2.5 text-base text-[#2b2416] mb-4 font-mono focus:outline-none focus:ring-2 focus:ring-[oklch(0.7_0.19_260/0.6)]"
          />

          <label className="text-xs font-semibold uppercase tracking-widest text-[#2b2416]/70">Payment Type</label>
          <div className="mt-1 flex rounded-lg border border-black/20 overflow-hidden mb-4">
            <button
              onClick={() => setPaymentType("cash")}
              className={`flex-1 py-2.5 text-sm font-bold ${paymentType === "cash" ? "bg-[oklch(0.78_0.2_155/0.35)] text-[#2b2416]" : "bg-white text-[#2b2416]/60"}`}
            >Cash</button>
            <button
              onClick={() => setPaymentType("deferred")}
              className={`flex-1 py-2.5 text-sm font-bold border-l border-black/20 ${paymentType === "deferred" ? "bg-[oklch(0.62_0.24_25/0.35)] text-[#2b2416]" : "bg-white text-[#2b2416]/60"}`}
            >Deferred (on credit)</button>
          </div>

          <div className="text-xs font-semibold uppercase tracking-widest text-[#2b2416]/70 mb-2">Items</div>
          <div className="rounded-lg border border-black/15 overflow-hidden mb-4">
            <div className="grid grid-cols-[1fr_90px_110px_110px] gap-2 px-4 py-2 bg-black/10 text-[11px] font-bold uppercase tracking-widest text-[#2b2416]">
              <span>Material</span>
              <span className="text-right">Qty</span>
              <span className="text-right">Unit Price</span>
              <span className="text-right">Subtotal</span>
            </div>
            <div className="divide-y divide-black/10">
              {items.map((it, idx) => (
                <div key={it.id} className="grid grid-cols-[1fr_90px_110px_110px] gap-2 items-center px-4 py-3 bg-white">
                  <span className="text-sm font-semibold text-[#2b2416] truncate">{it.materialName}</span>
                  <input
                    type="number" min="0" step="0.01" value={it.qty}
                    onChange={(e) => setItems((prev) => prev.map((p, i) => i === idx ? { ...p, qty: parseFloat(e.target.value) || 0 } : p))}
                    className="w-full bg-white border border-black/20 rounded-md px-2 py-1.5 text-sm font-mono text-right text-[#2b2416] focus:outline-none focus:ring-2 focus:ring-[oklch(0.7_0.19_260/0.6)]"
                  />
                  <input
                    type="number" min="0" step="0.01" value={it.unitPrice}
                    onChange={(e) => setItems((prev) => prev.map((p, i) => i === idx ? { ...p, unitPrice: parseFloat(e.target.value) || 0 } : p))}
                    className="w-full bg-white border border-black/20 rounded-md px-2 py-1.5 text-sm font-mono text-right text-[#2b2416] focus:outline-none focus:ring-2 focus:ring-[oklch(0.7_0.19_260/0.6)]"
                  />
                  <span className="text-sm font-mono font-bold text-right text-[#2b2416]">{fmtMoney(it.qty * it.unitPrice)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-between items-center py-3 border-t border-black/15">
            <span className="text-sm font-bold uppercase tracking-widest text-[#2b2416]/70">New Total</span>
            <span className="text-2xl font-mono font-bold text-[#2b2416]">{fmtMoney(newTotal)}</span>
          </div>

          {err && <div className="text-sm font-semibold text-[oklch(0.55_0.24_25)] mt-3">{err}</div>}
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-black/10 shrink-0 bg-white shadow-[0_-4px_12px_rgba(0,0,0,0.06)] z-10">
          <button onClick={onClose} disabled={saving} className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-black/5 border border-black/20 text-[#2b2416] hover:bg-black/10 disabled:opacity-50">
            Cancel / إلغاء
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={saving || items.length === 0}
            className="px-5 py-2.5 rounded-lg text-sm font-bold bg-gradient-to-r from-[oklch(0.7_0.19_260)] to-[oklch(0.65_0.24_305)] text-[#2b2416] shadow-md disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Changes / حفظ"}
          </button>
        </div>
      </div>
    </div>
  );
}

// خيارات طريقة الخصم — required choice of whose cash a deferred
// ("آجل") supplier payment comes out of. See recordSupplierPayment_ in
// Code.gs for the full accounting reasoning behind each option.
const EXPENSE_SCOPE_OPTIONS: { value: "daily_shift" | "monthly"; labelAr: string; labelEn: string; hint: string }[] = [
  {
    value: "daily_shift",
    labelAr: "خصم من إيراد اليوم (شيفت حالي)",
    labelEn: "Daily Shift Expense",
    hint: "Comes out of today's active shift — if paid in cash, reduces today's Expected Drawer Cash.",
  },
  {
    value: "monthly",
    labelAr: "خصم من إيراد/أرباح الشهر",
    labelEn: "Monthly Consolidated Expense",
    hint: "Doesn't touch today's shift or drawer reconciliation — deducted from this month's P&L / Net Revenue instead.",
  },
];

function RecordSupplierPaymentForm({ supplierId, outstandingInvoices, onDone, onCancel }: {
  supplierId: string;
  // Deferred invoices for this supplier, so the admin can optionally
  // say which specific invoice this payment is settling — purely for
  // the paper trail (folded into the description); see
  // recordSupplierPayment_ in Code.gs. Undefined where the caller
  // hasn't loaded the supplier's ledger (the dropdown is simply
  // omitted then).
  outstandingInvoices?: SupplierLedgerEntry[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const { recordSupplierPayment } = useStore();
  const [amount, setAmount] = useState("");
  const [paymentSource, setPaymentSource] = useState<PaymentSource | "">("");
  const [expenseScope, setExpenseScope] = useState<"daily_shift" | "monthly" | "">("");
  const [invoiceId, setInvoiceId] = useState("");
  const [note, setNote] = useState("");
  // Defaults to today's Cairo calendar date -- same pattern as the
  // Supplier Invoice and Advances date pickers (cairoDateLabel, NOT
  // new Date().toISOString().slice(0,10), for the same reason: the
  // viewing browser's own timezone shouldn't decide which calendar day
  // "today" defaults to). Backdatable for a past shift or a
  // late-logged payment -- see recordSupplierPayment_ in Code.gs,
  // which anchors this exact string at Cairo noon and uses it to set
  // the generated expense's own expenseDate, so Reports -> Expenses
  // History shows it under the date actually picked here, not today.
  const [paymentDate, setPaymentDate] = useState(() => cairoDateLabel(Date.now()));
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!(parseFloat(amount) > 0)) { setErr("Enter a valid amount."); return; }
    if (!paymentSource) { setErr("Select a payment source."); return; }
    if (!expenseScope) { setErr("Select how this payment should be deducted (خيارات طريقة الخصم)."); return; }
    if (!paymentDate) { setErr("Select a payment date."); return; }
    setSubmitting(true);
    setErr(null);
    try {
      const res = await recordSupplierPayment({ supplierId, amount: parseFloat(amount), paymentSource, expenseScope, note: note || undefined, invoiceId: invoiceId || undefined, paymentDate });
      if (!res.ok) { setErr(res.error ?? "Failed to record payment"); return; }
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong — please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="px-6 py-4 border-b border-black/8 bg-black/5 shrink-0 space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="text-xs uppercase tracking-widest text-muted-foreground">Amount</label>
          <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm font-mono" />
        </div>
        <div>
          <label className="text-xs uppercase tracking-widest text-muted-foreground">Payment Date</label>
          <input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} max={cairoDateLabel(Date.now())} className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm font-mono" />
        </div>
        <div>
          <label className="text-xs uppercase tracking-widest text-muted-foreground">Note (optional)</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm" />
        </div>
      </div>

      {outstandingInvoices && outstandingInvoices.length > 0 && (
        <div>
          <label className="text-xs uppercase tracking-widest text-muted-foreground">Settling which invoice? (optional)</label>
          <select value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)} className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm">
            <option value="">— Not tied to a specific invoice —</option>
            {outstandingInvoices.map((inv) => (
              <option key={inv.id} value={inv.id}>
                {new Date(inv.ts).toLocaleDateString()} — {inv.referenceNumber ? `#${inv.referenceNumber}` : `#${inv.id.slice(-6)}`} — {fmtMoney(inv.amount)}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="grid grid-cols-3 gap-2">
        {(Object.keys(PAYMENT_SOURCE_LABELS) as PaymentSource[]).map((src) => {
          const Icon = PAYMENT_SOURCE_ICONS[src];
          return (
            <button
              key={src}
              type="button"
              onClick={() => { setPaymentSource(src); if (src === "monthly_payment") setExpenseScope("monthly"); }}
              className={`flex items-center gap-2 text-xs py-2 px-3 rounded-lg border transition ${
                paymentSource === src
                  ? "bg-black/20 border-black/60 text-[#2b2416] font-semibold"
                  : "bg-white/70 border-black/10 text-muted-foreground hover:bg-black/8"
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" /> {PAYMENT_SOURCE_LABELS[src]}
            </button>
          );
        })}
      </div>

      {/* A Monthly Payment source is already, on its own, خصم من إيراد
          الشهر -- there's no daily-shift reading of it to choose, so
          the toggle is skipped entirely and expenseScope is set above
          when that source is picked. Cash Drawer/Out of Pocket still
          need the explicit choice, same as before. */}
      {paymentSource !== "monthly_payment" && (
        <div>
          <label className="text-xs uppercase tracking-widest text-muted-foreground">خيارات طريقة الخصم — Deduct this payment from</label>
          <div className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
            {EXPENSE_SCOPE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setExpenseScope(opt.value)}
                title={opt.hint}
                className={`text-left py-2 px-3 rounded-lg border transition ${
                  expenseScope === opt.value
                    ? "bg-[oklch(0.7_0.19_260/0.2)] border-[oklch(0.7_0.19_260/0.6)] text-[#2b2416]"
                    : "bg-white/70 border-black/10 text-muted-foreground hover:bg-black/8"
                }`}
              >
                <div className="text-sm font-bold" dir="rtl">{opt.labelAr}</div>
                <div className="text-[10px] uppercase tracking-widest mt-0.5">{opt.labelEn}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {err && <div className="text-xs text-[oklch(0.62_0.24_25)]">{err}</div>}
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} disabled={submitting} className="px-3 py-1.5 rounded-lg text-xs bg-white/70 border border-black/10">Cancel</button>
        <button onClick={() => void submit()} disabled={submitting} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-[oklch(0.78_0.2_155/0.2)] border border-[oklch(0.78_0.2_155/0.5)] text-[oklch(0.78_0.2_155)] disabled:opacity-50">
          {submitting ? "Saving..." : "Confirm Payment"}
        </button>
      </div>
    </div>
  );
}

function PendingApprovals() {
  const { state, approvePurchase, rejectPurchase } = useStore();
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  return (
    <div className="glass rounded-2xl p-6">
      <div className="flex items-center gap-2 mb-4">
        <Clock className="w-5 h-5 text-black" />
        <h2 className="text-lg font-semibold">Pending Approvals</h2>
        {state.pendingApprovals.length > 0 && (
          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-black/20 text-white border border-black/50">
            {state.pendingApprovals.length}
          </span>
        )}
      </div>

      {state.pendingApprovals.length === 0 ? (
        <div className="text-sm text-muted-foreground font-mono">Nothing waiting on approval.</div>
      ) : (
        <div className="space-y-3">
          {state.pendingApprovals.map((entry: LedgerEntry) => {
            const material = state.materials.find((m) => m.id === entry.materialId);
            return (
              <div key={entry.id} className="bg-white/60 rounded-lg p-4 border border-black/30 flex flex-col md:flex-row gap-4">
                {entry.receiptUrl && (
                  <a href={entry.receiptUrl} target="_blank" rel="noreferrer" className="shrink-0">
                    <img src={entry.receiptUrl} alt="Receipt" className="h-20 w-20 object-cover rounded-lg border border-black/10" />
                  </a>
                )}
                <div className="flex-1">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <div className="font-semibold text-sm">{material?.name ?? entry.materialId} — {entry.qty} {material?.unit}</div>
                      <div className="text-xs text-muted-foreground">{entry.category} · by {entry.staffUsername} · {new Date(entry.ts).toLocaleString()}</div>
                    </div>
                    <div className="font-mono font-bold">{fmtMoney(entry.amount)}</div>
                  </div>
                  {entry.description && <div className="text-xs text-muted-foreground mt-1">{entry.description}</div>}
                  {rejectingId === entry.id ? (
                    <div className="flex items-center gap-2 mt-3">
                      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" className="flex-1 bg-white/70 border border-black/10 rounded px-2 py-1.5 text-xs" />
                      <button onClick={async () => { await rejectPurchase(entry.id, reason); setRejectingId(null); setReason(""); }} className="text-xs px-3 py-1.5 rounded bg-[oklch(0.62_0.24_25/0.2)] border border-[oklch(0.62_0.24_25/0.5)] text-[oklch(0.62_0.24_25)]">Confirm Reject</button>
                      <button onClick={() => setRejectingId(null)} className="text-xs px-3 py-1.5 rounded bg-black/5 border border-black/10">Cancel</button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 mt-3">
                      <button onClick={() => approvePurchase(entry.id)} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-[oklch(0.78_0.2_155/0.2)] border border-[oklch(0.78_0.2_155/0.5)] text-[oklch(0.78_0.2_155)]">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Approve
                      </button>
                      <button onClick={() => setRejectingId(entry.id)} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-black/5 border border-black/10 hover:bg-[oklch(0.62_0.24_25/0.15)]">
                        <XCircle className="w-3.5 h-3.5" /> Reject
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PurchaseHistory() {
  const { state } = useStore();
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [reportOpen, setReportOpen] = useState(false);

  const procurementEntries = useMemo(
    () => state.ledger.filter((l) => PROCUREMENT_TYPES.has(l.type) && l.status === "approved"),
    [state.ledger],
  );

  const filtered = useMemo(() => {
    const fromTs = fromDate ? new Date(fromDate + "T00:00:00").getTime() : null;
    const toTs = toDate ? new Date(toDate + "T23:59:59").getTime() : null;
    return procurementEntries
      .filter((e) => (fromTs === null || e.ts >= fromTs) && (toTs === null || e.ts <= toTs))
      .sort((a, b) => b.ts - a.ts);
  }, [procurementEntries, fromDate, toDate]);

  const filteredTotal = filtered.reduce((a, e) => a + e.amount, 0);

  return (
    <div className="glass rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <History className="w-5 h-5 text-black" />
          <h2 className="text-lg font-semibold">Purchase History</h2>
        </div>
        <button
          onClick={() => setReportOpen(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-black to-black text-[#2b2416] text-xs font-bold uppercase tracking-wide"
        >
          <FileBarChart className="w-3.5 h-3.5" /> Generate Report
        </button>
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
        <div className="ml-auto text-right">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{fromDate || toDate ? "Selected Total" : "All-Time Total"}</div>
          <div className="text-sm font-mono font-bold">{fmtMoney(filteredTotal)}</div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="text-sm text-muted-foreground font-mono">No purchases in this range.</div>
      ) : (
        <div className="overflow-x-auto max-h-96 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-[#faf6ec]">
              <tr className="text-[10px] uppercase tracking-widest text-muted-foreground border-b border-black/8">
                <th className="text-left py-2 px-2">Date</th>
                <th className="text-left py-2 px-2">Material</th>
                <th className="text-right py-2 px-2">Qty</th>
                <th className="text-right py-2 px-2">Unit Price</th>
                <th className="text-left py-2 px-2">Payment Source</th>
                <th className="text-left py-2 px-2">By</th>
                <th className="text-right py-2 px-2">Total Price</th>
                <th className="text-right py-2 px-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => {
                const material = state.materials.find((m) => m.id === e.materialId);
                return (
                  <tr key={e.id} className="border-b border-black/8 hover:bg-black/5">
                    <td className="py-2 px-2 font-mono text-xs text-muted-foreground">{new Date(e.ts).toLocaleString()}</td>
                    <td className="py-2 px-2 font-semibold">{material?.name ?? e.materialId ?? e.description ?? e.category}</td>
                    <td className="py-2 px-2 text-right font-mono">{e.qty ?? "—"} {material?.unit}</td>
                    <td className="py-2 px-2 text-right font-mono">{e.unitCost != null ? fmtMoney(e.unitCost) : "—"}</td>
                    <td className="py-2 px-2 text-xs">{e.paymentSource ? PAYMENT_SOURCE_LABELS[e.paymentSource as PaymentSource] : "—"}</td>
                    <td className="py-2 px-2 text-xs">{e.staffUsername}</td>
                    <td className="py-2 px-2 text-right font-mono font-bold">{fmtMoney(e.amount)}</td>
                    <td className="py-2 px-2 text-right">
                      <PurchaseRowActions entry={e} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {reportOpen && <ReportModal entries={procurementEntries} materials={state.materials} onClose={() => setReportOpen(false)} />}
    </div>
  );
}

function PurchaseRowActions({ entry }: { entry: LedgerEntry }) {
  const { state, deletePurchase, deleteSupplierPayment } = useStore();
  const isAdmin = state.currentUser?.role === "admin";
  const [showEdit, setShowEdit] = useState(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // A "supplierPayment" row's balance actually lives in the SEPARATE
  // SupplierPayments running-balance table, not just this Ledger entry
  // -- deletePurchase (deletePurchase_/bizDeletePurchase_) has no type
  // guard and would happily delete ONLY this Ledger row, silently
  // leaving the SupplierPayments row (and the supplier's balance)
  // behind, desynced. deleteSupplierPayment removes both together.
  // linkedPaymentId is the SupplierPayments.id this Ledger entry
  // mirrors (set at creation by recordSupplierPayment_); an older
  // payment recorded before that field existed won't have it yet — use
  // the "Resync Supplier Payments" admin tool in Reports to backfill it.
  const isSupplierPayment = entry.type === "supplierPayment";

  const doDelete = async () => {
    setDeleting(true);
    setErr(null);
    try {
      const res = isSupplierPayment
        ? entry.linkedPaymentId
          ? await deleteSupplierPayment(entry.linkedPaymentId)
          : { ok: false, error: "This older payment is missing its link to the supplier balance record — run \"Resync Supplier Payments\" in Reports first, then try deleting again." }
        : await deletePurchase(entry.id);
      if (!res.ok) { setErr(res.error ?? "Delete failed"); return; }
      setShowConfirmDelete(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong — please try again.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="inline-flex items-center gap-2 relative">
      <button onClick={() => setShowEdit(true)} className="text-muted-foreground hover:text-[oklch(0.7_0.19_260)]" title="Edit">
        <Pencil className="w-3.5 h-3.5" />
      </button>
      {isAdmin && (
        <button onClick={() => setShowConfirmDelete(true)} className="text-muted-foreground hover:text-[oklch(0.62_0.24_25)]" title="Delete">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}

      {showEdit && <EditPurchaseModal entry={entry} onClose={() => setShowEdit(false)} />}

      {isAdmin && showConfirmDelete && (
        <div className="fixed inset-0 z-[250] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={() => !deleting && setShowConfirmDelete(false)}>
          <div className="w-full max-w-sm glass-strong rounded-2xl border border-[oklch(0.62_0.24_25/0.5)] p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-bold mb-2">Delete this expense of {fmtMoney(entry.amount)}?</h3>
            <p className="text-sm text-muted-foreground mb-3">
              {entry.description || entry.category}.{" "}
              {isSupplierPayment
                ? "This will also remove it from the supplier's running balance."
                : "If any of this stock has already been used in a sale, this will be blocked automatically."}
            </p>
            {err && <div className="text-sm text-[oklch(0.62_0.24_25)] mb-3">{err}</div>}
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowConfirmDelete(false)} disabled={deleting} className="px-3 py-1.5 rounded-lg text-sm bg-black/5 border border-black/10">Cancel</button>
              <button onClick={() => void doDelete()} disabled={deleting} className="px-3 py-1.5 rounded-lg text-sm font-bold bg-[oklch(0.62_0.24_25/0.15)] border border-[oklch(0.62_0.24_25/0.5)] text-[oklch(0.62_0.24_25)] disabled:opacity-50">
                {deleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EditPurchaseModal({ entry, onClose }: { entry: LedgerEntry; onClose: () => void }) {
  const { updatePurchase } = useStore();
  const [description, setDescription] = useState(entry.description || "");
  const [qty, setQty] = useState(entry.qty != null ? String(entry.qty) : "");
  const [unitCost, setUnitCost] = useState(entry.unitCost != null ? String(entry.unitCost) : "");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const hasQtyOrCost = entry.qty != null && entry.unitCost != null;

  const submit = async () => {
    setSubmitting(true);
    setErr(null);
    try {
      const patch: Parameters<typeof updatePurchase>[0] = { ledgerId: entry.id, description };
      if (hasQtyOrCost) {
        patch.qty = parseFloat(qty);
        patch.unitCost = parseFloat(unitCost);
      }
      const res = await updatePurchase(patch);
      if (!res.ok) { setErr(res.error ?? "Update failed"); return; }
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong — please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[250] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={() => !submitting && onClose()}>
      <div className="w-full max-w-sm glass-strong rounded-2xl border border-black/20 p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-bold mb-3">Edit Entry</h3>
        <div className="space-y-3">
          <div>
            <label className="text-xs uppercase tracking-widest text-muted-foreground">Description</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm" />
          </div>
          {hasQtyOrCost && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs uppercase tracking-widest text-muted-foreground">Quantity</label>
                <input type="number" step="0.01" value={qty} onChange={(e) => setQty(e.target.value)} className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm font-mono" />
              </div>
              <div>
                <label className="text-xs uppercase tracking-widest text-muted-foreground">Unit Cost</label>
                <input type="number" step="0.01" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm font-mono" />
              </div>
            </div>
          )}
        </div>
        {err && <div className="text-sm text-[oklch(0.62_0.24_25)] mt-3">{err}</div>}
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} disabled={submitting} className="px-3 py-1.5 rounded-lg text-sm bg-black/5 border border-black/10">Cancel</button>
          <button onClick={() => void submit()} disabled={submitting} className="px-3 py-1.5 rounded-lg text-sm font-bold bg-[oklch(0.78_0.2_155/0.15)] border border-[oklch(0.78_0.2_155/0.5)] text-[oklch(0.78_0.2_155)] disabled:opacity-50">
            {submitting ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ReportModal({ entries, materials, onClose }: {
  entries: LedgerEntry[];
  materials: ReturnType<typeof useStore>["state"]["materials"];
  onClose: () => void;
}) {
  const [timeframe, setTimeframe] = useState<"daily" | "weekly" | "monthly">("daily");
  const [dateInput, setDateInput] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [monthInput, setMonthInput] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });

  const range = useMemo(() => {
    if (timeframe === "daily") {
      const start = new Date(dateInput + "T00:00:00").getTime();
      return { start, end: start + 86400000, label: new Date(dateInput + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" }) };
    }
    if (timeframe === "weekly") {
      const anchor = new Date(dateInput + "T00:00:00");
      const dayOfWeek = anchor.getDay();
      const start = new Date(anchor);
      start.setDate(anchor.getDate() - dayOfWeek);
      const startTs = start.getTime();
      const end = startTs + 7 * 86400000;
      const endDate = new Date(end - 1);
      return { start: startTs, end, label: `Week of ${start.toLocaleDateString()} – ${endDate.toLocaleDateString()}` };
    }
    const [y, m] = monthInput.split("-").map(Number);
    const start = new Date(y, m - 1, 1).getTime();
    const end = new Date(y, m, 1).getTime();
    return { start, end, label: new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" }) };
  }, [timeframe, dateInput, monthInput]);

  const filtered = entries.filter((e) => e.ts >= range.start && e.ts < range.end).sort((a, b) => a.ts - b.ts);
  const total = filtered.reduce((a, e) => a + e.amount, 0);
  // Keyed loosely (not Record<PaymentSource, number>) so a legacy entry
  // still carrying the old "bank_transfer" value (retired in favor of
  // Monthly Payment) falls into Unspecified below instead of throwing
  // or silently dropping out of the grand total's own breakdown.
  const bySource: Record<string, number> = { cash_drawer: 0, out_of_pocket: 0, monthly_payment: 0, unspecified: 0 };
  filtered.forEach((e) => {
    if (e.paymentSource && e.paymentSource in bySource) bySource[e.paymentSource] += e.amount;
    else bySource.unspecified += e.amount;
  });

  const print = () => {
    const win = window.open("", "_blank", "width=900,height=1200");
    if (!win) return;
    win.document.write(`
<!DOCTYPE html><html><head><title>Procurement Report</title>
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
<div class="sub">Procurement Report — ${timeframe.toUpperCase()} — ${range.label}</div>
<div class="totals">
  <div class="grand"><span>TOTAL PROCUREMENT EXPENDITURE</span><span>${total.toFixed(2)} EGP</span></div>
  <div><span>&nbsp;&nbsp;Cash Drawer / من الدرج</span><span>${bySource.cash_drawer.toFixed(2)} EGP</span></div>
  <div><span>&nbsp;&nbsp;Out of Pocket / من الجيب</span><span>${bySource.out_of_pocket.toFixed(2)} EGP</span></div>
  <div><span>&nbsp;&nbsp;Monthly Payment / دفع شهري</span><span>${bySource.monthly_payment.toFixed(2)} EGP</span></div>
  ${bySource.unspecified > 0 ? `<div><span>&nbsp;&nbsp;Unspecified</span><span>${bySource.unspecified.toFixed(2)} EGP</span></div>` : ""}
  <div><span>Line Items</span><span>${filtered.length}</span></div>
</div>
<table>
  <thead><tr><th>Date</th><th>Material</th><th>Qty</th><th>Unit Price</th><th>Payment Source</th><th>Staff</th><th>Total Price</th></tr></thead>
  <tbody>
    ${filtered.map((e) => {
      // A "supplierPayment" row has no materialId/qty/unitCost (it's a
      // debt settlement, not a material purchase) — fall back to its
      // description (already names the supplier) and show "—" instead
      // of a misleading "0.00 EGP" unit price.
      const m = materials.find((mm) => mm.id === e.materialId);
      return `<tr>
        <td>${new Date(e.ts).toLocaleString()}</td>
        <td>${m?.name ?? e.materialId ?? e.description ?? e.category ?? ""}</td>
        <td>${e.qty != null ? `${e.qty} ${m?.unit ?? ""}` : "—"}</td>
        <td>${e.unitCost != null ? e.unitCost.toFixed(2) + " EGP" : "—"}</td>
        <td>${e.paymentSource ? PAYMENT_SOURCE_LABELS[e.paymentSource as PaymentSource] : "—"}</td>
        <td>${e.staffUsername}</td>
        <td>${e.amount.toFixed(2)} EGP</td>
      </tr>`;
    }).join("") || "<tr><td colspan=7>No purchases in this period</td></tr>"}
  </tbody>
</table>
<script>window.onload = () => setTimeout(() => { if (window.electronAPI) { window.electronAPI.printSilent({ deviceName: localStorage.getItem("glitch-preferred-printer") || "" }).catch(() => window.print()); } else { window.print(); } }, 300);</script>
</body></html>`);
    win.document.close();
  };

  const exportCsv = () => {
    const header = ["Date", "Material", "Qty", "Unit Price", "Payment Source", "Staff", "Total Price"];
    const rows = filtered.map((e) => {
      const m = materials.find((mm) => mm.id === e.materialId);
      return [
        new Date(e.ts).toLocaleString(), m?.name ?? e.materialId ?? e.description ?? e.category ?? "", e.qty ?? "",
        e.unitCost != null ? e.unitCost.toFixed(2) : "",
        e.paymentSource ? PAYMENT_SOURCE_LABELS[e.paymentSource as PaymentSource] : "", e.staffUsername, e.amount.toFixed(2),
      ];
    });
    const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `procurement-report-${timeframe}-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto glass-strong rounded-2xl border border-black/50" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-black/8">
          <div className="font-mono uppercase tracking-widest text-xs text-muted-foreground">Generate Procurement Report</div>
          <button onClick={onClose} className="text-muted-foreground hover:text-[#2b2416]">✕</button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {(["daily", "weekly", "monthly"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTimeframe(t)}
                className={`py-2.5 rounded-lg text-xs font-bold uppercase tracking-wide border-2 transition ${
                  timeframe === t
                    ? "bg-black/20 border-black/60 text-[#2b2416]"
                    : "bg-black/5 border-black/10 text-muted-foreground"
                }`}
              >
                {t === "daily" ? "Daily / يومي" : t === "weekly" ? "Weekly / أسبوعي" : "Monthly / شهري"}
              </button>
            ))}
          </div>

          {timeframe === "monthly" ? (
            <div>
              <label className="text-xs uppercase tracking-widest text-muted-foreground">Month</label>
              <input type="month" value={monthInput} onChange={(e) => setMonthInput(e.target.value)} className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm" />
            </div>
          ) : (
            <div>
              <label className="text-xs uppercase tracking-widest text-muted-foreground">{timeframe === "weekly" ? "Any Date in the Week" : "Date"}</label>
              <input type="date" value={dateInput} onChange={(e) => setDateInput(e.target.value)} className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm" />
            </div>
          )}

          <div className="rounded-lg bg-black/5 border border-black/8 p-3 text-xs font-mono space-y-1">
            <div className="text-muted-foreground uppercase tracking-widest text-[10px] mb-1">{range.label}</div>
            <div className="flex justify-between"><span>Line Items</span><span>{filtered.length}</span></div>
            <div className="flex justify-between"><span>Cash Drawer</span><span>{fmtMoney(bySource.cash_drawer)}</span></div>
            <div className="flex justify-between"><span>Out of Pocket</span><span>{fmtMoney(bySource.out_of_pocket)}</span></div>
            <div className="flex justify-between"><span>Monthly Payment</span><span>{fmtMoney(bySource.monthly_payment)}</span></div>
            <div className="flex justify-between border-t border-black/10 pt-1 mt-1 font-bold"><span>Total</span><span>{fmtMoney(total)}</span></div>
          </div>
        </div>
        <div className="p-4 border-t border-black/8 flex justify-end gap-2">
          <button onClick={exportCsv} className="px-4 py-2 rounded-lg text-sm bg-black/5 hover:bg-black/8 border border-black/10">Export CSV</button>
          <button
            onClick={print}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm bg-gradient-to-r from-black to-black text-[#2b2416] font-bold"
          >
            Print
          </button>
        </div>
      </div>
    </div>
  );
}
