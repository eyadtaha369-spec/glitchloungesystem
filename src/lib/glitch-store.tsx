import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import type {
  Role,
  PublicAccount,
  StockItem,
  MenuItem,
  Room,
  Session,
  AppState,
  Shift,
  PaymentMethod,
  RawMaterial,
  Supplier,
  RecurringExpense,
  LedgerEntry,
  VoidRequest,
  VoidReason,
  AuditLogEntry,
  StaffOrder,
  RestockLogEntry,
  PaymentSource,
  BusinessDay,
} from "./types";
import { loginFn, logoutFn, sessionFn } from "@/backend/auth";
import { getAccountsFn, addAccountFn, updateAccountFn, deleteAccountFn } from "@/backend/accounts";
import {
  getStateFn,
  startRoomFn,
  endRoomFn,
  logWasteMarketingFn,
  nextKotNumberFn,
  extendRoomTimeFn,
  pauseRoomFn,
  resumeRoomFn,
  addOrderFn,
  setOrderLineQtyFn,
  setOrderLineNoteFn,
  setRoomRateFn,
  renameRoomFn,
  addMenuItemFn,
  updateMenuItemFn,
  deleteMenuItemFn,
  setActualCashFn,
  openShiftFn,
  endShiftFn,
  forceEndShiftFn,
  closeBusinessDayFn,
  resetForProductionFn,
  getBusinessDaysFn,
  transferZoneFn,
  logSplitInterfaceOpenedFn,
  splitBillFn,
} from "@/backend/state";
import {
  getRawMaterialsFn, addRawMaterialFn, updateRawMaterialFn, deleteRawMaterialFn, adjustStockFn, setAbsoluteStockFn,
  restockMaterialFn, getRestockLogFn, setActualStockFn,
  importMenuCatalogFn,
  getSuppliersFn, addSupplierFn, updateSupplierFn, deleteSupplierFn,
  getRecurringExpensesFn, addRecurringExpenseFn, updateRecurringExpenseFn, deleteRecurringExpenseFn,
  logRecurringExpensePaymentFn,
  submitPurchaseFn,
  getLedgerFn, getPendingApprovalsFn, approvePurchaseFn, rejectPurchaseFn,
} from "@/backend/finance";
import {
  requestVoidFn, getVoidRequestsFn, approveVoidFn, denyVoidFn, setFraudThresholdFn, setGeofenceConfigFn, verifyAdminAuthFn, reconcileUnapprovedVoidFn,
} from "@/backend/void";
import { getActivityLogsFn } from "@/backend/audit";
import { submitStaffOrderFn, getStaffOrdersFn } from "@/backend/staffOrders";

export type {
  Role, StockItem, MenuItem, Room, Session, AppState, Shift, PaymentMethod,
  RawMaterial, Supplier, RecurringExpense, LedgerEntry, VoidRequest, VoidReason, AuditLogEntry, AuditRiskLevel,
  MenuCategory, StockAdjustmentReason, StaffOrder, RestockLogEntry, BusinessDay, PaymentSource, WasteMarketingReason,
} from "./types";
export { VOID_REASON_LABELS, WASTE_MARKETING_REASON_LABELS, MENU_CATEGORIES } from "./types";
export type CurrentUser = { username: string; role: Role };

interface State extends AppState {
  currentUser: CurrentUser | null;
  accounts: PublicAccount[];
  materials: RawMaterial[];
  suppliers: Supplier[];
  recurringExpenses: RecurringExpense[];
  ledger: LedgerEntry[];
  pendingApprovals: LedgerEntry[];
  voidRequests: VoidRequest[];
  activityLogs: AuditLogEntry[];
  staffOrders: StaffOrder[];
  restockLog: RestockLogEntry[];
}

const emptyAppState: AppState = {
  rooms: [],
  stock: [],
  menu: [],
  sessions: [],
  activity: [],
  cashRecords: [],
  actualCashInput: 0,
  shifts: [],
  activeShiftId: null,
  businessDayId: null,
  businessDays: [],
  orderCounter: 0,
  fraudThresholdPercent: 2,
  geofenceEnabled: false,
  cafeLat: 0,
  cafeLng: 0,
  geofenceRadiusMeters: 50,
  pendingVoidCountForActiveShift: 0,
};

