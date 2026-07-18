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

export type PaymentMethod = "cash" | "visa";

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
  paymentMethod: PaymentMethod;
  shiftId: string | null;
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

// A shift is the unit of accountability for one cashier's time on the
// register. Cash Reconciliation and the End-Of-Day Sales Log are scoped to
// the ACTIVE shift for cashiers (so a new shift never sees the previous
// one's numbers); admins can see across all shifts for the day, plus the
// full historical archive.
export interface Shift {
  id: string;
  cashierUsername: string;
  openedAt: number;
  closedAt: number | null;
  openingBalance: number;
  closingActualCash: number | null;
  expectedCash: number | null;
  discrepancy: number | null;
  forced: boolean; // true if closed via the admin emergency-reset path
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
  shifts: Shift[];
  activeShiftId: string | null;
}
