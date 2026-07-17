import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";

// ---------- Types ----------
export type Role = "admin" | "cashier";
export interface Account { username: string; password: string; role: Role; }
export interface StockItem {
  id: string;
  name: string;
  unit: string; // grams, ml, pcs
  initialStock: number;
  used: number;
  minStock: number;
}
export interface RecipeIngredient { stockId: string; qty: number; }
export interface MenuItem {
  id: string;
  name: string;
  price: number;
  ingredients: RecipeIngredient[];
}
export interface OrderLine { menuItemId: string; name: string; qty: number; price: number; }
export interface Room {
  id: string;
  name: string;
  isVip: boolean;
  hourlyRate: number;
  status: "available" | "active";
  startedAt: number | null;
  orders: OrderLine[];
}
export interface Session {
  id: string;
  roomId: string;
  roomName: string;
  startedAt: number;
  endedAt: number;
  durationSec: number;
  timeCost: number;
  orders: OrderLine[];
  ordersCost: number;
  total: number;
  splitBill: boolean;
}
export interface ActivityEntry { id: string; ts: number; message: string; }
export interface CashRecord { date: string; expected: number; actual: number; }

interface State {
  accounts: Account[];
  currentUser: Account | null;
  rooms: Room[];
  stock: StockItem[];
  menu: MenuItem[];
  sessions: Session[];
  activity: ActivityEntry[];
  cashRecords: CashRecord[];
  actualCashInput: number;
}

const LS_KEY = "glitch_state_v1";
const LS_SESSION = "glitch_session_v1";

// ---------- Defaults ----------
const defaultAccounts: Account[] = [
  { username: "admin", password: "admin123", role: "admin" },
  { username: "cashier1", password: "cashier123", role: "cashier" },
];

const defaultStock: StockItem[] = [
  { id: "coffee", name: "Coffee Beans", unit: "g", initialStock: 2000, used: 0, minStock: 300 },
  { id: "milk", name: "Milk", unit: "ml", initialStock: 5000, used: 0, minStock: 800 },
  { id: "sugar", name: "Sugar", unit: "g", initialStock: 1500, used: 0, minStock: 200 },
  { id: "cups", name: "Paper Cups", unit: "pcs", initialStock: 200, used: 0, minStock: 40 },
  { id: "soda", name: "Soda Cans", unit: "pcs", initialStock: 100, used: 0, minStock: 20 },
  { id: "chips", name: "Potato Chips", unit: "pcs", initialStock: 80, used: 0, minStock: 15 },
];

const defaultMenu: MenuItem[] = [
  { id: "latte", name: "Latte", price: 4.5, ingredients: [{ stockId: "coffee", qty: 18 }, { stockId: "milk", qty: 200 }, { stockId: "cups", qty: 1 }] },
  { id: "espresso", name: "Espresso", price: 3.0, ingredients: [{ stockId: "coffee", qty: 18 }, { stockId: "cups", qty: 1 }] },
  { id: "soda-drink", name: "Soda", price: 2.5, ingredients: [{ stockId: "soda", qty: 1 }] },
  { id: "chips-snack", name: "Chips", price: 2.0, ingredients: [{ stockId: "chips", qty: 1 }] },
];

const defaultRooms: Room[] = Array.from({ length: 8 }, (_, i) => ({
  id: `room-${i + 1}`,
  name: `Room ${i + 1}`,
  isVip: false,
  hourlyRate: 5,
  status: "available" as const,
  startedAt: null,
  orders: [],
})).concat([{
  id: "room-vip",
  name: "VIP",
  isVip: true,
  hourlyRate: 10,
  status: "available",
  startedAt: null,
  orders: [],
}]);

function loadState(): State {
  if (typeof window === "undefined") return initialState();
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as State;
      // ensure accounts and current user rehydrate
      return { ...initialState(), ...parsed, currentUser: parsed.currentUser ?? null };
    }
  } catch { /* ignore */ }
  return initialState();
}

function initialState(): State {
  return {
    accounts: defaultAccounts,
    currentUser: null,
    rooms: defaultRooms,
    stock: defaultStock,
    menu: defaultMenu,
    sessions: [],
    activity: [],
    cashRecords: [],
    actualCashInput: 0,
  };
}

// ---------- Context ----------
interface StoreContextValue {
  state: State;
  login: (u: string, p: string) => boolean;
  logout: () => void;
  addAccount: (a: Account) => boolean;
  deleteAccount: (username: string) => void;
  setRoomRate: (roomId: string, rate: number) => void;
  startRoom: (roomId: string) => void;
  endRoom: (roomId: string, splitBill: boolean) => Session | null;
  addOrder: (roomId: string, menuItemId: string, qty: number) => { ok: boolean; error?: string };
  updateStockItem: (id: string, patch: Partial<StockItem>) => void;
  addStockItem: (s: Omit<StockItem, "used">) => void;
  deleteStockItem: (id: string) => void;
  addMenuItem: (m: MenuItem) => void;
  deleteMenuItem: (id: string) => void;
  setActualCash: (n: number) => void;
  canFulfill: (menuItemId: string, qty: number) => boolean;
  computeElapsed: (room: Room) => number;
  reset: () => void;
}