interface StoreContextValue {
  state: State;
  ready: boolean;
  login: (u: string, p: string) => Promise<boolean>;
  logout: () => Promise<void>;
  addAccount: (a: { username: string; password: string; role: Role }) => Promise<boolean>;
  updateAccount: (
    originalUsername: string,
    patch: { username?: string; password?: string; role?: Role },
  ) => Promise<{ ok: boolean; error?: string }>;
  deleteAccount: (username: string) => Promise<void>;
  setRoomRate: (roomId: string, singleRate: number, multiRate: number) => Promise<void>;
  renameRoom: (roomId: string, name: string) => Promise<{ ok: boolean; error?: string }>;
  startRoom: (roomId: string, rateMode?: "single" | "multi") => Promise<{ ok: boolean; error?: string }>;
  endRoom: (roomId: string, splitBill: boolean, paymentMethod: PaymentMethod, cashAmount?: number, secondaryAmount?: number, frozenAt?: number, discount?: { timeDiscountType?: "fixed" | "percent"; timeDiscountValue?: number; ordersDiscountType?: "fixed" | "percent"; ordersDiscountValue?: number }) => Promise<{ session: Session | null; error?: string }>;
  pauseRoom: (roomId: string) => Promise<{ ok: boolean; error?: string }>;
  logWasteMarketing: (roomId: string, reason: string, note?: string) => Promise<{ ok: boolean; error?: string }>;
  nextKotNumber: () => Promise<{ ok: boolean; error?: string; number?: number }>;
  extendRoomTime: (roomId: string, deltaSec: number) => Promise<{ ok: boolean; error?: string }>;
  resumeRoom: (roomId: string) => Promise<{ ok: boolean; error?: string }>;
  addOrder: (roomId: string, menuItemId: string, qty: number) => Promise<{ ok: boolean; error?: string }>;
  setOrderLineQty: (roomId: string, menuItemId: string, qty: number) => Promise<{ ok: boolean; error?: string }>;
  setOrderLineNote: (roomId: string, menuItemId: string, notes: string) => Promise<{ ok: boolean; error?: string }>;
  removeOrderLine: (roomId: string, menuItemId: string) => Promise<{ ok: boolean; error?: string }>;
  addMenuItem: (m: MenuItem) => Promise<void>;
  updateMenuItem: (id: string, patch: Partial<MenuItem>) => Promise<void>;
  deleteMenuItem: (id: string) => Promise<void>;
  setActualCash: (n: number) => Promise<void>;
  canFulfill: (menuItemId: string, qty: number) => boolean;
  computeElapsed: (room: Room) => number;
  isPending: (key: string) => boolean;
  activeShift: Shift | null;
  openShift: (openingBalance: number, coords: { lat: number; lng: number } | null) => Promise<{ ok: boolean; error?: string }>;
  endShift: (actualCash: number, coords: { lat: number; lng: number } | null) => Promise<{ ok: boolean; error?: string; closedShift?: Shift }>;
  forceEndShift: (actualCash?: number) => Promise<void>;
  closeBusinessDay: () => Promise<{ ok: boolean; error?: string }>;
  resetForProduction: (password: string) => Promise<{ ok: boolean; error?: string }>;
  setFraudThreshold: (percent: number) => Promise<void>;
  setGeofenceConfig: (cfg: { enabled: boolean; lat: number; lng: number; radiusMeters: number }) => Promise<void>;

  // Raw materials / suppliers / recurring expense templates [admin CRUD]
  addRawMaterial: (m: { name: string; unit: string; minStockAlert: number }) => Promise<void>;
  adjustStock: (materialId: string, deltaQty: number, reason: "waste" | "correction" | "opening_balance", note?: string) => Promise<{ ok: boolean; error?: string }>;
  setAbsoluteStock: (materialId: string, targetQty: number, note?: string) => Promise<{ ok: boolean; error?: string; before?: number; after?: number; delta?: number }>;
  restockMaterial: (materialId: string, qtyAdded: number, unitCost?: number) => Promise<{ ok: boolean; error?: string }>;
  setActualStock: (materialId: string, actualStock: number) => Promise<{ ok: boolean; error?: string; variance?: number }>;
  refreshRestockLog: () => Promise<void>;
  importMenuCatalog: () => Promise<{ ok: boolean; materialsAdded: number; materialsPriced: number; itemsAdded: number; itemsUpdated: number; itemsWithoutRecipe: string[] }>;
  updateRawMaterial: (id: string, patch: Partial<RawMaterial>) => Promise<void>;
  deleteRawMaterial: (id: string) => Promise<void>;
  addSupplier: (s: { name: string; contact: string; category: string }) => Promise<void>;
  updateSupplier: (id: string, patch: Partial<Supplier>) => Promise<void>;
  deleteSupplier: (id: string) => Promise<void>;
  addRecurringExpense: (e: { name: string; amount: number; active: boolean }) => Promise<void>;
  updateRecurringExpense: (id: string, patch: Partial<RecurringExpense>) => Promise<void>;
  deleteRecurringExpense: (id: string) => Promise<void>;
  logRecurringExpensePayment: (e: { name: string; amount: number; description?: string }) => Promise<void>;

  // Procurement — photo mandatory; cashier submissions are pending until admin approves.
  submitPurchase: (p: {
    purchaseType: "stockedBatch" | "dailyFresh" | "midShiftPurchase";
    materialId: string;
    qty: number;
    unitCost: number;
    supplierId?: string;
    category?: string;
    description?: string;
    paymentSource: PaymentSource;
    receiptFile: File;
  }) => Promise<{ ok: boolean; error?: string; status?: string }>;
  approvePurchase: (ledgerId: string) => Promise<void>;
  rejectPurchase: (ledgerId: string, reason?: string) => Promise<void>;
  refreshLedger: () => Promise<void>;

  // Void workflow — cashiers request, admins auto-execute; requests only
  // affect the room's live order + inventory once approved.
  requestVoid: (v: { roomId: string; menuItemId: string; qty: number; reason: VoidReason; waiterName: string; approvingAdminUsername?: string; approvingAdminPassword?: string; routeUnapproved?: boolean }) => Promise<{ ok: boolean; error?: string }>;
  reconcileUnapprovedVoid: (voidId: string, action: "approve" | "flag_discrepancy", note?: string) => Promise<{ ok: boolean; error?: string }>;
  verifyAdminAuth: (adminUsername: string, adminPassword: string) => Promise<{ ok: boolean; adminUsername: string | null }>;
  approveVoid: (voidId: string) => Promise<{ ok: boolean; error?: string }>;
  denyVoid: (voidId: string) => Promise<void>;

