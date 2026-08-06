import { useEffect, useState } from "react";
import { useStore, captureGeolocation, type GeoResult } from "@/lib/glitch-store";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { MapPin, ShieldOff, Unlock, RotateCcw, Clock, Languages } from "lucide-react";
import logo from "@/assets/glitch-logo.jpg";

// Blocks the ENTIRE app (no Sidebar, no Rooms, nothing) for a cashier until
// they successfully start a shift from right here. Location is only
// required/enforced when the admin has actually turned on geofencing in
// Setup — otherwise a device that can't get a location fix (permission
// denied, no GPS, etc.) would never be able to open a shift at all.
export function Gatekeeper() {
  const { state, openShift } = useStore();
  const { t, lang, toggleLang } = useLanguage();
  const [geo, setGeo] = useState<GeoResult | null>(null);
  const [checking, setChecking] = useState(state.geofenceEnabled);
  const [openingBalance, setOpeningBalance] = useState("0");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const tryLocate = async () => {
    setChecking(true);
    setErr(null);
    const result = await captureGeolocation();
    setGeo(result);
    setChecking(false);
  };

  useEffect(() => {
    if (state.geofenceEnabled) {
      tryLocate();
    } else {
      // Still try to attach coordinates if easily available (nice-to-have
      // for the attendance log), but never block on it.
      captureGeolocation().then(setGeo);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStart = async () => {
    if (state.geofenceEnabled && !geo?.ok) return;
    setErr(null);
    setSubmitting(true);
    try {
      const res = await openShift(parseFloat(openingBalance) || 0, geo?.ok ? { lat: geo.lat, lng: geo.lng } : null);
      if (!res.ok) setErr(res.error ?? "Could not start shift");
    } finally {
      setSubmitting(false);
    }
  };

  const locationBlocked = state.geofenceEnabled && geo !== null && !geo.ok;
  const readyToStart = !state.geofenceEnabled || geo?.ok;

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative">
      <button
        onClick={toggleLang}
        className="absolute top-6 end-6 flex items-center gap-2 px-3 py-2 rounded-lg bg-black/5 border border-black/10 hover:bg-black/8 text-xs font-bold uppercase tracking-widest"
      >
        <Languages className="w-3.5 h-3.5" />
        {lang === "en" ? "العربية" : "English"}
      </button>

      <div className="w-full max-w-md glass-strong rounded-2xl border border-[oklch(0.7_0.19_260/0.4)] p-8">
        <div className="flex flex-col items-center text-center mb-6">
          <img src={logo} alt="GLITCH" className="w-16 h-16 rounded-full mb-3" />
          <h1 className="text-2xl font-bold tracking-tight">{t("shift.openShiftRequired")}</h1>
          <p className="text-xs text-muted-foreground mt-2 font-mono uppercase tracking-widest">
            {state.currentUser?.username}
          </p>
          <div className="flex items-center gap-1.5 mt-2 text-xs text-muted-foreground font-mono">
            <Clock className="w-3.5 h-3.5" /> {now.toLocaleString()}
          </div>
        </div>

        {checking && (
          <div className="flex flex-col items-center gap-3 py-8">
            <MapPin className="w-8 h-8 text-[oklch(0.7_0.19_260)] animate-pulse" />
            <p className="text-sm text-muted-foreground">{t("shift.checkingLocation")}</p>
          </div>
        )}

        {!checking && locationBlocked && (
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <ShieldOff className="w-10 h-10 text-[oklch(0.62_0.24_25)]" />
            <div>
              <h2 className="font-semibold text-lg">{t("shift.locationAccessRequired")}</h2>
              <p className="text-sm text-muted-foreground mt-2">
                {geo?.reason === "denied"
                  ? t("shift.locationDenied")
                  : geo?.reason === "unsupported"
                    ? t("shift.locationUnsupported")
                    : t("shift.locationFailed")}
              </p>
            </div>
            <button
              onClick={tryLocate}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-gradient-to-r from-[oklch(0.7_0.19_260)] to-[oklch(0.65_0.24_305)] text-[#2b2416] font-semibold text-sm"
            >
              <RotateCcw className="w-4 h-4" /> {t("shift.tryAgain")}
            </button>
          </div>
        )}

        {!checking && readyToStart && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground text-center">
              {t("shift.enterOpeningCash")}
            </p>
            <div>
              <label className="text-xs uppercase tracking-widest text-muted-foreground">
                {t("shift.openingBalance")}
              </label>
              <input
                type="number" step="0.01" autoFocus value={openingBalance}
                onChange={(e) => setOpeningBalance(e.target.value)}
                className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-3 text-lg font-mono outline-none focus:border-[oklch(0.7_0.19_260)] text-center"
              />
            </div>
            {err && <div className="text-sm text-[oklch(0.62_0.24_25)] text-center">{err}</div>}
            <button
              onClick={handleStart}
              disabled={submitting}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-lg bg-gradient-to-r from-[oklch(0.78_0.2_155)] to-[oklch(0.7_0.2_170)] text-black font-bold uppercase tracking-wider text-sm shadow-[0_0_25px_oklch(0.78_0.2_155/0.4)] disabled:opacity-60"
            >
              <Unlock className="w-4 h-4" /> {submitting ? t("shift.verifyingLocation") : t("shift.openShift")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
