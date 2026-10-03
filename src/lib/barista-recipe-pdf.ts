import type { MenuItem, StockItem } from "./types";
import { renderElementsToPdf } from "./render-report-pdf";

// Same reasoning as inventory-audit-pdf.ts / section-report-pdf.ts: real
// rendered HTML rasterized through the browser's own text engine, via
// html2canvas directly (not html2pdf.js — see render-report-pdf.ts for
// why that specific library silently produces blank pages) so Arabic
// names and prep notes render exactly as the browser shapes them.

const FONT_LINK_ID = "barista-recipe-pdf-font";

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

// This café's local date, Africa/Cairo, for the filename — same
// reasoning as every other report in this app (Reports.tsx's
// cairoDateLabel): the generating browser's own timezone shouldn't
// decide what day a document was produced on.
const CAIRO_TZ_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit",
});
function cairoDateLabel(ts: number): string {
  return CAIRO_TZ_FORMATTER.format(new Date(ts));
}

// Keeps every single html2canvas capture far under the browser's canvas
// size limit regardless of how large the menu grows — same defensive
// reasoning as ROWS_PER_CHUNK in section-report-pdf.ts (a menu with
// enough items in one category to overflow a single capture would
// otherwise silently produce blank pages with no error). 8 cards (2
// columns × 4 rows) comfortably fits one A4 portrait page per chunk.
const CARDS_PER_CHUNK = 8;

function materialLabel(stockId: string, stockById: Map<string, StockItem>): { name: string; unit: string } {
  const m = stockById.get(stockId);
  return m ? { name: m.name, unit: m.unit } : { name: stockId, unit: "" };
}

function cardHtml(item: MenuItem, stockById: Map<string, StockItem>): string {
  const ingredientsRows = (item.ingredients || []).map((ing) => {
    const { name, unit } = materialLabel(ing.stockId, stockById);
    return `
      <tr>
        <td style="padding:3px 4px;border-bottom:1px solid #eee;">${escapeHtml(name)}</td>
        <td style="padding:3px 4px;border-bottom:1px solid #eee;text-align:right;font-family:ui-monospace,monospace;font-weight:600;">${escapeHtml(ing.qty)} ${escapeHtml(unit)}</td>
      </tr>`;
  }).join("");

  return `
    <div style="border:1px solid #ddd;border-radius:10px;padding:14px;break-inside:avoid;display:flex;flex-direction:column;gap:8px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;border-bottom:2px solid #7c3aed;padding-bottom:8px;">
        <div style="font-size:14px;font-weight:700;">${escapeHtml(item.name)}</div>
        ${item.nameAr ? `<div dir="rtl" style="font-size:14px;font-weight:700;font-family:'Cairo',sans-serif;">${escapeHtml(item.nameAr)}</div>` : ""}
      </div>
      ${item.servingVessel ? `<div style="font-size:10px;color:#666;text-transform:uppercase;letter-spacing:0.5px;">Serving: <span style="color:#111;font-weight:600;">${escapeHtml(item.servingVessel)}</span></div>` : ""}
      ${ingredientsRows ? `
        <table style="width:100%;border-collapse:collapse;font-size:10.5px;">
          <thead>
            <tr style="color:#666;text-transform:uppercase;letter-spacing:0.5px;font-size:8.5px;">
              <th style="text-align:left;padding:3px 4px;border-bottom:1px solid #ccc;">Ingredient</th>
              <th style="text-align:right;padding:3px 4px;border-bottom:1px solid #ccc;">Qty</th>
            </tr>
          </thead>
          <tbody>${ingredientsRows}</tbody>
        </table>
      ` : `<div style="font-size:10px;color:#999;font-style:italic;">No recipe on file.</div>`}
      ${item.prepNotes ? `
        <div style="margin-top:2px;font-size:10px;color:#333;background:#f8f7fb;border-radius:6px;padding:7px 9px;">
          <span style="font-weight:700;text-transform:uppercase;letter-spacing:0.5px;font-size:8.5px;color:#666;">Prep Notes</span><br/>
          ${escapeHtml(item.prepNotes)}
        </div>
      ` : ""}
    </div>`;
}

