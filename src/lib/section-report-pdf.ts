import { renderElementToPdf } from "./render-report-pdf";

// A single generic PDF generator shared by every independently-dated
// section on the Reports page (Fixed Monthly Costs, Total Revenue by
// Date, Order History, Expenses History, Material Consumption, Wasted &
// Complimentary Ledger, Wasted/Marketing Audit Summary, Expenses
// Ledger). Each section already knows how to filter and shape its own
// rows for its own date range — this just turns {columns, rows,
// summaryLines} into the same GLITCH-branded, Arabic-capable PDF layout
// the Inventory/Monthly Audit reports already use, via the same
// html2canvas + jsPDF pipeline (see render-report-pdf.ts for why that's
// called directly instead of through html2pdf.js).

const FONT_LINK_ID = "section-report-pdf-font";

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
    // Best-effort — falls back to the default font stack if this fails.
  }
}

function escapeHtml(s: string | number): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Turns a section's display title into a filesystem-safe filename
// segment — e.g. "Wasted & Complimentary Ledger" -> "Wasted_Complimentary_Ledger".
// Keeps Latin letters/numbers only (the visible report content keeps
// full Arabic text; only the downloaded filename itself is ASCII-safe,
// since that's the part the OS file system has to handle).
export function slugifyForFilename(s: string): string {
  return s
    .replace(/[^\p{Script=Latin}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_") || "Report";
}

export interface SectionReportColumn {
  header: string;
  align?: "left" | "right" | "center";
}

export interface GenerateSectionReportPdfArgs {
  // Display title shown in the PDF header, e.g. "Order History".
  sectionTitle: string;
  // Optional Arabic subtitle shown under the English title.
  sectionTitleAr?: string;
  // Human-readable range shown under the title, e.g. "Oct 1 – Oct 7, 2026".
  rangeLabel: string;
  columns: (string | SectionReportColumn)[];
  rows: (string | number)[][];
  // Short "Total: X" / "N orders" style lines rendered as summary cards
  // above the table.
  summaryLines?: { label: string; value: string }[];
  // Pre-slugified section name for the filename, e.g. "Order_History".
  // Falls back to slugifying sectionTitle if omitted.
  filenameBase?: string;
  // YYYY-MM-DD, used in the filename and should match rangeLabel.
  startDate: string;
  endDate: string;
  orientation?: "portrait" | "landscape";
  emptyMessage?: string;
}

export async function generateSectionReportPdf({
  sectionTitle,
  sectionTitleAr,
  rangeLabel,
  columns,
  rows,
  summaryLines,
  filenameBase,
  startDate,
  endDate,
  orientation = "landscape",
  emptyMessage,
}: GenerateSectionReportPdfArgs): Promise<void> {
  await ensureArabicFontLoaded();

  const normalizedColumns: SectionReportColumn[] = columns.map((c) => (typeof c === "string" ? { header: c } : c));
  const generatedAt = new Date().toLocaleString();

  const container = document.createElement("div");
  container.style.position = "absolute";
  container.style.left = "-10000px";
  container.style.top = "0";
  container.style.width = "1100px";
  container.style.background = "#ffffff";
  container.style.fontFamily = "'Cairo', ui-sans-serif, system-ui, sans-serif";
  container.style.color = "#111111";
  container.style.padding = "28px";

  const summaryHtml = summaryLines && summaryLines.length
    ? `
      <div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap;">
        ${summaryLines.map((s) => `
          <div style="flex:1;min-width:160px;background:#f5f5f7;border-radius:10px;padding:12px 16px;">
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#666;">${escapeHtml(s.label)}</div>
            <div style="font-size:16px;font-weight:700;font-family:ui-monospace,monospace;margin-top:4px;">${escapeHtml(s.value)}</div>
          </div>
        `).join("")}
      </div>
    `
    : "";

  const theadHtml = `
    <tr style="background:#f0f0f3;text-transform:uppercase;letter-spacing:0.5px;font-size:8.5px;color:#444;">
      ${normalizedColumns.map((c) => `<th style="text-align:${c.align ?? "left"};padding:6px 5px;border-bottom:2px solid #ddd;">${escapeHtml(c.header)}</th>`).join("")}
    </tr>
  `;

  const tbodyHtml = rows.length
    ? rows.map((row) => `
      <tr style="border-bottom:1px solid #eee;">
        ${row.map((cell, i) => {
          const align = normalizedColumns[i]?.align ?? "left";
          const mono = align === "right" ? "font-family:ui-monospace,monospace;" : "";
          const weight = i === 0 ? "font-weight:600;" : "";
          return `<td style="padding:5px;text-align:${align};${mono}${weight}">${escapeHtml(cell)}</td>`;
        }).join("")}
      </tr>
    `).join("")
    : `<tr><td colspan="${normalizedColumns.length}" style="padding:16px;text-align:center;color:#999;">${escapeHtml(emptyMessage || "No data in this date range.")}</td></tr>`;

  container.innerHTML = `
    <div style="border-bottom:3px solid #7c3aed;padding-bottom:14px;margin-bottom:18px;display:flex;justify-content:space-between;align-items:flex-end;">
      <div>
        <div style="font-size:26px;font-weight:700;letter-spacing:3px;">GLITCH LOUNGE</div>
        <div style="font-size:12px;text-transform:uppercase;letter-spacing:2px;color:#666;margin-top:2px;">
          ${escapeHtml(sectionTitle)}${sectionTitleAr ? " — " + escapeHtml(sectionTitleAr) : ""}
        </div>
      </div>
      <div style="text-align:right;font-size:11px;color:#666;">
        <div>Date Range: ${escapeHtml(rangeLabel)}</div>
        <div>Generated: ${escapeHtml(generatedAt)}</div>
      </div>
    </div>

    ${summaryHtml}

    <table style="width:100%;border-collapse:collapse;font-size:10px;">
      <thead>${theadHtml}</thead>
      <tbody>${tbodyHtml}</tbody>
    </table>
  `;

  document.body.appendChild(container);

  const base = filenameBase || slugifyForFilename(sectionTitle);
  try {
    await renderElementToPdf(container, `${base}_${startDate}_to_${endDate}.pdf`, {
      keepStyleId: FONT_LINK_ID,
      orientation,
    });
  } finally {
    container.remove();
  }
}
