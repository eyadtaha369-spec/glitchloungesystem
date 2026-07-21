import { useRef, useState } from "react";
import { useStore, fmtMoney } from "@/lib/glitch-store";
import type { LedgerEntry } from "@/lib/glitch-store";
import { Camera, CheckCircle2, XCircle, Clock, ShieldAlert, Package } from "lucide-react";

const TYPE_LABEL: Record<string, string> = {
  stockedBatch: "Stocked Batch (bulk delivery)",
  dailyFresh: "Daily Fresh Sheet (perishables)",
  midShiftPurchase: "Mid-Shift Purchase",
};

export function ProcurementPage() {
  const { state } = useStore();
  const isAdmin = state.currentUser?.role === "admin";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Procurement</h1>
        <p className="text-sm text-muted-foreground mt-1 font-mono uppercase tracking-widest">
          Log Purchases &amp; Expenses
        </p>
      </div>

      {!isAdmin && (
        <div className="glass rounded-2xl p-4 border border-[oklch(0.82_0.16_85/0.4)] flex items-start gap-3">
          <ShieldAlert className="w-5 h-5 text-[oklch(0.82_0.16_85)] shrink-0 mt-0.5" />
          <p className="text-sm text-muted-foreground">
            Your submissions go to <strong className="text-foreground">Pending Approval</strong>. Stock and cash are not affected until an admin reviews and approves the receipt.
          </p>
        </div>
      )}

      <SubmitPurchaseForm />

      {isAdmin && <PendingApprovals />}
    </div>
  );
}

