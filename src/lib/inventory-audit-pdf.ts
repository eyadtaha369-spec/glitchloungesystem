import html2pdf from "html2pdf.js";
import type { StockItem } from "./types";

// Why html2pdf.js (DOM → canvas → PDF) instead of jsPDF/autotable here:
// jsPDF's built-in fonts have no Arabic glyphs at all, and getting Arabic
// to render correctly with jsPDF requires manually embedding a shaped
// Arabic font as base64 — brittle and heavy. html2pdf.js rasterizes real
// rendered HTML through the browser's own text engine, so Arabic item
// names (زبادي، عسل، إلخ) and mixed RTL/LTR lines render exactly as the
// browser shapes them, for free, using a web font we load up front.

export interface InventoryAuditCashRecon {
  expected: number;
  actual: number;
  discrepancy: number;
}

function fmtMoney(n: number): string {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + " EGP";
}

function statusFor(s: StockItem): { label: string; labelAr: string; color: string } {
  if (s.systemBalance <= 0) return { label: "Out", labelAr: "نَفَد", color: "#dc2626" };
  if (s.systemBalance < s.minStock) return { label: "Low", labelAr: "قليل", color: "#92700a" };
  return { label: "Available", labelAr: "متوفر", color: "#16a34a" };
}

const FONT_LINK_ID = "inventory-audit-pdf-font";

// Loads the Arabic-capable web font and waits until the browser has it
// ready, so the html2canvas snapshot taken right after doesn't fall back
// to tofu boxes for the first frame.
async function ensureArabicFontLoaded(): Promise<void> {
  if (!document.getElementById(FONT_LINK_ID)) {
    const link = document.createElement("link");
    link.id = FONT_LINK_ID;
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap";
    document.head.appendChild(link);
  }
  try {
    await document.fonts.load("600 14px Cairo");
    await document.fonts.load("400 14px Cairo");
    await document.fonts.ready;
  } catch {
    // Best-effort — if the font fails to load (offline, blocked), the
    // report still generates with the browser's default fallback fonts.
  }
}

