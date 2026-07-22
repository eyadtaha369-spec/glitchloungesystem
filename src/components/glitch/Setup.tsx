import { useState } from "react";
import { useStore, fmtMoney, captureGeolocation } from "@/lib/glitch-store";
import type { RawMaterial, Supplier } from "@/lib/glitch-store";
import { Plus, Trash2, Pencil, X, Save, Boxes, Truck, Receipt, MapPin, Navigation } from "lucide-react";

export function SetupPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Setup</h1>
        <p className="text-sm text-muted-foreground mt-1 font-mono uppercase tracking-widest">
          Raw Materials · Suppliers · Recurring Expenses · Geofence
        </p>
      </div>
      <GeofencePanel />
      <MaterialsPanel />
      <SuppliersPanel />
      <RecurringExpensesPanel />
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
          <input value={lat} onChange={(e) => setLat(e.target.value)} className="mt-1 w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm font-mono" />
        </div>
        <div>
          <label className="text-xs uppercase tracking-widest text-muted-foreground">Longitude</label>
          <input value={lng} onChange={(e) => setLng(e.target.value)} className="mt-1 w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm font-mono" />
        </div>
        <div>
          <label className="text-xs uppercase tracking-widest text-muted-foreground">Radius (meters)</label>
          <input type="number" value={radius} onChange={(e) => setRadius(e.target.value)} className="mt-1 w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm font-mono" />
        </div>
      </div>

      <div className="flex items-center gap-2 mt-4">
        <button onClick={useMyLocation} disabled={locating} className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 disabled:opacity-60">
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
        <button onClick={() => setShowAdd((v) => !v)} className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10">
          <Plus className="w-4 h-4" /> Add Material
        </button>
      </div>

      {showAdd && (
        <div className="mb-4 p-4 rounded-lg bg-black/30 border border-white/5 grid grid-cols-1 md:grid-cols-4 gap-2">
          <input placeholder="Name (e.g. Coffee Beans)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="md:col-span-2 bg-black/40 rounded px-3 py-2 text-sm border border-white/10" />
          <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} className="bg-black/40 rounded px-3 py-2 text-sm border border-white/10">
            <option value="kg">kg</option><option value="g">g</option><option value="L">Liters</option>
            <option value="ml">ml</option><option value="pcs">Pieces</option>
          </select>
          <input type="number" placeholder="Min stock alert" value={form.minStockAlert} onChange={(e) => setForm({ ...form, minStockAlert: +e.target.value })} className="bg-black/40 rounded px-3 py-2 text-sm border border-white/10" />
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
                <div key={m.id} className="bg-black/30 rounded-lg p-3 border border-[oklch(0.7_0.19_260/0.5)] space-y-2">
                  <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="w-full bg-black/40 rounded px-2 py-1.5 text-sm border border-white/10" />
                  <div className="grid grid-cols-2 gap-2">
                    <input value={editForm.unit} onChange={(e) => setEditForm({ ...editForm, unit: e.target.value })} className="bg-black/40 rounded px-2 py-1.5 text-xs border border-white/10" />
                    <input type="number" value={editForm.minStockAlert} onChange={(e) => setEditForm({ ...editForm, minStockAlert: +e.target.value })} className="bg-black/40 rounded px-2 py-1.5 text-xs border border-white/10" />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={async () => { await updateRawMaterial(m.id, editForm); setEditingId(null); }} className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-[oklch(0.78_0.2_155/0.2)] border border-[oklch(0.78_0.2_155/0.5)] text-[oklch(0.78_0.2_155)]"><Save className="w-3 h-3" /> Save</button>
                    <button onClick={() => setEditingId(null)} className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-white/5 border border-white/10"><X className="w-3 h-3" /> Cancel</button>
                  </div>
                </div>
              );
            }
            return (
              <div key={m.id} className="bg-black/30 rounded-lg p-3 border border-white/5 flex items-center justify-between">
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
        <button onClick={() => setShowAdd((v) => !v)} className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10">
          <Plus className="w-4 h-4" /> Add Supplier
        </button>
      </div>

      {showAdd && (
        <div className="mb-4 p-4 rounded-lg bg-black/30 border border-white/5 grid grid-cols-1 md:grid-cols-4 gap-2">
          <input placeholder="Supplier name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="bg-black/40 rounded px-3 py-2 text-sm border border-white/10" />
          <input placeholder="Contact (phone/email)" value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} className="bg-black/40 rounded px-3 py-2 text-sm border border-white/10" />
          <input placeholder="Category (e.g. Dairy)" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="bg-black/40 rounded px-3 py-2 text-sm border border-white/10" />
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
                <div key={s.id} className="bg-black/30 rounded-lg p-3 border border-[oklch(0.7_0.19_260/0.5)] space-y-2">
                  <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="w-full bg-black/40 rounded px-2 py-1.5 text-sm border border-white/10" />
                  <input value={editForm.contact} onChange={(e) => setEditForm({ ...editForm, contact: e.target.value })} className="w-full bg-black/40 rounded px-2 py-1.5 text-xs border border-white/10" />
                  <input value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })} className="w-full bg-black/40 rounded px-2 py-1.5 text-xs border border-white/10" />
                  <div className="flex gap-2">
                    <button onClick={async () => { await updateSupplier(s.id, editForm); setEditingId(null); }} className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-[oklch(0.78_0.2_155/0.2)] border border-[oklch(0.78_0.2_155/0.5)] text-[oklch(0.78_0.2_155)]"><Save className="w-3 h-3" /> Save</button>
                    <button onClick={() => setEditingId(null)} className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-white/5 border border-white/10"><X className="w-3 h-3" /> Cancel</button>
                  </div>
                </div>
              );
            }
            return (
              <div key={s.id} className="bg-black/30 rounded-lg p-3 border border-white/5 flex items-center justify-between">
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
        <button onClick={() => setShowAdd((v) => !v)} className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10">
          <Plus className="w-4 h-4" /> Add Template
        </button>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Templates for recurring costs (rent, salaries, utilities). Log the actual payment each month with "Log Payment" — that's what hits the ledger and P&amp;L, not the template itself.
      </p>

      {showAdd && (
        <div className="mb-4 p-4 rounded-lg bg-black/30 border border-white/5 grid grid-cols-1 md:grid-cols-3 gap-2">
          <input placeholder="Name (e.g. Rent)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="bg-black/40 rounded px-3 py-2 text-sm border border-white/10" />
          <input type="number" placeholder="Monthly amount" value={form.amount} onChange={(e) => setForm({ ...form, amount: +e.target.value })} className="bg-black/40 rounded px-3 py-2 text-sm border border-white/10" />
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
            <div key={e.id} className="bg-black/30 rounded-lg p-3 border border-white/5">
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
                  <button onClick={() => setPayingId(null)} className="text-xs px-2 py-1.5 rounded bg-white/5 border border-white/10">Cancel</button>
                </div>
              ) : (
                <button onClick={() => setPayingId(e.id)} className="mt-2 w-full text-xs py-1.5 rounded bg-white/5 border border-white/10 hover:bg-white/10">Log Payment</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
