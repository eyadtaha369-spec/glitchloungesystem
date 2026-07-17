// Server-only pure business logic. This used to live in the browser (glitch-store.tsx)
// where anyone could bypass it by editing localStorage directly. Now it only runs here,
// and the client can only affect state through the validated server functions in state.ts.

import type {
  AppState,
  Room,
  StockItem,
  MenuItem,
  Session,
} from "@/lib/types";

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

export function defaultAppState(): AppState {
  return {
    rooms: defaultRooms,
    stock: defaultStock,
    menu: defaultMenu,
    sessions: [],
    activity: [],
    cashRecords: [],
    actualCashInput: 0,
  };
}

function pushActivity(state: AppState, message: string): AppState {
  return {
    ...state,
    activity: [
      { id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, ts: Date.now(), message },
      ...state.activity,
    ].slice(0, 100),
  };
}

export function setRoomRate(state: AppState, roomId: string, rate: number): AppState {
  return { ...state, rooms: state.rooms.map((r) => (r.id === roomId ? { ...r, hourlyRate: rate } : r)) };
}

export function startRoom(state: AppState, roomId: string): AppState {
  const room = state.rooms.find((r) => r.id === roomId);
  if (!room || room.status === "active") return state;
  const now = Date.now();
  const rooms = state.rooms.map((r) => (r.id === roomId ? { ...r, status: "active" as const, startedAt: now, orders: [] } : r));
  return pushActivity({ ...state, rooms }, `${room.name} session started`);
}

export function canFulfill(state: AppState, menuItemId: string, qty: number): boolean {
  const item = state.menu.find((m) => m.id === menuItemId);
  if (!item) return false;
  return item.ingredients.every((ing) => {
    const stk = state.stock.find((s) => s.id === ing.stockId);
    if (!stk) return false;
    return stk.initialStock - stk.used >= ing.qty * qty;
  });
}

export function addOrder(
  state: AppState,
  roomId: string,
  menuItemId: string,
  qty: number,
): { ok: boolean; error?: string; state: AppState } {
  const item = state.menu.find((m) => m.id === menuItemId);
  if (!item) return { ok: false, error: "Item not found", state };
  if (!canFulfill(state, menuItemId, qty)) return { ok: false, error: `Insufficient stock for ${item.name}!`, state };

  const newStock = state.stock.map((stk) => {
    const ing = item.ingredients.find((i) => i.stockId === stk.id);
    if (!ing) return stk;
    return { ...stk, used: stk.used + ing.qty * qty };
  });
  const rooms = state.rooms.map((r) => {
    if (r.id !== roomId) return r;
    const existing = r.orders.find((o) => o.menuItemId === menuItemId);
    const newOrders = existing
      ? r.orders.map((o) => (o.menuItemId === menuItemId ? { ...o, qty: o.qty + qty } : o))
      : [...r.orders, { menuItemId, name: item.name, qty, price: item.price }];
    return { ...r, orders: newOrders };
  });
  const room = state.rooms.find((r) => r.id === roomId);
  const next = pushActivity({ ...state, rooms, stock: newStock }, `${room?.name ?? "Room"} added ${qty}x ${item.name}`);
  return { ok: true, state: next };
}

export function endRoom(
  state: AppState,
  roomId: string,
  splitBill: boolean,
): { session: Session | null; state: AppState } {
  const room = state.rooms.find((r) => r.id === roomId);
  if (!room || room.status !== "active" || !room.startedAt) return { session: null, state };
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
  const rooms = state.rooms.map((r) => (r.id === roomId ? { ...r, status: "available" as const, startedAt: null, orders: [] } : r));
  const next = pushActivity(
    { ...state, rooms, sessions: [session, ...state.sessions] },
    `${room.name} checked out - $${total.toFixed(2)} collected`,
  );
  return { session, state: next };
}

export function updateStockItem(state: AppState, id: string, patch: Partial<StockItem>): AppState {
  return { ...state, stock: state.stock.map((x) => (x.id === id ? { ...x, ...patch } : x)) };
}
export function addStockItem(state: AppState, item: Omit<StockItem, "used">): AppState {
  return { ...state, stock: [...state.stock, { ...item, used: 0 }] };
}
export function deleteStockItem(state: AppState, id: string): AppState {
  return { ...state, stock: state.stock.filter((x) => x.id !== id) };
}
export function addMenuItem(state: AppState, item: MenuItem): AppState {
  return { ...state, menu: [...state.menu, item] };
}
export function deleteMenuItem(state: AppState, id: string): AppState {
  return { ...state, menu: state.menu.filter((x) => x.id !== id) };
}
export function setActualCash(state: AppState, n: number): AppState {
  return { ...state, actualCashInput: n };
}
