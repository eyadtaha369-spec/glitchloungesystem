import { useState } from "react";
import { LayoutDashboard, Gamepad2, Package, Users, LogOut, FileBarChart, ShoppingCart, Settings2, ShieldAlert, Activity, Sofa, UserCog, Languages, Receipt, Wifi, WifiOff, RefreshCw, Menu, X } from "lucide-react";
import { useStore } from "@/lib/glitch-store";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import type { TranslationKey } from "@/lib/i18n/translations";
import logo from "@/assets/glitch-logo.jpg";

export type View = "dashboard" | "rooms" | "lounge" | "inventory" | "procurement" | "unpaidExpenses" | "staffOrders" | "setup" | "users" | "reports" | "voids" | "audit";

const items: { id: View; labelKey: TranslationKey; icon: React.ComponentType<{ className?: string }>; adminOnly?: boolean }[] = [
  { id: "dashboard", labelKey: "nav.dashboard", icon: LayoutDashboard, adminOnly: true },
  { id: "rooms", labelKey: "nav.rooms", icon: Gamepad2 },
  { id: "lounge", labelKey: "nav.lounge", icon: Sofa },
  { id: "procurement", labelKey: "nav.procurement", icon: ShoppingCart },
  { id: "unpaidExpenses", labelKey: "nav.unpaidExpenses", icon: Receipt },
  { id: "staffOrders", labelKey: "nav.staffOrders", icon: UserCog },
  { id: "inventory", labelKey: "nav.inventory", icon: Package, adminOnly: true },
  { id: "voids", labelKey: "nav.voidLedger", icon: ShieldAlert, adminOnly: true },
  { id: "audit", labelKey: "nav.auditTrail", icon: Activity, adminOnly: true },
  { id: "setup", labelKey: "nav.setup", icon: Settings2, adminOnly: true },
  { id: "reports", labelKey: "nav.reports", icon: FileBarChart, adminOnly: true },
  { id: "users", labelKey: "nav.users", icon: Users, adminOnly: true },
];

