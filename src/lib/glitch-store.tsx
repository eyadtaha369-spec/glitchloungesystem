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
} from "./types";
import { loginFn, logoutFn, sessionFn } from "@/backend/auth";
import { getAccountsFn, addAccountFn, updateAccountFn, deleteAccountFn } from "@/backend/accounts";
import {
  getStateFn,
  startRoomFn,
  endRoomFn,
  addOrderFn,
  setOrderLineQtyFn,
  setRoomRateFn,
  addMenuItemFn,
  updateMenuItemFn,
  deleteMenuItemFn,
  setActualCashFn,
  openShiftFn,
  endShiftFn,
  forceEndShiftFn,
} from "@/backend/state";
import {
  getRawMaterialsFn, addRawMaterialFn, updateRawMaterialFn, deleteRawMaterialFn,
  getSuppliersFn, addSupplierFn, updateSupplierFn, deleteSupplierFn,
  getRecurringExpensesFn, addRecurringExpenseFn, updateRecurringExpenseFn, deleteRecurringExpenseFn,
  logRecurringExpensePaymentFn,
  submitPurchaseFn,
  getLedgerFn, getPendingApprovalsFn, approvePurchaseFn, rejectPurchaseFn,
} from "@/backend/finance";
import {
  requestVoidFn, getVoidRequestsFn, approveVoidFn, denyVoidFn, setFraudThresholdFn,
} from "@/backend/void";

