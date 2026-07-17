// Shared types between client and server. No secrets or server-only logic here.

export type Role = "admin" | "cashier";

// Public account shape sent to the client — NEVER include password/hash.
export interface PublicAccount {
  username: string;
  role: Role;
}

export interface SessionUser {
  username: string;
  role: Role;
}

export interface StockItem {
  id: string;
  name: string;
  unit: string; // grams, ml, pcs
  initialStock: number;
  used: number;
  minStock: number;
}

export interface RecipeIngredient {
  stockId: string;
  qty: number;
}

export interface MenuItem {
  id: string;
  name: string;
  price: number;
  ingredients: RecipeIngredient[];
}

export interface OrderLine {
  menuItemId: string;
  name: string;
  qty: number;
  price: number;
}

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

export interface ActivityEntry {
  id: string;
  ts: number;
  message: string;
}

export interface CashRecord {
  date: string;
  expected: number;
  actual: number;
}

// The authoritative, server-owned business state (everything except accounts/session).
export interface AppState {
  rooms: Room[];
  stock: StockItem[];
  menu: MenuItem[];
  sessions: Session[];
  activity: ActivityEntry[];
  cashRecords: CashRecord[];
  actualCashInput: number;
}