function SubmitPurchaseForm() {
  const { state, activeShift, submitPurchase } = useStore();
  const isAdmin = state.currentUser?.role === "admin";
  const fileRef = useRef<HTMLInputElement>(null);

  const [purchaseType, setPurchaseType] = useState<"dailyFresh" | "midShiftPurchase" | "stockedBatch">("dailyFresh");
  const [materialId, setMaterialId] = useState("");
  const [qty, setQty] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [description, setDescription] = useState("");
  const [paidFromDrawer, setPaidFromDrawer] = useState(true);
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
    setMaterialId(""); setQty(""); setUnitCost(""); setSupplierId(""); setDescription("");
    onFile(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const submit = async () => {
    setResult(null);
    if (!materialId || !qty || !unitCost) { setResult({ kind: "err", text: "Material, quantity, and unit cost are required." }); return; }
    if (!receiptFile) { setResult({ kind: "err", text: "A receipt photo is required to submit." }); return; }
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
        paidFromDrawer: purchaseType === "stockedBatch" ? paidFromDrawer : true,
        receiptFile,
      });
      if (!res.ok) { setResult({ kind: "err", text: res.error ?? "Submission failed" }); return; }
      setResult({
        kind: "ok",
        text: res.status === "approved"
          ? `Approved instantly — ${fmtMoney(total)} added to inventory.`
          : `Submitted for admin approval — ${fmtMoney(total)} is pending, no stock or cash effect yet.`,
      });
      reset();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="glass rounded-2xl p-6">
      <div className="flex items-center gap-2 mb-4">
        <Package className="w-5 h-5 text-[oklch(0.7_0.19_260)]" />
        <h2 className="text-lg font-semibold">Log a Purchase</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-4">
        {(["dailyFresh", "midShiftPurchase", "stockedBatch"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setPurchaseType(t)}
            className={`text-xs py-2.5 px-3 rounded-lg border transition ${
              purchaseType === t
                ? "bg-[oklch(0.7_0.19_260/0.2)] border-[oklch(0.7_0.19_260/0.5)] text-white"
                : "bg-white/5 border-white/10 text-muted-foreground hover:bg-white/10"
            }`}
          >
            {TYPE_LABEL[t]}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="text-xs uppercase tracking-widest text-muted-foreground">Material</label>
          <select value={materialId} onChange={(e) => setMaterialId(e.target.value)} className="mt-1 w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm">
            <option value="">Select material...</option>
            {state.materials.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.unit})</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs uppercase tracking-widest text-muted-foreground">Supplier (optional)</label>
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="mt-1 w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm">
            <option value="">None</option>
            {state.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs uppercase tracking-widest text-muted-foreground">Quantity {material ? `(${material.unit})` : ""}</label>
          <input type="number" step="0.01" value={qty} onChange={(e) => setQty(e.target.value)} className="mt-1 w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm font-mono" />
        </div>
        <div>
          <label className="text-xs uppercase tracking-widest text-muted-foreground">Unit Cost</label>
          <input type="number" step="0.01" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} className="mt-1 w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm font-mono" />
        </div>
        <div className="md:col-span-2">
          <label className="text-xs uppercase tracking-widest text-muted-foreground">Description (optional)</label>
          <input value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1 w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm" />
        </div>
        {purchaseType === "stockedBatch" && (
          <label className="md:col-span-2 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={paidFromDrawer} onChange={(e) => setPaidFromDrawer(e.target.checked)} />
            Paid from the till drawer (affects cash reconciliation)
          </label>
        )}
        {purchaseType !== "stockedBatch" && !activeShift && (
          <div className="md:col-span-2 text-xs text-[oklch(0.82_0.16_85)]">No active shift — this won't be tied to a specific shift's drawer.</div>
        )}
      </div>

      <div className="mt-4 flex items-center gap-2 text-sm font-mono">
        <span className="text-muted-foreground">Total:</span>
        <span className="font-bold text-lg">{fmtMoney(total)}</span>
      </div>

      <div className="mt-4">
        <label className="text-xs uppercase tracking-widest text-muted-foreground">Receipt Photo (required)</label>
        <div className="mt-2 flex items-center gap-4">
          <button
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 text-sm"
          >
            <Camera className="w-4 h-4" /> {receiptFile ? "Change Photo" : "Attach Photo"}
          </button>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
          {receiptPreview && <img src={receiptPreview} alt="Receipt preview" className="h-16 w-16 object-cover rounded-lg border border-white/10" />}
        </div>
      </div>

      {result && (
        <div className={`mt-4 text-sm p-3 rounded-lg border ${result.kind === "ok" ? "bg-[oklch(0.78_0.2_155/0.1)] border-[oklch(0.78_0.2_155/0.4)] text-[oklch(0.78_0.2_155)]" : "bg-[oklch(0.62_0.24_25/0.1)] border-[oklch(0.62_0.24_25/0.4)] text-[oklch(0.75_0.22_25)]"}`}>
          {result.text}
        </div>
      )}

      <button
        onClick={submit}
        disabled={submitting}
        className="mt-4 w-full py-3 rounded-lg bg-gradient-to-r from-[oklch(0.7_0.19_260)] to-[oklch(0.65_0.24_305)] text-white font-semibold text-sm disabled:opacity-60"
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
        <Clock className="w-5 h-5 text-[oklch(0.82_0.16_85)]" />
        <h2 className="text-lg font-semibold">Pending Approvals</h2>
        {state.pendingApprovals.length > 0 && (
          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-[oklch(0.82_0.16_85/0.2)] text-[oklch(0.82_0.16_85)] border border-[oklch(0.82_0.16_85/0.5)]">
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
              <div key={entry.id} className="bg-black/30 rounded-lg p-4 border border-[oklch(0.82_0.16_85/0.3)] flex flex-col md:flex-row gap-4">
                {entry.receiptUrl && (
                  <a href={entry.receiptUrl} target="_blank" rel="noreferrer" className="shrink-0">
                    <img src={entry.receiptUrl} alt="Receipt" className="h-20 w-20 object-cover rounded-lg border border-white/10" />
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
                      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" className="flex-1 bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs" />
                      <button onClick={async () => { await rejectPurchase(entry.id, reason); setRejectingId(null); setReason(""); }} className="text-xs px-3 py-1.5 rounded bg-[oklch(0.62_0.24_25/0.2)] border border-[oklch(0.62_0.24_25/0.5)] text-[oklch(0.75_0.22_25)]">Confirm Reject</button>
                      <button onClick={() => setRejectingId(null)} className="text-xs px-3 py-1.5 rounded bg-white/5 border border-white/10">Cancel</button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 mt-3">
                      <button onClick={() => approvePurchase(entry.id)} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-[oklch(0.78_0.2_155/0.2)] border border-[oklch(0.78_0.2_155/0.5)] text-[oklch(0.78_0.2_155)]">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Approve
                      </button>
                      <button onClick={() => setRejectingId(entry.id)} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-white/5 border border-white/10 hover:bg-[oklch(0.62_0.24_25/0.15)]">
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
