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
  initialStock: number; // lifetime ever purchased
  used: number; // lifetime ever consumed
  minStock: number;
  unitCost: number;
  remaining: number; // current on-hand quantity
  totalValue: number; // remaining * unitCost
  usedSinceRestock: number; // consumed from the current (most recent) batch only
  lastRestockAt: number | null;
  actualStock: number | null;
  actualStockUpdatedAt: number | null;
  actualStockUpdatedBy: string | null;
  variance: number | null; // actualStock - remaining; negative = deficit, positive = surplus
  openingStock: number; // one-time historical starting balance, locked from editing after creation
  purchasesIn: number; // total purchased since Opening Stock was set
  salesWasteOut: number; // total consumed since Opening Stock was set (sales + waste, all sources) — equals `used`
  systemBalance: number; // Opening Stock + Purchases In - Sales & Waste Out, equals `remaining`
  actualCountValue: number | null; // actualStock * unitCost — distinct from totalValue, which uses systemBalance
  category: string;
  storageLocation: string;
  lastPurchaseCost: number;
}

export interface RecipeIngredient {
  stockId: string;
  qty: number;
}

export const MENU_CATEGORIES = [
  "Coffee", "Coffee Frappe", "Ice Coffee", "Milkshake",
  "Fresh Juice", "Frozen Fresh", "Mojito", "Desserts",
  "Cocktails", "Soft Drinks", "Hot Drinks", "Shisha", "Extras",
] as const;
export type MenuCategory = typeof MENU_CATEGORIES[number];

export interface MenuItem {
  id: string;
  name: string;
  price: number;
  category: MenuCategory;
  ingredients: RecipeIngredient[];
}

export interface OrderLine {
  menuItemId: string;
  name: string;
  qty: number;
  price: number;
  notes?: string;
  // How much of this line's current qty has already been sent to the
  // kitchen — NOT a boolean, since that would force re-sending the
  // FULL qty again the moment even one more unit is added. The
  // printable amount at any moment is qty - printedQuantity; after a
  // successful print, printedQuantity is set to whatever qty was at
  // that exact moment. Undefined/0 means nothing has been printed yet.
  printedQuantity?: number;
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
  // Pause/Resume: while paused, elapsed time (and therefore billing) stops
  // accumulating entirely — pausedDurationSec is the cumulative total of
  // all past pauses, subtracted from the raw elapsed time at billing.
  isPaused: boolean;
  pausedAt: number | null;
  pausedDurationSec: number;
  // Manual time extension/reduction — added on top of the natural
  // elapsed calculation. Extending is available to admin and cashier;
  // reducing is admin-only (a real under-billing risk if done
  // unsupervised), and can never push elapsed time below zero.
  timeAdjustmentSec: number;
  // Frozen rate-mode segments from switching Single<->Multi mid-session
  // — each entry is a completed period with its own rate and duration,
  // billed independently; only the CURRENT (still-running) period uses
  // the room's live hourlyRate/rateMode. Empty until the first switch.
  rateSegments: { rateMode: "single" | "multi"; hourlyRate: number; durationSec: number }[];
  // "room" = the original timed bays/VIP suite. "lounge" = a no-time-charge
  // table customers can be transferred to. "split" = an ephemeral
  // independent invoice created by extracting items off another active
  // room/table — checked out on its own, separately from the source.
  zone: "room" | "lounge" | "split" | "waste";
  splitInvoiceNumber: string | null;
  transferredFrom: string | null;
  // Owners Tables: lounge tables flagged for an automatic 25% discount on
  // every checkout/split against them.
  isOwnerTable: boolean;
}

