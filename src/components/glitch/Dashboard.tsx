import { useEffect, useState } from "react";
import { useStore, fmtMoney, isToday, computeDailyFinancials } from "@/lib/glitch-store";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { Activity, DollarSign, Gamepad2, AlertTriangle, Circle, Wallet, CreditCard, Smartphone, Receipt, TrendingUp, TrendingDown, CheckCircle2, History } from "lucide-react";
import { ShiftBar } from "./ShiftBar";

export function Dashboard() {
  const { state, computeElapsed } = useStore();
  const { t } = useLanguage();
  const [, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick((n) => n + 1), 1000); return () => clearInterval(id); }, []);

  // This page is admin-only (enforced in App.tsx — a cashier is redirected
  // before ever rendering this), so every number here is the full day,
  // with no cashier/shift-scoped variant to branch on anymore.
  const roomsOnly = state.rooms.filter((r) => r.zone === "room");
  const activeRooms = roomsOnly.filter((r) => r.status === "active");
  const available = roomsOnly.length - activeRooms.length;

  const stockAlerts = state.stock.filter((s) => {
    const remaining = s.initialStock - s.used;
    return remaining < s.minStock || remaining < s.initialStock * 0.2;
  });

  const revByRoom = state.rooms.map((r) => {
    const past = state.sessions.filter((s) => s.roomId === r.id).reduce((a, s) => a + s.total, 0);
    let live = 0;
    if (r.status === "active" && r.startedAt) {
      const dur = computeElapsed(r);
      live = (dur / 3600) * r.hourlyRate + r.orders.reduce((a, o) => a + o.qty * o.price, 0);
    }
    return { room: r, total: past + live, live };
  });
  const maxRev = Math.max(1, ...revByRoom.map((x) => x.total));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t("dashboard.title")}</h1>
        <p className="text-sm text-muted-foreground mt-1 font-mono uppercase tracking-widest">{t("dashboard.subtitle")}</p>
      </div>

      <ShiftBar />

      <DailyReconciliationPanel />

      {/* Metric cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard
          label={t("dashboard.activeRooms")}
          value={`${activeRooms.length} / ${roomsOnly.length}`}
          icon={Gamepad2}
          accent="cyan"
        />
        <MetricCard
          label={t("dashboard.availableRooms")}
          value={String(available)}
          icon={Circle}
          accent="blue"
        />
        <MetricCard
          label={t("dashboard.stockAlerts")}
          value={String(stockAlerts.length)}
          icon={AlertTriangle}
          accent={stockAlerts.length > 0 ? "red" : "blue"}
          pulse={stockAlerts.length > 0}
        />
      </div>

      {/* Analytics grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Revenue chart */}
        <div className="lg:col-span-2 glass rounded-2xl p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-semibold">{t("dashboard.revenueByRoom")}</h2>
              <p className="text-xs text-muted-foreground font-mono uppercase tracking-widest mt-0.5">{t("dashboard.completedPlusLive")}</p>
            </div>
            <div className="text-xs text-muted-foreground font-mono">{t("dashboard.max")} {fmtMoney(maxRev)}</div>
          </div>
          <div className="space-y-3">
            {revByRoom.map(({ room, total, live }) => {
              const pct = (total / maxRev) * 100;
              return (
                <div key={room.id} className="flex items-center gap-3">
                  <div className={`w-16 text-xs font-mono ${room.isVip ? "text-black" : "text-muted-foreground"}`}>
                    {room.name}
                  </div>
                  <div className="flex-1 h-3 bg-white/70 rounded-full overflow-hidden relative">
                    <div
                      className={`h-full rounded-full transition-all ${
                        room.isVip
                          ? "bg-gradient-to-r from-black to-[oklch(0.65_0.24_305)]"
                          : "bg-gradient-to-r from-[oklch(0.7_0.19_260)] to-[oklch(0.7_0.19_260)]"
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                    {live > 0 && (
                      <div className="absolute inset-y-0 right-1 flex items-center">
                        <span className="w-1.5 h-1.5 rounded-full bg-[oklch(0.78_0.2_155)] animate-pulse-glow" />
                      </div>
                    )}
                  </div>
                  <div className="w-24 text-right text-sm font-mono">{fmtMoney(total)}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Activity feed */}
        <div className="glass rounded-2xl p-6 flex flex-col">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="w-4 h-4 text-[oklch(0.7_0.19_260)]" />
            <h2 className="text-lg font-semibold">{t("dashboard.activityFeed")}</h2>
          </div>
          <div className="flex-1 overflow-y-auto space-y-2 max-h-[420px] pr-1">
            {state.activity.length === 0 ? (
              <div className="text-sm text-muted-foreground font-mono">{t("dashboard.noActivityYet")}</div>
            ) : (
              state.activity.slice(0, 30).map((a) => (
                <div key={a.id} className="text-sm p-3 rounded-lg bg-white/60 border border-black/8 hover:border-[oklch(0.7_0.19_260/0.35)] transition">
                  <div className="text-foreground">{a.message}</div>
                  <div className="text-[10px] font-mono text-muted-foreground mt-1 uppercase tracking-wider">
                    {new Date(a.ts).toLocaleTimeString()}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// The dark-themed executive financial overview requested — deliberately
// scoped to this one section rather than the whole app, since a global
// dark mode wasn't part of the request, just this panel.
function DailyReconciliationPanel() {
  const { state, saveDailyReconciliation, getDailyReconciliationHistory } = useStore();
  const { t } = useLanguage();
  const [actualCashInput, setActualCashInput] = useState("");
  const [instapayInput, setInstapayInput] = useState("");
  const [visaInput, setVisaInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<Awaited<ReturnType<typeof getDailyReconciliationHistory>> | null>(null);

  const financials = computeDailyFinancials(state.sessions, state.ledger);
  const actualCash = parseFloat(actualCashInput);
  const instapayTotal = parseFloat(instapayInput) || 0;
  const visaTotal = parseFloat(visaInput) || 0;
  const hasActualCash = actualCashInput.trim() !== "" && !isNaN(actualCash);
  // Expected cash now depends on the two manually entered fields, so it
  // recomputes live as the admin types either one — same formula the
  // server uses on save, just evaluated here for instant feedback.
  const expectedCash = financials.totalRevenue - visaTotal - instapayTotal - financials.expensesTotal;
  const variance = hasActualCash ? actualCash - expectedCash : null;
  const isOver = variance !== null && variance >= 0;

  const loadHistory = async () => {
    const records = await getDailyReconciliationHistory();
    setHistory(records);
  };

  const handleToggleHistory = () => {
    const next = !historyOpen;
    setHistoryOpen(next);
    if (next && !history) void loadHistory();
  };

  const handleSave = async () => {
    if (!hasActualCash) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await saveDailyReconciliation(actualCash, instapayTotal, visaTotal);
      if (res.ok) {
        setSaveMsg(t("dashboard.reconciliationSaved"));
        if (historyOpen) void loadHistory();
      } else {
        setSaveMsg(res.error ?? "Could not save");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-[#0b0d12] text-white p-6 shadow-[0_0_40px_rgba(0,0,0,0.3)]">
      <h2 className="text-lg font-semibold flex items-center gap-2">
        <Wallet className="w-5 h-5 text-[oklch(0.78_0.2_155)]" /> {t("dashboard.financialOverview")}
      </h2>
      <p className="text-xs text-white/40 mt-0.5">
        Calendar day only ({new Date().toLocaleDateString()}) — a shift spanning midnight shows less here than in its own Shift Revenue total.
      </p>

      {/* Revenue + expenses stay auto-calculated; InstaPay and Visa are
          manual entry, same style as Actual Cash — the source of truth
          for those two is the bank/payment-app statement, not
          necessarily what got typed in at checkout time. */}
      <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <DarkKpiCard
          label={t("dashboard.closedOrdersTotal")}
          value={fmtMoney(financials.totalRevenue)}
          icon={DollarSign}
          highlighted
        />
        <DarkInputCard
          label={t("dashboard.instapayTotal")}
          icon={Smartphone}
          value={instapayInput}
          onChange={(v) => { setInstapayInput(v); setSaveMsg(null); }}
        />
        <DarkInputCard
          label={t("dashboard.visaCardTotal")}
          icon={CreditCard}
          value={visaInput}
          onChange={(v) => { setVisaInput(v); setSaveMsg(null); }}
        />
        <DarkKpiCard label={t("dashboard.dailyExpenses")} value={fmtMoney(financials.expensesTotal)} icon={Receipt} />
      </div>

      {/* Expected cash + actual cash input + variance */}
      <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="lg:col-span-1 rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="text-[10px] uppercase tracking-widest text-white/50">{t("dashboard.expectedCash")}</div>
          <div className="mt-1 text-3xl font-bold font-mono">{fmtMoney(expectedCash)}</div>
        </div>

        <div className="lg:col-span-1 rounded-xl border border-white/10 bg-white/5 p-4">
          <label className="text-[10px] uppercase tracking-widest text-white/50">{t("dashboard.actualCashLabel")}</label>
          <input
            type="number"
            inputMode="decimal"
            value={actualCashInput}
            onChange={(e) => { setActualCashInput(e.target.value); setSaveMsg(null); }}
            placeholder={t("dashboard.actualCashPlaceholder")}
            className="mt-2 w-full bg-black/30 border border-white/15 rounded-lg px-3 py-2 text-xl font-mono text-white placeholder:text-white/30 focus:outline-none focus:border-[oklch(0.78_0.2_155/0.6)]"
          />
        </div>

        <div
          className={`lg:col-span-1 rounded-xl border p-4 flex flex-col justify-center transition-colors ${
            variance === null
              ? "border-white/10 bg-white/5"
              : isOver
                ? "border-[oklch(0.78_0.2_155/0.5)] bg-[oklch(0.78_0.2_155/0.15)]"
                : "border-[oklch(0.62_0.24_25/0.5)] bg-[oklch(0.62_0.24_25/0.15)]"
          }`}
        >
          <div className="text-[10px] uppercase tracking-widest text-white/50">{t("dashboard.variance")}</div>
          {variance === null ? (
            <div className="mt-1 text-lg font-mono text-white/40">—</div>
          ) : (
            <div className={`mt-1 flex items-center gap-2 text-2xl font-bold font-mono ${isOver ? "text-[oklch(0.78_0.2_155)]" : "text-[oklch(0.62_0.24_25)]"}`}>
              {isOver ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
              {variance === 0 ? t("dashboard.matched") : `${variance > 0 ? "+" : ""}${fmtMoney(variance)}`}
              {variance !== 0 && (
                <span className="text-xs font-normal uppercase tracking-widest opacity-80">
                  {isOver ? t("dashboard.over") : t("dashboard.shortage")}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3 flex-wrap">
        <button
          onClick={() => void handleSave()}
          disabled={!hasActualCash || saving}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-[oklch(0.78_0.2_155)] text-black disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <CheckCircle2 className="w-4 h-4" /> {saving ? "..." : t("dashboard.saveReconciliation")}
        </button>
        {saveMsg && <span className="text-sm text-white/70">{saveMsg}</span>}
        <button onClick={handleToggleHistory} className="ms-auto flex items-center gap-1.5 text-xs text-white/50 hover:text-white/80">
          <History className="w-3.5 h-3.5" /> {t("dashboard.reconciliationHistory")} {historyOpen ? "▲" : "▼"}
        </button>
      </div>

      {historyOpen && (
        <div className="mt-3 border-t border-white/10 pt-3">
          {!history ? (
            <div className="text-sm text-white/40">...</div>
          ) : history.length === 0 ? (
            <div className="text-sm text-white/40">{t("dashboard.noHistoryYet")}</div>
          ) : (
            <div className="space-y-1.5 max-h-56 overflow-y-auto">
              {history.map((r) => (
                <div key={r.id} className="flex items-center justify-between text-xs font-mono py-1.5 px-2 rounded bg-white/5">
                  <span className="text-white/60">{r.dateLabel} — {r.recordedBy}</span>
                  <span className="text-white/50">{t("dashboard.expectedCash")}: {fmtMoney(r.expectedCash)}</span>
                  <span className={r.variance >= 0 ? "text-[oklch(0.78_0.2_155)]" : "text-[oklch(0.62_0.24_25)]"}>
                    {r.variance >= 0 ? "+" : ""}{fmtMoney(r.variance)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DarkKpiCard({ label, value, icon: Icon, highlighted }: {
  label: string; value: string;
  icon: React.ComponentType<{ className?: string }>;
  highlighted?: boolean;
}) {
  return (
    <div
      className={`rounded-xl p-4 border ${
        highlighted
          ? "border-[oklch(0.78_0.2_155/0.5)] bg-gradient-to-br from-[oklch(0.78_0.2_155/0.2)] to-transparent"
          : "border-white/10 bg-white/5"
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="text-[10px] uppercase tracking-widest text-white/50">{label}</div>
        <Icon className={`w-4 h-4 ${highlighted ? "text-[oklch(0.78_0.2_155)]" : "text-white/40"}`} />
      </div>
      <div className={`mt-2 font-mono font-bold ${highlighted ? "text-2xl text-[oklch(0.78_0.2_155)]" : "text-xl text-white"}`}>{value}</div>
    </div>
  );
}

// Same visual shape as DarkKpiCard, but an editable field instead of a
// read-only value — used for InstaPay/Visa, which are manually entered
// (their source of truth is the bank/payment-app statement, not
// necessarily what got typed in at checkout).
function DarkInputCard({ label, icon: Icon, value, onChange }: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="rounded-xl p-4 border border-white/10 bg-white/5">
      <div className="flex items-start justify-between">
        <label className="text-[10px] uppercase tracking-widest text-white/50">{label}</label>
        <Icon className="w-4 h-4 text-white/40" />
      </div>
      <input
        type="number"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0.00"
        className="mt-2 w-full bg-transparent text-xl font-mono font-bold text-white placeholder:text-white/30 focus:outline-none"
      />
    </div>
  );
}

function MetricCard({ label, value, icon: Icon, accent, pulse }: {
  label: string; value: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: "blue" | "cyan" | "purple" | "gold" | "green" | "red";
  pulse?: boolean;
}) {
  const map = {
    blue: "from-[oklch(0.7_0.19_260/0.15)] border-[oklch(0.7_0.19_260/0.4)] text-[oklch(0.7_0.19_260)]",
    cyan: "from-[oklch(0.7_0.19_260/0.15)] border-[oklch(0.7_0.19_260/0.4)] text-[oklch(0.7_0.19_260)]",
    purple: "from-[oklch(0.65_0.24_305/0.15)] border-[oklch(0.65_0.24_305/0.4)] text-[oklch(0.65_0.24_305)]",
    gold: "from-black/15 border-black/40 text-white",
    green: "from-[oklch(0.78_0.2_155/0.15)] border-[oklch(0.78_0.2_155/0.4)] text-[oklch(0.78_0.2_155)]",
    red: "from-[oklch(0.62_0.24_25/0.15)] border-[oklch(0.62_0.24_25/0.4)] text-[oklch(0.62_0.24_25)]",
  };
  return (
    <div className={`glass rounded-2xl p-5 border bg-gradient-to-br to-transparent ${map[accent]} ${pulse ? "animate-pulse-red" : ""}`}>
      <div className="flex items-start justify-between">
        <div className="text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
        <Icon className={`w-5 h-5 ${map[accent].split(" ").pop()}`} />
      </div>
      <div className="mt-3 text-3xl font-bold font-mono">{value}</div>
    </div>
  );
}