export type {
  Role, StockItem, MenuItem, Room, Session, AppState, Shift, PaymentMethod,
  RawMaterial, Supplier, RecurringExpense, LedgerEntry, VoidRequest, VoidReason,
} from "./types";
export { VOID_REASON_LABELS } from "./types";
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
  fraudThresholdPercent: 2,
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
  setRoomRate: (roomId: string, rate: number) => Promise<void>;
  startRoom: (roomId: string) => Promise<{ ok: boolean; error?: string }>;
  endRoom: (roomId: string, splitBill: boolean, paymentMethod: PaymentMethod) => Promise<Session | null>;
  addOrder: (roomId: string, menuItemId: string, qty: number) => Promise<{ ok: boolean; error?: string }>;
  setOrderLineQty: (roomId: string, menuItemId: string, qty: number) => Promise<{ ok: boolean; error?: string }>;
  removeOrderLine: (roomId: string, menuItemId: string) => Promise<{ ok: boolean; error?: string }>;
  addMenuItem: (m: MenuItem) => Promise<void>;
  updateMenuItem: (id: string, patch: Partial<MenuItem>) => Promise<void>;
  deleteMenuItem: (id: string) => Promise<void>;
  setActualCash: (n: number) => Promise<void>;
  canFulfill: (menuItemId: string, qty: number) => boolean;
  computeElapsed: (room: Room) => number;
  isPending: (key: string) => boolean;
  activeShift: Shift | null;
  openShift: (openingBalance: number) => Promise<{ ok: boolean; error?: string }>;
  endShift: (actualCash: number) => Promise<{ ok: boolean; error?: string; closedShift?: Shift }>;
  forceEndShift: (actualCash?: number) => Promise<void>;

  // Raw materials / suppliers / recurring expense templates [admin CRUD]
  addRawMaterial: (m: { name: string; unit: string; minStockAlert: number }) => Promise<void>;
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
    paidFromDrawer: boolean;
    receiptFile: File;
  }) => Promise<{ ok: boolean; error?: string; status?: string }>;
  approvePurchase: (ledgerId: string) => Promise<void>;
  rejectPurchase: (ledgerId: string, reason?: string) => Promise<void>;
  refreshLedger: () => Promise<void>;

  // Void workflow — cashiers request, admins auto-execute; requests only
  // affect the room's live order + inventory once approved.
  requestVoid: (v: { roomId: string; menuItemId: string; qty: number; reason: VoidReason; waiterName: string }) => Promise<{ ok: boolean; error?: string }>;
  approveVoid: (voidId: string) => Promise<{ ok: boolean; error?: string }>;
  denyVoid: (voidId: string) => Promise<void>;
  setFraudThreshold: (percent: number) => Promise<void>;
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
      setMaterials([]); setSuppliers([]); setRecurringExpenses([]); setLedger([]); setPendingApprovals([]); setVoidRequests([]);
      return;
    }
    try {
      const [mats, sups] = await Promise.all([getRawMaterialsFn(), getSuppliersFn()]);
      setMaterials(mats);
      setSuppliers(sups);
    } catch { /* leave as-is */ }
    if (user.role === "admin") {
      try {
        const [exp, led, pend, voids] = await Promise.all([
          getRecurringExpensesFn(), getLedgerFn(), getPendingApprovalsFn(), getVoidRequestsFn(),
        ]);
        setRecurringExpenses(exp);
        setLedger(led);
        setPendingApprovals(pend);
        setVoidRequests(voids);
      } catch { /* leave as-is */ }
    } else {
      setRecurringExpenses([]); setLedger([]); setPendingApprovals([]); setVoidRequests([]);
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
    setMaterials([]); setSuppliers([]); setRecurringExpenses([]); setLedger([]); setPendingApprovals([]); setVoidRequests([]);
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

  const setRoomRate: StoreContextValue["setRoomRate"] = async (roomId, rate) => {
    return withPending(`setRoomRate:${roomId}`, async () => {
      setAppState((prev) => ({
        ...prev,
        rooms: prev.rooms.map((r) => (r.id === roomId ? { ...r, hourlyRate: rate } : r)),
      }));
      setAppState(await setRoomRateFn({ data: { roomId, rate } }));
    });
  };
  const startRoom: StoreContextValue["startRoom"] = async (roomId) => {
    return withPending(`startRoom:${roomId}`, async () => {
      const now = Date.now();
      setAppState((prev) => ({
        ...prev,
        rooms: prev.rooms.map((r) =>
          r.id === roomId && r.status !== "active" ? { ...r, status: "active", startedAt: now, orders: [] } : r,
        ),
      }));
      const res = await startRoomFn({ data: { roomId } });
      setAppState(res.state);
      return { ok: res.ok, error: res.error };
    });
  };
  const endRoom: StoreContextValue["endRoom"] = async (roomId, splitBill, paymentMethod) => {
    return withPending(`endRoom:${roomId}`, async () => {
      setAppState((prev) => ({
        ...prev,
        rooms: prev.rooms.map((r) =>
          r.id === roomId ? { ...r, status: "available", startedAt: null, orders: [] } : r,
        ),
      }));
      const res = await endRoomFn({ data: { roomId, splitBill, paymentMethod } });
      setAppState(res.state);
      return res.session;
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
  const updateRawMaterial: StoreContextValue["updateRawMaterial"] = async (id, patch) => {
    return withPending(`updateRawMaterial:${id}`, async () => {
      const res = await updateRawMaterialFn({ data: { id, patch } });
      if (res.ok) setMaterials((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
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
          paidFromDrawer: p.paidFromDrawer,
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
      }
      return { ok: res.ok, error: res.error };
    });
  };
  const approveVoid: StoreContextValue["approveVoid"] = async (voidId) => {
    return withPending(`approveVoid:${voidId}`, async () => {
      const res = await approveVoidFn({ data: { voidId } });
      if (res.ok && res.state) setAppState(res.state);
      await refreshVoidRequests();
      return { ok: res.ok, error: res.error };
    });
  };
  const denyVoid: StoreContextValue["denyVoid"] = async (voidId) => {
    return withPending(`denyVoid:${voidId}`, async () => {
      await denyVoidFn({ data: { voidId } });
      await refreshVoidRequests();
    });
  };
  const setFraudThreshold: StoreContextValue["setFraudThreshold"] = async (percent) => {
    return withPending("setFraudThreshold", async () => {
      setAppState(await setFraudThresholdFn({ data: { percent } }));
    });
  };

  const openShift: StoreContextValue["openShift"] = async (openingBalance) => {
    return withPending("openShift", async () => {
      const res = await openShiftFn({ data: { openingBalance } });
      setAppState(res.state);
      return { ok: res.ok, error: res.error };
    });
  };
  const endShift: StoreContextValue["endShift"] = async (actualCash) => {
    return withPending("endShift", async () => {
      const closingShiftId = appState.activeShiftId;
      const res = await endShiftFn({ data: { actualCash } });
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
    return Math.max(0, Math.floor((Date.now() - room.startedAt) / 1000));
  };

  const state: State = { ...appState, currentUser, accounts, materials, suppliers, recurringExpenses, ledger, pendingApprovals, voidRequests };
  const activeShift = appState.shifts.find((s) => s.id === appState.activeShiftId) ?? null;

  const value: StoreContextValue = {
    state, ready, login, logout, addAccount, updateAccount, deleteAccount,
    setRoomRate, startRoom, endRoom, addOrder, setOrderLineQty, removeOrderLine,
    addMenuItem, updateMenuItem, deleteMenuItem, setActualCash, canFulfill,
    computeElapsed, isPending, activeShift, openShift, endShift, forceEndShift,
    addRawMaterial, updateRawMaterial, deleteRawMaterial,
    addSupplier, updateSupplier, deleteSupplier,
    addRecurringExpense, updateRecurringExpense, deleteRecurringExpense, logRecurringExpensePayment,
    submitPurchase, approvePurchase, rejectPurchase, refreshLedger,
    requestVoid, approveVoid, denyVoid, setFraudThreshold,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}

// helpers
export function fmtDuration(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}
export function fmtMoney(n: number) {
  return `$${n.toFixed(2)}`;
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