export interface Session {
  id: string;
  // Clean permanent sequential Order # (1, 2, 3...) — never resets, shown
  // on the customer receipt instead of the raw internal id.
  orderNumber: number;
  roomId: string;
  roomName: string;
  startedAt: number;
  endedAt: number;
  durationSec: number;
  timeCost: number;
  // Frozen rate-mode segments as they stood at checkout — how timeCost
  // breaks down if the room ever switched Single<->Multi mid-session
  // (e.g. "1hr Single @ 100 + 45min Multi @ 150"). Includes the final
  // still-running-at-checkout period too, not just prior switches, so
  // together these always sum to exactly durationSec/timeCost. Empty
  // for a session that never switched modes, or for lounge tables.
  rateSegments: { rateMode: "single" | "multi"; hourlyRate: number; durationSec: number }[];
  orders: OrderLine[];
  ordersCost: number;
  total: number;
  cogs: number;
  discountAmount: number;
  discountLabel: string | null;
  timeDiscountAmount: number;
  timeDiscountLabel: string | null;
  ordersDiscountAmount: number;
  ordersDiscountLabel: string | null;
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
// A single admin cash-reconciliation snapshot, scoped to a SHIFT (not
// a calendar date) — a "Business Day" here is defined strictly by the
// shift's own lifecycle, so a shift spanning midnight is one
// continuous reconciliation scope regardless of calendar date.
// dateLabel is kept only as a display label (when this was recorded),
// not the actual financial scoping field. Deliberately independent
// from Shift's own expectedCash/discrepancy — see reconciliation.js
// for why the formulas differ on purpose.
export interface DailyReconciliation {
  id: string;
  shiftId: string | null;
  dateLabel: string;
  recordedAt: number;
  recordedBy: string;
  totalRevenue: number;
  instapayTotal: number;
  visaTotal: number;
  expensesTotal: number;
  expectedCash: number;
  actualCash: number;
  variance: number;
}

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
  // 24/7 Business Day lifecycle — links this shift to the continuous
  // business period it belongs to, independent of calendar midnight.
  businessDayId: string | null;
}

// A "Business Day" spans however many shifts happen between one explicit
// Close Business Day action and the next — NOT a calendar-midnight
// boundary. A cafe running Shift 1/2/3 across midnight stays on the SAME
// business day until the owner/head cashier explicitly closes it.
export interface BusinessDay {
  id: string;
  label: string; // human-readable, set from the date it opened
  openedAt: number;
  closedAt: number | null;
  totalRevenue: number;
  totalCash: number;
  totalVisa: number;
  totalInstapay: number;
  totalExpenses: number;
  netProfit: number;
  shiftCount: number;
  closedBy: string | null;
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
  // 24/7 Business Day lifecycle — the currently OPEN business period, if
  // any. Auto-created the moment a shift opens with none currently open;
  // stays open across any number of shifts (including past midnight)
  // until explicitly closed via Close Business Day.
  businessDayId: string | null;
  businessDays: BusinessDay[]; // computed, read fresh — same pattern as sessions/shifts
  // Permanent, never-resetting global counter — the source of every
  // Session's orderNumber. A tiny integer, safe to keep directly in the
  // state blob (not a growing list).
  orderCounter: number;
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
  // Admin-editable "current" cost price per unit — used for stock
  // valuation and as the default cost when restocking (can be overridden
  // at restock time to reflect a new purchase price).
  unitCost: number;
  // Manually counted physical stock (kitchen/store), for discrepancy
  // tracking against the system-calculated remaining figure.
  actualStock: number | null;
  actualStockUpdatedAt: number | null;
  actualStockUpdatedBy: string | null;
  // Set ONCE at creation, locked from editing permanently after — enforced
  // server-side, not just hidden in the UI.
  openingStock: number;
  category: string;
  storageLocation: string;
  // "تكلفة آخر شراء" — replaces average-cost logic. Auto-updated by every
  // approved purchase or restock, distinct from unitCost (which this
  // keeps in sync with, but exists as its own explicit, always-current field).
  lastPurchaseCost: number;
}

export interface RestockLogEntry {
  id: string;
  ts: number;
  materialId: string;
  materialName: string;
  qtyAdded: number;
  carryoverAdded: number;
  newTotal: number;
  unitCost: number;
  performedBy: string;
}

export type WasteInvoiceReason = "spill" | "expired" | "training" | "prepError";
export const WASTE_INVOICE_REASON_LABELS: Record<WasteInvoiceReason, string> = {
  spill: "Spill",
  expired: "Expired",
  training: "Training",
  prepError: "Preparation Error",
};
export interface WasteInvoice {
  id: string;
  invoiceNumber: number;
  ts: number;
  materialId: string;
  materialName: string;
  unit: string;
  wastedQty: number;
  reason: WasteInvoiceReason;
  reasonLabel: string;
  note: string;
  unitCost: number;
  totalCost: number;
  loggedBy: string;
  shiftId: string | null;
}

