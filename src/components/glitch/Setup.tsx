import { useEffect, useState } from "react";
import { useStore, fmtMoney } from "@/lib/glitch-store";
import type { RawMaterial, Supplier } from "@/lib/glitch-store";
import { getPreferredPrinter, setPreferredPrinter } from "@/lib/print";
import { Plus, Trash2, Pencil, X, Save, Boxes, Truck, Receipt, AlertOctagon, Printer, Copy, Check, RefreshCw, Upload, History } from "lucide-react";

export function SetupPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Setup</h1>
        <p className="text-sm text-muted-foreground mt-1 font-mono uppercase tracking-widest">
          Raw Materials · Suppliers
        </p>
      </div>
      <PrinterSetupPanel />
      <MaterialsPanel />
      <SuppliersPanel />
      <CloudMigrationPanel />
      <MenuRebuildPanel />
      <ProductionResetPanel />
      <KeepInventoryResetPanel />
    </div>
  );
}

function CloudMigrationPanel() {
  const { migrateToCloud } = useStore();
  const [open, setOpen] = useState(false);
  const [cloudUrl, setCloudUrl] = useState("");
  const [cloudSecret, setCloudSecret] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [password, setPassword] = useState("");
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ tableSummary: Record<string, number>; accountsAdded: number } | null>(null);

  const REQUIRED_PHRASE = "MIGRATE FROM CAFE";
  const canSubmit = confirmText.trim().toUpperCase() === REQUIRED_PHRASE && password.length > 0 && cloudUrl.trim().length > 0 && cloudSecret.trim().length > 0;

  const submit = async () => {
    if (!canSubmit) return;
    setRunning(true);
    setErr(null);
    try {
      const res = await migrateToCloud({ password, cloudUrl: cloudUrl.trim(), cloudSecret: cloudSecret.trim() });
      if (!res.ok) { setErr((res.step === "export" ? "Export step failed: " : res.step === "import" ? "Import step failed: " : "") + (res.error ?? "Migration failed")); return; }
      setResult({ tableSummary: res.tableSummary, accountsAdded: res.accountsAdded });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong — please try again.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="rounded-2xl p-6 border-2 border-[oklch(0.7_0.19_260/0.5)] bg-[oklch(0.7_0.19_260/0.06)]">
      <div className="flex items-center gap-2 mb-2">
        <History className="w-5 h-5 text-[oklch(0.7_0.19_260)]" />
        <h2 className="text-lg font-bold text-[oklch(0.7_0.19_260)]">Migrate This Device's Data to the Cloud</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-4 max-w-2xl">
        Sends everything on <strong>this device</strong> (materials, batches, sessions, ledger, suppliers, invoices,
        accounts, the whole menu) to the online/cloud backend, replacing what's currently there. Existing cloud
        accounts (like the owner's web login) are never overwritten — only new accounts get added. Safe to run
        again later — each run fully replaces the cloud's business data with this device's latest snapshot, so
        there's no risk of duplicates from running it more than once. You can either keep this device on its own
        local database and re-run this whenever you want the cloud caught up, or point this device at the cloud
        afterward so every device reads and writes the same data going forward — your choice.
      </p>
      <button
        onClick={() => setOpen(true)}
        className="px-4 py-2.5 rounded-lg bg-[oklch(0.7_0.19_260/0.15)] border-2 border-[oklch(0.7_0.19_260/0.6)] text-[oklch(0.7_0.19_260)] text-sm font-bold uppercase tracking-wide hover:bg-[oklch(0.7_0.19_260/0.25)]"
      >
        Migrate to Cloud
      </button>

      {open && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md" onClick={() => !running && setOpen(false)}>
          <div className="w-full max-w-lg glass-strong rounded-2xl border-2 border-[oklch(0.7_0.19_260/0.6)] max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            {result ? (
              <div className="p-6 space-y-2">
                <div className="text-lg font-bold text-[oklch(0.78_0.2_155)]">Migration Complete</div>
                <div className="text-sm text-muted-foreground space-y-1">
                  {Object.entries(result.tableSummary).map(([table, count]) => (
                    <div key={table} className="flex justify-between font-mono text-xs">
                      <span>{table}</span><span>{count}</span>
                    </div>
                  ))}
                </div>
                {result.accountsAdded > 0 && <p className="text-sm">{result.accountsAdded} new account(s) added to the cloud.</p>}
                <p className="text-xs text-muted-foreground pt-2">
                  This device's own local database is untouched — it's still there, still working, and you can run
                  this again anytime to push a fresh snapshot to the cloud. If you'd rather this device read and
                  write the cloud directly instead of its own local database from now on, reconfigure its
                  APPS_SCRIPT_URL to point at the cloud and restart — but that's optional, not required.
                </p>
                <button onClick={() => { setOpen(false); setResult(null); setConfirmText(""); setPassword(""); }} className="mt-2 px-4 py-2 rounded-lg text-sm bg-black/5 hover:bg-black/8 border border-black/10">Done</button>
              </div>
            ) : (
              <>
                <div className="p-5 space-y-4">
                  <h3 className="text-lg font-bold text-[oklch(0.7_0.19_260)]">This replaces cloud business data with what's on this device.</h3>
                  <p className="text-sm text-muted-foreground">
                    Get the Cloud URL and Secret from your Apps Script deployment (or wherever your online site's
                    environment variables are configured) before starting.
                  </p>
                  <div>
                    <label className="text-xs uppercase tracking-widest text-muted-foreground">Cloud Apps Script URL</label>
                    <input
                      value={cloudUrl} onChange={(e) => setCloudUrl(e.target.value)}
                      placeholder="https://script.google.com/macros/s/.../exec"
                      className="mt-1 w-full bg-black/5 border border-black/10 rounded-lg px-3 py-2 text-sm font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-xs uppercase tracking-widest text-muted-foreground">Cloud Secret</label>
                    <input
                      type="password" value={cloudSecret} onChange={(e) => setCloudSecret(e.target.value)}
                      className="mt-1 w-full bg-black/5 border border-black/10 rounded-lg px-3 py-2 text-sm font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-xs uppercase tracking-widest text-muted-foreground">
                      Type <span className="font-bold text-[oklch(0.7_0.19_260)]">{REQUIRED_PHRASE}</span> to confirm
                    </label>
                    <input
                      value={confirmText} onChange={(e) => setConfirmText(e.target.value)}
                      className="mt-1 w-full bg-black/5 border border-black/10 rounded-lg px-3 py-2 text-sm font-mono"
                      placeholder={REQUIRED_PHRASE}
                    />
                  </div>
                  <div>
                    <label className="text-xs uppercase tracking-widest text-muted-foreground">Re-enter Your Admin Password</label>
                    <input
                      type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                      className="mt-1 w-full bg-black/5 border border-black/10 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  {err && <div className="text-sm text-[oklch(0.62_0.24_25)]">{err}</div>}
                </div>
                <div className="p-4 border-t border-black/8 flex justify-end gap-2">
                  <button onClick={() => setOpen(false)} disabled={running} className="px-4 py-2 rounded-lg text-sm bg-black/5 hover:bg-black/8 border border-black/10">Cancel</button>
                  <button
                    onClick={() => void submit()}
                    disabled={!canSubmit || running}
                    className="px-4 py-2 rounded-lg text-sm bg-[oklch(0.7_0.19_260)] text-white font-bold disabled:opacity-40"
                  >
                    {running ? "Migrating..." : "Migrate Now"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function MenuRebuildPanel() {
  const { resetMenuAndRecipes } = useStore();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [password, setPassword] = useState("");
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ materialsCreated: number; itemsCreated: number; unresolved: string[] } | null>(null);

  const REQUIRED_PHRASE = "REBUILD MENU";
  const canSubmit = confirmText.trim().toUpperCase() === REQUIRED_PHRASE && password.length > 0;

  const submit = async () => {
    if (!canSubmit) return;
    setRunning(true);
    setErr(null);
    try {
      const res = await resetMenuAndRecipes(password);
      if (!res.ok) { setErr(res.error ?? "Rebuild failed"); return; }
      setResult({ materialsCreated: res.materialsCreated, itemsCreated: res.itemsCreated, unresolved: res.unresolved });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="rounded-2xl p-6 border-2 border-[oklch(0.62_0.24_25/0.5)] bg-[oklch(0.62_0.24_25/0.06)]">
      <div className="flex items-center gap-2 mb-2">
        <AlertOctagon className="w-5 h-5 text-[oklch(0.62_0.24_25)]" />
        <h2 className="text-lg font-bold text-[oklch(0.62_0.24_25)]">Danger Zone — Rebuild Entire Menu &amp; Recipes</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-4 max-w-2xl">
        Permanently replaces the entire menu with the current source recipe book — every menu item's name, price,
        category, and recipe is rebuilt from scratch. Any material referenced by a recipe but not already in your
        inventory (matched by name) is created automatically; materials that already exist are never duplicated or
        altered. <strong>This cannot be undone.</strong>
      </p>
      <button
        onClick={() => setOpen(true)}
        className="px-4 py-2.5 rounded-lg bg-[oklch(0.62_0.24_25/0.15)] border-2 border-[oklch(0.62_0.24_25/0.6)] text-[oklch(0.62_0.24_25)] text-sm font-bold uppercase tracking-wide hover:bg-[oklch(0.62_0.24_25/0.25)]"
      >
        Rebuild Menu &amp; Recipes
      </button>

      {open && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md" onClick={() => !running && setOpen(false)}>
          <div className="w-full max-w-md glass-strong rounded-2xl border-2 border-[oklch(0.62_0.24_25/0.6)]" onClick={(e) => e.stopPropagation()}>
            {result ? (
              <div className="p-6 space-y-2">
                <div className="text-lg font-bold text-[oklch(0.78_0.2_155)]">Menu Rebuilt</div>
                <p className="text-sm text-muted-foreground">
                  {result.materialsCreated} new material{result.materialsCreated === 1 ? "" : "s"} created ·{" "}
                  {result.itemsCreated} menu item{result.itemsCreated === 1 ? "" : "s"} rebuilt
                </p>
                {result.unresolved.length > 0 && (
                  <p className="text-xs text-[oklch(0.62_0.24_25)]">Couldn't resolve: {result.unresolved.join(", ")}</p>
                )}
                <button onClick={() => { setOpen(false); setResult(null); setConfirmText(""); setPassword(""); }} className="mt-2 px-4 py-2 rounded-lg text-sm bg-black/5 hover:bg-black/8 border border-black/10">Done</button>
              </div>
            ) : (
              <>
                <div className="p-5 space-y-4">
                  <h3 className="text-lg font-bold text-[oklch(0.62_0.24_25)]">This is permanent.</h3>
                  <p className="text-sm text-muted-foreground">
                    Every current menu item will be replaced. This does not touch stock quantities, prices already
                    charged in past sessions, or reports — only the live menu and its recipes going forward.
                  </p>
                  <div>
                    <label className="text-xs uppercase tracking-widest text-muted-foreground">
                      Type <span className="font-bold text-[oklch(0.62_0.24_25)]">{REQUIRED_PHRASE}</span> to confirm
                    </label>
                    <input
                      value={confirmText} onChange={(e) => setConfirmText(e.target.value)}
                      className="mt-1 w-full bg-black/5 border border-black/10 rounded-lg px-3 py-2 text-sm font-mono"
                      placeholder={REQUIRED_PHRASE}
                    />
                  </div>
                  <div>
                    <label className="text-xs uppercase tracking-widest text-muted-foreground">Re-enter Your Admin Password</label>
                    <input
                      type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                      className="mt-1 w-full bg-black/5 border border-black/10 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  {err && <div className="text-sm text-[oklch(0.62_0.24_25)]">{err}</div>}
                </div>
                <div className="p-4 border-t border-black/8 flex justify-end gap-2">
                  <button onClick={() => setOpen(false)} disabled={running} className="px-4 py-2 rounded-lg text-sm bg-black/5 hover:bg-black/8 border border-black/10">Cancel</button>
                  <button
                    onClick={submit}
                    disabled={!canSubmit || running}
                    className="px-4 py-2 rounded-lg text-sm bg-[oklch(0.62_0.24_25)] text-white font-bold disabled:opacity-40"
                  >
                    {running ? "Rebuilding..." : "Permanently Rebuild"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ProductionResetPanel() {
  const { resetForProduction } = useStore();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [password, setPassword] = useState("");
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const REQUIRED_PHRASE = "RESET FOR PRODUCTION";
  const canSubmit = confirmText.trim().toUpperCase() === REQUIRED_PHRASE && password.length > 0;

  const submit = async () => {
    if (!canSubmit) return;
    setRunning(true);
    setErr(null);
    try {
      const res = await resetForProduction(password);
      if (!res.ok) { setErr(res.error ?? "Reset failed"); return; }
      setDone(true);
      setTimeout(() => window.location.reload(), 1800);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="rounded-2xl p-6 border-2 border-[oklch(0.62_0.24_25/0.5)] bg-[oklch(0.62_0.24_25/0.06)]">
      <div className="flex items-center gap-2 mb-2">
        <AlertOctagon className="w-5 h-5 text-[oklch(0.62_0.24_25)]" />
        <h2 className="text-lg font-bold text-[oklch(0.62_0.24_25)]">Danger Zone — Go-Live Data Wipe</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-4 max-w-2xl">
        Permanently deletes every order, receipt, shift, void, expense, staff order, restock log, and activity log entry —
        resetting all financial totals and order counters to zero. Your menu, categories, prices, room names/rates, raw
        material definitions, suppliers, and employee accounts are preserved. <strong>This cannot be undone.</strong>{" "}
        Only run this once, right before going live for real.
      </p>
      <button
        onClick={() => setOpen(true)}
        className="px-4 py-2.5 rounded-lg bg-[oklch(0.62_0.24_25/0.15)] border-2 border-[oklch(0.62_0.24_25/0.6)] text-[oklch(0.62_0.24_25)] text-sm font-bold uppercase tracking-wide hover:bg-[oklch(0.62_0.24_25/0.25)]"
      >
        Reset System for Live Production
      </button>

      {open && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md" onClick={() => !running && setOpen(false)}>
          <div className="w-full max-w-md glass-strong rounded-2xl border-2 border-[oklch(0.62_0.24_25/0.6)]" onClick={(e) => e.stopPropagation()}>
            {done ? (
              <div className="p-6 text-center space-y-2">
                <div className="text-lg font-bold text-[oklch(0.78_0.2_155)]">System Reset Complete</div>
                <p className="text-sm text-muted-foreground">Reloading with a clean slate...</p>
              </div>
            ) : (
              <>
                <div className="p-5 space-y-4">
                  <h3 className="text-lg font-bold text-[oklch(0.62_0.24_25)]">This is permanent.</h3>
                  <p className="text-sm text-muted-foreground">
                    All test orders, receipts, shifts, void requests, expenses, staff orders, and activity history will be
                    deleted forever. Menu, rooms, materials, and accounts stay.
                  </p>
                  <div>
                    <label className="text-xs uppercase tracking-widest text-muted-foreground">
                      Type <span className="font-bold text-[oklch(0.62_0.24_25)]">{REQUIRED_PHRASE}</span> to confirm
                    </label>
                    <input
                      value={confirmText} onChange={(e) => setConfirmText(e.target.value)}
                      className="mt-1 w-full bg-black/5 border border-black/10 rounded-lg px-3 py-2 text-sm font-mono"
                      placeholder={REQUIRED_PHRASE}
                    />
                  </div>
                  <div>
                    <label className="text-xs uppercase tracking-widest text-muted-foreground">Re-enter Your Admin Password</label>
                    <input
                      type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                      className="mt-1 w-full bg-black/5 border border-black/10 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  {err && <div className="text-sm text-[oklch(0.62_0.24_25)]">{err}</div>}
                </div>
                <div className="p-4 border-t border-black/8 flex justify-end gap-2">
                  <button onClick={() => setOpen(false)} disabled={running} className="px-4 py-2 rounded-lg text-sm bg-black/5 hover:bg-black/8 border border-black/10">Cancel</button>
                  <button
                    onClick={submit}
                    disabled={!canSubmit || running}
                    className="px-4 py-2 rounded-lg text-sm bg-[oklch(0.62_0.24_25)] text-white font-bold disabled:opacity-40"
                  >
                    {running ? "Wiping Data..." : "Permanently Reset"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function KeepInventoryResetPanel() {
  const { resetKeepingInventoryAndLedger } = useStore();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [password, setPassword] = useState("");
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const REQUIRED_PHRASE = "KEEP INVENTORY";
  const canSubmit = confirmText.trim().toUpperCase() === REQUIRED_PHRASE && password.length > 0;

  const submit = async () => {
    if (!canSubmit) return;
    setRunning(true);
    setErr(null);
    try {
      const res = await resetKeepingInventoryAndLedger(password);
      if (!res.ok) { setErr(res.error ?? "Reset failed"); return; }
      setDone(true);
      setTimeout(() => window.location.reload(), 1800);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="rounded-2xl p-6 border-2 border-[oklch(0.82_0.16_85/0.5)] bg-[oklch(0.82_0.16_85/0.06)]">
      <div className="flex items-center gap-2 mb-2">
        <AlertOctagon className="w-5 h-5 text-black" />
        <h2 className="text-lg font-bold text-black">Danger Zone — Reset Test Data, Keep Inventory</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-4 max-w-2xl">
        Wipes test sessions, shifts, void requests, staff orders, restock log, waste invoices, and activity history —
        resetting order counters and clearing any active shift/room. Unlike the Go-Live reset above, this{" "}
        <strong>keeps your current stock levels, procurements, expenses, and suppliers exactly as they are</strong> —
        nothing you've entered in Inventory or Procurement gets lost. <strong>This cannot be undone.</strong>
      </p>
      <button
        onClick={() => setOpen(true)}
        className="px-4 py-2.5 rounded-lg bg-[oklch(0.82_0.16_85/0.15)] border-2 border-[oklch(0.82_0.16_85/0.6)] text-black text-sm font-bold uppercase tracking-wide hover:bg-[oklch(0.82_0.16_85/0.25)]"
      >
        Reset Test Data (Keep Inventory)
      </button>

      {open && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md" onClick={() => !running && setOpen(false)}>
          <div className="w-full max-w-md glass-strong rounded-2xl border-2 border-[oklch(0.82_0.16_85/0.6)]" onClick={(e) => e.stopPropagation()}>
            {done ? (
              <div className="p-6 text-center space-y-2">
                <div className="text-lg font-bold text-[oklch(0.78_0.2_155)]">Test Data Cleared</div>
                <p className="text-sm text-muted-foreground">Your inventory and procurements are untouched. Reloading...</p>
              </div>
            ) : (
              <>
                <div className="p-5 space-y-4">
                  <h3 className="text-lg font-bold text-black">This is permanent.</h3>
                  <p className="text-sm text-muted-foreground">
                    Sessions, shifts, void requests, staff orders, restock log, waste invoices, and activity history will
                    be deleted forever. Raw materials, current stock, all Ledger entries (Expenses and Procurements),
                    supplier invoices, and suppliers stay exactly as they are.
                  </p>
                  <div>
                    <label className="text-xs uppercase tracking-widest text-muted-foreground">
                      Type <span className="font-bold text-black">{REQUIRED_PHRASE}</span> to confirm
                    </label>
                    <input
                      value={confirmText} onChange={(e) => setConfirmText(e.target.value)}
                      className="mt-1 w-full bg-black/5 border border-black/10 rounded-lg px-3 py-2 text-sm font-mono"
                      placeholder={REQUIRED_PHRASE}
                    />
                  </div>
                  <div>
                    <label className="text-xs uppercase tracking-widest text-muted-foreground">Re-enter Your Admin Password</label>
                    <input
                      type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                      className="mt-1 w-full bg-black/5 border border-black/10 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  {err && <div className="text-sm text-[oklch(0.62_0.24_25)]">{err}</div>}
                </div>
                <div className="p-4 border-t border-black/8 flex justify-end gap-2">
                  <button onClick={() => setOpen(false)} disabled={running} className="px-4 py-2 rounded-lg text-sm bg-black/5 hover:bg-black/8 border border-black/10">Cancel</button>
                  <button
                    onClick={submit}
                    disabled={!canSubmit || running}
                    className="px-4 py-2 rounded-lg text-sm bg-black text-white font-bold disabled:opacity-40"
                  >
                    {running ? "Wiping..." : "Permanently Reset"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PrinterSetupPanel() {
  const [copied, setCopied] = useState<string | null>(null);
  const kioskCommand = '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --kiosk-printing --app=https://glitchloungesystem.vercel.app';
  const [printers, setPrinters] = useState<{ name: string; displayName?: string; isDefault?: boolean }[] | null>(null);
  const [selected, setSelected] = useState(getPreferredPrinter());
  const isElectron = typeof window !== "undefined" && !!window.electronAPI;

  useEffect(() => {
    if (!isElectron) return;
    window.electronAPI?.listPrinters().then(setPrinters);
  }, [isElectron]);

  const choosePrinter = (name: string) => {
    setSelected(name);
    setPreferredPrinter(name);
  };

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="glass rounded-2xl p-6 border border-black/40">
      <div className="flex items-center gap-2 mb-2">
        <Printer className="w-5 h-5 text-black" />
        <h2 className="text-lg font-semibold">Thermal Printer Setup — One-Click Printing</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-4 max-w-2xl">
        {isElectron ? (
          <>You're running the desktop app, which prints silently already — no dialog, ever. Pick which physical printer it should use below.</>
        ) : (
          <>Being honest about what's possible here: no website can silently print without asking, on any browser — that's
          a deliberate security boundary, not a limitation of this app. The Print buttons already fire instantly with no
          extra clicks needed inside the print dialog itself, but to skip that dialog entirely on your actual till
          computer, launch Chrome with the <code className="bg-black/5 px-1 rounded">--kiosk-printing</code> flag below.
          Do this once on the register's PC.</>
        )}
      </p>

      {isElectron && (
        <div className="mb-5 rounded-xl bg-black/5 border border-black/8 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Printer for This Device</div>
            <button
              onClick={() => window.electronAPI?.listPrinters().then(setPrinters)}
              className="flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-lg bg-black/5 border border-black/10 hover:bg-black/8"
            >
              <RefreshCw className="w-3 h-3" /> Refresh
            </button>
          </div>
          {printers === null ? (
            <div className="text-xs text-muted-foreground font-mono">Detecting printers...</div>
          ) : printers.length === 0 ? (
            <div className="text-xs text-muted-foreground font-mono">No printers detected on this machine — check it's installed in Windows first.</div>
          ) : (
            <div className="space-y-2">
              <button
                onClick={() => choosePrinter("")}
                className={`w-full flex items-center justify-between text-start text-xs px-3 py-2.5 rounded-lg border ${
                  selected === "" ? "bg-black/20 border-black/60 text-[#2b2416] font-semibold" : "bg-white/60 border-black/10 hover:bg-black/5"
                }`}
              >
                <span>System Default</span>
                {selected === "" && <Check className="w-3.5 h-3.5" />}
              </button>
              {printers.map((p) => (
                <button
                  key={p.name}
                  onClick={() => choosePrinter(p.name)}
                  className={`w-full flex items-center justify-between text-start text-xs px-3 py-2.5 rounded-lg border ${
                    selected === p.name ? "bg-black/20 border-black/60 text-[#2b2416] font-semibold" : "bg-white/60 border-black/10 hover:bg-black/5"
                  }`}
                >
                  <span>{p.displayName || p.name}{p.isDefault ? " (Windows default)" : ""}</span>
                  {selected === p.name && <Check className="w-3.5 h-3.5" />}
                </button>
              ))}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground mt-3">
            Applies to every receipt, kitchen ticket, and report on this device from now on — each till can have its own choice.
          </p>
        </div>
      )}

      {!isElectron && (
      <div className="space-y-4">
        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1.5">Windows — Desktop Shortcut Target</div>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-black/5 border border-black/10 rounded-lg px-3 py-2 text-xs font-mono break-all">{kioskCommand}</code>
            <button onClick={() => copy(kioskCommand, "win")} className="shrink-0 p-2 rounded-lg bg-black/5 border border-black/10 hover:bg-black/8">
              {copied === "win" ? <Check className="w-4 h-4 text-[oklch(0.78_0.2_155)]" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            Right-click your desktop → New → Shortcut → paste this as the location (swap the Chrome path if installed
            elsewhere). Then set this shortcut as the one cashiers actually open every day instead of a normal Chrome icon.
          </p>
        </div>

        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1.5">macOS — Terminal Command</div>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-black/5 border border-black/10 rounded-lg px-3 py-2 text-xs font-mono break-all">
              open -a &quot;Google Chrome&quot; --args --kiosk-printing --app=https://glitchloungesystem.vercel.app
            </code>
            <button
              onClick={() => copy('open -a "Google Chrome" --args --kiosk-printing --app=https://glitchloungesystem.vercel.app', "mac")}
              className="shrink-0 p-2 rounded-lg bg-black/5 border border-black/10 hover:bg-black/8"
            >
              {copied === "mac" ? <Check className="w-4 h-4 text-[oklch(0.78_0.2_155)]" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <div className="rounded-lg bg-black/10 border border-black/30 p-3 text-xs text-muted-foreground">
          <strong className="text-foreground">Then, in that window, print once manually</strong> (Ctrl/Cmd+P) and set your
          80mm thermal printer as the default destination — kiosk mode always prints to whatever is currently set as
          default, silently, from then on. Also make sure "Margins" is set to "None" and paper size to your printer's
          80mm profile the first time, so it doesn't need to ask again.
        </div>
      </div>
      )}
    </div>
  );
}

function BulkImportModal({ onClose }: { onClose: () => void }) {
  const { bulkAddRawMaterials } = useStore();
  const [raw, setRaw] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ added: number; skipped: string[] } | null>(null);

  // Expects tab-separated data, one material per line — exactly what
  // Excel produces when you select a range and paste: Name, Unit,
  // Opening Stock, Unit Cost, Min Stock Alert. Also tolerates commas
  // (CSV) as a fallback delimiter.
  const parsedRows = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const cells = line.includes("\t") ? line.split("\t") : line.split(",");
      return {
        name: (cells[0] || "").trim(),
        unit: (cells[1] || "").trim(),
        openingStock: parseFloat(cells[2]) || 0,
        unitCost: parseFloat(cells[3]) || 0,
        minStockAlert: parseFloat(cells[4]) || 0,
      };
    })
    .filter((r) => r.name);

  const submit = async () => {
    if (parsedRows.length === 0) { setErr("Paste at least one row with a name."); return; }
    setSubmitting(true);
    setErr(null);
    try {
      const res = await bulkAddRawMaterials(parsedRows);
      if (!res.ok) { setErr("Import failed."); return; }
      setResult({ added: res.added, skipped: res.skipped });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[300] flex flex-col bg-[#f5f0e6]">
      {/* Pinned header — never scrolls, always visible */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-black/10 bg-white/60 backdrop-blur-md shrink-0">
        <h3 className="text-xl font-bold text-[oklch(0.7_0.19_260)]">Bulk Import Materials</h3>
        <button onClick={onClose} className="text-muted-foreground hover:text-[#2b2416] p-1"><X className="w-5 h-5" /></button>
      </div>

      {/* Only this middle section scrolls — header and footer stay put */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="max-w-3xl mx-auto">
          {result ? (
            <div className="space-y-3">
              <div className="text-lg font-bold text-[oklch(0.78_0.2_155)]">Imported {result.added} material(s)</div>
              {result.skipped.length > 0 && (
                <div className="text-sm text-muted-foreground">
                  Skipped {result.skipped.length} already-existing material(s) by name: {result.skipped.join(", ")}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Paste directly from Excel — select your data (including these 5 columns, no header row) and paste
                below. One material per line: <strong>Name, Unit, Opening Stock, Unit Cost, Min Stock Alert</strong>.
                Materials already in your list (matched by name) are skipped automatically, so it's safe to paste the
                same sheet again later.
              </p>
              <textarea
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                placeholder={"بلو كيراساو سولو\tكيلو\t1.35\t170\t1\nشيري سولو\tكيلو\t1.05\t170\t1"}
                rows={10}
                className="w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm font-mono"
                dir="auto"
              />
              {parsedRows.length > 0 && (
                <div>
                  <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1.5">Preview — {parsedRows.length} row(s)</div>
                  <div className="rounded-lg border border-black/10">
                    <table className="w-full text-xs">
                      <thead className="bg-white/90">
                        <tr className="text-left text-muted-foreground uppercase tracking-widest">
                          <th className="px-2 py-1.5">Name</th><th className="px-2 py-1.5">Unit</th>
                          <th className="px-2 py-1.5 text-right">Opening</th><th className="px-2 py-1.5 text-right">Cost</th>
                          <th className="px-2 py-1.5 text-right">Min</th>
                        </tr>
                      </thead>
                      <tbody>
                        {parsedRows.map((r, i) => (
                          <tr key={i} className="border-t border-black/5">
                            <td className="px-2 py-1" dir="auto">{r.name}</td>
                            <td className="px-2 py-1">{r.unit}</td>
                            <td className="px-2 py-1 text-right font-mono">{r.openingStock}</td>
                            <td className="px-2 py-1 text-right font-mono">{r.unitCost}</td>
                            <td className="px-2 py-1 text-right font-mono">{r.minStockAlert}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {err && <div className="text-sm text-[oklch(0.62_0.24_25)]">{err}</div>}
            </div>
          )}
        </div>
      </div>

      {/* Pinned footer — always visible and reachable regardless of window size or content length */}
      <div className="px-6 py-4 border-t border-black/10 bg-white/60 backdrop-blur-md shrink-0 flex justify-center">
        <div className="w-full max-w-3xl flex justify-end gap-2">
          {result ? (
            <button onClick={onClose} className="px-5 py-2.5 rounded-lg text-sm bg-[oklch(0.7_0.19_260/0.2)] border border-[oklch(0.7_0.19_260/0.5)] font-semibold">Done</button>
          ) : (
            <>
              <button onClick={onClose} disabled={submitting} className="px-5 py-2.5 rounded-lg text-sm bg-black/5 hover:bg-black/8 border border-black/10">Cancel</button>
              <button
                onClick={() => void submit()}
                disabled={submitting || parsedRows.length === 0}
                className="px-5 py-2.5 rounded-lg text-sm bg-[oklch(0.7_0.19_260/0.2)] border border-[oklch(0.7_0.19_260/0.5)] font-bold disabled:opacity-40"
              >
                {submitting ? "Importing..." : `Import ${parsedRows.length} Material(s)`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function MaterialsPanel() {
  const { state, addRawMaterial, updateRawMaterial, deleteRawMaterial } = useStore();
  const [showAdd, setShowAdd] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [form, setForm] = useState({ name: "", unit: "kg", minStockAlert: 0, unitCost: 0, openingStock: 0, category: "", storageLocation: "" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: "", unit: "", minStockAlert: 0 });

  const beginEdit = (m: RawMaterial) => {
    setEditingId(m.id);
    setEditForm({ name: m.name, unit: m.unit, minStockAlert: m.minStockAlert });
  };

  return (
    <div className="glass rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Boxes className="w-5 h-5 text-black" />
          <h2 className="text-lg font-semibold">Raw Material Profiles</h2>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowBulkImport(true)} className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg bg-[oklch(0.7_0.19_260/0.15)] border border-[oklch(0.7_0.19_260/0.4)] text-[oklch(0.7_0.19_260)] hover:bg-[oklch(0.7_0.19_260/0.25)]">
            <Upload className="w-4 h-4" /> Bulk Import
          </button>
          <button onClick={() => setShowAdd((v) => !v)} className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg bg-black/5 border border-black/10 hover:bg-black/8">
            <Plus className="w-4 h-4" /> Add Material
          </button>
        </div>
      </div>
      {showBulkImport && <BulkImportModal onClose={() => setShowBulkImport(false)} />}

      {showAdd && (
        <div className="mb-4 p-4 rounded-lg bg-white/60 border border-black/8 grid grid-cols-1 md:grid-cols-4 gap-2">
          <input placeholder="Name (e.g. Coffee Beans)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="md:col-span-2 bg-white/70 rounded px-3 py-2 text-sm border border-black/10" />
          <input placeholder="Unit (e.g. g, kg, ml, L, pcs, box, علبة...)" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} className="bg-white/70 rounded px-3 py-2 text-sm border border-black/10" />
          <input type="number" placeholder="Min stock alert" value={form.minStockAlert} onChange={(e) => setForm({ ...form, minStockAlert: parseFloat(e.target.value) || 0 })} className="bg-white/70 rounded px-3 py-2 text-sm border border-black/10" />
          <input type="number" step="0.01" placeholder="Unit cost (EGP)" value={form.unitCost} onChange={(e) => setForm({ ...form, unitCost: parseFloat(e.target.value) || 0 })} className="bg-white/70 rounded px-3 py-2 text-sm border border-black/10" />
          <div>
            <input type="number" step="0.01" placeholder="Opening stock (رصيد بداية الفترة)" value={form.openingStock} onChange={(e) => setForm({ ...form, openingStock: parseFloat(e.target.value) || 0 })} className="w-full bg-white/70 rounded px-3 py-2 text-sm border border-black/10" />
            <p className="text-[10px] text-muted-foreground mt-1">One-time only — locked from editing once saved.</p>
          </div>
          <input placeholder="Category (الفئة)" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="bg-white/70 rounded px-3 py-2 text-sm border border-black/10" />
          <input placeholder="Storage location (مكان التخزين)" value={form.storageLocation} onChange={(e) => setForm({ ...form, storageLocation: e.target.value })} className="bg-white/70 rounded px-3 py-2 text-sm border border-black/10" />
          <button
            className="md:col-span-4 py-2 rounded bg-[oklch(0.7_0.19_260/0.2)] border border-[oklch(0.7_0.19_260/0.5)] text-sm"
            onClick={async () => {
              if (!form.name) return;
              await addRawMaterial(form);
              setForm({ name: "", unit: "kg", minStockAlert: 0, unitCost: 0, openingStock: 0, category: "", storageLocation: "" });
              setShowAdd(false);
            }}
          >Save Material</button>
        </div>
      )}

      {state.materials.length === 0 ? (
        <div className="text-sm text-muted-foreground font-mono">No raw materials yet.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {state.materials.map((m) => {
            const isEditing = editingId === m.id;
            if (isEditing) {
              return (
                <div key={m.id} className="bg-white/60 rounded-lg p-3 border border-[oklch(0.7_0.19_260/0.5)] space-y-2">
                  <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="w-full bg-white/70 rounded px-2 py-1.5 text-sm border border-black/10" />
                  <div className="grid grid-cols-2 gap-2">
                    <input value={editForm.unit} onChange={(e) => setEditForm({ ...editForm, unit: e.target.value })} className="bg-white/70 rounded px-2 py-1.5 text-xs border border-black/10" />
                    <input type="number" value={editForm.minStockAlert} onChange={(e) => setEditForm({ ...editForm, minStockAlert: parseFloat(e.target.value) || 0 })} className="bg-white/70 rounded px-2 py-1.5 text-xs border border-black/10" />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={async () => { await updateRawMaterial(m.id, editForm); setEditingId(null); }} className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-[oklch(0.78_0.2_155/0.2)] border border-[oklch(0.78_0.2_155/0.5)] text-[oklch(0.78_0.2_155)]"><Save className="w-3 h-3" /> Save</button>
                    <button onClick={() => setEditingId(null)} className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-black/5 border border-black/10"><X className="w-3 h-3" /> Cancel</button>
                  </div>
                </div>
              );
            }
            return (
              <div key={m.id} className="bg-white/60 rounded-lg p-3 border border-black/8 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-sm">{m.name}</div>
                  <div className="text-xs text-muted-foreground font-mono">{m.unit} · min {m.minStockAlert}</div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => beginEdit(m)} className="text-muted-foreground hover:text-[oklch(0.7_0.19_260)]"><Pencil className="w-3.5 h-3.5" /></button>
                  <button onClick={() => deleteRawMaterial(m.id)} className="text-muted-foreground hover:text-[oklch(0.62_0.24_25)]"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SuppliersPanel() {
  const { state, addSupplier, updateSupplier, deleteSupplier } = useStore();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", contact: "", category: "" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: "", contact: "", category: "" });

  const beginEdit = (s: Supplier) => {
    setEditingId(s.id);
    setEditForm({ name: s.name, contact: s.contact, category: s.category });
  };

  return (
    <div className="glass rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Truck className="w-5 h-5 text-[oklch(0.7_0.19_260)]" />
          <h2 className="text-lg font-semibold">Supplier Profiles</h2>
        </div>
        <button onClick={() => setShowAdd((v) => !v)} className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg bg-black/5 border border-black/10 hover:bg-black/8">
          <Plus className="w-4 h-4" /> Add Supplier
        </button>
      </div>

      {showAdd && (
        <div className="mb-4 p-4 rounded-lg bg-white/60 border border-black/8 grid grid-cols-1 md:grid-cols-4 gap-2">
          <input placeholder="Supplier name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="bg-white/70 rounded px-3 py-2 text-sm border border-black/10" />
          <input placeholder="Contact (phone/email)" value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} className="bg-white/70 rounded px-3 py-2 text-sm border border-black/10" />
          <input placeholder="Category (e.g. Dairy)" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="bg-white/70 rounded px-3 py-2 text-sm border border-black/10" />
          <button
            className="py-2 rounded bg-[oklch(0.7_0.19_260/0.2)] border border-[oklch(0.7_0.19_260/0.5)] text-sm"
            onClick={async () => {
              if (!form.name) return;
              await addSupplier(form);
              setForm({ name: "", contact: "", category: "" });
              setShowAdd(false);
            }}
          >Save</button>
        </div>
      )}

      {state.suppliers.length === 0 ? (
        <div className="text-sm text-muted-foreground font-mono">No suppliers yet.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {state.suppliers.map((s) => {
            const isEditing = editingId === s.id;
            if (isEditing) {
              return (
                <div key={s.id} className="bg-white/60 rounded-lg p-3 border border-[oklch(0.7_0.19_260/0.5)] space-y-2">
                  <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="w-full bg-white/70 rounded px-2 py-1.5 text-sm border border-black/10" />
                  <input value={editForm.contact} onChange={(e) => setEditForm({ ...editForm, contact: e.target.value })} className="w-full bg-white/70 rounded px-2 py-1.5 text-xs border border-black/10" />
                  <input value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })} className="w-full bg-white/70 rounded px-2 py-1.5 text-xs border border-black/10" />
                  <div className="flex gap-2">
                    <button onClick={async () => { await updateSupplier(s.id, editForm); setEditingId(null); }} className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-[oklch(0.78_0.2_155/0.2)] border border-[oklch(0.78_0.2_155/0.5)] text-[oklch(0.78_0.2_155)]"><Save className="w-3 h-3" /> Save</button>
                    <button onClick={() => setEditingId(null)} className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-black/5 border border-black/10"><X className="w-3 h-3" /> Cancel</button>
                  </div>
                </div>
              );
            }
            return (
              <div key={s.id} className="bg-white/60 rounded-lg p-3 border border-black/8 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-sm">{s.name}</div>
                  <div className="text-xs text-muted-foreground">{s.category} · {s.contact}</div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => beginEdit(s)} className="text-muted-foreground hover:text-[oklch(0.7_0.19_260)]"><Pencil className="w-3.5 h-3.5" /></button>
                  <button onClick={() => deleteSupplier(s.id)} className="text-muted-foreground hover:text-[oklch(0.62_0.24_25)]"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