  // Staff Orders & Consumption — standard menu prices for costing, but
  // routed to a Staff Consumption Expense, never retail revenue.
  submitStaffOrder: (params: { staffName: string; items: { menuItemId: string; qty: number }[] }) => Promise<{ ok: boolean; error?: string; staffOrder?: StaffOrder }>;
  refreshStaffOrders: () => Promise<void>;

  // Cross-zone transfer & interactive split
  transferZone: (sourceId: string, targetId: string, rateMode?: "single" | "multi") => Promise<{ ok: boolean; error?: string }>;
  openSplitInterface: (roomId: string) => Promise<void>;
  splitBill: (params: {
    roomId: string;
    mode: "items" | "amount";
    items?: { menuItemId: string; qty: number }[];
    customAmount?: number;
    paymentMethod: PaymentMethod;
    cashAmount?: number;
    secondaryAmount?: number;
  }) => Promise<{ ok: boolean; error?: string; session?: Session }>;
  refreshActivityLogs: () => Promise<void>;
  refreshVoidRequests: () => Promise<void>;
}

const StoreContext = createContext<StoreContextValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [appState, setAppState] = useState<AppState>(emptyAppState);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [accounts, setAccounts] = useState<PublicAccount[]>([]);
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [recurringExpenses, setRecurringExpenses] = useState<RecurringExpense[]>([]);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<LedgerEntry[]>([]);
  const [voidRequests, setVoidRequests] = useState<VoidRequest[]>([]);
  const [activityLogs, setActivityLogs] = useState<AuditLogEntry[]>([]);
  const [staffOrders, setStaffOrders] = useState<StaffOrder[]>([]);
  const [restockLog, setRestockLog] = useState<RestockLogEntry[]>([]);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState<Set<string>>(new Set());

  // Wraps any async action: marks `key` as pending immediately (so buttons
  // can show a spinner / disable themselves the instant they're clicked),
  // runs the real server call, then clears pending whether it succeeds or fails.
  const withPending = useCallback(async <T,>(key: string, fn: () => Promise<T>): Promise<T> => {
    setPending((prev) => new Set(prev).add(key));
    try {
      return await fn();
    } finally {
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }, []);

  const isPending = useCallback((key: string) => pending.has(key), [pending]);

  const refreshAccounts = useCallback(async (user: CurrentUser | null) => {
    if (user?.role === "admin") {
      try {
        setAccounts(await getAccountsFn());
      } catch {
        setAccounts([]);
      }
    } else {
      setAccounts([]);
    }
  }, []);

  // Materials/suppliers are read by both roles (procurement forms need
  // them); recurring expenses, ledger, the approval queue, and void
  // requests are admin-only.
  const refreshFinance = useCallback(async (user: CurrentUser | null) => {
    if (!user) {
      setMaterials([]); setSuppliers([]); setRecurringExpenses([]); setLedger([]); setPendingApprovals([]); setVoidRequests([]); setActivityLogs([]); setStaffOrders([]); setRestockLog([]);
      return;
    }
    try {
      const [mats, sups, restocks] = await Promise.all([getRawMaterialsFn(), getSuppliersFn(), getRestockLogFn()]);
      setMaterials(mats);
      setSuppliers(sups);
      setRestockLog(restocks);
    } catch { /* leave as-is */ }
    if (user.role === "admin") {
      try {
        const [exp, led, pend, voids, logs, staffOrds] = await Promise.all([
          getRecurringExpensesFn(), getLedgerFn(), getPendingApprovalsFn(), getVoidRequestsFn(), getActivityLogsFn(), getStaffOrdersFn(),
        ]);
        setRecurringExpenses(exp);
        setLedger(led);
        setPendingApprovals(pend);
        setVoidRequests(voids);
        setActivityLogs(logs);
        setStaffOrders(staffOrds);
      } catch { /* leave as-is */ }
    } else {
      setRecurringExpenses([]); setLedger([]); setPendingApprovals([]); setVoidRequests([]); setActivityLogs([]); setStaffOrders([]);
    }
  }, []);
  const refreshLedger: StoreContextValue["refreshLedger"] = async () => {
    if (currentUser?.role !== "admin") return;
    const [led, pend] = await Promise.all([getLedgerFn(), getPendingApprovalsFn()]);
    setLedger(led);
    setPendingApprovals(pend);
  };

  useEffect(() => {
    (async () => {
      try {
        const user = await sessionFn();
        setCurrentUser(user);
        if (user) {
          const [state] = await Promise.all([getStateFn(), refreshAccounts(user), refreshFinance(user)]);
          setAppState(state);
        }
      } finally {
        setReady(true);
      }
    })();
  }, [refreshAccounts, refreshFinance]);

  const login: StoreContextValue["login"] = async (u, p) => {
    return withPending("login", async () => {
      const res = await loginFn({ data: { username: u, password: p } });
      if (!res.ok) return false;
      const user = { username: res.username, role: res.role };
      setCurrentUser(user);
      const [state] = await Promise.all([getStateFn(), refreshAccounts(user), refreshFinance(user)]);
      setAppState(state);
      return true;
    });
  };

  const logout = async () => {
    await logoutFn();
    setCurrentUser(null);
    setAccounts([]);
    setMaterials([]); setSuppliers([]); setRecurringExpenses([]); setLedger([]); setPendingApprovals([]); setVoidRequests([]); setActivityLogs([]); setStaffOrders([]); setRestockLog([]);
    setAppState(emptyAppState);
  };

  const addAccount: StoreContextValue["addAccount"] = async (a) => {
    return withPending("addAccount", async () => {
      const res = await addAccountFn({ data: a });
      if (res.ok) await refreshAccounts(currentUser);
      return res.ok;
    });
  };
  const deleteAccount: StoreContextValue["deleteAccount"] = async (username) => {
    return withPending(`deleteAccount:${username}`, async () => {
      await deleteAccountFn({ data: { username } });
      await refreshAccounts(currentUser);
    });
  };
  const updateAccount: StoreContextValue["updateAccount"] = async (originalUsername, patch) => {
    return withPending(`updateAccount:${originalUsername}`, async () => {
      const res = await updateAccountFn({ data: { originalUsername, ...patch } });
      if (res.ok) {
        await refreshAccounts(currentUser);
        if (currentUser?.username === originalUsername) {
          setCurrentUser({
            username: patch.username?.trim() || currentUser.username,
            role: patch.role ?? currentUser.role,
          });
        }
      }
      return res;
    });
  };

  const setRoomRate: StoreContextValue["setRoomRate"] = async (roomId, singleRate, multiRate) => {
    return withPending(`setRoomRate:${roomId}`, async () => {
      setAppState((prev) => ({
        ...prev,
        rooms: prev.rooms.map((r) => (r.id === roomId ? { ...r, singleRate, multiRate } : r)),
      }));
      setAppState(await setRoomRateFn({ data: { roomId, singleRate, multiRate } }));
    });
  };
  const renameRoom: StoreContextValue["renameRoom"] = async (roomId, name) => {
    return withPending(`renameRoom:${roomId}`, async () => {
      try {
        const res = await renameRoomFn({ data: { roomId, name } });
        if (res.ok) setAppState(res.state);
        return { ok: res.ok, error: res.error };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Rename failed unexpectedly." };
      }
    });
  };
  const startRoom: StoreContextValue["startRoom"] = async (roomId, rateMode) => {
    return withPending(`startRoom:${roomId}`, async () => {
      const now = Date.now();
      setAppState((prev) => ({
        ...prev,
        rooms: prev.rooms.map((r) => {
          if (r.id !== roomId || r.status === "active") return r;
          const rate = r.zone === "room" ? (rateMode === "multi" ? r.multiRate : r.singleRate) : 0;
          return { ...r, status: "active", startedAt: now, orders: [], hourlyRate: rate, rateMode: r.zone === "room" ? (rateMode ?? null) : null };
        }),
      }));
      const res = await startRoomFn({ data: { roomId, rateMode } });
      setAppState(res.state);
      return { ok: res.ok, error: res.error };
    });
  };
  const endRoom: StoreContextValue["endRoom"] = async (roomId, splitBill, paymentMethod, cashAmount, secondaryAmount, frozenAt, discount) => {
    return withPending(`endRoom:${roomId}`, async () => {
      // No optimistic clear here — a mixed-payment split that doesn't sum
      // to the ticket total is rejected server-side, and the room must
      // stay exactly as it was so the cashier can correct the amounts.
      try {
        const res = await endRoomFn({ data: { roomId, splitBill, paymentMethod, cashAmount, secondaryAmount, frozenAt, ...discount } });
        setAppState(res.state);
        if (res.session) await refreshLedger();
        return { session: res.session, error: res.error };
      } catch (err) {
        // A server function that throws (network failure, or a mismatch
        // against a stale Apps Script deployment) would otherwise vanish
        // as a silent unhandled rejection — always surface something.
        return { session: null, error: err instanceof Error ? err.message : "Checkout failed unexpectedly. Please try again." };
      }
    });
  };
  const pauseRoom: StoreContextValue["pauseRoom"] = async (roomId) => {
    return withPending(`pauseRoom:${roomId}`, async () => {
      const now = Date.now();
      // Instant feedback — flip to paused locally right away; a failed
      // request just gets overwritten by the server's real state below,
      // which is an automatic rollback since setAppState always takes
      // the server's word as final once the response comes back.
      setAppState((prev) => ({
        ...prev,
        rooms: prev.rooms.map((r) => (r.id === roomId && !r.isPaused ? { ...r, isPaused: true, pausedAt: now } : r)),
      }));
      try {
        const res = await pauseRoomFn({ data: { roomId } });
        if (res.ok) setAppState(res.state);
        return { ok: res.ok, error: res.error };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Could not pause session." };
      }
    });
  };
  const logWasteMarketing: StoreContextValue["logWasteMarketing"] = async (roomId, reason, note) => {
    return withPending(`logWasteMarketing:${roomId}`, async () => {
      try {
        const res = await logWasteMarketingFn({ data: { roomId, reason, note } });
        if (res.ok) { setAppState(res.state); await refreshLedger(); }
        return { ok: res.ok, error: res.error };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Could not log waste/marketing." };
      }
    });
  };
  const nextKotNumber: StoreContextValue["nextKotNumber"] = async () => {
    if (!appState.activeShiftId) return { ok: false, error: "No active shift" };
    try {
      const res = await nextKotNumberFn({ data: { shiftId: appState.activeShiftId } });
      return { ok: res.ok, error: res.error, number: res.number };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Could not get ticket number." };
    }
  };
  const extendRoomTime: StoreContextValue["extendRoomTime"] = async (roomId, deltaSec) => {
    return withPending(`extendRoomTime:${roomId}`, async () => {
      try {
        const res = await extendRoomTimeFn({ data: { roomId, deltaSec } });
        if (res.ok) setAppState(res.state);
        return { ok: res.ok, error: res.error };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Could not extend time." };
      }
    });
  };
  const resumeRoom: StoreContextValue["resumeRoom"] = async (roomId) => {
    return withPending(`resumeRoom:${roomId}`, async () => {
      const now = Date.now();
      setAppState((prev) => ({
        ...prev,
        rooms: prev.rooms.map((r) => {
          if (r.id !== roomId || !r.isPaused) return r;
          const addedPause = r.pausedAt ? (now - r.pausedAt) / 1000 : 0;
          return { ...r, isPaused: false, pausedAt: null, pausedDurationSec: (r.pausedDurationSec || 0) + addedPause };
        }),
      }));
      try {
        const res = await resumeRoomFn({ data: { roomId } });
        if (res.ok) setAppState(res.state);
        return { ok: res.ok, error: res.error };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Could not resume session." };
      }
    });
  };
  const addOrder: StoreContextValue["addOrder"] = async (roomId, menuItemId, qty) => {
    return withPending(`addOrder:${roomId}`, async () => {
      const item = appState.menu.find((m) => m.id === menuItemId);
      if (item && canFulfill(menuItemId, qty)) {
        setAppState((prev) => {
          const newStock = prev.stock.map((stk) => {
            const ing = item.ingredients.find((i) => i.stockId === stk.id);
            return ing ? { ...stk, used: stk.used + ing.qty * qty } : stk;
          });
          const rooms = prev.rooms.map((r) => {
            if (r.id !== roomId) return r;
            const existing = r.orders.find((o) => o.menuItemId === menuItemId);
            const newOrders = existing
              ? r.orders.map((o) => (o.menuItemId === menuItemId ? { ...o, qty: o.qty + qty } : o))
              : [...r.orders, { menuItemId, name: item.name, qty, price: item.price }];
            return { ...r, orders: newOrders };
          });
          return { ...prev, rooms, stock: newStock };
        });
      }
      const res = await addOrderFn({ data: { roomId, menuItemId, qty } });
      setAppState(res.state);
      return { ok: res.ok, error: res.error };
    });
  };
  // Fixes a mis-added item on a live check before it's printed/checked out —
  // set an exact quantity (or 0 to remove) rather than incrementing.
  const setOrderLineQty: StoreContextValue["setOrderLineQty"] = async (roomId, menuItemId, qty) => {
    return withPending(`orderLine:${roomId}:${menuItemId}`, async () => {
      setAppState((prev) => ({
        ...prev,
        rooms: prev.rooms.map((r) => {
          if (r.id !== roomId) return r;
          const orders = qty <= 0
            ? r.orders.filter((o) => o.menuItemId !== menuItemId)
            : r.orders.map((o) => (o.menuItemId === menuItemId ? { ...o, qty } : o));
          return { ...r, orders };
        }),
      }));
      const res = await setOrderLineQtyFn({ data: { roomId, menuItemId, qty } });
      setAppState(res.state);
      return { ok: res.ok, error: res.error };
    });
  };
  const removeOrderLine: StoreContextValue["removeOrderLine"] = (roomId, menuItemId) =>
    setOrderLineQty(roomId, menuItemId, 0);
  const setOrderLineNote: StoreContextValue["setOrderLineNote"] = async (roomId, menuItemId, notes) => {
    return withPending(`orderNote:${roomId}:${menuItemId}`, async () => {
      setAppState((prev) => ({
        ...prev,
        rooms: prev.rooms.map((r) =>
          r.id !== roomId ? r : { ...r, orders: r.orders.map((o) => (o.menuItemId === menuItemId ? { ...o, notes } : o)) },
        ),
      }));
      const res = await setOrderLineNoteFn({ data: { roomId, menuItemId, notes } });
      setAppState(res.state);
      return { ok: res.ok, error: res.error };
    });
  };
  const addMenuItem: StoreContextValue["addMenuItem"] = async (item) => {
    return withPending("addMenuItem", async () => {
      setAppState(await addMenuItemFn({ data: { item } }));
    });
  };
  const updateMenuItem: StoreContextValue["updateMenuItem"] = async (id, patch) => {
    return withPending(`updateMenuItem:${id}`, async () => {
      setAppState((prev) => ({ ...prev, menu: prev.menu.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
      setAppState(await updateMenuItemFn({ data: { id, patch } }));
    });
  };
  const deleteMenuItem: StoreContextValue["deleteMenuItem"] = async (id) => {
    return withPending(`deleteMenuItem:${id}`, async () => {
      setAppState((prev) => ({ ...prev, menu: prev.menu.filter((x) => x.id !== id) }));
      setAppState(await deleteMenuItemFn({ data: { id } }));
    });
  };
  const setActualCash: StoreContextValue["setActualCash"] = async (n) => {
    return withPending("setActualCash", async () => {
      setAppState((prev) => ({ ...prev, actualCashInput: n }));
      setAppState(await setActualCashFn({ data: { amount: n } }));
    });
  };

  // ---------- Raw materials / suppliers / recurring expenses ----------
  const addRawMaterial: StoreContextValue["addRawMaterial"] = async (m) => {
    return withPending("addRawMaterial", async () => {
      const res = await addRawMaterialFn({ data: m });
      if (res.ok) setMaterials((prev) => [...prev, res.item]);
    });
  };
  const adjustStock: StoreContextValue["adjustStock"] = async (materialId, deltaQty, reason, note) => {
    return withPending(`adjustStock:${materialId}`, async () => {
      const res = await adjustStockFn({ data: { materialId, deltaQty, reason, note } });
      if (res.ok) setAppState(res.state);
      return { ok: res.ok, error: res.error };
    });
  };
  const setAbsoluteStock: StoreContextValue["setAbsoluteStock"] = async (materialId, targetQty, note) => {
    return withPending(`setAbsoluteStock:${materialId}`, async () => {
      const res = await setAbsoluteStockFn({ data: { materialId, targetQty, note } });
      if (res.ok) setAppState(res.state);
      return { ok: res.ok, error: res.error, before: res.before, after: res.after, delta: res.delta };
    });
  };
  const refreshRestockLog: StoreContextValue["refreshRestockLog"] = async () => {
    setRestockLog(await getRestockLogFn());
  };
  const restockMaterial: StoreContextValue["restockMaterial"] = async (materialId, qtyAdded, unitCost) => {
    return withPending(`restockMaterial:${materialId}`, async () => {
      try {
        const res = await restockMaterialFn({ data: { materialId, qtyAdded, unitCost } });
        if (res.ok) {
          setAppState(res.state);
          await refreshRestockLog();
        }
        return { ok: res.ok, error: res.error };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Restock failed unexpectedly." };
      }
    });
  };
  const setActualStock: StoreContextValue["setActualStock"] = async (materialId, actualStock) => {
    return withPending(`setActualStock:${materialId}`, async () => {
      try {
        const res = await setActualStockFn({ data: { materialId, actualStock } });
        if (res.ok) setAppState(res.state);
        return { ok: res.ok, error: res.error, variance: res.variance };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Could not save actual stock." };
      }
    });
  };
  const importMenuCatalog: StoreContextValue["importMenuCatalog"] = async () => {
    return withPending("importMenuCatalog", async () => {
      const res = await importMenuCatalogFn();
      if (res.ok) {
        setAppState(res.state);
        setMaterials(await getRawMaterialsFn());
      }
      return {
        ok: res.ok, materialsAdded: res.materialsAdded, materialsPriced: res.materialsPriced, itemsAdded: res.itemsAdded,
        itemsUpdated: res.itemsUpdated, itemsWithoutRecipe: res.itemsWithoutRecipe,
      };
    });
  };
  const updateRawMaterial: StoreContextValue["updateRawMaterial"] = async (id, patch) => {
    return withPending(`updateRawMaterial:${id}`, async () => {
      const res = await updateRawMaterialFn({ data: { id, patch } });
      if (res.ok) {
        setMaterials((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
        // StockTable (Inventory page) renders from appState.stock — the
        // COMPUTED view — not from `materials`, so without this patch the
        // edit would silently appear to do nothing there until some other
        // action happened to force a full state refresh.
        setAppState((prev) => ({
          ...prev,
          stock: prev.stock.map((s) => {
            if (s.id !== id) return s;
            const next = { ...s };
            if (patch.unit !== undefined) next.unit = patch.unit;
            if (patch.unitCost !== undefined) next.unitCost = patch.unitCost;
            if (patch.minStockAlert !== undefined) next.minStock = patch.minStockAlert;
            return next;
          }),
        }));
      }
    });
  };
  const deleteRawMaterial: StoreContextValue["deleteRawMaterial"] = async (id) => {
    return withPending(`deleteRawMaterial:${id}`, async () => {
      const res = await deleteRawMaterialFn({ data: { id } });
      if (res.ok) setMaterials((prev) => prev.filter((m) => m.id !== id));
    });
  };
  const addSupplier: StoreContextValue["addSupplier"] = async (s) => {
    return withPending("addSupplier", async () => {
      const res = await addSupplierFn({ data: s });
      if (res.ok) setSuppliers((prev) => [...prev, res.item]);
    });
  };
  const updateSupplier: StoreContextValue["updateSupplier"] = async (id, patch) => {
    return withPending(`updateSupplier:${id}`, async () => {
      const res = await updateSupplierFn({ data: { id, patch } });
      if (res.ok) setSuppliers((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    });
  };
  const deleteSupplier: StoreContextValue["deleteSupplier"] = async (id) => {
    return withPending(`deleteSupplier:${id}`, async () => {
      const res = await deleteSupplierFn({ data: { id } });
      if (res.ok) setSuppliers((prev) => prev.filter((s) => s.id !== id));
    });
  };
  const addRecurringExpense: StoreContextValue["addRecurringExpense"] = async (e) => {
    return withPending("addRecurringExpense", async () => {
      const res = await addRecurringExpenseFn({ data: e });
      if (res.ok) setRecurringExpenses((prev) => [...prev, res.item]);
    });
  };
  const updateRecurringExpense: StoreContextValue["updateRecurringExpense"] = async (id, patch) => {
    return withPending(`updateRecurringExpense:${id}`, async () => {
      const res = await updateRecurringExpenseFn({ data: { id, patch } });
      if (res.ok) setRecurringExpenses((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
    });
  };
  const deleteRecurringExpense: StoreContextValue["deleteRecurringExpense"] = async (id) => {
    return withPending(`deleteRecurringExpense:${id}`, async () => {
      const res = await deleteRecurringExpenseFn({ data: { id } });
      if (res.ok) setRecurringExpenses((prev) => prev.filter((e) => e.id !== id));
    });
  };
  const logRecurringExpensePayment: StoreContextValue["logRecurringExpensePayment"] = async (e) => {
    return withPending("logRecurringExpensePayment", async () => {
      await logRecurringExpensePaymentFn({ data: e });
      await refreshLedger();
    });
  };

  // ---------- Procurement ----------
  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(",")[1] ?? "");
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const submitPurchase: StoreContextValue["submitPurchase"] = async (p) => {
    return withPending("submitPurchase", async () => {
      const receiptBase64 = await fileToBase64(p.receiptFile);
      const res = await submitPurchaseFn({
        data: {
          purchaseType: p.purchaseType,
          materialId: p.materialId,
          qty: p.qty,
          unitCost: p.unitCost,
          supplierId: p.supplierId,
          category: p.category,
          description: p.description,
          paymentSource: p.paymentSource,
          shiftId: appState.activeShiftId,
          receiptBase64,
          receiptMimeType: p.receiptFile.type || "image/jpeg",
        },
      });
      if (res.ok) {
        await refreshLedger();
        // Admin submissions land approved immediately — refresh state so
        // the new batch shows up in the computed stock view right away.
        if (currentUser?.role === "admin") setAppState(await getStateFn());
      }
      return { ok: res.ok, error: res.error, status: res.status };
    });
  };
  const approvePurchase: StoreContextValue["approvePurchase"] = async (ledgerId) => {
    return withPending(`approvePurchase:${ledgerId}`, async () => {
      const res = await approvePurchaseFn({ data: { ledgerId } });
      if (res.ok) {
        await refreshLedger();
        setAppState(await getStateFn());
      }
    });
  };
  const rejectPurchase: StoreContextValue["rejectPurchase"] = async (ledgerId, reason) => {
    return withPending(`rejectPurchase:${ledgerId}`, async () => {
      await rejectPurchaseFn({ data: { ledgerId, reason } });
      await refreshLedger();
    });
  };

  // ---------- Void workflow ----------
  const refreshVoidRequests = async () => {
    if (currentUser?.role !== "admin") return;
    setVoidRequests(await getVoidRequestsFn());
  };
  const requestVoid: StoreContextValue["requestVoid"] = async (v) => {
    return withPending(`requestVoid:${v.roomId}:${v.menuItemId}`, async () => {
      const res = await requestVoidFn({ data: v });
      if (res.ok) {
        setAppState(res.state);
        await refreshVoidRequests();
        await refreshLedger();
      }
      return { ok: res.ok, error: res.error };
    });
  };
  const reconcileUnapprovedVoid: StoreContextValue["reconcileUnapprovedVoid"] = async (voidId, action, note) => {
    return withPending(`reconcileUnapprovedVoid:${voidId}`, async () => {
      const res = await reconcileUnapprovedVoidFn({ data: { voidId, action, note } });
      if (res.ok) await refreshVoidRequests();
      return { ok: res.ok, error: res.error };
    });
  };
  const verifyAdminAuth: StoreContextValue["verifyAdminAuth"] = async (adminUsername, adminPassword) => {
    return withPending("verifyAdminAuth", async () => {
      try {
        return await verifyAdminAuthFn({ data: { adminUsername, adminPassword } });
      } catch {
        return { ok: false, adminUsername: null };
      }
    });
  };
  const approveVoid: StoreContextValue["approveVoid"] = async (voidId) => {
    return withPending(`approveVoid:${voidId}`, async () => {
      const res = await approveVoidFn({ data: { voidId } });
      if (res.ok && res.state) setAppState(res.state);
      await refreshVoidRequests();
      await refreshLedger();
      return { ok: res.ok, error: res.error };
    });
  };
  const denyVoid: StoreContextValue["denyVoid"] = async (voidId) => {
    return withPending(`denyVoid:${voidId}`, async () => {
      await denyVoidFn({ data: { voidId } });
      await refreshVoidRequests();
    });
  };

  // ---------- Staff Orders & Consumption ----------
  const refreshStaffOrders: StoreContextValue["refreshStaffOrders"] = async () => {
    if (currentUser?.role !== "admin") return;
    setStaffOrders(await getStaffOrdersFn());
  };
  const submitStaffOrder: StoreContextValue["submitStaffOrder"] = async (params) => {
    return withPending("submitStaffOrder", async () => {
      try {
        const res = await submitStaffOrderFn({ data: params });
        if (res.ok) {
          setAppState(res.state);
          await refreshStaffOrders();
          await refreshLedger();
        }
        return { ok: res.ok, error: res.error, staffOrder: res.staffOrder };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Staff order failed unexpectedly." };
      }
    });
  };

  // ---------- Cross-zone transfer & interactive split ----------
  const transferZone: StoreContextValue["transferZone"] = async (sourceId, targetId, rateMode) => {
    return withPending(`transfer:${sourceId}`, async () => {
      const res = await transferZoneFn({ data: { sourceId, targetId, rateMode } });
      if (res.ok) setAppState(res.state);
      return { ok: res.ok, error: res.error };
    });
  };
  const openSplitInterface: StoreContextValue["openSplitInterface"] = async (roomId) => {
    // Fire-and-forget audit log of the moment the split UI opened — not
    // pending-tracked since it has no loading state of its own to show.
    await logSplitInterfaceOpenedFn({ data: { roomId } });
  };
  const splitBill: StoreContextValue["splitBill"] = async (params) => {
    return withPending(`splitBill:${params.roomId}`, async () => {
      try {
        const res = await splitBillFn({ data: params });
        if (res.ok) { setAppState(res.state); await refreshLedger(); }
        return { ok: res.ok, error: res.error, session: res.session };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Split payment failed unexpectedly. Please try again." };
      }
    });
  };
  const refreshActivityLogs: StoreContextValue["refreshActivityLogs"] = async () => {
    if (currentUser?.role !== "admin") return;
    setActivityLogs(await getActivityLogsFn());
  };
  const setFraudThreshold: StoreContextValue["setFraudThreshold"] = async (percent) => {
    return withPending("setFraudThreshold", async () => {
      setAppState(await setFraudThresholdFn({ data: { percent } }));
    });
  };

  const openShift: StoreContextValue["openShift"] = async (openingBalance, coords) => {
    return withPending("openShift", async () => {
      const res = await openShiftFn({ data: { openingBalance, lat: coords?.lat, lng: coords?.lng } });
      setAppState(res.state);
      return { ok: res.ok, error: res.error };
    });
  };
  const endShift: StoreContextValue["endShift"] = async (actualCash, coords) => {
    return withPending("endShift", async () => {
      const closingShiftId = appState.activeShiftId;
      const res = await endShiftFn({ data: { actualCash, lat: coords?.lat, lng: coords?.lng } });
      // Strict reset: once a shift closes, wipe any locally-cached view of
      // it immediately so the next shift never glimpses the previous one's
      // numbers, even for the instant before the fresh state arrives.
      setAppState(res.state);
      const closedShift = res.state.shifts.find((sh) => sh.id === closingShiftId);
      return { ok: res.ok, error: res.error, closedShift };
    });
  };
  const forceEndShift: StoreContextValue["forceEndShift"] = async (actualCash) => {
    return withPending("forceEndShift", async () => {
      setAppState(await forceEndShiftFn({ data: { actualCash } }));
    });
  };
  const closeBusinessDay: StoreContextValue["closeBusinessDay"] = async () => {
    return withPending("closeBusinessDay", async () => {
      try {
        const res = await closeBusinessDayFn();
        if (res.ok) setAppState(res.state);
        return { ok: res.ok, error: res.error };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Could not close business day." };
      }
    });
  };
  const resetForProduction: StoreContextValue["resetForProduction"] = async (password) => {
    return withPending("resetForProduction", async () => {
      try {
        const res = await resetForProductionFn({ data: { password } });
        if (res.ok) setAppState(res.state);
        return { ok: res.ok, error: res.error };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Reset failed unexpectedly." };
      }
    });
  };
  const setGeofenceConfig: StoreContextValue["setGeofenceConfig"] = async (cfg) => {
    return withPending("setGeofenceConfig", async () => {
      setAppState(await setGeofenceConfigFn({ data: cfg }));
    });
  };

  // Pure client-side helpers — non-authoritative, just for instant UI feedback.
  // Every mutation is re-validated on the server regardless of what these return.
  const canFulfill: StoreContextValue["canFulfill"] = (menuItemId, qty) => {
    const item = appState.menu.find((m) => m.id === menuItemId);
    if (!item) return false;
    return item.ingredients.every((ing) => {
      const stk = appState.stock.find((s) => s.id === ing.stockId);
      if (!stk) return false;
      return stk.initialStock - stk.used >= ing.qty * qty;
    });
  };
  const computeElapsed = (room: Room) => {
    if (!room.startedAt || room.status !== "active") return 0;
    const now = Date.now();
    const raw = (now - room.startedAt) / 1000;
    const pausedSoFar = (room.pausedDurationSec || 0) + (room.isPaused && room.pausedAt ? (now - room.pausedAt) / 1000 : 0);
    return Math.max(0, Math.floor(raw - pausedSoFar + (room.timeAdjustmentSec || 0)));
  };

  const state: State = { ...appState, currentUser, accounts, materials, suppliers, recurringExpenses, ledger, pendingApprovals, voidRequests, activityLogs, staffOrders, restockLog };
  const activeShift = appState.shifts.find((s) => s.id === appState.activeShiftId) ?? null;

  const value: StoreContextValue = {
    state, ready, login, logout, addAccount, updateAccount, deleteAccount,
    setRoomRate, renameRoom, startRoom, endRoom, pauseRoom, resumeRoom, logWasteMarketing, nextKotNumber, extendRoomTime, addOrder, setOrderLineQty, setOrderLineNote, removeOrderLine,
    addMenuItem, updateMenuItem, deleteMenuItem, setActualCash, canFulfill,
    computeElapsed, isPending, activeShift, openShift, endShift, forceEndShift, closeBusinessDay, resetForProduction,
    addRawMaterial, updateRawMaterial, deleteRawMaterial, adjustStock, setAbsoluteStock, restockMaterial, refreshRestockLog, setActualStock, importMenuCatalog,
    addSupplier, updateSupplier, deleteSupplier,
    addRecurringExpense, updateRecurringExpense, deleteRecurringExpense, logRecurringExpensePayment,
    submitPurchase, approvePurchase, rejectPurchase, refreshLedger,
    requestVoid, verifyAdminAuth, approveVoid, denyVoid, reconcileUnapprovedVoid, setFraudThreshold, setGeofenceConfig, submitStaffOrder, refreshStaffOrders,
    transferZone, openSplitInterface, splitBill, refreshActivityLogs, refreshVoidRequests,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}

// helpers
export type GeoResult =
  | { ok: true; lat: number; lng: number }
  | { ok: false; reason: "denied" | "unavailable" | "unsupported" };

// Captures live GPS coords at the exact moment it's called — used right
// when the user clicks Start/End Shift, never cached, since the whole
// point of the geofence is verifying where they are RIGHT NOW.
export function captureGeolocation(): Promise<GeoResult> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) {
      resolve({ ok: false, reason: "unsupported" });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ ok: true, lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => resolve({ ok: false, reason: err.code === err.PERMISSION_DENIED ? "denied" : "unavailable" }),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  });
}

export function fmtDuration(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}
export function fmtMoney(n: number) {
  return `EGP ${n.toFixed(2)}`;
}
export function isToday(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}
export function monthKey(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
