import { useEffect, useMemo, useRef, useState } from "react";
import { useStore, fmtMoney } from "@/lib/glitch-store";
import type { LedgerEntry, PaymentSource } from "@/lib/glitch-store";
import { Camera, CheckCircle2, XCircle, Clock, ShieldAlert, Package, Wallet, Landmark, HandCoins, FileBarChart, History, Search } from "lucide-react";

const TYPE_LABEL: Record<string, string> = {
  stockedBatch: "Stocked Batch (bulk delivery)",
  dailyFresh: "Daily Fresh Sheet (perishables)",
  midShiftPurchase: "Expenses",
};

const PAYMENT_SOURCE_LABELS: Record<PaymentSource, string> = {
  cash_drawer: "Cash Drawer / من الدرج",
  out_of_pocket: "Out of Pocket / من الجيب",
  bank_transfer: "Bank Transfer / Visa / InstaPay",
};
const PAYMENT_SOURCE_ICONS: Record<PaymentSource, typeof Wallet> = {
  cash_drawer: Wallet,
  out_of_pocket: HandCoins,
  bank_transfer: Landmark,
};
const PROCUREMENT_TYPES = new Set(["stockedBatch", "dailyFresh", "midShiftPurchase"]);

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

      {isAdmin && <PendingApprovals />}
      {isAdmin && <PurchaseHistory />}
    </div>
  );
}