// Captured at Monthly Rollover time, for a specific ended period —
// "month" is "YYYY-MM". A permanent, read-only record: nothing after
// creation ever edits these rows.
export interface InventorySnapshot {
  id: string;
  month: string;
  archivedAt: number;
  materialId: string;
  materialName: string;
  unit: string;
  category: string;
  openingBalance: number;
  purchasesIn: number;
  salesWasteOut: number;
  finalSystemBalance: number;
  finalActualCount: number | null;
  unitCost: number;
  totalValue: number;
  archivedBy: string | null;
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

export type PaymentSource = "cash_drawer" | "out_of_pocket" | "bank_transfer";

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
  // More granular than paidFromDrawer — distinguishes "Out of Pocket"
  // (owner/staff personal expense, no till effect) from "Bank Transfer"
  // (digital payment, also no till effect) so reporting can break out
  // Till vs Personal vs Digital separately, not just drawer-or-not.
  paymentSource: PaymentSource | null;
  shiftId: string | null;
  materialId: string | null;
  qty: number | null;
  unitCost: number | null;
  // "paid" for everything except an unpaid/debt Expense entry — that
  // one case is what keeps paidFromDrawer false and paymentSource null
  // until it's settled via settleExpense.
  paymentStatus: "paid" | "unpaid";
}

// A supplier account's transaction history — invoices (debit, only when
// deferred) and payments (credit), with a running balance computed at
// each point. Deliberately separate from LedgerEntry: a supplier
// account is a running balance across many invoices and partial
// payments, not a single settleable debt.
export interface SupplierLedgerEntry {
  ts: number;
  type: "invoice" | "payment";
  description: string;
  amount: number;
  debit: number;
  credit: number;
  paymentType: "cash" | "deferred" | null;
  id: string;
  runningBalance: number;
  // Present on invoice-type entries only — full detail for the edit
  // form, avoiding a second round-trip for data already loaded here.
  invoiceDate?: number;
  paymentSource?: string | null;
  items?: { id: string; materialId: string; materialName: string; qty: number; unitPrice: number }[];
}

// ---------- Void workflow (anti-collusion) ----------

export type VoidReason = "wrongInput" | "spilled" | "customerRejected" | "complimentary";
// Spec calls for strictly "approved" | "pending" in the audit ledger's status
// column. "denied" is a pragmatic addition so admins can actually clear out
// a mistaken request instead of it sitting pending forever — it's excluded
// from both the Approved and Pending Approval buckets in reporting.
// "unapproved" is DIFFERENT from "pending": a pending void keeps the item
// on the live bill until reviewed (anti-collusion — nobody can remove a
// paid item without eventual admin sign-off). An "unapproved" void is the
// offline/no-admin-available route — the item is removed and inventory
// deducted IMMEDIATELY so checkout isn't blocked, and reconciliation
// happens after the fact via "discrepancy" if something looks wrong.
export type VoidStatus = "pending" | "approved" | "denied" | "unapproved" | "discrepancy";

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

export type WasteMarketingReason = "remakeWrongOrder" | "remakeComplaint" | "complimentary" | "spilledDamaged" | "marketingPromo" | "other";
export const WASTE_MARKETING_REASON_LABELS: Record<WasteMarketingReason, string> = {
  remakeWrongOrder: "Remake — Wrong Order",
  remakeComplaint: "Remake — Customer Complaint",
  complimentary: "Complimentary / VIP Hospitality",
  spilledDamaged: "Spilled / Damaged",
  marketingPromo: "Marketing / Promotional Giveaway",
  other: "Other",
};

export type StockAdjustmentReason = "waste" | "correction" | "opening_balance";

// ---------- Staff Orders & Consumption ----------
// Standard menu prices are used for costing/inventory purposes, but the
// amount is an EXPENSE (Staff Consumption Ledger), never retail revenue.
export interface StaffOrder {
  id: string;
  ts: number;
  staffName: string;
  items: OrderLine[];
  totalAmount: number;
  cogs: number;
  processedBy: string;
  shiftId: string | null;
}

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
