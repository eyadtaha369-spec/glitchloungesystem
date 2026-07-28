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
  notes?: string;
}

// 4 checkout options. Mixed options split the ticket across two methods —
// the exact amounts are recorded on the Session (cashAmount/visaAmount/
// instapayAmount) rather than inferred from this label, so revenue
// aggregation is exact regardless of pure vs. mixed payment.
export type PaymentMethod = "cash" | "visa" | "mixed_cash_visa" | "mixed_cash_instapay";

export interface Room {
  id: string;
  name: string;
  isVip: boolean;
  hourlyRate: number; // the EFFECTIVE rate for the current/last session (0 for lounge/split, or before first start)
  singleRate: number; // configurable base rate — Single mode (room zone only)
  multiRate: number; // configurable base rate — Multi mode (room zone only)
  rateMode: "single" | "multi" | null; // which rate is active for the current session
  status: "available" | "active";
  startedAt: number | null;
  orders: OrderLine[];
  // "room" = the original timed bays/VIP suite. "lounge" = a no-time-charge
  // table customers can be transferred to. "split" = an ephemeral
  // independent invoice created by extracting items off another active
  // room/table — checked out on its own, separately from the source.
  zone: "room" | "lounge" | "split";
  splitInvoiceNumber: string | null;
  transferredFrom: string | null;
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
  cogs: number;
  splitBill: boolean;
  paymentMethod: PaymentMethod;
  // Exact per-method breakdown. For pure cash/visa, one of these equals
  // `total` and the others are 0. For mixed payments, cashAmount +
  // (visaAmount or instapayAmount) === total exactly (server-validated).
  cashAmount: number;
  visaAmount: number;
  instapayAmount: number;
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
  openedLat: number | null;
  openedLng: number | null;
  closedLat: number | null;
  closedLng: number | null;
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
  fraudThresholdPercent: number;
  // Geofence config for the Shift Gatekeeper — cashiers (and admins) must be
  // physically at these coordinates, within the radius, to open/close a shift.
  geofenceEnabled: boolean;
  cafeLat: number;
  cafeLng: number;
  geofenceRadiusMeters: number;
  // Computed (not persisted) — lets any role see this without needing full
  // void-ledger access, for the "flag at shift close" requirement.
  pendingVoidCountForActiveShift: number;
}

// ---------- Costing / procurement / anti-theft ledger ----------
// These live as real rows in dedicated Sheet tabs (not the AppState JSON
// blob) because a growing financial ledger would eventually exceed a
// single Sheet cell's 50,000-character limit.

export interface RawMaterial {
  id: string;
  name: string;
  unit: string;
  minStockAlert: number;
}

export interface Supplier {
  id: string;
  name: string;
  contact: string;
  category: string;
}

export interface RecurringExpense {
  id: string;
  name: string;
  amount: number;
  active: boolean;
}

// One FIFO purchase lot for a raw material. Consumption always draws from
// the oldest batch with qtyRemaining > 0 first, so COGS reflects the real
// price paid for the units actually used.
export interface Batch {
  id: string;
  materialId: string;
  supplierId: string | null;
  qtyPurchased: number;
  qtyRemaining: number;
  unitCost: number;
  purchasedAt: number;
  source: "stockedBatch" | "dailyFresh";
}

export type LedgerType =
  | "sale"
  | "stockedBatch"
  | "dailyFresh"
  | "midShiftPurchase"
  | "recurringExpense"
  | "manualAdjustment";
export type LedgerStatus = "approved" | "pending" | "rejected";
export type LedgerDirection = "inflow" | "outflow";

export interface LedgerEntry {
  id: string;
  ts: number;
  amount: number;
  direction: LedgerDirection;
  type: LedgerType;
  category: string;
  description: string;
  supplierId: string | null;
  staffUsername: string;
  status: LedgerStatus;
  receiptUrl: string | null;
  paidFromDrawer: boolean;
  shiftId: string | null;
  materialId: string | null;
  qty: number | null;
  unitCost: number | null;
}

// ---------- Void workflow (anti-collusion) ----------

export type VoidReason = "wrongInput" | "spilled" | "customerRejected" | "complimentary";
// Spec calls for strictly "approved" | "pending" in the audit ledger's status
// column. "denied" is a pragmatic addition so admins can actually clear out
// a mistaken request instead of it sitting pending forever — it's excluded
// from both the Approved and Pending Approval buckets in reporting.
export type VoidStatus = "pending" | "approved" | "denied";

export interface VoidRequest {
  id: string;
  ts: number;
  roomId: string;
  roomName: string;
  menuItemId: string;
  itemName: string;
  qty: number;
  unitPrice: number;
  billValue: number;
  reason: VoidReason;
  status: VoidStatus;
  cashierUsername: string;
  waiterName: string;
  shiftId: string | null;
  approvedBy: string | null;
  approvedAt: number | null;
  cogs: number | null;
  applied: boolean;
  applyError: string | null;
}

export const VOID_REASON_LABELS: Record<VoidReason, string> = {
  wrongInput: "Wrong Input (Before Preparation)",
  spilled: "Spilled / Damaged by Staff",
  customerRejected: "Customer Rejected (Taste/Quality)",
  complimentary: "Complimentary / VIP Gift (Free)",
};

// ---------- System-wide Activity Log ("the Black Box") ----------
// Write-Once, Read-Many — enforced by simply never providing an update or
// delete path for this data, anywhere in the app or the backend.

export type AuditRiskLevel = "green" | "yellow" | "red";

export interface AuditLogEntry {
  id: string;
  ts: number;
  actorUsername: string;
  actorRole: string;
  actionType: string;
  location: string;
  riskLevel: AuditRiskLevel;
  description: string;
  before: string; // JSON string, "" if not applicable
  after: string; // JSON string, "" if not applicable
  shiftId: string | null;
}
