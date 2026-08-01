import { useEffect, useState } from "react";
import { useStore, fmtMoney, captureGeolocation } from "@/lib/glitch-store";
import type { RawMaterial, Supplier } from "@/lib/glitch-store";
import { getPreferredPrinter, setPreferredPrinter } from "@/lib/print";
import { Plus, Trash2, Pencil, X, Save, Boxes, Truck, Receipt, MapPin, Navigation, AlertOctagon, Printer, Copy, Check, RefreshCw } from "lucide-react";

export function SetupPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Setup</h1>
        <p className="text-sm text-muted-foreground mt-1 font-mono uppercase tracking-widest">
          Raw Materials · Suppliers · Recurring Expenses · Geofence
        </p>
      </div>
      <MenuImportPanel />
      <PrinterSetupPanel />
      <GeofencePanel />
      <MaterialsPanel />
      <SuppliersPanel />
      <RecurringExpensesPanel />
      <ProductionResetPanel />
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
    <div className="rounded-2xl p-6 border-2 border-[oklch(0.58_0.22_25/0.5)] bg-[oklch(0.58_0.22_25/0.06)]">
      <div className="flex items-center gap-2 mb-2">
        <AlertOctagon className="w-5 h-5 text-[oklch(0.58_0.22_25)]" />
        <h2 className="text-lg font-bold text-[oklch(0.58_0.22_25)]">Danger Zone — Go-Live Data Wipe</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-4 max-w-2xl">
        Permanently deletes every order, receipt, shift, void, expense, staff order, restock log, and activity log entry —
        resetting all financial totals and order counters to zero. Your menu, categories, prices, room names/rates, raw
        material definitions, suppliers, and employee accounts are preserved. <strong>This cannot be undone.</strong>{" "}
        Only run this once, right before going live for real.
      </p>
      <button
        onClick={() => setOpen(true)}
        className="px-4 py-2.5 rounded-lg bg-[oklch(0.58_0.22_25/0.15)] border-2 border-[oklch(0.58_0.22_25/0.6)] text-[oklch(0.58_0.22_25)] text-sm font-bold uppercase tracking-wide hover:bg-[oklch(0.58_0.22_25/0.25)]"
      >
        Reset System for Live Production
      </button>

      {open && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md" onClick={() => !running && setOpen(false)}>
          <div className="w-full max-w-md glass-strong rounded-2xl border-2 border-[oklch(0.58_0.22_25/0.6)]" onClick={(e) => e.stopPropagation()}>
            {done ? (
              <div className="p-6 text-center space-y-2">
                <div className="text-lg font-bold text-[oklch(0.62_0.16_155)]">System Reset Complete</div>
                <p className="text-sm text-muted-foreground">Reloading with a clean slate...</p>
              </div>
            ) : (
              <>
                <div className="p-5 space-y-4">
                  <h3 className="text-lg font-bold text-[oklch(0.58_0.22_25)]">This is permanent.</h3>
                  <p className="text-sm text-muted-foreground">
                    All test orders, receipts, shifts, void requests, expenses, staff orders, and activity history will be
                    deleted forever. Menu, rooms, materials, and accounts stay.
                  </p>
                  <div>
                    <label className="text-xs uppercase tracking-widest text-muted-foreground">
                      Type <span className="font-bold text-[oklch(0.58_0.22_25)]">{REQUIRED_PHRASE}</span> to confirm
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
                  {err && <div className="text-sm text-[oklch(0.58_0.22_25)]">{err}</div>}
                </div>
                <div className="p-4 border-t border-black/8 flex justify-end gap-2">
                  <button onClick={() => setOpen(false)} disabled={running} className="px-4 py-2 rounded-lg text-sm bg-black/5 hover:bg-black/8 border border-black/10">Cancel</button>
                  <button
                    onClick={submit}
                    disabled={!canSubmit || running}
                    className="px-4 py-2 rounded-lg text-sm bg-[oklch(0.58_0.22_25)] text-white font-bold disabled:opacity-40"
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
    <div className="glass rounded-2xl p-6 border border-[oklch(0.72_0.14_85/0.4)]">
      <div className="flex items-center gap-2 mb-2">
        <Printer className="w-5 h-5 text-[oklch(0.72_0.14_85)]" />
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
                  selected === "" ? "bg-[oklch(0.72_0.14_85/0.2)] border-[oklch(0.72_0.14_85/0.6)] text-[#2b2416] font-semibold" : "bg-white/60 border-black/10 hover:bg-black/5"
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
                    selected === p.name ? "bg-[oklch(0.72_0.14_85/0.2)] border-[oklch(0.72_0.14_85/0.6)] text-[#2b2416] font-semibold" : "bg-white/60 border-black/10 hover:bg-black/5"
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
              {copied === "win" ? <Check className="w-4 h-4 text-[oklch(0.62_0.16_155)]" /> : <Copy className="w-4 h-4" />}
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
              {copied === "mac" ? <Check className="w-4 h-4 text-[oklch(0.62_0.16_155)]" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <div className="rounded-lg bg-[oklch(0.72_0.14_85/0.1)] border border-[oklch(0.72_0.14_85/0.3)] p-3 text-xs text-muted-foreground">
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

function MenuImportPanel() {
  const { importMenuCatalog } = useStore();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ materialsAdded: number; materialsPriced: number; itemsAdded: number; itemsUpdated: number; itemsWithoutRecipe: string[] } | null>(null);

  const run = async () => {
    setRunning(true);
    setResult(null);
    try {
      const res = await importMenuCatalog();
      setResult(res);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="glass rounded-2xl p-6 border border-[oklch(0.7_0.19_260/0.4)]">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold">Import Full Menu Catalog</h2>
          <p className="text-xs text-muted-foreground mt-1 max-w-xl">
            Adds the full Coffee / Frappe / Ice Coffee / Milkshake / Fresh Juice / Frozen Fresh / Mojito / Desserts
            catalog with recipes and verified real unit costs from GLITCH's own recipe book. Safe to run more than
            once — matches by name, so existing items get updated in place instead of duplicated (and existing raw
            materials get their price refreshed to the verified figure), and nothing already in your menu is removed.
          </p>
        </div>
        <button
          onClick={run}
          disabled={running}
          className="shrink-0 px-4 py-2.5 rounded-lg bg-gradient-to-r from-[oklch(0.7_0.19_260)] to-[oklch(0.65_0.24_305)] text-[#2b2416] text-sm font-semibold disabled:opacity-60"
        >
          {running ? "Importing..." : "Run Import"}
        </button>
      </div>
      {result && (
        <div className="mt-4 p-4 rounded-lg bg-white/60 border border-black/8 text-sm space-y-1">
          <div className="text-[oklch(0.78_0.2_155)]">
            {result.materialsAdded} new raw material{result.materialsAdded === 1 ? "" : "s"} added ·{" "}
            {result.materialsPriced} existing material{result.materialsPriced === 1 ? "" : "s"} re-priced ·{" "}
            {result.itemsAdded} new item{result.itemsAdded === 1 ? "" : "s"} added ·{" "}
            {result.itemsUpdated} item{result.itemsUpdated === 1 ? "" : "s"} updated in place
          </div>
          {result.itemsWithoutRecipe.length > 0 && (
            <div className="text-[oklch(0.82_0.16_85)] text-xs mt-2">
              No recipe was provided for these — they won't deduct stock until you add ingredients on the Inventory page:{" "}
              {result.itemsWithoutRecipe.join(", ")}.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function GeofencePanel() {
  const { state, setGeofenceConfig } = useStore();
  const [enabled, setEnabled] = useState(state.geofenceEnabled);
  const [lat, setLat] = useState(String(state.cafeLat));
  const [lng, setLng] = useState(String(state.cafeLng));
  const [radius, setRadius] = useState(String(state.geofenceRadiusMeters));
  const [locating, setLocating] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const useMyLocation = async () => {
    setLocating(true);
    setMsg(null);
    const geo = await captureGeolocation();
    setLocating(false);
    if (!geo.ok) { setMsg("Couldn't get your location — check browser permissions."); return; }
    setLat(String(geo.lat));
    setLng(String(geo.lng));
    setMsg("Captured your current location below. Save to apply it as the venue's coordinates.");
  };

  const save = async () => {
    await setGeofenceConfig({
      enabled,
      lat: parseFloat(lat) || 0,
      lng: parseFloat(lng) || 0,
      radiusMeters: parseFloat(radius) || 50,
    });
    setMsg("Geofence settings saved.");
  };

  return (
    <div className="glass rounded-2xl p-6">
      <div className="flex items-center gap-2 mb-4">
        <MapPin className="w-5 h-5 text-[oklch(0.85_0.16_200)]" />
        <h2 className="text-lg font-semibold">Shift Geofence</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        When enabled, cashiers (and admins) must be physically within this radius of the venue to open or close a shift. Stand at the actual venue and tap "Use My Current Location" to set it precisely.
      </p>

      <label className="flex items-center gap-2 text-sm mb-4">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Enforce geofence on shift open/close
      </label>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="text-xs uppercase tracking-widest text-muted-foreground">Latitude</label>
          <input value={lat} onChange={(e) => setLat(e.target.value)} className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm font-mono" />
        </div>
        <div>
          <label className="text-xs uppercase tracking-widest text-muted-foreground">Longitude</label>
          <input value={lng} onChange={(e) => setLng(e.target.value)} className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm font-mono" />
        </div>
        <div>
          <label className="text-xs uppercase tracking-widest text-muted-foreground">Radius (meters)</label>
          <input type="number" value={radius} onChange={(e) => setRadius(e.target.value)} className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm font-mono" />
        </div>
      </div>

      <div className="flex items-center gap-2 mt-4">
        <button onClick={useMyLocation} disabled={locating} className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg bg-black/5 border border-black/10 hover:bg-black/8 disabled:opacity-60">
          <Navigation className="w-3.5 h-3.5" /> {locating ? "Locating..." : "Use My Current Location"}
        </button>
        <button onClick={save} className="text-xs px-4 py-2 rounded-lg bg-[oklch(0.7_0.19_260/0.2)] border border-[oklch(0.7_0.19_260/0.5)]">Save Geofence</button>
      </div>
      {msg && <div className="mt-3 text-xs text-muted-foreground">{msg}</div>}
    </div>
  );
}

function MaterialsPanel() {
  const { state, addRawMaterial, updateRawMaterial, deleteRawMaterial } = useStore();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", unit: "kg", minStockAlert: 0 });
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
          <Boxes className="w-5 h-5 text-[oklch(0.82_0.16_85)]" />
          <h2 className="text-lg font-semibold">Raw Material Profiles</h2>
        </div>
        <button onClick={() => setShowAdd((v) => !v)} className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg bg-black/5 border border-black/10 hover:bg-black/8">
          <Plus className="w-4 h-4" /> Add Material
        </button>
      </div>

      {showAdd && (
        <div className="mb-4 p-4 rounded-lg bg-white/60 border border-black/8 grid grid-cols-1 md:grid-cols-4 gap-2">
          <input placeholder="Name (e.g. Coffee Beans)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="md:col-span-2 bg-white/70 rounded px-3 py-2 text-sm border border-black/10" />
          <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} className="bg-white/70 rounded px-3 py-2 text-sm border border-black/10">
            <option value="kg">kg</option><option value="g">g</option><option value="L">Liters</option>
            <option value="ml">ml</option><option value="pcs">Pieces</option>
          </select>
          <input type="number" placeholder="Min stock alert" value={form.minStockAlert} onChange={(e) => setForm({ ...form, minStockAlert: +e.target.value })} className="bg-white/70 rounded px-3 py-2 text-sm border border-black/10" />
          <button
            className="md:col-span-4 py-2 rounded bg-[oklch(0.7_0.19_260/0.2)] border border-[oklch(0.7_0.19_260/0.5)] text-sm"
            onClick={async () => {
              if (!form.name) return;
              await addRawMaterial(form);
              setForm({ name: "", unit: "kg", minStockAlert: 0 });
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
                    <input type="number" value={editForm.minStockAlert} onChange={(e) => setEditForm({ ...editForm, minStockAlert: +e.target.value })} className="bg-white/70 rounded px-2 py-1.5 text-xs border border-black/10" />
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
                  <button onClick={() => beginEdit(m)} className="text-muted-foreground hover:text-[oklch(0.85_0.16_200)]"><Pencil className="w-3.5 h-3.5" /></button>
                  <button onClick={() => deleteRawMaterial(m.id)} className="text-muted-foreground hover:text-[oklch(0.75_0.22_25)]"><Trash2 className="w-3.5 h-3.5" /></button>
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
          <Truck className="w-5 h-5 text-[oklch(0.85_0.16_200)]" />
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
                  <button onClick={() => beginEdit(s)} className="text-muted-foreground hover:text-[oklch(0.85_0.16_200)]"><Pencil className="w-3.5 h-3.5" /></button>
                  <button onClick={() => deleteSupplier(s.id)} className="text-muted-foreground hover:text-[oklch(0.75_0.22_25)]"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RecurringExpensesPanel() {
  const { state, addRecurringExpense, deleteRecurringExpense, logRecurringExpensePayment } = useStore();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", amount: 0, active: true });
  const [payingId, setPayingId] = useState<string | null>(null);

  return (
    <div className="glass rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Receipt className="w-5 h-5 text-[oklch(0.78_0.2_155)]" />
          <h2 className="text-lg font-semibold">Fixed / Recurring Expenses</h2>
        </div>
        <button onClick={() => setShowAdd((v) => !v)} className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg bg-black/5 border border-black/10 hover:bg-black/8">
          <Plus className="w-4 h-4" /> Add Template
        </button>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Templates for recurring costs (rent, salaries, utilities). Log the actual payment each month with "Log Payment" — that's what hits the ledger and P&amp;L, not the template itself.
      </p>

      {showAdd && (
        <div className="mb-4 p-4 rounded-lg bg-white/60 border border-black/8 grid grid-cols-1 md:grid-cols-3 gap-2">
          <input placeholder="Name (e.g. Rent)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="bg-white/70 rounded px-3 py-2 text-sm border border-black/10" />
          <input type="number" placeholder="Monthly amount" value={form.amount} onChange={(e) => setForm({ ...form, amount: +e.target.value })} className="bg-white/70 rounded px-3 py-2 text-sm border border-black/10" />
          <button
            className="py-2 rounded bg-[oklch(0.7_0.19_260/0.2)] border border-[oklch(0.7_0.19_260/0.5)] text-sm"
            onClick={async () => {
              if (!form.name) return;
              await addRecurringExpense(form);
              setForm({ name: "", amount: 0, active: true });
              setShowAdd(false);
            }}
          >Save Template</button>
        </div>
      )}

      {state.recurringExpenses.length === 0 ? (
        <div className="text-sm text-muted-foreground font-mono">No recurring expense templates yet.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {state.recurringExpenses.map((e) => (
            <div key={e.id} className="bg-white/60 rounded-lg p-3 border border-black/8">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-sm">{e.name}</div>
                  <div className="text-xs font-mono text-muted-foreground">{fmtMoney(e.amount)}/mo</div>
                </div>
                <button onClick={() => deleteRecurringExpense(e.id)} className="text-muted-foreground hover:text-[oklch(0.75_0.22_25)]"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
              {payingId === e.id ? (
                <div className="flex items-center gap-2 mt-2">
                  <button
                    onClick={async () => { await logRecurringExpensePayment({ name: e.name, amount: e.amount }); setPayingId(null); }}
                    className="flex-1 text-xs py-1.5 rounded bg-[oklch(0.62_0.24_25/0.2)] border border-[oklch(0.62_0.24_25/0.5)] text-[oklch(0.75_0.22_25)]"
                  >Confirm ${e.amount.toFixed(2)} Paid</button>
                  <button onClick={() => setPayingId(null)} className="text-xs px-2 py-1.5 rounded bg-black/5 border border-black/10">Cancel</button>
                </div>
              ) : (
                <button onClick={() => setPayingId(e.id)} className="mt-2 w-full text-xs py-1.5 rounded bg-black/5 border border-black/10 hover:bg-black/8">Log Payment</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
