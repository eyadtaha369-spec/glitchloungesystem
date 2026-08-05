import { useEffect, useState } from "react";
import { useStore, fmtMoney } from "@/lib/glitch-store";
import type { LedgerEntry, PaymentSource } from "@/lib/glitch-store";
import { Receipt, Wallet, Landmark, HandCoins, CheckCircle2 } from "lucide-react";

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

export function UnpaidExpensesPage() {
  const { unpaidExpenses, refreshUnpaidExpenses } = useStore();
  const [settleTarget, setSettleTarget] = useState<LedgerEntry | null>(null);

  useEffect(() => {
    void refreshUnpaidExpenses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const total = unpaidExpenses.reduce((a, e) => a + e.amount, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Unpaid Expenses</h1>
        <p className="text-sm text-muted-foreground mt-1 font-mono uppercase tracking-widest">
          المصروفات والمشتريات الآجلة — Debts &amp; Pending Payments
        </p>
      </div>

      <div className="glass rounded-2xl p-6 border border-[oklch(0.82_0.16_85/0.4)]">
        <div className="flex items-center gap-2 mb-1">
          <Receipt className="w-5 h-5 text-[oklch(0.82_0.16_85)]" />
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Total Owed</div>
        </div>
        <div className="text-3xl font-mono font-bold text-[oklch(0.82_0.16_85)]">{fmtMoney(total)}</div>
        <p className="text-xs text-muted-foreground mt-1">
          {unpaidExpenses.length} unpaid item{unpaidExpenses.length === 1 ? "" : "s"} — none of these have affected any shift's cash drawer yet.
        </p>
      </div>

      <div className="glass rounded-2xl p-6">
        {unpaidExpenses.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-8">No unpaid expenses — everything's settled.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-widest text-muted-foreground border-b border-black/8">
                  <th className="text-left py-2 px-2">Date</th>
                  <th className="text-left py-2 px-2">Item / Expense</th>
                  <th className="text-right py-2 px-2">Amount</th>
                  <th className="text-left py-2 px-2">Supplier / Notes</th>
                  <th className="py-2 px-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {unpaidExpenses.map((e) => (
                  <tr key={e.id} className="border-b border-black/8 hover:bg-black/5">
                    <td className="py-2.5 px-2 text-muted-foreground font-mono text-xs">{new Date(e.ts).toLocaleDateString()}</td>
                    <td className="py-2.5 px-2 font-semibold">{e.description}</td>
                    <td className="py-2.5 px-2 text-right font-mono font-bold text-[oklch(0.75_0.22_25)]">{fmtMoney(e.amount)}</td>
                    <td className="py-2.5 px-2 text-muted-foreground text-xs">{e.supplierId || e.category || "—"}</td>
                    <td className="py-2.5 px-2 text-right">
                      <button
                        onClick={() => setSettleTarget(e)}
                        className="text-xs font-bold uppercase tracking-widest px-3 py-1.5 rounded-lg bg-[oklch(0.78_0.2_155/0.15)] border border-[oklch(0.78_0.2_155/0.5)] text-[oklch(0.78_0.2_155)] hover:bg-[oklch(0.78_0.2_155/0.25)]"
                      >
                        Settle / تسديد
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {settleTarget && <SettleModal entry={settleTarget} onClose={() => setSettleTarget(null)} />}
    </div>
  );
}

function SettleModal({ entry, onClose }: { entry: LedgerEntry; onClose: () => void }) {
  const { settleExpense } = useStore();
  const [paymentSource, setPaymentSource] = useState<PaymentSource | "">("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!paymentSource) { setErr("Select a payment source."); return; }
    setSubmitting(true);
    setErr(null);
    try {
      const res = await settleExpense(entry.id, paymentSource);
      if (!res.ok) { setErr(res.error ?? "Settlement failed"); return; }
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={() => !submitting && onClose()}>
      <div className="w-full max-w-md glass-strong rounded-2xl border border-[oklch(0.78_0.2_155/0.5)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-5 py-4 border-b border-black/8">
          <CheckCircle2 className="w-5 h-5 text-[oklch(0.78_0.2_155)]" />
          <h3 className="text-lg font-bold">Settle Debt</h3>
        </div>
        <div className="p-5 space-y-4">
          <div className="rounded-lg bg-black/5 border border-black/8 p-3 text-sm">
            <div className="font-semibold">{entry.description}</div>
            <div className="text-lg font-mono font-bold text-[oklch(0.75_0.22_25)] mt-1">{fmtMoney(entry.amount)}</div>
          </div>
          <div>
            <label className="text-xs uppercase tracking-widest text-muted-foreground">Payment Source / طريقة الدفع</label>
            <div className="grid grid-cols-1 gap-2 mt-1.5">
              {(Object.keys(PAYMENT_SOURCE_LABELS) as PaymentSource[]).map((src) => {
                const Icon = PAYMENT_SOURCE_ICONS[src];
                return (
                  <button
                    key={src}
                    type="button"
                    onClick={() => setPaymentSource(src)}
                    className={`flex items-center gap-2 text-sm py-2.5 px-3 rounded-lg border transition ${
                      paymentSource === src
                        ? "bg-[oklch(0.78_0.2_155/0.2)] border-[oklch(0.78_0.2_155/0.6)] text-[oklch(0.78_0.2_155)] font-semibold"
                        : "bg-black/5 border-black/10 text-muted-foreground hover:bg-black/8"
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" /> {PAYMENT_SOURCE_LABELS[src]}
                  </button>
                );
              })}
            </div>
            {paymentSource === "cash_drawer" && (
              <p className="text-[11px] text-[oklch(0.82_0.16_85)] mt-1.5">This will now deduct from the active shift's expected cash.</p>
            )}
          </div>
          {err && <div className="text-sm text-[oklch(0.75_0.22_25)]">{err}</div>}
        </div>
        <div className="p-4 border-t border-black/8 flex justify-end gap-2">
          <button onClick={onClose} disabled={submitting} className="px-4 py-2 rounded-lg text-sm bg-black/5 hover:bg-black/8 border border-black/10">Cancel</button>
          <button
            onClick={() => void submit()}
            disabled={submitting || !paymentSource}
            className="px-4 py-2 rounded-lg text-sm bg-[oklch(0.78_0.2_155/0.2)] border border-[oklch(0.78_0.2_155/0.5)] text-[oklch(0.78_0.2_155)] font-bold disabled:opacity-40"
          >
            {submitting ? "Settling..." : "Confirm Payment"}
          </button>
        </div>
      </div>
    </div>
  );
}
