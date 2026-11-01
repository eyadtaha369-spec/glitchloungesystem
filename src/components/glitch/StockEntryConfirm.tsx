import { useState } from "react";
import { AlertTriangle } from "lucide-react";

export interface StockEntryConfirmLine {
  // Plain-words sentence, e.g. "You are adding 5 kg of Mango at EGP 120 each."
  sentence: string;
  detail?: string;
  warnings: string[];
}

// Pre-submission confirmation for any stock/procurement entry. Warnings
// (sanity-threshold hits) must be explicitly acknowledged before Confirm
// unlocks, so a mistyped quantity or price can't go through on autopilot.
export function StockEntryConfirmModal({ lines, totalLabel, busy, onConfirm, onCancel }: {
  lines: StockEntryConfirmLine[];
  totalLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const warningCount = lines.reduce((a, l) => a + l.warnings.length, 0);
  const [ack, setAck] = useState(false);
  const locked = warningCount > 0 && !ack;
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl border border-black/10 p-5 max-h-[90vh] overflow-y-auto">
        <h3 className="text-base font-bold text-[#2b2416]">Confirm stock entry / تأكيد الإدخال</h3>
        <div className="mt-3 space-y-3">
          {lines.map((l, i) => (
            <div key={i} className="rounded-lg border border-black/10 bg-black/[0.03] p-3">
              <p className="text-sm font-semibold text-[#2b2416]">{l.sentence}</p>
              {l.detail && <p className="text-xs text-muted-foreground mt-1">{l.detail}</p>}
              {l.warnings.map((w, j) => (
                <p key={j} className="mt-2 flex gap-2 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-md p-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" /> <span>{w}</span>
                </p>
              ))}
            </div>
          ))}
        </div>
        <p className="mt-3 text-sm font-mono">Total: <span className="font-bold text-base">{totalLabel}</span></p>
        {warningCount > 0 && (
          <label className="mt-3 flex items-start gap-2 text-xs font-semibold text-red-700 cursor-pointer">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 w-4 h-4" />
            I checked the warning{warningCount > 1 ? "s" : ""} above — these numbers are correct. / راجعت التحذيرات والأرقام صحيحة
          </label>
        )}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className="py-2.5 rounded-lg border border-black/15 text-sm font-semibold">Go back / رجوع</button>
          <button type="button" onClick={onConfirm} disabled={locked || busy} className="py-2.5 rounded-lg bg-[#2b2416] text-white text-sm font-semibold disabled:opacity-40">
            {busy ? "Saving..." : "Confirm / تأكيد"}
          </button>
        </div>
      </div>
    </div>
  );
}
