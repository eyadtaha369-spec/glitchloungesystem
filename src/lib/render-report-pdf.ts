import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";

// Renders an off-screen HTML element to a downloadable, paginated PDF —
// used by both the Inventory Audit Report and the Monthly Financial &
// Sales Audit Report.
//
// This calls html2canvas directly rather than going through html2pdf.js.
// html2pdf.js doesn't render the element you give it: internally it
// clones your element into its OWN wrapper div (.html2pdf__container,
// styled with a page-derived width and margin:auto) and calls
// html2canvas on THAT wrapper instead. In testing, that extra layer of
// indirection made html2canvas's own clone/measure step collapse the
// wrapper to zero height — producing a PDF with real page count but a
// completely blank image on every page, with no error thrown. Calling
// html2canvas directly on our own element (which we size and control)
// measures correctly every time, and the manual page-slicing below is
// the same logic html2pdf.js uses internally anyway, so nothing is lost
// by not depending on it.
//
// `onclone` strips every external stylesheet from the hidden clone
// html2canvas rasterizes from (never the live page) — html2canvas can't
// parse modern CSS color functions like oklch(), which this app's own
// global stylesheet uses everywhere for its theme, and throws instead of
// skipping them. Nothing in a generated report actually needs that
// stylesheet since every element is styled with plain inline hex colors,
// so stripping it removes the only source of oklch() html2canvas would
// ever encounter. A font <link> matching `keepStyleId` (used to load an
// Arabic-capable web font) is preserved.
export async function renderElementToPdf(
  container: HTMLElement,
  filename: string,
  opts?: { keepStyleId?: string; orientation?: "portrait" | "landscape" },
): Promise<void> {
  const keepStyleId = opts?.keepStyleId;
  const orientation = opts?.orientation ?? "landscape";

  const canvas = await html2canvas(container, {
    scale: 2,
    useCORS: true,
    backgroundColor: "#ffffff",
    onclone: (clonedDoc: Document) => {
      clonedDoc.querySelectorAll("link[rel='stylesheet'], style").forEach((el) => {
        if (keepStyleId && el.id === keepStyleId) return;
        el.remove();
      });
      if (clonedDoc.body) clonedDoc.body.style.backgroundColor = "#ffffff";
    },
  });

  const doc = new jsPDF({ unit: "pt", format: "a4", orientation });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 20;
  const usableWidth = pageWidth - margin * 2;
  const usableHeight = pageHeight - margin * 2;

  // Pixels-per-point scale factor of the captured canvas relative to the
  // PDF's usable page width — used to slice the full-height canvas into
  // page-sized chunks, each the right pixel height for one PDF page.
  const pxPerPt = canvas.width / usableWidth;
  const pxPageHeight = Math.max(1, Math.floor(usableHeight * pxPerPt));
  const totalPages = Math.max(1, Math.ceil(canvas.height / pxPageHeight));

  const pageCanvas = document.createElement("canvas");
  const pageCtx = pageCanvas.getContext("2d");
  if (!pageCtx) throw new Error("Could not create a canvas context to build the PDF.");
  pageCanvas.width = canvas.width;

  for (let page = 0; page < totalPages; page++) {
    const sliceHeight = page === totalPages - 1 ? canvas.height - pxPageHeight * page : pxPageHeight;
    pageCanvas.height = sliceHeight;
    pageCtx.fillStyle = "#ffffff";
    pageCtx.fillRect(0, 0, pageCanvas.width, sliceHeight);
    pageCtx.drawImage(canvas, 0, page * pxPageHeight, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);
    const imgData = pageCanvas.toDataURL("image/jpeg", 0.98);
    const renderedHeight = sliceHeight / pxPerPt;
    if (page > 0) doc.addPage();
    doc.addImage(imgData, "JPEG", margin, margin, usableWidth, renderedHeight);
  }

  doc.save(filename);
}
