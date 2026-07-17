import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import type {
  Role,
  PublicAccount,
  StockItem,
  MenuItem,
  Room,
  Session,
  AppState,
} from "./types";
import { loginFn, logoutFn, sessionFn } from "@/backend/auth";
import { getAccountsFn, addAccountFn, updateAccountFn, deleteAccountFn } from "@/backend/accounts";
import {
  getStateFn,
  startRoomFn,
  endRoomFn,
  addOrderFn,
  setRoomRateFn,
  updateStockItemFn,
  addStockItemFn,
  deleteStockItemFn,
  addMenuItemFn,
  deleteMenuItemFn,
  setActualCashFn,
} from "@/backend/state";

export type { Role, StockItem, MenuItem, Room, Session, AppState } from "./types";
export type CurrentUser = { username: string; role: Role };

interface State extends AppState {
  currentUser: CurrentUser | null;
  accounts: PublicAccount[];
}

const emptyAppState: AppState = {
  rooms: [],
  stock: [],
  menu: [],
  sessions: [],
  activity: [],
  cashRecords: [],
  actualCashInput: 0,
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
  startRoom: (roomId: string) => Promise<void>;
  endRoom: (roomId: string, splitBill: boolean) => Promise<Session | null>;
  addOrder: (roomId: string, menuItemId: string, qty: number) => Promise<{ ok: boolean; error?: string }>;
  updateStockItem: (id: string, patch: Partial<StockItem>) => Promise<void>;
  addStockItem: (s: Omit<StockItem, "used">) => Promise<void>;
  deleteStockItem: (id: string) => Promise<void>;
  addMenuItem: (m: MenuItem) => Promise<void>;
  deleteMenuItem: (id: string) => Promise<void>;
  setActualCash: (n: number) => Promise<void>;
  canFulfill: (menuItemId: string, qty: number) => boolean;
  computeElapsed: (room: Room) => number;
}

const StoreContext = createContext<StoreContextValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [appState, setAppState] = useState<AppState>(emptyAppState);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [accounts, setAccounts] = useState<PublicAccount[]>([]);
  const [ready, setReady] = useState(false);

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

  useEffect(() => {
    (async () => {
      try {
        const user = await sessionFn();
        setCurrentUser(user);
        if (user) {
          const [state] = await Promise.all([getStateFn(), refreshAccounts(user)]);
          setAppState(state);
        }
      } finally {
        setReady(true);
      }
    })();
  }, [refreshAccounts]);

  const login: StoreContextValue["login"] = async (u, p) => {
    const res = await loginFn({ data: { username: u, password: p } });
    if (!res.ok) return false;
    const user = { username: res.username, role: res.role };
    setCurrentUser(user);
    const [state] = await Promise.all([getStateFn(), refreshAccounts(user)]);
    setAppState(state);
    return true;
  };

  const logout = async () => {
    await logoutFn();
    setCurrentUser(null);
    setAccounts([]);
    setAppState(emptyAppState);
  };

  const addAccount: StoreContextValue["addAccount"] = async (a) => {
    const res = await addAccountFn({ data: a });
    if (res.ok) await refreshAccounts(currentUser);
    return res.ok;
  };
  const deleteAccount: StoreContextValue["deleteAccount"] = async (username) => {
    await deleteAccountFn({ data: { username } });
    await refreshAccounts(currentUser);
  };
  const updateAccount: StoreContextValue["updateAccount"] = async (originalUsername, patch) => {
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
  };

  const setRoomRate: StoreContextValue["setRoomRate"] = async (roomId, rate) => {
    setAppState(await setRoomRateFn({ data: { roomId, rate } }));
  };
  const startRoom: StoreContextValue["startRoom"] = async (roomId) => {
    setAppState(await startRoomFn({ data: { roomId } }));
  };
  const endRoom: StoreContextValue["endRoom"] = async (roomId, splitBill) => {
    const res = await endRoomFn({ data: { roomId, splitBill } });
    setAppState(res.state);
    return res.session;
  };
  const addOrder: StoreContextValue["addOrder"] = async (roomId, menuItemId, qty) => {
    const res = await addOrderFn({ data: { roomId, menuItemId, qty } });
    setAppState(res.state);
    return { ok: res.ok, error: res.error };
  };
  const updateStockItem: StoreContextValue["updateStockItem"] = async (id, patch) => {
    setAppState(await updateStockItemFn({ data: { id, patch } }));
  };
  const addStockItem: StoreContextValue["addStockItem"] = async (item) => {
    setAppState(await addStockItemFn({ data: { item } }));
  };
  const deleteStockItem: StoreContextValue["deleteStockItem"] = async (id) => {
    setAppState(await deleteStockItemFn({ data: { id } }));
  };
  const addMenuItem: StoreContextValue["addMenuItem"] = async (item) => {
    setAppState(await addMenuItemFn({ data: { item } }));
  };
  const deleteMenuItem: StoreContextValue["deleteMenuItem"] = async (id) => {
    setAppState(await deleteMenuItemFn({ data: { id } }));
  };
  const setActualCash: StoreContextValue["setActualCash"] = async (n) => {
    setAppState(await setActualCashFn({ data: { amount: n } }));
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

  const state: State = { ...appState, currentUser, accounts };

  const value: StoreContextValue = {
    state, ready, login, logout, addAccount, updateAccount, deleteAccount,
    setRoomRate, startRoom, endRoom, addOrder,
    updateStockItem, addStockItem, deleteStockItem,
    addMenuItem, deleteMenuItem, setActualCash, canFulfill,
    computeElapsed,
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
