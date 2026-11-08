import { useStore, fmtMoney } from "@/lib/glitch-store";
import { generateShiftReportPdf, downloadBlob } from "@/lib/shift-report-pdf";
import { FileDown, LogOut, CheckCircle2 } from "lucide-react";
import logo from "@/assets/glitch-logo.jpg";

// Shown to a cashier right after they close their shift. Contains ONLY that
// shift's own Z-report (their orders, cash / card totals, drawer variance).
// Signing out is required so the incoming cashier logs in with their own
// account and enters their own opening cash (العهدة المبدئية).
export function ShiftHandover() {
  const { handover, logout } = useStore();
  if (!handover) return null;
  const { shift, sessions, ledger } = handover;
  const cash = sessions.reduce((a, s) => a + s.cashAmount, 0);
  const visa = sessions.reduce((a, s) => a + s.visaAmount, 0);
  const insta = sessions.reduce((a, s) => a + s.instapayAmount, 0);
  const total = sessions.reduce((a, s) => a + s.total, 0);
  const vat = sessions.reduce((a, s) => a + (Number(s.vatAmount) || 0), 0);
  const expected = shift.expectedCash ?? 0;
  const counted = shift.closingActualCash ?? 0;
  const variance = shift.discrepancy ?? 0;
  const ok = Math.abs(variance) < 0.005;

  const download = () => {
    const { blob, filename } = generateShiftReportPdf({ shift, sessions, ledger });
    downloadBlob(blob, filename);
  };

  const Row = ({ k, v, strong }: { k: string; v: string; strong?: boolean }) => (
    <div className={`flex justify-between gap-3 ${strong ? "font-bold" : ""}`}><span>{k}</span><span>{v}</span></div>
  );

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md glass-strong rounded-2xl border border-black/10 p-6 sm:p-8">
        <div className="flex flex-col items-center text-center mb-5">
          <img src={logo} alt="GLITCH" className="w-14 h-14 rounded-full mb-3" />
          <div className="flex items-center gap-2"><CheckCircle2 className="w-5 h-5" /><h1 className="text-xl font-bold">Shift closed / تم إغلاق الوردية</h1></div>
          <p className="text-xs text-muted-foreground font-mono mt-1">{shift.cashierUsername} · {new Date(shift.openedAt).toLocaleTimeString()} → {shift.closedAt ? new Date(shift.closedAt).toLocaleTimeString() : ""}</p>
        </div>

        <div className="p-4 rounded-xl bg-white/60 border border-black/10 text-sm font-mono space-y-1.5">
          <Row k="Orders / الطلبات" v={String(sessions.length)} />
          <Row k="Total sales (incl. VAT)" v={fmtMoney(total)} strong />
          <Row k="VAT 14%" v={fmtMoney(vat)} />
          <div className="border-t border-black/10 my-2" />
          <Row k="Cash / كاش" v={fmtMoney(cash)} />
          <Row k="Card / فيزا" v={fmtMoney(visa)} />
          <Row k="InstaPay" v={fmtMoney(insta)} />
          <div className="border-t border-black/10 my-2" />
          <Row k="Opening cash / العهدة" v={fmtMoney(shift.openingBalance)} />
          <Row k="Expected in drawer" v={fmtMoney(expected)} />
          <Row k="Counted" v={fmtMoney(counted)} />
          <Row k={ok ? "Drawer variance — balanced" : variance > 0 ? "Drawer variance — over" : "Drawer variance — short"} v={fmtMoney(variance)} strong />
        </div>

        <button onClick={download} className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-white/70 border border-black/15 font-semibold text-sm hover:bg-white">
          <FileDown className="w-4 h-4" /> Download Z-report (PDF)
        </button>
        <button onClick={() => logout()} className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-black text-white font-semibold text-sm">
          <LogOut className="w-4 h-4" /> Sign out — hand over to next cashier
        </button>
        <p className="text-[11px] text-muted-foreground text-center mt-3">The next cashier signs in with their own account and enters their opening cash (العهدة المبدئية) to start a new shift.</p>
      </div>
    </div>
  );
}