const StoreContext = createContext<StoreContextValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(() => (typeof window === "undefined" ? initialState() : loadState()));
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setState(loadState());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  }, [state, hydrated]);

  // cross-tab sync
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === LS_KEY && e.newValue) {
        try { setState(JSON.parse(e.newValue)); } catch { /* ignore */ }
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const pushActivity = (msg: string, s: State): State => ({
    ...s,
    activity: [{ id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, ts: Date.now(), message: msg }, ...s.activity].slice(0, 100),
  });

  const login: StoreContextValue["login"] = (u, p) => {
    const acc = state.accounts.find((a) => a.username === u && a.password === p);
    if (!acc) return false;
    setState((s) => ({ ...s, currentUser: acc }));
    localStorage.setItem(LS_SESSION, JSON.stringify({ username: acc.username }));
    return true;
  };

  const logout = () => {
    setState((s) => ({ ...s, currentUser: null }));
    localStorage.removeItem(LS_SESSION);
  };

  const addAccount: StoreContextValue["addAccount"] = (a) => {
    if (state.accounts.some((x) => x.username === a.username)) return false;
    setState((s) => ({ ...s, accounts: [...s.accounts, a] }));
    return true;
  };
  const deleteAccount = (username: string) => {
    setState((s) => ({ ...s, accounts: s.accounts.filter((a) => a.username !== username) }));
  };

  const setRoomRate = (roomId: string, rate: number) => {
    setState((s) => ({ ...s, rooms: s.rooms.map((r) => r.id === roomId ? { ...r, hourlyRate: rate } : r) }));
  };

  const startRoom = (roomId: string) => {
    setState((s) => {
      const room = s.rooms.find((r) => r.id === roomId);
      if (!room || room.status === "active") return s;
      const now = Date.now();
      const rooms = s.rooms.map((r) => r.id === roomId ? { ...r, status: "active" as const, startedAt: now, orders: [] } : r);
      return pushActivity(`${room.name} session started`, { ...s, rooms });
    });
  };

  const computeElapsed = (room: Room) => {
    if (!room.startedAt || room.status !== "active") return 0;
    return Math.max(0, Math.floor((Date.now() - room.startedAt) / 1000));
  };

  const canFulfill: StoreContextValue["canFulfill"] = (menuItemId, qty) => {
    const item = state.menu.find((m) => m.id === menuItemId);
    if (!item) return false;
    return item.ingredients.every((ing) => {
      const stk = state.stock.find((s) => s.id === ing.stockId);
      if (!stk) return false;
      const remaining = stk.initialStock - stk.used;
      return remaining >= ing.qty * qty;
    });
  };

  const addOrder: StoreContextValue["addOrder"] = (roomId, menuItemId, qty) => {
    const item = state.menu.find((m) => m.id === menuItemId);
    if (!item) return { ok: false, error: "Item not found" };
    if (!canFulfill(menuItemId, qty)) return { ok: false, error: `Insufficient stock for ${item.name}!` };

    setState((s) => {
      // Deduct stock immediately on order add
      const newStock = s.stock.map((stk) => {
        const ing = item.ingredients.find((i) => i.stockId === stk.id);
        if (!ing) return stk;
        return { ...stk, used: stk.used + ing.qty * qty };
      });
      const rooms = s.rooms.map((r) => {
        if (r.id !== roomId) return r;
        const existing = r.orders.find((o) => o.menuItemId === menuItemId);
        const newOrders = existing
          ? r.orders.map((o) => o.menuItemId === menuItemId ? { ...o, qty: o.qty + qty } : o)
          : [...r.orders, { menuItemId, name: item.name, qty, price: item.price }];
        return { ...r, orders: newOrders };
      });
      const room = s.rooms.find((r) => r.id === roomId);
      return pushActivity(`${room?.name ?? "Room"} added ${qty}x ${item.name}`, { ...s, rooms, stock: newStock });
    });
    return { ok: true };
  };

  const endRoom: StoreContextValue["endRoom"] = (roomId, splitBill) => {
    const room = state.rooms.find((r) => r.id === roomId);
    if (!room || room.status !== "active" || !room.startedAt) return null;
    const endedAt = Date.now();
    const durationSec = Math.max(1, Math.floor((endedAt - room.startedAt) / 1000));
    const timeCost = (durationSec / 3600) * room.hourlyRate;
    const ordersCost = room.orders.reduce((a, o) => a + o.qty * o.price, 0);
    const total = timeCost + ordersCost;
    const session: Session = {
      id: `sess-${endedAt}`,
      roomId: room.id,
      roomName: room.name,
      startedAt: room.startedAt,
      endedAt,
      durationSec,
      timeCost,
      orders: room.orders,
      ordersCost,
      total,
      splitBill,
    };
    setState((s) => {
      const rooms = s.rooms.map((r) => r.id === roomId ? { ...r, status: "available" as const, startedAt: null, orders: [] } : r);
      return pushActivity(`${room.name} checked out - $${total.toFixed(2)} collected`, {
        ...s,
        rooms,
        sessions: [session, ...s.sessions],
      });
    });
    return session;
  };

  const updateStockItem = (id: string, patch: Partial<StockItem>) => {
    setState((s) => ({ ...s, stock: s.stock.map((x) => x.id === id ? { ...x, ...patch } : x) }));
  };
  const addStockItem = (item: Omit<StockItem, "used">) => {
    setState((s) => ({ ...s, stock: [...s.stock, { ...item, used: 0 }] }));
  };
  const deleteStockItem = (id: string) => {
    setState((s) => ({ ...s, stock: s.stock.filter((x) => x.id !== id) }));
  };
  const addMenuItem = (m: MenuItem) => {
    setState((s) => ({ ...s, menu: [...s.menu, m] }));
  };
  const deleteMenuItem = (id: string) => {
    setState((s) => ({ ...s, menu: s.menu.filter((x) => x.id !== id) }));
  };
  const setActualCash = (n: number) => setState((s) => ({ ...s, actualCashInput: n }));

  const reset = () => setState(initialState());

  const value: StoreContextValue = {
    state, login, logout, addAccount, deleteAccount,
    setRoomRate, startRoom, endRoom, addOrder,
    updateStockItem, addStockItem, deleteStockItem,
    addMenuItem, deleteMenuItem, setActualCash, canFulfill,
    computeElapsed, reset,
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
