import { jsPDF } from "jspdf";
import type { Shift, Session, LedgerEntry } from "./types";

// Dark/luxury palette matching the app's own branding — gold accent on
// near-black, rather than a plain white business-report look.
const INK = "#141414";
const PANEL = "#1f1f1f";
const GOLD = "#D4AF37";
const TEXT_LIGHT = "#f2f2f2";
const TEXT_MUTED = "#a8a8a8";
const GREEN = "#4ade80";
const RED = "#f87171";

function fmt(n: number): string {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + " EGP";
}
function fmtDateTime(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
function fmtHours(sec: number): string {
  const h = sec / 3600;
  return h.toFixed(1) + "h";
}

export interface ShiftReportData {
  shift: Shift;
  sessions: Session[]; // already filtered to this shift's own sessions
  ledger: LedgerEntry[]; // already filtered to this shift's own ledger entries
}

// Builds the full PDF in memory and returns it as a Blob, plus the
// suggested filename — the caller decides whether to trigger a
// browser download, upload it for storage, or both.
export function generateShiftReportPdf({ shift, sessions, ledger }: ShiftReportData): { blob: Blob; filename: string } {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 40;
  let y = 0;

  // ---- Derived figures (identical logic to ShiftCard's own reconciliation breakdown) ----
  const grossSales = sessions.reduce((a, s) => a + s.total, 0);
  const totalDiscounts = sessions.reduce((a, s) => a + (s.discountAmount || 0), 0);
  const cashCollected = sessions.reduce((a, s) => a + s.cashAmount, 0);
  const visaCollected = sessions.reduce((a, s) => a + s.visaAmount, 0);
  const instapayCollected = sessions.reduce((a, s) => a + s.instapayAmount, 0);
  const approvedOutflows = ledger.filter((l) => l.status === "approved" && l.paidFromDrawer && l.direction === "outflow");
  const supplierPayments = approvedOutflows.filter((l) => l.type === "supplierPayment").reduce((a, l) => a + Number(l.amount), 0);
  const operationalExpenses = approvedOutflows.filter((l) => l.type !== "supplierPayment").reduce((a, l) => a + Number(l.amount), 0);
  const totalExpenses = supplierPayments + operationalExpenses;
  const fixedMonthlyCosts = ledger.filter((l) => l.type === "fixedMonthlyCost");
  const expectedCash = shift.expectedCash;
  const discrepancy = shift.discrepancy;
  const isReconciled = discrepancy !== null && Math.abs(discrepancy) < 0.005;

  // Item sales aggregation, across every session's order lines.
  const itemTotals = new Map<string, { qty: number; revenue: number }>();
  sessions.forEach((s) => {
    s.orders.forEach((line) => {
      const cur = itemTotals.get(line.name) || { qty: 0, revenue: 0 };
      cur.qty += line.qty;
      cur.revenue += line.qty * line.price;
      itemTotals.set(line.name, cur);
    });
  });
  const topItems = Array.from(itemTotals.entries())
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  // Room/table activity — total seated time and a count of completed
  // checks per room, rather than per session (a room can appear
  // multiple times across the shift).
  const roomActivity = new Map<string, { sessions: number; seconds: number }>();
  sessions.forEach((s) => {
    const cur = roomActivity.get(s.roomName) || { sessions: 0, seconds: 0 };
    cur.sessions += 1;
    cur.seconds += s.durationSec;
    roomActivity.set(s.roomName, cur);
  });
  const roomRows = Array.from(roomActivity.entries()).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.seconds - a.seconds);
  const totalPlayedSeconds = sessions.reduce((a, s) => a + s.durationSec, 0);

  // ---- Page background + header band ----
  doc.setFillColor(INK);
  doc.rect(0, 0, pageWidth, doc.internal.pageSize.getHeight(), "F");
  doc.setFillColor(PANEL);
  doc.rect(0, 0, pageWidth, 110, "F");
  doc.setDrawColor(GOLD);
  doc.setLineWidth(1.5);
  doc.line(0, 110, pageWidth, 110);

  doc.setTextColor(GOLD);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("GLITCH LOUNGE OS", margin, 42);
  doc.setFontSize(12);
  doc.setTextColor(TEXT_LIGHT);
  doc.text("Shift Summary Report", margin, 62);

  doc.setFontSize(9);
  doc.setTextColor(TEXT_MUTED);
  doc.setFont("helvetica", "normal");
  const headerRight = [
    `Shift ID: ${shift.id}`,
    `Cashier: ${shift.cashierUsername}`,
    `Opened: ${fmtDateTime(shift.openedAt)}`,
    `Closed: ${fmtDateTime(shift.closedAt)}`,
  ];
  headerRight.forEach((line, i) => doc.text(line, pageWidth - margin, 32 + i * 13, { align: "right" }));

  y = 140;

  const sectionTitle = (title: string) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(GOLD);
    doc.text(title.toUpperCase(), margin, y);
    doc.setDrawColor(GOLD);
    doc.setLineWidth(0.5);
    doc.line(margin, y + 4, pageWidth - margin, y + 4);
    y += 20;
  };

  const kvRow = (label: string, value: string, opts?: { bold?: boolean; color?: string }) => {
    doc.setFont("helvetica", opts?.bold ? "bold" : "normal");
    doc.setFontSize(10);
    doc.setTextColor(TEXT_MUTED);
    doc.text(label, margin, y);
    doc.setTextColor(opts?.color || TEXT_LIGHT);
    doc.text(value, pageWidth - margin, y, { align: "right" });
    y += 16;
  };

  // ---- Financial Summary ----
  sectionTitle("Financial Summary");
  kvRow("Opening Balance", fmt(shift.openingBalance));
  kvRow("Gross Sales", fmt(grossSales));
  kvRow("Total Discounts", "-" + fmt(totalDiscounts));
  kvRow("Total Expenses (Drawer)", "-" + fmt(totalExpenses));
  kvRow("Expected Cash", expectedCash !== null ? fmt(expectedCash) : "—", { bold: true });
  kvRow("Actual Cash Entered", shift.closingActualCash !== null ? fmt(shift.closingActualCash) : "—");
  kvRow(
    "Discrepancy / Variance",
    discrepancy !== null ? `${discrepancy > 0 ? "+" : ""}${fmt(discrepancy)}  [${isReconciled ? "RECONCILED" : "UNAPPROVED"}]` : "—",
    { bold: true, color: discrepancy === null ? TEXT_LIGHT : isReconciled ? GREEN : RED },
  );
  y += 8;

  // ---- Payment Breakdown ----
  sectionTitle("Payment Breakdown");
  kvRow("Cash", fmt(cashCollected));
  kvRow("Visa / Card", fmt(visaCollected));
  kvRow("InstaPay", fmt(instapayCollected));
  y += 8;

  // ---- Fixed Monthly Costs (owner revenue expenses) ----
  sectionTitle("Fixed Monthly Costs Logged This Shift");
  if (fixedMonthlyCosts.length === 0) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.setTextColor(TEXT_MUTED);
    doc.text("None logged during this shift.", margin, y);
    y += 16;
  } else {
    fixedMonthlyCosts.forEach((l) => kvRow(l.description, fmt(Number(l.amount))));
  }
  y += 8;

  // ---- Sales Summary (top items) ----
  sectionTitle("Sales Summary — Top Items");
  if (topItems.length === 0) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.setTextColor(TEXT_MUTED);
    doc.text("No item sales recorded during this shift.", margin, y);
    y += 16;
  } else {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(TEXT_MUTED);
    doc.text("Item", margin, y);
    doc.text("Qty", pageWidth - margin - 140, y, { align: "right" });
    doc.text("Revenue", pageWidth - margin, y, { align: "right" });
    y += 14;
    topItems.forEach((item) => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      doc.setTextColor(TEXT_LIGHT);
      doc.text(item.name, margin, y);
      doc.text(String(item.qty), pageWidth - margin - 140, y, { align: "right" });
      doc.text(fmt(item.revenue), pageWidth - margin, y, { align: "right" });
      y += 15;
    });
  }
  y += 8;

  // ---- Room / Table Activity ----
  if (y > 620) { doc.addPage(); doc.setFillColor(INK); doc.rect(0, 0, pageWidth, doc.internal.pageSize.getHeight(), "F"); y = 60; }
  sectionTitle("Room / Table Activity");
  kvRow("Total Checks Closed", String(sessions.length));
  kvRow("Total Hours Played", fmtHours(totalPlayedSeconds), { bold: true });
  y += 4;
  if (roomRows.length > 0) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(TEXT_MUTED);
    doc.text("Room / Table", margin, y);
    doc.text("Checks", pageWidth - margin - 140, y, { align: "right" });
    doc.text("Time", pageWidth - margin, y, { align: "right" });
    y += 14;
    roomRows.forEach((r) => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      doc.setTextColor(TEXT_LIGHT);
      doc.text(r.name, margin, y);
      doc.text(String(r.sessions), pageWidth - margin - 140, y, { align: "right" });
      doc.text(fmtHours(r.seconds), pageWidth - margin, y, { align: "right" });
      y += 15;
    });
  }

  // Footer
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(TEXT_MUTED);
    doc.text(`Generated ${new Date().toLocaleString()}`, margin, doc.internal.pageSize.getHeight() - 20);
    doc.text(`Page ${p} of ${pageCount}`, pageWidth - margin, doc.internal.pageSize.getHeight() - 20, { align: "right" });
  }

  const dateLabel = new Date(shift.closedAt || Date.now()).toISOString().slice(0, 10);
  const filename = `Shift_Report_${shift.id}_${dateLabel}.pdf`;
  return { blob: doc.output("blob"), filename };
}

// Triggers a standard browser download of the given blob — used right
// after a shift closes, and available again from Shift History for a
// re-download of a report generated in a past session (regenerated
// on demand from the same stored session/ledger data, rather than
// needing the original file to still exist anywhere).
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