// html2canvas (inside html2pdf.js) can't parse modern CSS color functions
// — oklch(), color-mix(), lab()/lch() — and this app's own global
// stylesheet uses oklch() everywhere for its theme. html2canvas throws
// outright ("unsupported color function oklch") rather than skipping
// those rules, even though none of that CSS is actually needed here:
// every element this report renders is styled with plain inline hex
// colors. Stripping every external stylesheet/<style> tag from the
// CLONE html2canvas renders from (never the live page) removes the only
// source of oklch() it would ever encounter, while the Google Fonts
// <link> (matched by id) is kept so Arabic text still renders with Cairo.
function stripUnsupportedStyles(clonedDoc: Document): void {
  clonedDoc.querySelectorAll("link[rel='stylesheet'], style").forEach((el) => {
    if (el.id === FONT_LINK_ID) return;
    el.remove();
  });
  if (clonedDoc.body) clonedDoc.body.style.backgroundColor = "#ffffff";
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface GenerateInventoryAuditReportArgs {
  stock: StockItem[];
  cashRecon: InventoryAuditCashRecon;
}

// Builds the report as an off-screen DOM node, rasterizes it to a PDF
// client-side, and triggers an immediate download — no server round
// trip, no print dialog.
export async function generateInventoryAuditReportPdf({ stock, cashRecon }: GenerateInventoryAuditReportArgs): Promise<void> {
  await ensureArabicFontLoaded();

  const now = new Date();
  const dateLabel = now.toISOString().slice(0, 10);
  const generatedAt = now.toLocaleString();

  const rows = stock.map((s) => {
    const hasActualCount = s.actualStock !== null;
    const varianceQty = hasActualCount ? Math.round((s.actualStock! - s.systemBalance) * 100) / 100 : null;
    const varianceValue = varianceQty !== null ? Math.round(varianceQty * s.lastPurchaseCost * 100) / 100 : null;
    const status = statusFor(s);
    const stockValue = s.systemBalance * s.lastPurchaseCost;
    return { s, hasActualCount, varianceQty, varianceValue, status, stockValue };
  });
  const totalStockValue = rows.reduce((a, r) => a + r.stockValue, 0);

  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "-10000px";
  container.style.top = "0";
  container.style.width = "1100px";
  container.style.background = "#ffffff";
  container.style.fontFamily = "'Cairo', ui-sans-serif, system-ui, sans-serif";
  container.style.color = "#111111";
  container.style.padding = "28px";

  const discColor = Math.abs(cashRecon.discrepancy) < 0.005 ? "#16a34a" : cashRecon.discrepancy < 0 ? "#dc2626" : "#16a34a";
  const discLabel = Math.abs(cashRecon.discrepancy) < 0.005 ? "Balanced" : cashRecon.discrepancy < 0 ? "Deficit · عجز" : "Surplus · زيادة";

  container.innerHTML = `
    <div style="border-bottom:3px solid #7c3aed;padding-bottom:14px;margin-bottom:18px;display:flex;justify-content:space-between;align-items:flex-end;">
      <div>
        <div style="font-size:26px;font-weight:700;letter-spacing:3px;">GLITCH LOUNGE</div>
        <div style="font-size:12px;text-transform:uppercase;letter-spacing:2px;color:#666;margin-top:2px;">Inventory Audit Report</div>
      </div>
      <div style="text-align:right;font-size:11px;color:#666;">
        <div>Generated: ${escapeHtml(generatedAt)}</div>
      </div>
    </div>

    <div style="margin-bottom:20px;">
      <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Cash Reconciliation</div>
      <div style="display:flex;gap:12px;">
        <div style="flex:1;background:#f5f5f7;border-radius:10px;padding:12px 16px;">
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#666;">Expected</div>
          <div style="font-size:18px;font-weight:700;font-family:ui-monospace,monospace;margin-top:4px;">${fmtMoney(cashRecon.expected)}</div>
        </div>
        <div style="flex:1;background:#f5f5f7;border-radius:10px;padding:12px 16px;">
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#666;">Actual</div>
          <div style="font-size:18px;font-weight:700;font-family:ui-monospace,monospace;margin-top:4px;">${fmtMoney(cashRecon.actual)}</div>
        </div>
        <div style="flex:1;background:#f5f5f7;border-radius:10px;padding:12px 16px;border:1px solid ${discColor};">
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#666;">Discrepancy</div>
          <div style="font-size:18px;font-weight:700;font-family:ui-monospace,monospace;margin-top:4px;color:${discColor};">${cashRecon.discrepancy > 0 ? "+" : ""}${fmtMoney(cashRecon.discrepancy)} <span style="font-size:10px;font-weight:600;">[${discLabel}]</span></div>
        </div>
      </div>
    </div>

    <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Stock Inventory</div>
    <table style="width:100%;border-collapse:collapse;font-size:10px;">
      <thead>
        <tr style="background:#f0f0f3;text-transform:uppercase;letter-spacing:0.5px;font-size:8.5px;color:#444;">
          <th style="text-align:left;padding:6px 5px;border-bottom:2px solid #ddd;">Item</th>
          <th style="text-align:left;padding:6px 5px;border-bottom:2px solid #ddd;">Unit</th>
          <th style="text-align:right;padding:6px 5px;border-bottom:2px solid #ddd;">Opening</th>
          <th style="text-align:right;padding:6px 5px;border-bottom:2px solid #ddd;">Purchases</th>
          <th style="text-align:right;padding:6px 5px;border-bottom:2px solid #ddd;">Consumption</th>
          <th style="text-align:right;padding:6px 5px;border-bottom:2px solid #ddd;">Remaining</th>
          <th style="text-align:right;padding:6px 5px;border-bottom:2px solid #ddd;">Actual</th>
          <th style="text-align:right;padding:6px 5px;border-bottom:2px solid #ddd;">Var. Qty</th>
          <th style="text-align:right;padding:6px 5px;border-bottom:2px solid #ddd;">Var. Value</th>
          <th style="text-align:center;padding:6px 5px;border-bottom:2px solid #ddd;">Status</th>
          <th style="text-align:right;padding:6px 5px;border-bottom:2px solid #ddd;">Stock Value</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(({ s, hasActualCount, varianceQty, varianceValue, status, stockValue }) => `
          <tr style="border-bottom:1px solid #eee;">
            <td style="padding:5px;font-weight:600;">${escapeHtml(s.name)}</td>
            <td style="padding:5px;">${escapeHtml(s.unit)}</td>
            <td style="padding:5px;text-align:right;font-family:ui-monospace,monospace;">${s.openingStock}</td>
            <td style="padding:5px;text-align:right;font-family:ui-monospace,monospace;color:#16a34a;">+${s.purchasesIn}</td>
            <td style="padding:5px;text-align:right;font-family:ui-monospace,monospace;color:#dc2626;">-${s.salesWasteOut}</td>
            <td style="padding:5px;text-align:right;font-family:ui-monospace,monospace;font-weight:700;">${s.systemBalance}</td>
            <td style="padding:5px;text-align:right;font-family:ui-monospace,monospace;">${hasActualCount ? s.actualStock : "—"}</td>
            <td style="padding:5px;text-align:right;font-family:ui-monospace,monospace;${varianceQty !== null && varianceQty < 0 ? "color:#dc2626;" : varianceQty !== null && varianceQty > 0 ? "color:#16a34a;" : "color:#999;"}">${varianceQty === null ? "—" : varianceQty > 0 ? `+${varianceQty}` : varianceQty}</td>
            <td style="padding:5px;text-align:right;font-family:ui-monospace,monospace;${varianceValue !== null && varianceValue < 0 ? "color:#dc2626;" : varianceValue !== null && varianceValue > 0 ? "color:#16a34a;" : "color:#999;"}">${varianceValue === null ? "—" : varianceValue > 0 ? `+${fmtMoney(varianceValue)}` : fmtMoney(varianceValue)}</td>
            <td style="padding:5px;text-align:center;">
              <span style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;padding:2px 6px;border-radius:9999px;border:1px solid ${status.color};color:${status.color};">${status.label} / ${status.labelAr}</span>
            </td>
            <td style="padding:5px;text-align:right;font-family:ui-monospace,monospace;">${fmtMoney(stockValue)}</td>
          </tr>
        `).join("")}
      </tbody>
      <tfoot>
        <tr>
          <td colspan="10" style="padding:8px 5px;text-align:right;font-weight:700;border-top:2px solid #111;">Total Stock Value</td>
          <td style="padding:8px 5px;text-align:right;font-weight:700;font-family:ui-monospace,monospace;border-top:2px solid #111;">${fmtMoney(totalStockValue)}</td>
        </tr>
      </tfoot>
    </table>
  `;

  document.body.appendChild(container);

  try {
    await html2pdf()
      .set({
        margin: 20,
        filename: `Inventory_Audit_Report_${dateLabel}.pdf`,
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff", onclone: stripUnsupportedStyles },
        jsPDF: { unit: "pt", format: "a4", orientation: "landscape" },
      })
      .from(container)
      .save();
  } finally {
    container.remove();
  }
}
