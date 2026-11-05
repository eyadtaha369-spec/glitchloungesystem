import { createServerFn } from "@tanstack/react-start";
import { callAppsScript } from "./appsScript";
import { requireAdmin } from "./session";
import { verifyOwnerPassword, checkAndRecordAttempt, assertNotLockedOut, issueOwnerToken, assertOwnerToken } from "./ownerAuth";
import { businessDayLabelForTs } from "@/lib/business-day";
import { isOperationalExpense } from "@/lib/expense-rules";
import type { AppState, LedgerEntry } from "@/lib/types";

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export interface OwnerRow {
  period: string; checks: number; netSales: number; vat: number; grandTotal: number;
  cash: number; visa: number; instapay: number; discounts: number; expenses: number; profit: number;
}
export interface OwnerReportData {
  token: string; expiresAt: number;
  from: string | null; to: string | null;
  totals: OwnerRow;
  days: OwnerRow[]; months: OwnerRow[];
  items: { name: string; qty: number; amount: number }[];
}

// Step 1: check the owner password on the server. Returns a token that
// is only good for 2 minutes of inactivity and nothing else.
export const unlockOwnerReportFn = createServerFn({ method: "POST" })
  .validator((d: { password: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    assertNotLockedOut(user.username);
    const ok = verifyOwnerPassword(data.password);
    checkAndRecordAttempt(user.username, ok);
    if (!ok) return { ok: false as const, error: "Wrong owner password." };
    const t = issueOwnerToken(user.username);
    return { ok: true as const, token: t.token, expiresAt: t.expiresAt };
  });

// Keeps an already-unlocked report alive while the owner is actively
// using the page (the page calls this on real activity, throttled).
export const renewOwnerTokenFn = createServerFn({ method: "POST" })
  .validator((d: { token: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    assertOwnerToken(data.token, user.username);
    return issueOwnerToken(user.username);
  });

// Step 2: real figures. Refused without a valid, unexpired token; every
// successful call hands back a fresh token (so the 2 minutes counts from
// the last real activity).
export const getOwnerReportFn = createServerFn({ method: "POST" })
  .validator((d: { token: string; from?: string; to?: string }) => d)
  .handler(async ({ data }): Promise<OwnerReportData> => {
    const user = await requireAdmin();
    assertOwnerToken(data.token, user.username);

    const [stateRes, ledgerRes] = await Promise.all([
      callAppsScript<{ state: AppState }>("getState", { username: user.username }),
      callAppsScript<{ items: LedgerEntry[] }>("getLedger", { username: user.username }),
    ]);
    const state = stateRes.state;
    const shiftDay = new Map<string, string>();
    state.shifts.forEach((sh) => shiftDay.set(sh.id, businessDayLabelForTs(sh.openedAt)));
    const dayOf = (shiftId: string | null | undefined, ts: number) => (shiftId && shiftDay.get(shiftId)) || businessDayLabelForTs(ts);

    const from = data.from || null;
    const to = data.to || null;
    const inRange = (d: string) => (!from || d >= from) && (!to || d <= to);

    const blank = (period: string): OwnerRow => ({ period, checks: 0, netSales: 0, vat: 0, grandTotal: 0, cash: 0, visa: 0, instapay: 0, discounts: 0, expenses: 0, profit: 0 });
    const days = new Map<string, OwnerRow>();
    const items = new Map<string, { name: string; qty: number; amount: number }>();
    const get = (d: string) => { let r = days.get(d); if (!r) { r = blank(d); days.set(d, r); } return r; };

    for (const s of state.sessions) {
      const d = dayOf(s.shiftId, s.endedAt);
      if (!inRange(d)) continue;
      const vat = Number(s.vatAmount) || 0;
      const r = get(d);
      r.checks += 1;
      r.grandTotal += Number(s.total) || 0;
      r.vat += vat;
      r.netSales += s.subtotal == null ? (Number(s.total) || 0) - vat : Number(s.subtotal);
      r.cash += Number(s.cashAmount) || 0;
      r.visa += Number(s.visaAmount) || 0;
      r.instapay += Number(s.instapayAmount) || 0;
      r.discounts += Number(s.discountAmount) || 0;
      for (const o of s.orders ?? []) {
        const it = items.get(o.name) ?? { name: o.name, qty: 0, amount: 0 };
        it.qty += Number(o.qty) || 0;
        it.amount += (Number(o.qty) || 0) * (Number(o.price) || 0);
        items.set(o.name, it);
      }
    }
    for (const l of ledgerRes.items) {
      if (!isOperationalExpense(l)) continue;
      const d = l.expenseDate || dayOf(l.shiftId, l.ts);
      if (!inRange(d)) continue;
      get(d).expenses += Number(l.amount) || 0;
    }

    const fin = (r: OwnerRow): OwnerRow => ({
      ...r, netSales: r2(r.netSales), vat: r2(r.vat), grandTotal: r2(r.grandTotal), cash: r2(r.cash), visa: r2(r.visa),
      instapay: r2(r.instapay), discounts: r2(r.discounts), expenses: r2(r.expenses), profit: r2(r.netSales - r.expenses),
    });
    const dayRows = Array.from(days.values()).sort((a, b) => a.period.localeCompare(b.period)).map(fin);
    const months = new Map<string, OwnerRow>();
    const totals = blank("TOTAL");
    const add = (t: OwnerRow, r: OwnerRow) => {
      t.checks += r.checks; t.netSales += r.netSales; t.vat += r.vat; t.grandTotal += r.grandTotal; t.cash += r.cash;
      t.visa += r.visa; t.instapay += r.instapay; t.discounts += r.discounts; t.expenses += r.expenses;
    };
    for (const r of dayRows) {
      const k = r.period.slice(0, 7);
      const m = months.get(k) ?? blank(k);
      add(m, r); months.set(k, m);
      add(totals, r);
    }

    const t = issueOwnerToken(user.username);
    return {
      token: t.token, expiresAt: t.expiresAt, from, to,
      totals: fin(totals),
      days: dayRows,
      months: Array.from(months.values()).sort((a, b) => a.period.localeCompare(b.period)).map(fin),
      items: Array.from(items.values()).sort((a, b) => b.amount - a.amount).map((i) => ({ ...i, amount: r2(i.amount) })),
    };
  });