function SubmitPurchaseForm() {
  const [tab, setTab] = useState<"dailyFresh" | "stockedBatch" | "expenses">("dailyFresh");
  return (
    <div className="glass rounded-2xl p-6">
      <div className="flex items-center gap-2 mb-4">
        <Package className="w-5 h-5 text-[oklch(0.7_0.19_260)]" />
        <h2 className="text-lg font-semibold">Log a Purchase</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-4">
        {([["dailyFresh", TYPE_LABEL.dailyFresh], ["stockedBatch", TYPE_LABEL.stockedBatch], ["expenses", "Expenses"]] as const).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
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

      {tab === "expenses" ? <ExpenseSubmitForm /> : <MaterialPurchaseForm purchaseType={tab} />}
    </div>
  );
}

// Type-to-filter combobox — with 70+ materials (many in Arabic), a
// plain <select> means scrolling through a long list or relying on
// native type-to-jump, which works less reliably with Arabic/RTL text
// than a real search box does.
function SearchableMaterialSelect({ materials, value, onChange, placeholder }: {
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
  const fileRef = useRef<HTMLInputElement>(null);

  const [materialId, setMaterialId] = useState("");
  const [qty, setQty] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [description, setDescription] = useState("");
  const [paymentStatus, setPaymentStatus] = useState<"paid" | "unpaid">("paid");
  const [paymentSource, setPaymentSource] = useState<PaymentSource | "">("");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const material = state.materials.find((m) => m.id === materialId);
  const total = (parseFloat(qty) || 0) * (parseFloat(unitCost) || 0);

  const onFile = (f: File | null) => {
    setReceiptFile(f);
    if (f) setReceiptPreview(URL.createObjectURL(f));
    else setReceiptPreview(null);
  };

  const reset = () => {
    setMaterialId(""); setQty(""); setUnitCost(""); setSupplierId(""); setDescription(""); setPaymentStatus("paid"); setPaymentSource("");
    onFile(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const submit = async () => {
    setResult(null);
    if (!materialId || !qty || !unitCost) { setResult({ kind: "err", text: "Material, quantity, and unit cost are required." }); return; }
    if (paymentStatus === "paid" && !paymentSource) { setResult({ kind: "err", text: "Select a payment source, or mark this Unpaid instead." }); return; }
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
        receiptFile,
      });
      if (!res.ok) { setResult({ kind: "err", text: res.error ?? "Submission failed" }); return; }
      setResult({
        kind: "ok",
        text: res.status === "approved"
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

      <div className="mt-4">
        <label className="text-xs uppercase tracking-widest text-muted-foreground">Receipt Photo (optional)</label>
        <div className="mt-2 flex items-center gap-4">
          <button
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-black/5 border border-black/10 hover:bg-black/8 text-sm"
          >
            <Camera className="w-4 h-4" /> {receiptFile ? "Change Photo" : "Attach Photo"}
          </button>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
          {receiptPreview && <img src={receiptPreview} alt="Receipt preview" className="h-16 w-16 object-cover rounded-lg border border-black/10" />}
        </div>
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
  const { state, activeShift, submitExpense } = useStore();
  const isAdmin = state.currentUser?.role === "admin";
  const fileRef = useRef<HTMLInputElement>(null);

  const [itemName, setItemName] = useState("");
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [paymentStatus, setPaymentStatus] = useState<"paid" | "unpaid">("paid");
  const [paymentSource, setPaymentSource] = useState<PaymentSource | "">("");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const onFile = (f: File | null) => {
    setReceiptFile(f);
    if (f) setReceiptPreview(URL.createObjectURL(f));
    else setReceiptPreview(null);
  };

  const reset = () => {
    setItemName(""); setCategory(""); setAmount(""); setNotes(""); setSupplierId(""); setPaymentStatus("paid"); setPaymentSource("");
    onFile(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const submit = async () => {
    setResult(null);
    if (!itemName || !amount) { setResult({ kind: "err", text: "Item/expense description and amount are required." }); return; }
    if (paymentStatus === "paid" && !paymentSource) { setResult({ kind: "err", text: "Select a payment source, or mark this Unpaid instead." }); return; }
    setSubmitting(true);
    try {
      const res = await submitExpense({
        itemName,
        category: category || undefined,
        amount: parseFloat(amount),
        notes: notes || undefined,
        supplierId: supplierId || undefined,
        paymentStatus,
        paymentSource: paymentStatus === "paid" ? (paymentSource as PaymentSource) : undefined,
        receiptFile,
      });
      if (!res.ok) { setResult({ kind: "err", text: res.error ?? "Submission failed" }); return; }
      setResult({
        kind: "ok",
        text: res.status === "approved"
          ? paymentStatus === "unpaid"
            ? `Logged — ${fmtMoney(parseFloat(amount))} recorded as unpaid, showing on the Unpaid Expenses page until settled.`
            : `Approved instantly — ${fmtMoney(parseFloat(amount))} recorded.`
          : `Submitted for admin approval — ${fmtMoney(parseFloat(amount))} is pending, no effect yet.`,
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
          <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm font-mono" />
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
          </div>
        ) : (
          <div className="md:col-span-2 text-xs text-muted-foreground bg-black/5 border border-black/8 rounded-lg p-3">
            No money has left the drawer or safe yet — this won't affect any shift's cash total until it's settled on the
            <strong> Unpaid Expenses</strong> page.
          </div>
        )}
      </div>

      <div className="mt-4">
        <label className="text-xs uppercase tracking-widest text-muted-foreground">Receipt Photo (optional)</label>
        <div className="mt-2 flex items-center gap-4">
          <button
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-black/5 border border-black/10 hover:bg-black/8 text-sm"
          >
            <Camera className="w-4 h-4" /> {receiptFile ? "Change Photo" : "Attach Photo"}
          </button>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
          {receiptPreview && <img src={receiptPreview} alt="Receipt preview" className="h-16 w-16 object-cover rounded-lg border border-black/10" />}
        </div>
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
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => {
                const material = state.materials.find((m) => m.id === e.materialId);
                return (
                  <tr key={e.id} className="border-b border-black/8 hover:bg-black/5">
                    <td className="py-2 px-2 font-mono text-xs text-muted-foreground">{new Date(e.ts).toLocaleString()}</td>
                    <td className="py-2 px-2 font-semibold">{material?.name ?? e.materialId}</td>
                    <td className="py-2 px-2 text-right font-mono">{e.qty} {material?.unit}</td>
                    <td className="py-2 px-2 text-right font-mono">{fmtMoney(e.unitCost ?? 0)}</td>
                    <td className="py-2 px-2 text-xs">{e.paymentSource ? PAYMENT_SOURCE_LABELS[e.paymentSource] : "—"}</td>
                    <td className="py-2 px-2 text-xs">{e.staffUsername}</td>
                    <td className="py-2 px-2 text-right font-mono font-bold">{fmtMoney(e.amount)}</td>
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
  const bySource = { cash_drawer: 0, out_of_pocket: 0, bank_transfer: 0, unspecified: 0 };
  filtered.forEach((e) => {
    if (e.paymentSource) bySource[e.paymentSource] += e.amount;
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
  <div><span>&nbsp;&nbsp;Bank Transfer / Visa / InstaPay</span><span>${bySource.bank_transfer.toFixed(2)} EGP</span></div>
  ${bySource.unspecified > 0 ? `<div><span>&nbsp;&nbsp;Unspecified</span><span>${bySource.unspecified.toFixed(2)} EGP</span></div>` : ""}
  <div><span>Line Items</span><span>${filtered.length}</span></div>
</div>
<table>
  <thead><tr><th>Date</th><th>Material</th><th>Qty</th><th>Unit Price</th><th>Payment Source</th><th>Staff</th><th>Total Price</th></tr></thead>
  <tbody>
    ${filtered.map((e) => {
      const m = materials.find((mm) => mm.id === e.materialId);
      return `<tr>
        <td>${new Date(e.ts).toLocaleString()}</td>
        <td>${m?.name ?? e.materialId ?? ""}</td>
        <td>${e.qty ?? ""} ${m?.unit ?? ""}</td>
        <td>${(e.unitCost ?? 0).toFixed(2)} EGP</td>
        <td>${e.paymentSource ? PAYMENT_SOURCE_LABELS[e.paymentSource] : "—"}</td>
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
        new Date(e.ts).toLocaleString(), m?.name ?? e.materialId ?? "", e.qty ?? "", (e.unitCost ?? 0).toFixed(2),
        e.paymentSource ? PAYMENT_SOURCE_LABELS[e.paymentSource] : "", e.staffUsername, e.amount.toFixed(2),
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
            <div className="flex justify-between"><span>Bank Transfer</span><span>{fmtMoney(bySource.bank_transfer)}</span></div>
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
