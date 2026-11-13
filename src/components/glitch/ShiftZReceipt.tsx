import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { Shift, Session, LedgerEntry } from "@/lib/types";
import { printSmart } from "@/lib/print";
import { businessDayLabelForTs } from "@/lib/business-day";
import logo from "@/assets/glitch-logo-mark.png";

// 80mm thermal Z-report. Every row is composed as a fixed-width monospace
// string (40 chars) so label and value ALWAYS sit on one line with a dotted
// leader between them — nothing can wrap or drift. Display only: all figures
// are derived from the already-closed shift's own sessions/ledger.
const W = 40;
const NON_ITEM_PREFIXES = ["room-time", "transfer-charge-", "partial-payment", "split-credit-"];
const money = (n: number) => "EGP " + (Math.round(n * 100) / 100).toFixed(2);
const FSI = "⁨", PDI = "⁩"; // isolate any Arabic names so alignment can't be bidi-scrambled

function row(label: string, value: string): string {
  const max = Math.max(4, W - value.length - 3);
  const lab = label.length > max ? label.slice(0, max - 1) + "." : label;
  const dots = ".".repeat(Math.max(2, W - lab.length - value.length - 2));
  return FSI + lab + PDI + " " + dots + " " + value;
}
const center = (t: string) => " ".repeat(Math.max(0, Math.floor((W - t.length) / 2))) + t;
const rule = (c = "-") => c.repeat(W);
const stamp = (ts: number) => {
  const d = new Date(ts);
  return d.toLocaleDateString("en-GB") + " " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
};

type Line = { t: string; b?: boolean; big?: boolean };

export function buildZReportLines({ shift, sessions, ledger }: { shift: Shift; sessions: Session[]; ledger: LedgerEntry[] }): Line[] {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const net = (s: Session) => (s.subtotal == null ? (Number(s.total) || 0) - (Number(s.vatAmount) || 0) : Number(s.subtotal));
  const roomTime = r2(sessions.reduce((a, s) => a + (Number(s.timeCost) || 0), 0));
  const menuTotal = r2(sessions.reduce((a, s) => a + (Number(s.ordersCost) || 0), 0));
  const netTotal = r2(sessions.reduce((a, s) => a + net(s), 0));
  const discounts = r2(roomTime + menuTotal - netTotal);
  const vat = r2(sessions.reduce((a, s) => a + (Number(s.vatAmount) || 0), 0));
  const grand = r2(sessions.reduce((a, s) => a + (Number(s.total) || 0), 0));
  const cash = r2(sessions.reduce((a, s) => a + (Number(s.cashAmount) || 0), 0));
  const visa = r2(sessions.reduce((a, s) => a + (Number(s.visaAmount) || 0), 0));
  const insta = r2(sessions.reduce((a, s) => a + (Number(s.instapayAmount) || 0), 0));
  const expenses = r2(ledger.filter((l) => l.status === "approved" && l.paidFromDrawer && l.direction === "outflow").reduce((a, l) => a + Number(l.amount), 0));

  const rooms = new Map<string, number>();
  sessions.forEach((s) => rooms.set(s.roomName, (rooms.get(s.roomName) || 0) + net(s)));
  const items = new Map<string, { qty: number; rev: number }>();
  sessions.forEach((s) => s.orders.forEach((o) => {
    if (NON_ITEM_PREFIXES.some((p) => String(o.menuItemId).startsWith(p))) return;
    const cur = items.get(o.name) || { qty: 0, rev: 0 };
    cur.qty += o.qty; cur.rev += o.qty * o.price;
    items.set(o.name, cur);
  }));

  const expected = Number(shift.expectedCash) || 0;
  const counted = Number(shift.closingActualCash) || 0;
  const variance = shift.discrepancy != null ? Number(shift.discrepancy) : counted - expected;
  const L: Line[] = [];
  const add = (t: string, o: Partial<Line> = {}) => L.push({ t, ...o });

  add(center("GLITCH PLAYSTATION & LOUNGE"), { b: true });
  add(center("SHIFT Z-REPORT"), { b: true });
  add(rule("="));
  add(row("Cashier", shift.cashierUsername));
  add(row("Shift Start", stamp(shift.openedAt)));
  add(row("Shift End", shift.closedAt ? stamp(shift.closedAt) : "-"));
  add(row("Business Date", businessDayLabelForTs(shift.openedAt)));
  add(row("Orders", String(sessions.length)));
  add(rule());
  add("ROOMS / TABLES (net of VAT)", { b: true });
  if (rooms.size === 0) add("- none -");
  Array.from(rooms.entries()).sort((a, b) => b[1] - a[1]).forEach(([n, v]) => add(row(n, money(v))));
  add(rule());
  add("MENU ITEMS SOLD", { b: true });
  if (items.size === 0) add("- none -");
  Array.from(items.entries()).sort((a, b) => b[1].rev - a[1].rev).forEach(([n, v]) => add(row(v.qty + "x " + n, money(v.rev))));
  add(rule());
  add("FINANCIAL SUMMARY", { b: true });
  add(row("Room Time Total", money(roomTime)));
  add(row("Menu Items Total", money(menuTotal)));
  if (Math.abs(discounts) >= 0.005) add(row("Discounts", "-" + money(Math.abs(discounts))));
  add(row("VAT (14%)", money(vat)));
  add(rule());
  add(row("Cash Sales", money(cash)));
  add(row("Card Sales", money(visa)));
  add(row("InstaPay", money(insta)));
  add(row("Expenses / Deductions", money(expenses)));
  add(rule());
  add(row("Opening Cash", money(Number(shift.openingBalance) || 0)));
  add(row("Expected Cash", money(expected)));
  add(row("Counted Cash", money(counted)));
  add(row(Math.abs(variance) < 0.005 ? "Variance (balanced)" : variance > 0 ? "Variance (OVER)" : "Variance (SHORT)", (variance > 0 ? "+" : variance < 0 ? "-" : "") + money(Math.abs(variance)), ), { b: true });
  add(rule("="));
  add(row("GRAND TOTAL", money(grand)), { b: true, big: true });
  add(rule("="));
  add(center("Printed " + stamp(Date.now())));
  return L;
}

export function ShiftZReceiptPrint({ data, onDone }: { data: { shift: Shift; sessions: Session[]; ledger: LedgerEntry[] }; onDone: () => void }) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    (async () => {
      await new Promise<void>((resolve) => {
        const img = new Image();
        const t = setTimeout(resolve, 1500);
        img.onload = img.onerror = () => { clearTimeout(t); resolve(); };
        img.src = logo;
        if (img.complete) { clearTimeout(t); resolve(); }
      });
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      try { await printSmart(); } catch (err) { console.error("Z-report print failed:", err); }
      onDone();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const lines = buildZReportLines(data);
  return createPortal(
    <div className="print-root fixed top-0 -left-[10000px] w-[80mm]" aria-hidden>
      <div className="print-area bg-white text-black">
        <div className="text-center"><img src={logo} alt="GLITCH" className="w-28 h-auto mx-auto receipt-logo" /></div>
        <div dir="ltr" style={{ fontFamily: '"Courier New", monospace', fontSize: "11px", lineHeight: 1.35, whiteSpace: "pre", textAlign: "left" }}>
          {lines.map((l, i) => (
            <div key={i} style={{ fontWeight: l.b ? 800 : 500, fontSize: l.big ? "12px" : undefined }}>{l.t || " "}</div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
