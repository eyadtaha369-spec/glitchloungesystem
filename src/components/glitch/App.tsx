import { useEffect, useState } from "react";
import { StoreProvider, useStore } from "@/lib/glitch-store";
import { Login } from "./Login";
import { Sidebar, type View } from "./Sidebar";
import { Dashboard } from "./Dashboard";
import { RoomsPage } from "./Rooms";
import { InventoryPage } from "./Inventory";
import { UsersPage } from "./Users";
import { Lock } from "lucide-react";

function Shell() {
  const { state } = useStore();
  const [view, setView] = useState<View>("dashboard");
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  if (!mounted) return null;
  if (!state.currentUser) return <Login />;

  const isAdmin = state.currentUser.role === "admin";
  const locked = !isAdmin && (view === "inventory" || view === "users");

  return (
    <div className="min-h-screen">
      <Sidebar view={view} onChange={setView} />
      <main className="pl-64 min-h-screen">
        <div className="p-6 lg:p-10 max-w-[1600px] mx-auto">
          {locked ? (
            <div className="glass rounded-2xl p-12 text-center border border-[oklch(0.62_0.24_25/0.4)]">
              <Lock className="w-10 h-10 mx-auto text-[oklch(0.75_0.22_25)]" />
              <h2 className="mt-4 text-xl font-semibold">Restricted Zone</h2>
              <p className="text-sm text-muted-foreground mt-2 font-mono uppercase tracking-widest">Admin credentials required</p>
            </div>
          ) : view === "dashboard" ? <Dashboard />
            : view === "rooms" ? <RoomsPage />
            : view === "inventory" ? <InventoryPage />
            : <UsersPage />}
        </div>
      </main>
    </div>
  );
}

export function GlitchApp() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
