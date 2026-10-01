import html2pdf from "html2pdf.js";

// Same approach as inventory-audit-pdf.ts: html2pdf.js rasterizes real
// rendered HTML through the browser's own text engine, so Arabic column
// headers and (if a menu item is named in Arabic) item names render
// correctly without needing a manually embedded Arabic font for jsPDF.

export interface MonthlyAuditFinancials {
  monthStr: string; // "2026-08"
  monthLabel: string; // "August 2026"
  revenue: number;
  expenses: number;
  netProfit: number;
}

export interface MonthlyAuditItemRow {
  name: string;
  qty: number;
  revenue: number;
  unitCost: number;
  totalCost: number;
  profit: number;
  marginPct: number | null;
}

export interface GenerateMonthlyAuditReportArgs {
  financials: MonthlyAuditFinancials;
  items: MonthlyAuditItemRow[];
  totalRevenue: number;
  totalCost: number;
  totalProfit: number;
}

function fmtMoney(n: number): string {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + " EGP";
}

async function ensureArabicFontLoaded(): Promise<void> {
  const linkId = "monthly-audit-pdf-font";
  if (!document.getElementById(linkId)) {
    const link = document.createElement("link");
    link.id = linkId;
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap";
    document.head.appendChild(link);
  }
  try {
    await document.fonts.load("600 14px Cairo");
    await document.fonts.load("400 14px Cairo");
    await document.fonts.ready;
  } catch {
    // Best-effort — falls back to the default font stack if this fails.
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function generateMonthlyAuditReportPdf({ financials, items, totalRevenue, totalCost, totalProfit }: GenerateMonthlyAuditReportArgs): Promise<void> {
  await ensureArabicFontLoaded();

  const generatedAt = new Date().toLocaleString();
  const marginPct = totalRevenue > 0 ? Math.round((totalProfit / totalRevenue) * 1000) / 10 : null;

  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "-10000px";
  container.style.top = "0";
  container.style.width = "1100px";
  container.style.background = "#ffffff";
  container.style.fontFamily = "'Cairo', ui-sans-serif, system-ui, sans-serif";
  container.style.color = "#111111";
  container.style.padding = "28px";

  const profitColor = financials.netProfit >= 0 ? "#16a34a" : "#dc2626";

  container.innerHTML = `
    <div style="border-bottom:3px solid #7c3aed;padding-bottom:14px;margin-bottom:18px;display:flex;justify-content:space-between;align-items:flex-end;">
      <div>
        <div style="font-size:26px;font-weight:700;letter-spacing:3px;">GLITCH LOUNGE</div>
        <div style="font-size:12px;text-transform:uppercase;letter-spacing:2px;color:#666;margin-top:2px;">Monthly Financial &amp; Sales Audit Report — ${escapeHtml(financials.monthLabel)}</div>
      </div>
      <div style="text-align:right;font-size:11px;color:#666;">
        <div>Generated: ${escapeHtml(generatedAt)}</div>
      </div>
    </div>

    <div style="margin-bottom:22px;">
      <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Monthly Financial Summary — الملخص المالي الشهري</div>
      <div style="display:flex;gap:12px;">
        <div style="flex:1;background:#f5f5f7;border-radius:10px;padding:12px 16px;">
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#666;">Total Revenue · الإيرادات</div>
          <div style="font-size:18px;font-weight:700;font-family:ui-monospace,monospace;margin-top:4px;color:#16a34a;">${fmtMoney(financials.revenue)}</div>
        </div>
        <div style="flex:1;background:#f5f5f7;border-radius:10px;padding:12px 16px;">
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#666;">Expenses &amp; Purchases · المصاريف والمشتريات</div>
          <div style="font-size:18px;font-weight:700;font-family:ui-monospace,monospace;margin-top:4px;color:#dc2626;">${fmtMoney(financials.expenses)}</div>
        </div>
        <div style="flex:1;background:#f5f5f7;border-radius:10px;padding:12px 16px;border:1px solid ${profitColor};">
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#666;">Net Profit · صافي الربح</div>
          <div style="font-size:18px;font-weight:700;font-family:ui-monospace,monospace;margin-top:4px;color:${profitColor};">${fmtMoney(financials.netProfit)}</div>
        </div>
      </div>
    </div>

    <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Item-Level Sales &amp; Cost Breakdown — تقرير مبيعات وتكلفة الأصناف</div>
    <table style="width:100%;border-collapse:collapse;font-size:10px;">
      <thead>
        <tr style="background:#f0f0f3;text-transform:uppercase;letter-spacing:0.5px;font-size:8.5px;color:#444;">
          <th style="text-align:left;padding:6px 5px;border-bottom:2px solid #ddd;">Item</th>
          <th style="text-align:right;padding:6px 5px;border-bottom:2px solid #ddd;">Qty Sold</th>
          <th style="text-align:right;padding:6px 5px;border-bottom:2px solid #ddd;">Revenue</th>
          <th style="text-align:right;padding:6px 5px;border-bottom:2px solid #ddd;">Unit Cost</th>
          <th style="text-align:right;padding:6px 5px;border-bottom:2px solid #ddd;">Total Cost (COGS)</th>
          <th style="text-align:right;padding:6px 5px;border-bottom:2px solid #ddd;">Profit</th>
          <th style="text-align:right;padding:6px 5px;border-bottom:2px solid #ddd;">Margin</th>
        </tr>
      </thead>
      <tbody>
        ${items.map((r) => `
          <tr style="border-bottom:1px solid #eee;">
            <td style="padding:5px;font-weight:600;">${escapeHtml(r.name)}</td>
            <td style="padding:5px;text-align:right;font-family:ui-monospace,monospace;">${r.qty}</td>
            <td style="padding:5px;text-align:right;font-family:ui-monospace,monospace;color:#16a34a;">${fmtMoney(r.revenue)}</td>
            <td style="padding:5px;text-align:right;font-family:ui-monospace,monospace;color:#666;">${fmtMoney(r.unitCost)}</td>
            <td style="padding:5px;text-align:right;font-family:ui-monospace,monospace;color:#dc2626;">${fmtMoney(r.totalCost)}</td>
            <td style="padding:5px;text-align:right;font-family:ui-monospace,monospace;font-weight:700;color:${r.profit >= 0 ? "#16a34a" : "#dc2626"};">${fmtMoney(r.profit)}</td>
            <td style="padding:5px;text-align:right;font-family:ui-monospace,monospace;color:#666;">${r.marginPct === null ? "—" : `${r.marginPct}%`}</td>
          </tr>
        `).join("") || `<tr><td colspan="7" style="padding:10px;text-align:center;color:#999;">No sales recorded this month</td></tr>`}
      </tbody>
      <tfoot>
        <tr>
          <td style="padding:8px 5px;text-align:right;font-weight:700;border-top:2px solid #111;">Total</td>
          <td style="padding:8px 5px;text-align:right;font-weight:700;font-family:ui-monospace,monospace;border-top:2px solid #111;">${items.reduce((a, r) => a + r.qty, 0)}</td>
          <td style="padding:8px 5px;text-align:right;font-weight:700;font-family:ui-monospace,monospace;border-top:2px solid #111;color:#16a34a;">${fmtMoney(totalRevenue)}</td>
          <td style="padding:8px 5px;border-top:2px solid #111;"></td>
          <td style="padding:8px 5px;text-align:right;font-weight:700;font-family:ui-monospace,monospace;border-top:2px solid #111;color:#dc2626;">${fmtMoney(totalCost)}</td>
          <td style="padding:8px 5px;text-align:right;font-weight:700;font-family:ui-monospace,monospace;border-top:2px solid #111;color:${totalProfit >= 0 ? "#16a34a" : "#dc2626"};">${fmtMoney(totalProfit)}</td>
          <td style="padding:8px 5px;text-align:right;font-weight:700;font-family:ui-monospace,monospace;border-top:2px solid #111;">${marginPct === null ? "—" : `${marginPct}%`}</td>
        </tr>
      </tfoot>
    </table>
  `;

  document.body.appendChild(container);

  try {
    await html2pdf()
      .set({
        margin: 20,
        filename: `Monthly_Audit_Report_${financials.monthStr}.pdf`,
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff" },
        jsPDF: { unit: "pt", format: "a4", orientation: "landscape" },
      })
      .from(container)
      .save();
  } finally {
    container.remove();
  }
}
