import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import logo from "@/assets/glitch-logo-mark.png";
import { fmtMoney } from "@/lib/glitch-store";
import { printSmart } from "@/lib/print";

export interface VoidReceiptData {
  ts: number;
  voidedBy: string;            // logged-in user who confirmed the void
  approvedBy?: string | null;  // admin who authorised it, when different
  requestedBy?: string | null; // cashier who requested it (admin approvals)
  location: string;            // room / table name
  orderRef: string;            // original order # / check reference
  items: { qty: number; name: string; unitPrice: number }[];
  amount: number;
  reason: string;
  waiter?: string | null;
  status: string;
}

function fmtStamp(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "2-digit", day: "2-digit" }) + " " +
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// Resolves once the logo is loaded (max 1.5s) and the receipt DOM has painted,
// so a print started right after setState includes everything.
export async function waitForReceiptPaint(): Promise<void> {
  await new Promise<void>((resolve) => {
    const img = new Image();
    const t = setTimeout(resolve, 1500);
    img.onload = img.onerror = () => { clearTimeout(t); resolve(); };
    img.src = logo;
    if (img.complete) { clearTimeout(t); resolve(); }
  });
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
}

// Thermal "VOID RECEIPT". Rendered off-screen (portaled to <body> like every
// other receipt) and printed automatically on mount through the same
// printSmart() path as normal receipts. English-only, single-line rows.
export function VoidReceiptPrint({ receipt, onDone, autoPrint = true }: { receipt: VoidReceiptData; onDone: () => void; autoPrint?: boolean }) {
  const fired = useRef(false);
  useEffect(() => {
    // autoPrint=false: the caller prints directly inside its own click flow.
    if (!autoPrint || fired.current) return;
    fired.current = true;
    // NOTE: no "cancelled" flag on cleanup. React StrictMode (dev) runs this
    // effect, runs its cleanup, then skips the second run because of
    // fired.current -- a cancel flag set by that cleanup silently killed the
    // print every time. The print must always run exactly once per receipt.
    (async () => {
      // Wait for the logo so it is in the printout, but never block forever.
      await new Promise<void>((resolve) => {
        const img = new Image();
        const t = setTimeout(resolve, 1500);
        img.onload = img.onerror = () => { clearTimeout(t); resolve(); };
        img.src = logo;
        if (img.complete) { clearTimeout(t); resolve(); }
      });
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      try { await printSmart(); } catch (err) { console.error("Void receipt print failed:", err); }
      onDone();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const Row = ({ k, v }: { k: string; v: string }) => (
    <div className="flex justify-between gap-2"><span>{k}</span><span className="text-right">{v}</span></div>
  );

  return createPortal(
    <div className="print-root fixed top-0 -left-[10000px] w-[80mm]" aria-hidden>
      <div className="print-area p-4 font-mono text-sm bg-white text-black">
        <div className="text-center mb-3 receipt-block">
          <img src={logo} alt="GLITCH" className="w-32 h-auto mx-auto receipt-logo" />
          <div className="text-lg font-bold tracking-widest mt-1">GLITCH</div>
          <div className="text-base font-black mt-2">*** VOID RECEIPT ***</div>
        </div>
        <div className="border-b border-dashed border-black/40 py-2 my-2 text-xs receipt-block">
          <Row k="Voided By" v={receipt.voidedBy} />
          {receipt.approvedBy && receipt.approvedBy !== receipt.voidedBy && <Row k="Approved By" v={receipt.approvedBy} />}
          {receipt.requestedBy && receipt.requestedBy !== receipt.voidedBy && <Row k="Requested By" v={receipt.requestedBy} />}
          <Row k="Date/Time" v={fmtStamp(receipt.ts)} />
          <Row k="Order #" v={receipt.orderRef} />
          <Row k="Room/Table" v={receipt.location} />
          {receipt.waiter ? <Row k="Waiter" v={receipt.waiter} /> : null}
          <Row k="Status" v={receipt.status} />
        </div>
        <div className="text-xs uppercase tracking-widest opacity-70">Voided Items</div>
        {receipt.items.map((it, i) => (
          <div key={i} className="flex justify-between receipt-line">
            <span>{it.qty}× {it.name}</span><span>{fmtMoney(it.qty * it.unitPrice)}</span>
          </div>
        ))}
        <div className="border-t border-double border-black/25 mt-3 pt-2 receipt-block receipt-total">
          <div className="flex justify-between text-lg font-black"><span>VOID TOTAL</span><span>{fmtMoney(receipt.amount)}</span></div>
        </div>
        <div className="mt-3 text-xs receipt-block">
          <div className="uppercase tracking-widest opacity-70">Reason</div>
          <div className="font-bold">{receipt.reason || "—"}</div>
        </div>
        <div className="text-center text-xs font-bold uppercase tracking-widest mt-4">*** VOID RECEIPT ***</div>
      </div>
    </div>,
    document.body,
  );
}
