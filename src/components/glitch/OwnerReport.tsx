import { useCallback, useEffect, useRef, useState } from "react";
import { fmtMoney } from "@/lib/glitch-store";
import { unlockOwnerReportFn, getOwnerReportFn, renewOwnerTokenFn, type OwnerReportData, type OwnerRow } from "@/backend/ownerReport";
import { Lock, Unlock, Download, ShieldCheck } from "lucide-react";

const IDLE_MS = 2 * 60 * 1000;

// Owner Report: real (100%) sales figures. The page holds NO sales data
// until the owner password is verified on the server, and it drops
// everything again after 2 minutes without activity or when you leave it.
export function OwnerReportPage() {
  const [token, setToken] = useState<string | null>(null);
  const [data, setData] = useState<OwnerReportData | null>(null);
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(IDLE_MS / 1000);
  const lastActivity = useRef(Date.now());
  const lastRenew = useRef(0);
  const tokenRef = useRef<string | null>(null);
  tokenRef.current = token;

  const lock = useCallback((message?: string) => {
    setToken(null); setData(null); setPassword(""); setFrom(""); setTo("");
    if (message) setErr(message);
  }, []);

  const load = useCallback(async (tk: string, f: string, t: string) => {
    setBusy(true); setErr(null);
    try {
      const res = await getOwnerReportFn({ data: { token: tk, from: f || undefined, to: t || undefined } });
      setData(res); setToken(res.token); lastActivity.current = Date.now();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("OWNER_LOCKED")) lock("Locked — enter the owner password again.");
      else setErr(msg || "Could not load the report.");
    } finally { setBusy(false); }
  }, [lock]);

  const unlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const res = await unlockOwnerReportFn({ data: { password } });
      setPassword("");
      if (!res.ok) { setErr(res.error); return; }
      setToken(res.token);
      lastActivity.current = Date.now();
      await load(res.token, "", "");
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Could not unlock.");
    } finally { setBusy(false); }
  };

  // Auto-lock: 2 minutes of no mouse/keyboard/touch activity; real activity
  // also renews the server-side token (throttled) so it never expires
  // under someone who is actively reading.
  useEffect(() => {
    if (!token) return;
    const onActivity = () => {
      lastActivity.current = Date.now();
      if (Date.now() - lastRenew.current > 30_000 && tokenRef.current) {
        lastRenew.current = Date.now();
        renewOwnerTokenFn({ data: { token: tokenRef.current } })
          .then((r) => setToken(r.token))
          .catch(() => lock("Locked — enter the owner password again."));
      }
    };
    const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll"];
    events.forEach((ev) => window.addEventListener(ev, onActivity, { passive: true }));
    const tick = setInterval(() => {
      const left = IDLE_MS - (Date.now() - lastActivity.current);
      setSecondsLeft(Math.max(0, Math.ceil(left / 1000)));
      if (left <= 0) lock("Locked after 2 minutes of inactivity.");
    }, 1000);
    const onHide = () => lock();
    window.addEventListener("pagehide", onHide);
    return () => {
      events.forEach((ev) => window.removeEventListener(ev, onActivity));
      clearInterval(tick);
      window.removeEventListener("pagehide", onHide);
    };
  }, [token !== null, lock]); // eslint-disable-line react-hooks/exhaustive-deps

  // Leaving the page (unmount) drops the data from memory.
  useEffect(() => () => { setToken(null); setData(null); }, []);

  const exportCsv = () => {
    if (!data) return;
    const head = ["Period", "Checks", "Net Sales", "VAT 14%", "Grand Total", "Cash", "Visa", "InstaPay", "Discounts", "Expenses", "Net Profit"];
    const toLine = (r: OwnerRow) => [r.period, r.checks, r.netSales, r.vat, r.grandTotal, r.cash, r.visa, r.instapay, r.discounts, r.expenses, r.profit];
    const section = (title: string, rows: OwnerRow[]) => [[title], head, ...rows.map(toLine), []];
    const lines: (string | number)[][] = [
      ["Owner Report — real sales figures", data.from || "all dates", data.to || ""],
      [],
      ...section("TOTAL", [data.totals]),
      ...section("BY MONTH", data.months),
      ...section("BY DAY", data.days),
      ["ITEMS SOLD"], ["Item", "Qty", "Amount"], ...data.items.map((i) => [i.name, i.qty, i.amount]),
    ];
    const csv = "﻿" + lines.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `owner-report-${data.from || "all"}-${data.to || "now"}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (!token || !data) {
    return (
      <div className="max-w-md mx-auto mt-10 glass rounded-2xl p-8 text-center">
        <Lock className="w-10 h-10 mx-auto text-muted-foreground" />
        <h1 className="mt-4 text-2xl font-bold">Owner Report</h1>
        <p className="text-sm text-muted-foreground mt-2">Enter the owner password to view real sales figures.</p>
        <form onSubmit={unlock} className="mt-6 space-y-3">
          <input
            type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus autoComplete="off"
            placeholder="Owner password"
            className="w-full bg-white/80 border-2 border-black/12 rounded-xl px-4 py-3 text-center font-mono outline-none focus:border-[oklch(0.7_0.19_260)]"
          />
          {err && <div className="text-sm p-3 rounded-xl bg-[oklch(0.62_0.24_25/0.15)] border border-[oklch(0.62_0.24_25/0.5)] text-[oklch(0.62_0.24_25)] font-semibold">{err}</div>}
          <button disabled={busy || !password} className="w-full py-3 rounded-xl bg-black text-white font-bold uppercase tracking-wide disabled:opacity-50">
            {busy ? "Checking…" : "Unlock"}
          </button>
        </form>
      </div>
    );
  }

  const Card = ({ label, value }: { label: string; value: string }) => (
    <div className="glass rounded-2xl p-4">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-bold font-mono break-words">{value}</div>
    </div>
  );
  const T = data.totals;
  const cols = ["Period", "Checks", "Net Sales", "VAT", "Grand Total", "Cash", "Visa", "InstaPay", "Discounts", "Expenses", "Net Profit"];
  const table = (title: string, rows: OwnerRow[]) => (
    <div className="glass rounded-2xl p-4 sm:p-6 overflow-x-auto">
      <h2 className="text-lg font-semibold mb-3">{title}</h2>
      <table className="w-full text-sm font-mono min-w-[760px]">
        <thead><tr className="text-[10px] uppercase tracking-widest text-muted-foreground text-right">
          {cols.map((c, i) => <th key={c} className={`pb-2 pr-3 ${i === 0 ? "text-left" : ""}`}>{c}</th>)}
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.period} className="border-t border-black/8 text-right">
              <td className="py-2 pr-3 text-left">{r.period}</td><td className="pr-3">{r.checks}</td>
              <td className="pr-3">{fmtMoney(r.netSales)}</td><td className="pr-3">{fmtMoney(r.vat)}</td><td className="pr-3 font-bold">{fmtMoney(r.grandTotal)}</td>
              <td className="pr-3">{fmtMoney(r.cash)}</td><td className="pr-3">{fmtMoney(r.visa)}</td><td className="pr-3">{fmtMoney(r.instapay)}</td>
              <td className="pr-3">{fmtMoney(r.discounts)}</td><td className="pr-3">{fmtMoney(r.expenses)}</td><td className="pr-3 font-bold">{fmtMoney(r.profit)}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={cols.length} className="py-6 text-center text-muted-foreground">No sales in this range.</td></tr>}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2"><ShieldCheck className="w-6 h-6" /> Owner Report</h1>
          <p className="text-xs text-muted-foreground mt-1 font-mono uppercase tracking-widest">Real figures · read-only · locks in {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={exportCsv} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-black/5 border border-black/10 hover:bg-black/10 text-sm font-bold"><Download className="w-4 h-4" /> Excel (CSV)</button>
          <button onClick={() => lock()} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-black text-white text-sm font-bold"><Unlock className="w-4 h-4" /> Lock now</button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs uppercase tracking-widest text-muted-foreground">From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 block bg-white/70 border border-black/10 rounded-xl px-3 py-2 text-sm font-mono" /></label>
        <label className="text-xs uppercase tracking-widest text-muted-foreground">To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 block bg-white/70 border border-black/10 rounded-xl px-3 py-2 text-sm font-mono" /></label>
        <button disabled={busy} onClick={() => token && void load(token, from, to)} className="px-4 py-2 rounded-xl bg-black text-white text-sm font-bold disabled:opacity-50">{busy ? "Loading…" : "Apply"}</button>
        <button disabled={busy} onClick={() => { setFrom(""); setTo(""); if (token) void load(token, "", ""); }} className="px-4 py-2 rounded-xl bg-black/5 border border-black/10 text-sm font-bold">All dates</button>
      </div>
      {err && <div className="text-sm p-3 rounded-xl bg-[oklch(0.62_0.24_25/0.15)] border border-[oklch(0.62_0.24_25/0.5)] text-[oklch(0.62_0.24_25)] font-semibold">{err}</div>}

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <Card label="Net Sales (Subtotal)" value={fmtMoney(T.netSales)} />
        <Card label="VAT 14%" value={fmtMoney(T.vat)} />
        <Card label="Grand Total" value={fmtMoney(T.grandTotal)} />
        <Card label="Net Profit" value={fmtMoney(T.profit)} />
        <Card label="Total Checks" value={String(T.checks)} />
        <Card label="Cash" value={fmtMoney(T.cash)} />
        <Card label="Visa" value={fmtMoney(T.visa)} />
        <Card label="InstaPay" value={fmtMoney(T.instapay)} />
        <Card label="Discounts" value={fmtMoney(T.discounts)} />
        <Card label="Expenses" value={fmtMoney(T.expenses)} />
      </div>

      {table("By month", data.months)}
      {table("By day", data.days)}

      <div className="glass rounded-2xl p-4 sm:p-6 overflow-x-auto">
        <h2 className="text-lg font-semibold mb-3">Items sold</h2>
        <table className="w-full text-sm font-mono min-w-[360px]">
          <thead><tr className="text-[10px] uppercase tracking-widest text-muted-foreground text-right"><th className="text-left pb-2">Item</th><th className="pb-2 pr-3">Qty</th><th className="pb-2">Amount</th></tr></thead>
          <tbody>{data.items.map((i) => (
            <tr key={i.name} className="border-t border-black/8 text-right"><td className="py-2 text-left">{i.name}</td><td className="pr-3">{i.qty}</td><td>{fmtMoney(i.amount)}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}
