import { useState } from "react";
import { createPortal } from "react-dom";
import { useStore, fmtMoney, captureGeolocation } from "@/lib/glitch-store";
import { Lock, Unlock, DollarSign } from "lucide-react";

export function ShiftBar() {
  const { state, activeShift, openShift, endShift } = useStore();
  const isAdmin = state.currentUser?.role === "admin";
  const [openingBalance, setOpeningBalance] = useState("0");
  const [err, setErr] = useState<string | null>(null);
  const [endOpen, setEndOpen] = useState(false);
  const [actualCash, setActualCash] = useState("0");
  const [locating, setLocating] = useState(false);
  const [closedSummary, setClosedSummary] = useState<{ expected: number; actual: number; discrepancy: number } | null>(null);
  const [orphanedPrompt, setOrphanedPrompt] = useState<{ count: number; sessionsCount: number; expensesCount: number; total: number } | null>(null);

  const shiftSessions = activeShift ? state.sessions.filter((s) => s.shiftId === activeShift.id) : [];
  const cashSalesOnly = shiftSessions.reduce((a, s) => a + s.cashAmount, 0);
  const shiftRevenue = shiftSessions.reduce((a, s) => a + s.total, 0);

  const handleOpen = async () => {
    setErr(null);
    setLocating(true);
    const geo = await captureGeolocation();
    setLocating(false);
    if (!geo.ok && state.geofenceEnabled) {
      setErr(geo.reason === "denied" ? "Location access is required to open a shift. Please allow it and try again." : "Couldn't get your location. Try again.");
      return;
    }
    const res = await openShift(parseFloat(openingBalance) || 0, geo.ok ? { lat: geo.lat, lng: geo.lng } : null);
    if (!res.ok) { setErr(res.error ?? "Could not open shift"); return; }
    // Can only happen if a checkout/expense was submitted while no
    // shift was open (an admin bypassing the cashier Gatekeeper) --
    // never auto-attached, always requires this explicit confirmation
    // before that revenue moves onto the new shift's books.
    if (res.orphaned && res.orphaned.count > 0) setOrphanedPrompt(res.orphaned);
  };

  const handleEnd = async () => {
    setErr(null);
    setLocating(true);
    const geo = await captureGeolocation();
    setLocating(false);
    if (!geo.ok && state.geofenceEnabled) {
      setErr(geo.reason === "denied" ? "Location access is required to end a shift. Please allow it and try again." : "Couldn't get your location. Try again.");
      return;
    }
    const cash = parseFloat(actualCash) || 0;
    const res = await endShift(cash, geo.ok ? { lat: geo.lat, lng: geo.lng } : null);
    if (!res.ok) { setErr(res.error ?? "Could not end shift"); return; }
    if (res.closedShift && res.closedShift.expectedCash !== null && res.closedShift.discrepancy !== null) {
      setClosedSummary({ expected: res.closedShift.expectedCash, actual: cash, discrepancy: res.closedShift.discrepancy });
    }
    setEndOpen(false);
    setActualCash("0");
  };

  if (!activeShift) {
    return (
      <>
      <div className="glass rounded-2xl p-6 border border-[oklch(0.7_0.19_260/0.4)]">
        <div className="flex items-center gap-2 mb-3">
          <Lock className="w-5 h-5 text-[oklch(0.7_0.19_260)]" />
          <h2 className="text-lg font-semibold">No Active Shift</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Open a shift with your starting cash drawer amount before taking orders or starting rooms. This gives you a clean slate — none of the previous shift's numbers carry over.
        </p>
        {closedSummary && (
          <div className="mb-4 p-3 rounded-lg bg-white/60 border border-black/8 text-xs font-mono">
            <div className="text-muted-foreground uppercase tracking-widest text-[10px] mb-1">Previous Shift Closed</div>
            <div className="flex justify-between"><span>Expected Cash</span><span>{fmtMoney(closedSummary.expected)}</span></div>
            <div className="flex justify-between"><span>Actual Cash</span><span>{fmtMoney(closedSummary.actual)}</span></div>
            <div className={`flex justify-between font-bold ${Math.abs(closedSummary.discrepancy) < 0.005 ? "text-[oklch(0.78_0.2_155)]" : "text-[oklch(0.62_0.24_25)]"}`}>
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
              className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 font-mono outline-none focus:border-[oklch(0.7_0.19_260)]"
            />
          </div>
          <button
            onClick={handleOpen}
            disabled={locating}
            className="flex items-center gap-2 px-5 py-2.5 mt-5 rounded-lg bg-gradient-to-r from-[oklch(0.7_0.19_260)] to-[oklch(0.65_0.24_305)] text-[#2b2416] font-semibold text-sm shadow-[0_0_20px_oklch(0.7_0.19_260/0.4)] disabled:opacity-60"
          >
            <Unlock className="w-4 h-4" /> {locating ? "Locating..." : "Open Shift"}
          </button>
        </div>
        {err && <div className="mt-2 text-xs text-[oklch(0.62_0.24_25)]">{err}</div>}
      </div>
      {orphanedPrompt && <OrphanedSessionsPrompt info={orphanedPrompt} onClose={() => setOrphanedPrompt(null)} />}
      </>
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
        {isAdmin && (
          <button
            onClick={() => setEndOpen(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[oklch(0.62_0.24_25/0.15)] border border-[oklch(0.62_0.24_25/0.5)] text-[oklch(0.62_0.24_25)] font-semibold text-sm hover:bg-[oklch(0.62_0.24_25/0.25)] transition"
          >
            <Lock className="w-4 h-4" /> End Shift
          </button>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-center">
        <div className="bg-white/60 rounded-lg p-3 border border-black/8">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Shift Revenue</div>
          <div className="mt-1 font-mono font-bold text-lg">{fmtMoney(shiftRevenue)}</div>
          <div className="text-[9px] text-muted-foreground/70 mt-0.5">Whole shift, since {new Date(activeShift.openedAt).toLocaleDateString()}</div>
        </div>
        <div className="bg-white/60 rounded-lg p-3 border border-black/8">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Orders Closed</div>
          <div className="mt-1 font-mono font-bold text-lg">{shiftSessions.length}</div>
        </div>
      </div>

      {endOpen && createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md" onClick={() => setEndOpen(false)}>
          <div className="w-full max-w-lg max-h-[92vh] overflow-y-auto glass-strong rounded-3xl border-2 border-[oklch(0.62_0.24_25/0.5)] shadow-[0_0_60px_oklch(0.62_0.24_25/0.4)] p-7" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <DollarSign className="w-8 h-8 text-[oklch(0.62_0.24_25)]" />
              <h3 className="text-2xl font-bold">Close Out Shift</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-5">Count your cash drawer and enter the actual amount. Expected cash = opening balance + cash sales − any approved drawer expenses, computed when you confirm. This closes the shift permanently and resets counters for the next cashier.</p>

            {state.pendingVoidCountForActiveShift > 0 && (
              <div className="mb-5 p-4 rounded-xl bg-black/12 border-2 border-black/50 text-sm text-white font-medium">
                ⚠ {state.pendingVoidCountForActiveShift} void request{state.pendingVoidCountForActiveShift > 1 ? "s are" : " is"} still awaiting admin approval this shift. Closing now will flag {state.pendingVoidCountForActiveShift > 1 ? "them" : "it"} as an <strong>Unapproved Discrepancy</strong> for the owner to reconcile later.
              </div>
            )}

            <div className="flex justify-between text-lg font-mono font-bold mb-4 p-4 rounded-xl bg-white/60 border border-black/10">
              <span className="text-muted-foreground text-sm uppercase tracking-widest self-center">Cash Sales So Far</span><span>{fmtMoney(cashSalesOnly)}</span>
            </div>
            <label className="text-sm uppercase tracking-widest font-bold text-muted-foreground">Actual Cash Counted</label>
            <input
              type="number" step="0.01" value={actualCash} autoFocus
              onChange={(e) => setActualCash(e.target.value)}
              className="mt-2 w-full bg-white/80 border-2 border-black/12 rounded-xl px-4 py-4 text-2xl font-mono font-bold text-center outline-none focus:border-[oklch(0.7_0.19_260)]"
            />
            {err && <div className="mt-3 text-sm p-3 rounded-xl bg-[oklch(0.62_0.24_25/0.15)] border-2 border-[oklch(0.62_0.24_25/0.5)] text-[oklch(0.62_0.24_25)] font-semibold">{err}</div>}
            <div className="flex gap-3 mt-6">
              <button onClick={() => setEndOpen(false)} className="flex-1 py-4 rounded-xl bg-black/5 border-2 border-black/10 text-base font-semibold hover:bg-black/8 transition">Cancel</button>
              <button onClick={handleEnd} disabled={locating} className="flex-1 py-4 rounded-xl bg-[oklch(0.62_0.24_25/0.25)] border-2 border-[oklch(0.62_0.24_25/0.6)] text-[oklch(0.62_0.24_25)] font-bold text-base uppercase tracking-wide disabled:opacity-60">{locating ? "Locating..." : "Confirm & Close"}</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

// Shared between ShiftBar (admin's own shift controls) and Gatekeeper
// (the cashier's mandatory shift-open screen) -- both trigger this
// same explicit confirmation the moment a shift opens with something
// orphaned waiting, rather than silently reassigning money to a new
// shift with no one ever seeing it happen.
export function OrphanedSessionsPrompt({ info, onClose }: {
  info: { count: number; sessionsCount: number; expensesCount: number; total: number };
  onClose: () => void;
}) {
  const { attachOrphanedToShift } = useStore();
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const attach = async () => {
    setSubmitting(true);
    setErr(null);
    try {
      const res = await attachOrphanedToShift();
      if (!res.ok) { setErr(res.error ?? "Could not attach these."); return; }
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const parts: string[] = [];
  if (info.sessionsCount > 0) parts.push(`${info.sessionsCount} closed check${info.sessionsCount === 1 ? "" : "s"}`);
  if (info.expensesCount > 0) parts.push(`${info.expensesCount} expense${info.expensesCount === 1 ? "" : "s"}`);

  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md" onClick={() => !submitting && onClose()}>
      <div className="w-full max-w-sm glass-strong rounded-2xl border-2 border-[oklch(0.85_0.18_85/0.6)] p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-bold mb-2">Unassigned sales found</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Found {parts.join(" and ")} (Total: {fmtMoney(info.total)}) recorded while no shift was active — likely
          from a checkout that happened before this shift was opened. Attach them to this new shift so they count
          toward its revenue?
        </p>
        {err && <div className="text-sm text-[oklch(0.62_0.24_25)] mb-3">{err}</div>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} disabled={submitting} className="px-4 py-2 rounded-lg text-sm bg-black/5 border border-black/10">Not now</button>
          <button
            onClick={() => void attach()}
            disabled={submitting}
            className="px-4 py-2 rounded-lg text-sm font-bold bg-gradient-to-r from-[oklch(0.7_0.19_260)] to-[oklch(0.65_0.24_305)] text-[#2b2416] disabled:opacity-60"
          >
            {submitting ? "Attaching..." : "Yes, Attach to Shift"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
