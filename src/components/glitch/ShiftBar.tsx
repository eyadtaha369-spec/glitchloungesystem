import { useState } from "react";
import { useStore, fmtMoney } from "@/lib/glitch-store";
import { Lock, Unlock, DollarSign } from "lucide-react";

export function ShiftBar() {
  const { state, activeShift, openShift, endShift } = useStore();
  const [openingBalance, setOpeningBalance] = useState("0");
  const [err, setErr] = useState<string | null>(null);
  const [endOpen, setEndOpen] = useState(false);
  const [actualCash, setActualCash] = useState("0");
  const [closedSummary, setClosedSummary] = useState<{ expected: number; actual: number; discrepancy: number } | null>(null);

  const shiftSessions = activeShift ? state.sessions.filter((s) => s.shiftId === activeShift.id) : [];
  const cashSalesOnly = shiftSessions.filter((s) => s.paymentMethod === "cash").reduce((a, s) => a + s.total, 0);
  const shiftRevenue = shiftSessions.reduce((a, s) => a + s.total, 0);

  const handleOpen = async () => {
    setErr(null);
    const res = await openShift(parseFloat(openingBalance) || 0);
    if (!res.ok) setErr(res.error ?? "Could not open shift");
  };

  const handleEnd = async () => {
    setErr(null);
    const cash = parseFloat(actualCash) || 0;
    const res = await endShift(cash);
    if (!res.ok) { setErr(res.error ?? "Could not end shift"); return; }
    if (res.closedShift && res.closedShift.expectedCash !== null && res.closedShift.discrepancy !== null) {
      setClosedSummary({ expected: res.closedShift.expectedCash, actual: cash, discrepancy: res.closedShift.discrepancy });
    }
    setEndOpen(false);
    setActualCash("0");
  };

  if (!activeShift) {
    return (
      <div className="glass rounded-2xl p-6 border border-[oklch(0.7_0.19_260/0.4)]">
        <div className="flex items-center gap-2 mb-3">
          <Lock className="w-5 h-5 text-[oklch(0.85_0.16_200)]" />
          <h2 className="text-lg font-semibold">No Active Shift</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Open a shift with your starting cash drawer amount before taking orders or starting rooms. This gives you a clean slate — none of the previous shift's numbers carry over.
        </p>
        {closedSummary && (
          <div className="mb-4 p-3 rounded-lg bg-black/30 border border-white/5 text-xs font-mono">
            <div className="text-muted-foreground uppercase tracking-widest text-[10px] mb-1">Previous Shift Closed</div>
            <div className="flex justify-between"><span>Expected Cash</span><span>{fmtMoney(closedSummary.expected)}</span></div>
            <div className="flex justify-between"><span>Actual Cash</span><span>{fmtMoney(closedSummary.actual)}</span></div>
            <div className={`flex justify-between font-bold ${Math.abs(closedSummary.discrepancy) < 0.005 ? "text-[oklch(0.78_0.2_155)]" : "text-[oklch(0.75_0.22_25)]"}`}>
              <span>Discrepancy</span><span>{fmtMoney(closedSummary.discrepancy)}</span>
            </div>
          </div>
        )}
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <label className="text-xs uppercase tracking-widest text-muted-foreground">Opening Balance</label>
            <input
              type="number" step="0.01" value={openingBalance}
              onChange={(e) => setOpeningBalance(e.target.value)}
              className="mt-1 w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 font-mono outline-none focus:border-[oklch(0.7_0.19_260)]"
            />
          </div>
          <button
            onClick={handleOpen}
            className="flex items-center gap-2 px-5 py-2.5 mt-5 rounded-lg bg-gradient-to-r from-[oklch(0.7_0.19_260)] to-[oklch(0.65_0.24_305)] text-white font-semibold text-sm shadow-[0_0_20px_oklch(0.7_0.19_260/0.4)]"
          >
            <Unlock className="w-4 h-4" /> Open Shift
          </button>
        </div>
        {err && <div className="mt-2 text-xs text-[oklch(0.75_0.22_25)]">{err}</div>}
      </div>
    );
  }

  return (
    <div className="glass rounded-2xl p-6 border border-[oklch(0.78_0.2_155/0.4)]">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[oklch(0.78_0.2_155)] animate-pulse-glow" />
            <h2 className="text-lg font-semibold">Shift Open — {activeShift.cashierUsername}</h2>
          </div>
          <p className="text-xs text-muted-foreground font-mono uppercase tracking-widest mt-1">
            Since {new Date(activeShift.openedAt).toLocaleTimeString()} · Opening ${activeShift.openingBalance.toFixed(2)}
          </p>
        </div>
        <button
          onClick={() => setEndOpen(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[oklch(0.62_0.24_25/0.15)] border border-[oklch(0.62_0.24_25/0.5)] text-[oklch(0.75_0.22_25)] font-semibold text-sm hover:bg-[oklch(0.62_0.24_25/0.25)] transition"
        >
          <Lock className="w-4 h-4" /> End Shift
        </button>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3 text-center">
        <div className="bg-black/30 rounded-lg p-3 border border-white/5">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Shift Revenue</div>
          <div className="mt-1 font-mono font-bold text-lg">{fmtMoney(shiftRevenue)}</div>
        </div>
        <div className="bg-black/30 rounded-lg p-3 border border-white/5">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Cash Sales</div>
          <div className="mt-1 font-mono font-bold text-lg">{fmtMoney(cashSalesOnly)}</div>
        </div>
        <div className="bg-black/30 rounded-lg p-3 border border-white/5">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Orders Closed</div>
          <div className="mt-1 font-mono font-bold text-lg">{shiftSessions.length}</div>
        </div>
      </div>

      {endOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={() => setEndOpen(false)}>
          <div className="w-full max-w-sm glass-strong rounded-2xl border border-[oklch(0.62_0.24_25/0.4)] p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-3">
              <DollarSign className="w-5 h-5 text-[oklch(0.75_0.22_25)]" />
              <h3 className="text-lg font-semibold">Close Out Shift</h3>
            </div>
            <p className="text-xs text-muted-foreground mb-4">Count your cash drawer and enter the actual amount. Expected cash = opening balance + cash sales − any approved drawer expenses, computed when you confirm. This closes the shift permanently and resets counters for the next cashier.</p>

            {state.pendingVoidCountForActiveShift > 0 && (
              <div className="mb-4 p-3 rounded-lg bg-[oklch(0.82_0.16_85/0.1)] border border-[oklch(0.82_0.16_85/0.4)] text-xs text-[oklch(0.82_0.16_85)]">
                ⚠ {state.pendingVoidCountForActiveShift} void request{state.pendingVoidCountForActiveShift > 1 ? "s are" : " is"} still awaiting admin approval this shift. Closing now will flag {state.pendingVoidCountForActiveShift > 1 ? "them" : "it"} as an <strong>Unapproved Discrepancy</strong> for the owner to reconcile later.
              </div>
            )}

            <div className="flex justify-between text-sm font-mono mb-3 p-3 rounded-lg bg-black/30 border border-white/5">
              <span className="text-muted-foreground">Cash Sales So Far</span><span>{fmtMoney(cashSalesOnly)}</span>
            </div>
            <label className="text-xs uppercase tracking-widest text-muted-foreground">Actual Cash Counted</label>
            <input
              type="number" step="0.01" value={actualCash} autoFocus
              onChange={(e) => setActualCash(e.target.value)}
              className="mt-1 w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 font-mono outline-none focus:border-[oklch(0.7_0.19_260)]"
            />
            <div className="flex gap-2 mt-4">
              <button onClick={() => setEndOpen(false)} className="flex-1 py-2.5 rounded-lg bg-white/5 border border-white/10 text-sm">Cancel</button>
              <button onClick={handleEnd} className="flex-1 py-2.5 rounded-lg bg-[oklch(0.62_0.24_25/0.2)] border border-[oklch(0.62_0.24_25/0.5)] text-[oklch(0.75_0.22_25)] font-semibold text-sm">Confirm &amp; Close</button>
            </div>
            {err && <div className="mt-2 text-xs text-[oklch(0.75_0.22_25)]">{err}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