function headerHtml(generatedAt: string, isFirstChunkOverall: boolean, categoryLabel: string | undefined, isFirstChunkOfCategory: boolean): string {
  const categoryHeading = categoryLabel
    ? `<div style="font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;color:#7c3aed;">${escapeHtml(categoryLabel)}${isFirstChunkOfCategory ? "" : " (continued)"}</div>`
    : "";
  if (isFirstChunkOverall) {
    return `
      <div style="border-bottom:3px solid #7c3aed;padding-bottom:14px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:flex-end;">
        <div>
          <div style="font-size:26px;font-weight:700;letter-spacing:3px;">GLITCH LOUNGE</div>
          <div style="font-size:12px;text-transform:uppercase;letter-spacing:2px;color:#666;margin-top:2px;">Barista Standard Operating Procedures · دليل الوصفات</div>
        </div>
        <div style="text-align:right;font-size:11px;color:#666;">
          <div>Generated: ${escapeHtml(generatedAt)}</div>
        </div>
      </div>
      ${categoryHeading}
    `;
  }
  return categoryHeading;
}

export interface GenerateBaristaRecipePdfArgs {
  menu: MenuItem[];
  stock: StockItem[];
  // Category display order — items not in any listed category are
  // grouped under "Other" at the end, rather than silently dropped.
  categoryOrder: readonly string[];
}

export async function generateBaristaRecipePdf({ menu, stock, categoryOrder }: GenerateBaristaRecipePdfArgs): Promise<void> {
  await ensureArabicFontLoaded();

  const stockById = new Map(stock.map((s) => [s.id, s]));
  const now = new Date();
  const dateLabel = cairoDateLabel(now.getTime());
  const generatedAt = now.toLocaleString();

  const byCategory = new Map<string, MenuItem[]>();
  menu.forEach((item) => {
    const cat = item.category && categoryOrder.includes(item.category) ? item.category : "Other";
    const list = byCategory.get(cat) ?? [];
    list.push(item);
    byCategory.set(cat, list);
  });
  const orderedCategories = [...categoryOrder.filter((c) => byCategory.has(c)), ...(byCategory.has("Other") ? ["Other"] : [])];

  const containers: HTMLElement[] = [];
  let isFirstChunkOverall = true;

  orderedCategories.forEach((cat) => {
    const items = (byCategory.get(cat) || []).slice().sort((a, b) => a.name.localeCompare(b.name));
    const chunks: MenuItem[][] = [];
    for (let i = 0; i < items.length; i += CARDS_PER_CHUNK) chunks.push(items.slice(i, i + CARDS_PER_CHUNK));
    if (chunks.length === 0) return;

    chunks.forEach((chunkItems, chunkIdx) => {
      const container = document.createElement("div");
      container.style.position = "absolute";
      container.style.left = "-10000px";
      container.style.top = "0";
      container.style.width = "780px";
      container.style.background = "#ffffff";
      container.style.fontFamily = "'Cairo', ui-sans-serif, system-ui, sans-serif";
      container.style.color = "#111111";
      container.style.padding = "28px";

      container.innerHTML = `
        ${headerHtml(generatedAt, isFirstChunkOverall, cat, chunkIdx === 0)}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          ${chunkItems.map((item) => cardHtml(item, stockById)).join("")}
        </div>
      `;
      document.body.appendChild(container);
      containers.push(container);
      isFirstChunkOverall = false;
    });
  });

  if (containers.length === 0) {
    const empty = document.createElement("div");
    empty.style.position = "absolute";
    empty.style.left = "-10000px";
    empty.style.width = "780px";
    empty.style.background = "#ffffff";
    empty.style.fontFamily = "'Cairo', ui-sans-serif, system-ui, sans-serif";
    empty.style.padding = "28px";
    empty.innerHTML = `${headerHtml(generatedAt, true, undefined, true)}<div style="font-size:12px;color:#999;">No menu items to export.</div>`;
    document.body.appendChild(empty);
    containers.push(empty);
  }

  try {
    await renderElementsToPdf(containers, `GLITCH_Barista_Recipes_${dateLabel}.pdf`, {
      keepStyleId: FONT_LINK_ID,
      orientation: "portrait",
    });
  } finally {
    containers.forEach((c) => c.remove());
  }
}