export function Sidebar({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  const { state, logout } = useStore();
  const { t, lang, toggleLang } = useLanguage();
  const isAdmin = state.currentUser?.role === "admin";
  const [mobileOpen, setMobileOpen] = useState(false);

  const selectView = (v: View) => {
    onChange(v);
    setMobileOpen(false); // picking a page closes the drawer on mobile
  };

  return (
    <>
      {/* Hamburger — mobile only, fixed so it's reachable from any scroll position */}
      <button
        onClick={() => setMobileOpen(true)}
        className="no-print md:hidden fixed top-3 start-3 z-40 w-11 h-11 rounded-lg glass-strong border border-black/10 flex items-center justify-center"
        aria-label="Open menu"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Backdrop — mobile only, tapping it closes the drawer same as the X */}
      {mobileOpen && (
        <div className="no-print md:hidden fixed inset-0 z-30 bg-black/60 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
      )}

      <aside
        className={`no-print fixed start-0 top-0 h-screen w-64 glass-strong border-e border-black/10 flex flex-col z-30 transition-transform duration-200 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        } md:translate-x-0`}
      >
        <div className="p-6 flex items-center gap-3 border-b border-black/8">
          <img src={logo} alt="GLITCH" className="w-11 h-11 rounded-lg object-cover ring-1 ring-black/50" />
          <div>
            <div className="font-bold tracking-widest text-gradient-gold text-lg leading-tight">GLITCH</div>
            <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Lounge OS</div>
          </div>
          <button onClick={() => setMobileOpen(false)} className="md:hidden ms-auto w-8 h-8 flex items-center justify-center text-muted-foreground" aria-label="Close menu">
            <X className="w-5 h-5" />
          </button>
        </div>

      <div className="px-6 py-3 border-b border-black/8">
        <button
          onClick={toggleLang}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-black/5 border border-black/10 hover:bg-black/8 text-xs font-bold uppercase tracking-widest"
          title={lang === "en" ? "التبديل إلى العربية" : "Switch to English"}
        >
          <Languages className="w-3.5 h-3.5" />
          {lang === "en" ? "العربية" : "English"}
        </button>
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {items.filter((i) => !i.adminOnly || isAdmin).map((item) => {
          const Icon = item.icon;
          const active = view === item.id;
          return (
            <button
              key={item.id}
              onClick={() => selectView(item.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium tracking-wide transition-all group ${
                active
                  ? "bg-[oklch(0.7_0.19_260/0.15)] text-[#2b2416] border border-[oklch(0.7_0.19_260/0.5)] shadow-[0_0_20px_oklch(0.7_0.19_260/0.35)]"
                  : "text-muted-foreground hover:text-[#2b2416] hover:bg-black/5"
              }`}
            >
              <Icon className={`w-4 h-4 ${active ? "text-[oklch(0.7_0.19_260)]" : ""}`} />
              <span>{t(item.labelKey)}</span>
              {active && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-[oklch(0.7_0.19_260)] shadow-[0_0_10px_oklch(0.7_0.19_260)]" />}
            </button>
          );
        })}
      </nav>

      <div className="p-4 border-t border-black/8 space-y-3">
        <SyncStatusBadge />
        <div className="flex items-center gap-3 px-2">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[oklch(0.7_0.19_260)] to-[oklch(0.65_0.24_305)] flex items-center justify-center text-sm font-bold text-[#2b2416]">
            {state.currentUser?.username[0].toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium truncate">{state.currentUser?.username}</div>
            <div className="text-[10px] uppercase tracking-widest text-[oklch(0.7_0.19_260)]">{state.currentUser?.role}</div>
          </div>
        </div>
        <button
          onClick={logout}
          className="w-full flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm text-muted-foreground hover:text-[#2b2416] hover:bg-[oklch(0.62_0.24_25/0.15)] hover:border-[oklch(0.62_0.24_25/0.4)] border border-transparent transition"
        >
          <LogOut className="w-4 h-4" /> {t("nav.logout")}
        </button>
      </div>
    </aside>
    </>
  );
}

function SyncStatusBadge() {
  const { connectionStatus, lastSyncedAt } = useStore();

  // Real CSS oklch() syntax for inline styles — space-separated with
  // the alpha channel inside the parens (oklch(L C H / A)), NOT the
  // underscore-and-trailing-slash convention Tailwind class names use
  // (that's a class-name escaping scheme, invalid as a raw CSS value).
  const config = {
    synced: { icon: Wifi, label: "Synced", solid: "oklch(0.78 0.2 155)", tint: "oklch(0.78 0.2 155 / 0.1)" },
    syncing: { icon: RefreshCw, label: "Syncing...", solid: "oklch(0.7 0.19 260)", tint: "oklch(0.7 0.19 260 / 0.1)" },
    offline: { icon: WifiOff, label: "Offline", solid: "oklch(0.62 0.24 25)", tint: "oklch(0.62 0.24 25 / 0.1)" },
  }[connectionStatus];

  const Icon = config.icon;
  const ago = lastSyncedAt ? Math.max(0, Math.round((Date.now() - lastSyncedAt) / 1000)) : null;
  const agoText = ago === null ? "" : ago < 5 ? "just now" : ago < 60 ? `${ago}s ago` : `${Math.round(ago / 60)}m ago`;

  return (
    <div
      className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs"
      style={{ backgroundColor: config.tint, border: `1px solid ${config.solid}` }}
      title={connectionStatus === "offline" ? "Couldn't reach the backend — check your connection." : lastSyncedAt ? `Last synced ${agoText}` : ""}
    >
      <Icon className={`w-3.5 h-3.5 shrink-0 ${connectionStatus === "syncing" ? "animate-spin" : ""}`} style={{ color: config.solid }} />
      <span className="font-semibold" style={{ color: config.solid }}>{config.label}</span>
      {connectionStatus === "synced" && agoText && <span className="text-muted-foreground ml-auto">{agoText}</span>}
    </div>
  );
}
