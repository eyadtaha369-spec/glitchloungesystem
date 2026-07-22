import { useEffect, useState } from "react";
import { useStore, captureGeolocation, type GeoResult } from "@/lib/glitch-store";
import { MapPin, ShieldOff, Unlock, RotateCcw } from "lucide-react";
import logo from "@/assets/glitch-logo.jpg";

// Blocks the ENTIRE app (no Sidebar, no Rooms, nothing) for a cashier until
// they successfully start a shift from right here. Location permission is
// mandatory — if it's denied there is no way through this screen except
// granting it and retrying.
export function Gatekeeper() {
  const { state, openShift } = useStore();
  const [geo, setGeo] = useState<GeoResult | null>(null);
  const [checking, setChecking] = useState(true);
  const [openingBalance, setOpeningBalance] = useState("0");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const tryLocate = async () => {
    setChecking(true);
    setErr(null);
    const result = await captureGeolocation();
    setGeo(result);
    setChecking(false);
  };

  useEffect(() => {
    tryLocate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStart = async () => {
    if (!geo?.ok) return;
    setErr(null);
    setSubmitting(true);
    try {
      const res = await openShift(parseFloat(openingBalance) || 0, { lat: geo.lat, lng: geo.lng });
      if (!res.ok) setErr(res.error ?? "Could not start shift");
    } finally {
      setSubmitting(false);
    }
  };

  const locationBlocked = geo !== null && !geo.ok;

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md glass-strong rounded-2xl border border-[oklch(0.7_0.19_260/0.4)] p-8">
        <div className="flex flex-col items-center text-center mb-6">
          <img src={logo} alt="GLITCH" className="w-16 h-16 rounded-full mb-3" />
          <h1 className="text-2xl font-bold tracking-tight">Shift Gatekeeper</h1>
          <p className="text-xs text-muted-foreground mt-1 font-mono uppercase tracking-widest">
            {state.currentUser?.username}
          </p>
        </div>

        {checking && (
          <div className="flex flex-col items-center gap-3 py-8">
            <MapPin className="w-8 h-8 text-[oklch(0.85_0.16_200)] animate-pulse" />
            <p className="text-sm text-muted-foreground">Checking your location...</p>
          </div>
        )}

        {!checking && locationBlocked && (
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <ShieldOff className="w-10 h-10 text-[oklch(0.75_0.22_25)]" />
            <div>
              <h2 className="font-semibold text-lg">Location Access Required</h2>
              <p className="text-sm text-muted-foreground mt-2">
                {geo?.reason === "denied"
                  ? "You've blocked location access for this site. You cannot open or close a shift — or reach the POS at all — until you allow it."
                  : geo?.reason === "unsupported"
                    ? "This browser/device doesn't support location services, which are required to open a shift."
                    : "Couldn't get a location fix. Make sure location services are on and try again."}
              </p>
            </div>
            <button
              onClick={tryLocate}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-gradient-to-r from-[oklch(0.7_0.19_260)] to-[oklch(0.65_0.24_305)] text-white font-semibold text-sm"
            >
              <RotateCcw className="w-4 h-4" /> Try Again
            </button>
          </div>
        )}

        {!checking && geo?.ok && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground text-center">
              Enter your starting cash drawer amount to begin your shift. None of the previous shift's numbers will be visible to you.
            </p>
            <div>
              <label className="text-xs uppercase tracking-widest text-muted-foreground">Opening Balance</label>
              <input
                type="number" step="0.01" autoFocus value={openingBalance}
                onChange={(e) => setOpeningBalance(e.target.value)}
                className="mt-1 w-full bg-black/40 border border-white/10 rounded-lg px-3 py-3 text-lg font-mono outline-none focus:border-[oklch(0.7_0.19_260)] text-center"
              />
            </div>
            {err && <div className="text-sm text-[oklch(0.75_0.22_25)] text-center">{err}</div>}
            <button
              onClick={handleStart}
              disabled={submitting}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-lg bg-gradient-to-r from-[oklch(0.78_0.2_155)] to-[oklch(0.7_0.2_170)] text-black font-bold uppercase tracking-wider text-sm shadow-[0_0_25px_oklch(0.78_0.2_155/0.4)] disabled:opacity-60"
            >
              <Unlock className="w-4 h-4" /> {submitting ? "Verifying Location..." : "Start Shift"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
