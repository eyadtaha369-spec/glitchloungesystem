// Global 14% VAT (exclusive): menu prices, room rates and time charges are
// unchanged. Subtotal = Drinks + Food + Time (after discounts); VAT = 14% of
// that; Grand Total = Subtotal + VAT. Mirrors server/lib/util.js vatBreakdown_.
import type { Session } from "./types";

export const VAT_RATE = 0.14;
const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export function vatBreakdown(net: number) {
  const subtotal = r2(net);
  const vatAmount = r2(subtotal * VAT_RATE);
  return { subtotal, vatAmount, total: r2(subtotal + vatAmount) };
}

// Old (pre-VAT) sessions have no subtotal/vatAmount -> VAT-free.
export function sessionVat(s: Pick<Session, "total" | "subtotal" | "vatAmount">) {
  const vatAmount = Number(s.vatAmount) || 0;
  const subtotal = s.subtotal == null ? (Number(s.total) || 0) - vatAmount : Number(s.subtotal);
  return { subtotal: r2(subtotal), vatAmount: r2(vatAmount), total: r2(Number(s.total) || 0) };
}
export const netSales = (s: Pick<Session, "total" | "subtotal" | "vatAmount">) => sessionVat(s).subtotal;

export const VAT_LABEL_EN = "VAT 14%";
export const VAT_LABEL_AR = "ضريبة القيمة المضافة 14%";
export const SUBTOTAL_LABEL_AR = "الإجمالي الفرعي";
export const GRAND_TOTAL_LABEL_AR = "الإجمالي النهائي";
