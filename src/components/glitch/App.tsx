import { useEffect, useState } from "react";
import { StoreProvider, useStore } from "@/lib/glitch-store";
import { LanguageProvider, useLanguage } from "@/lib/i18n/LanguageContext";
import receiptLogo from "@/assets/glitch-logo-mark.png";
import { Login } from "./Login";
import { Sidebar, type View } from "./Sidebar";
import { Dashboard } from "./Dashboard";
import { RoomsPage, LoungePage } from "./Rooms";
import { InventoryPage } from "./Inventory";
import { UsersPage } from "./Users";
import { ReportsPage } from "./Reports";
import { ProcurementPage } from "./Procurement";
import { UnpaidExpensesPage } from "./UnpaidExpenses";
import { SetupPage } from "./Setup";
import { VoidsPage } from "./Voids";
import { AuditLogPage } from "./AuditLog";
import { StaffOrdersPage } from "./StaffOrders";
import { Gatekeeper } from "./Gatekeeper";
import { Lock } from "lucide-react";

function Shell() {
  const { state, ready, activeShift } = useStore();
  const { dir, t } = useLanguage();
  const [view, setView] = useState<View>("dashboard");

  // Warm the browser's image cache for the receipt logo as early as
  // possible — the actual bug this fixes: window.print() firing before a
  // freshly-created <img> has finished loading prints with that image
  // completely blank. Preloading here means by the time anyone actually
  // opens a receipt/KOT modal, the image already has a decoded cache
  // entry and renders instantly instead of racing the print call.
  useEffect(() => {
    const img = new Image();
    img.src = receiptLogo;
  }, []);

  if (!ready) return null;
  if (!state.currentUser) return <Login />;

  const isAdmin = state.currentUser.role === "admin";

  // Cashiers cannot see or reach ANY POS screen — Rooms, Dashboard, nothing —
  // until they've started a geofence-verified shift right here.
  if (!isAdmin && !activeShift) return <Gatekeeper />;

  const locked = !isAdmin && (view === "inventory" || view === "users" || view === "reports" || view === "setup" || view === "voids" || view === "audit");

  return (
    <div className="min-h-screen" dir={dir}>
      <Sidebar view={view} onChange={setView} />
      <main className="ps-64 min-h-screen">
        <div className="p-6 lg:p-10 max-w-[1600px] mx-auto">
          {locked ? (
            <div className="glass rounded-2xl p-12 text-center border border-[oklch(0.62_0.24_25/0.4)]">
              <Lock className="w-10 h-10 mx-auto text-[oklch(0.62_0.24_25)]" />
              <h2 className="mt-4 text-xl font-semibold">{t("common.restrictedZone")}</h2>
              <p className="text-sm text-muted-foreground mt-2 font-mono uppercase tracking-widest">{t("common.adminCredentialsRequired")}</p>
            </div>
          ) : view === "dashboard" ? <Dashboard />
            : view === "rooms" ? <RoomsPage />
            : view === "lounge" ? <LoungePage />
            : view === "inventory" ? <InventoryPage />
            : view === "procurement" ? <ProcurementPage />
            : view === "unpaidExpenses" ? <UnpaidExpensesPage />
            : view === "setup" ? <SetupPage />
            : view === "reports" ? <ReportsPage />
            : view === "voids" ? <VoidsPage />
            : view === "audit" ? <AuditLogPage />
            : view === "staffOrders" ? <StaffOrdersPage />
            : <UsersPage />}
        </div>
      </main>
    </div>
  );
}

export function GlitchApp() {
  return (
    <LanguageProvider>
      <StoreProvider>
        <Shell />
      </StoreProvider>
    </LanguageProvider>
  );
}
