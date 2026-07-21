import { LayoutDashboard, Gamepad2, Package, Users, LogOut, FileBarChart, ShoppingCart, Settings2 } from "lucide-react";
import { useStore } from "@/lib/glitch-store";
import logo from "@/assets/glitch-logo.jpg";

export type View = "dashboard" | "rooms" | "inventory" | "procurement" | "setup" | "users" | "reports";

const items: { id: View; label: string; icon: React.ComponentType<{ className?: string }>; adminOnly?: boolean }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "rooms", label: "Rooms", icon: Gamepad2 },
  { id: "procurement", label: "Procurement", icon: ShoppingCart },
  { id: "inventory", label: "Inventory", icon: Package, adminOnly: true },
  { id: "setup", label: "Setup", icon: Settings2, adminOnly: true },
  { id: "reports", label: "Reports", icon: FileBarChart, adminOnly: true },
  { id: "users", label: "Users", icon: Users, adminOnly: true },
];

export function Sidebar({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  const { state, logout } = useStore();
  const isAdmin = state.currentUser?.role === "admin";

  return (
    <aside className="no-print fixed left-0 top-0 h-screen w-64 glass-strong border-r border-white/10 flex flex-col z-30">
      <div className="p-6 flex items-center gap-3 border-b border-white/5">
        <img src={logo} alt="GLITCH" className="w-11 h-11 rounded-lg object-cover ring-1 ring-[oklch(0.82_0.16_85/0.5)]" />
        <div>
          <div className="font-bold tracking-widest text-gradient-gold text-lg leading-tight">GLITCH</div>
          <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Lounge OS</div>
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {items.filter((i) => !i.adminOnly || isAdmin).map((item) => {
          const Icon = item.icon;
          const active = view === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onChange(item.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium tracking-wide transition-all group ${
                active
                  ? "bg-[oklch(0.7_0.19_260/0.15)] text-white border border-[oklch(0.7_0.19_260/0.5)] shadow-[0_0_20px_oklch(0.7_0.19_260/0.35)]"
                  : "text-muted-foreground hover:text-white hover:bg-white/5"
              }`}
            >
              <Icon className={`w-4 h-4 ${active ? "text-[oklch(0.85_0.16_200)]" : ""}`} />
              <span>{item.label}</span>
              {active && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-[oklch(0.85_0.16_200)] shadow-[0_0_10px_oklch(0.85_0.16_200)]" />}
            </button>
          );
        })}
      </nav>

      <div className="p-4 border-t border-white/5 space-y-3">
        <div className="flex items-center gap-3 px-2">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[oklch(0.7_0.19_260)] to-[oklch(0.65_0.24_305)] flex items-center justify-center text-sm font-bold text-white">
            {state.currentUser?.username[0].toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium truncate">{state.currentUser?.username}</div>
            <div className="text-[10px] uppercase tracking-widest text-[oklch(0.85_0.16_200)]">{state.currentUser?.role}</div>
          </div>
        </div>
        <button
          onClick={logout}
          className="w-full flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm text-muted-foreground hover:text-white hover:bg-[oklch(0.62_0.24_25/0.15)] hover:border-[oklch(0.62_0.24_25/0.4)] border border-transparent transition"
        >
          <LogOut className="w-4 h-4" /> Logout
        </button>
      </div>
    </aside>
  );
}
