import { useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/glitch-store";
import type { AuditLogEntry, AuditRiskLevel } from "@/lib/glitch-store";
import { Download, Lock } from "lucide-react";

function microTs(ts: number) {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} - ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const RISK_STYLE: Record<AuditRiskLevel, string> = {
  green: "bg-[oklch(0.78_0.2_155/0.12)] border-[oklch(0.78_0.2_155/0.4)] text-[oklch(0.78_0.2_155)]",
  yellow: "bg-[oklch(0.82_0.16_85/0.12)] border-[oklch(0.82_0.16_85/0.4)] text-[oklch(0.82_0.16_85)]",
  red: "bg-[oklch(0.62_0.24_25/0.12)] border-[oklch(0.62_0.24_25/0.5)] text-[oklch(0.62_0.24_25)]",
};

export function AuditLogPage() {
  const { state, refreshActivityLogs } = useStore();
  const [staff, setStaff] = useState("all");
  const [actionType, setActionType] = useState("all");
  const [risk, setRisk] = useState<"all" | AuditRiskLevel>("all");
  const [location, setLocation] = useState("all");
  const [shiftId, setShiftId] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [live, setLive] = useState(true);

  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => refreshActivityLogs(), 8000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  const staffOptions = useMemo(() => Array.from(new Set(state.activityLogs.map((l) => l.actorUsername))).sort(), [state.activityLogs]);
  const actionOptions = useMemo(() => Array.from(new Set(state.activityLogs.map((l) => l.actionType))).sort(), [state.activityLogs]);
  const locationOptions = useMemo(() => Array.from(new Set(state.activityLogs.map((l) => l.location).filter(Boolean))).sort(), [state.activityLogs]);
  const shiftOptions = useMemo(() => Array.from(new Set(state.activityLogs.map((l) => l.shiftId).filter((s): s is string => !!s))).sort(), [state.activityLogs]);

  const filtered = useMemo(() => {
    const fromTs = from ? new Date(from).getTime() : null;
    const toTs = to ? new Date(to).getTime() + 86400000 - 1 : null;
    return state.activityLogs
      .filter((l) => staff === "all" || l.actorUsername === staff)
      .filter((l) => actionType === "all" || l.actionType === actionType)
      .filter((l) => risk === "all" || l.riskLevel === risk)
      .filter((l) => location === "all" || l.location === location)
      .filter((l) => shiftId === "all" || l.shiftId === shiftId)
      .filter((l) => (fromTs === null || l.ts >= fromTs) && (toTs === null || l.ts <= toTs))
      .sort((a, b) => b.ts - a.ts);
  }, [state.activityLogs, staff, actionType, risk, location, shiftId, from, to]);

  const exportCsv = () => {
    const rows = [
      ["Timestamp", "Actor", "Role", "Action", "Location", "Risk", "Description", "Shift ID", "Before", "After"],
      ...filtered.map((l) => [
        microTs(l.ts), l.actorUsername, l.actorRole, l.actionType, l.location, l.riskLevel, l.description,
        l.shiftId ?? "", l.before, l.after,
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `glitch-audit-trail-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Audit Trail</h1>
          <p className="text-sm text-muted-foreground mt-1 font-mono uppercase tracking-widest">The Cafe's Black Box — Write-Once, Read-Many</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setLive((v) => !v)}
            className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg border ${live ? "bg-[oklch(0.78_0.2_155/0.15)] border-[oklch(0.78_0.2_155/0.5)] text-[oklch(0.78_0.2_155)]" : "bg-black/5 border-black/10 text-muted-foreground"}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${live ? "bg-[oklch(0.78_0.2_155)] animate-pulse-glow" : "bg-muted-foreground"}`} />
            {live ? "Live" : "Paused"}
          </button>
          <button onClick={exportCsv} className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg bg-black/5 border border-black/10 hover:bg-black/8">
            <Download className="w-3.5 h-3.5" /> Export CSV
          </button>
        </div>
      </div>

      <div className="glass rounded-2xl p-4 border border-black/8">
        <div className="flex items-center gap-2 mb-3 text-xs text-muted-foreground">
          <Lock className="w-3.5 h-3.5" />
          Immutable by design — no admin action anywhere in this system can edit or delete a log entry once written.
        </div>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
          <select value={staff} onChange={(e) => setStaff(e.target.value)} className="bg-white/70 border border-black/10 rounded-lg px-2 py-2 text-xs">
            <option value="all">All Staff</option>
            {staffOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={actionType} onChange={(e) => setActionType(e.target.value)} className="bg-white/70 border border-black/10 rounded-lg px-2 py-2 text-xs">
            <option value="all">All Actions</option>
            {actionOptions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <select value={location} onChange={(e) => setLocation(e.target.value)} className="bg-white/70 border border-black/10 rounded-lg px-2 py-2 text-xs">
            <option value="all">All Rooms/Tables</option>
            {locationOptions.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <select value={shiftId} onChange={(e) => setShiftId(e.target.value)} className="bg-white/70 border border-black/10 rounded-lg px-2 py-2 text-xs">
            <option value="all">All Shifts</option>
            {shiftOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={risk} onChange={(e) => setRisk(e.target.value as typeof risk)} className="bg-white/70 border border-black/10 rounded-lg px-2 py-2 text-xs">
            <option value="all">All Risk Levels</option>
            <option value="green">Green — Normal</option>
            <option value="yellow">Yellow — Caution</option>
            <option value="red">Red — High Risk</option>
          </select>
          <div className="flex items-center gap-1">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-full bg-white/70 border border-black/10 rounded-lg px-2 py-2 text-xs" />
          </div>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span className="text-xs text-muted-foreground">to</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="bg-white/70 border border-black/10 rounded-lg px-2 py-2 text-xs" />
          <span className="text-xs text-muted-foreground ml-auto">{filtered.length} of {state.activityLogs.length} entries</span>
        </div>
      </div>

      <div className="glass rounded-2xl p-4">
        <div className="space-y-1.5 max-h-[600px] overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="text-sm text-muted-foreground font-mono p-4">No matching activity.</div>
          ) : (
            filtered.map((l) => (
              <LogRow key={l.id} entry={l} expanded={expandedId === l.id} onToggle={() => setExpandedId(expandedId === l.id ? null : l.id)} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function LogRow({ entry, expanded, onToggle }: { entry: AuditLogEntry; expanded: boolean; onToggle: () => void }) {
  return (
    <div className={`rounded-lg border px-3 py-2 cursor-pointer transition ${RISK_STYLE[entry.riskLevel]}`} onClick={onToggle}>
      <div className="flex items-center gap-3 text-xs">
        <span className="font-mono text-[10px] shrink-0 w-40 opacity-80">{microTs(entry.ts)}</span>
        <span className="font-bold shrink-0">{entry.actorUsername}</span>
        <span className="opacity-70 shrink-0">({entry.actorRole})</span>
        <span className="font-mono text-[10px] uppercase tracking-widest shrink-0 px-1.5 py-0.5 rounded bg-white/50">{entry.actionType}</span>
        {entry.location && <span className="opacity-70 shrink-0 hidden md:inline">@ {entry.location}</span>}
        <span className="truncate flex-1">{entry.description}</span>
      </div>
      {expanded && (entry.before || entry.after) && (
        <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2 text-[10px] font-mono">
          {entry.before && (
            <div className="bg-white/60 rounded p-2 overflow-x-auto">
              <div className="uppercase tracking-widest opacity-60 mb-1">Before</div>
              <pre className="whitespace-pre-wrap break-all">{entry.before}</pre>
            </div>
          )}
          {entry.after && (
            <div className="bg-white/60 rounded p-2 overflow-x-auto">
              <div className="uppercase tracking-widest opacity-60 mb-1">After</div>
              <pre className="whitespace-pre-wrap break-all">{entry.after}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
