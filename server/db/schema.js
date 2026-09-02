// Faithful 1:1 port of every Google Sheets tab used by google-apps-script/Code.gs.
// Column names and shapes match sheetObjectHeaders_() exactly, on purpose —
// this keeps the ported business logic (handlers/*.js) as close to a
// line-by-line translation of Code.gs as possible, which is what actually
// keeps this port low-risk instead of a from-scratch rewrite.
//
// AppState is stored the SAME way it always was: one row, one JSON blob
// column — not because that's the "best" schema, but because replicating
// exactly what already works (and was already hardened against the
// 50,000-character bug earlier in this project) is safer than redesigning
// it from scratch during a migration.

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS AppState (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS Accounts (
  username TEXT PRIMARY KEY,
  passwordHash TEXT NOT NULL,
  role TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS RawMaterials (
  id TEXT PRIMARY KEY,
  name TEXT, unit TEXT, minStockAlert REAL, unitCost REAL,
  actualStock REAL, actualStockUpdatedAt INTEGER, actualStockUpdatedBy TEXT,
  openingStock REAL, category TEXT, storageLocation TEXT, lastPurchaseCost REAL
);

CREATE TABLE IF NOT EXISTS PurchaseInvoices (
  id TEXT PRIMARY KEY,
  supplierId TEXT, supplierName TEXT, invoiceDate INTEGER, paymentType TEXT,
  totalAmount REAL, createdAt INTEGER, createdBy TEXT, paymentSource TEXT
);

CREATE TABLE IF NOT EXISTS PurchaseInvoiceItems (
  id TEXT PRIMARY KEY,
  invoiceId TEXT, materialId TEXT, materialName TEXT, qty REAL, unitPrice REAL, subtotal REAL
);

CREATE TABLE IF NOT EXISTS SupplierPayments (
  id TEXT PRIMARY KEY,
  supplierId TEXT, ts INTEGER, amount REAL, paymentSource TEXT, note TEXT, recordedBy TEXT
);

CREATE TABLE IF NOT EXISTS Suppliers (
  id TEXT PRIMARY KEY,
  name TEXT, contact TEXT, category TEXT
);

CREATE TABLE IF NOT EXISTS RecurringExpenses (
  id TEXT PRIMARY KEY,
  name TEXT, amount REAL, active INTEGER
);

CREATE TABLE IF NOT EXISTS Batches (
  id TEXT PRIMARY KEY,
  materialId TEXT, supplierId TEXT, qtyPurchased REAL, qtyRemaining REAL,
  unitCost REAL, purchasedAt INTEGER, source TEXT, invoiceId TEXT, ledgerId TEXT
);

CREATE TABLE IF NOT EXISTS Ledger (
  id TEXT PRIMARY KEY,
  ts INTEGER, amount REAL, direction TEXT, type TEXT, category TEXT,
  description TEXT, supplierId TEXT, staffUsername TEXT, status TEXT,
  receiptUrl TEXT, paidFromDrawer INTEGER, shiftId TEXT, materialId TEXT,
  qty REAL, unitCost REAL, paymentSource TEXT, paymentStatus TEXT
);

CREATE TABLE IF NOT EXISTS VoidRequests (
  id TEXT PRIMARY KEY,
  ts INTEGER, roomId TEXT, roomName TEXT, menuItemId TEXT, itemName TEXT,
  qty REAL, unitPrice REAL, billValue REAL, reason TEXT, status TEXT,
  cashierUsername TEXT, waiterName TEXT, shiftId TEXT, approvedBy TEXT,
  approvedAt INTEGER, cogs REAL, applied INTEGER, applyError TEXT
);

CREATE TABLE IF NOT EXISTS ActivityLogs (
  id TEXT PRIMARY KEY,
  ts INTEGER, actorUsername TEXT, actorRole TEXT, actionType TEXT,
  location TEXT, riskLevel TEXT, description TEXT, before TEXT, after TEXT,
  shiftId TEXT
);

CREATE TABLE IF NOT EXISTS Sessions (
  id TEXT PRIMARY KEY,
  orderNumber INTEGER, roomId TEXT, roomName TEXT, startedAt INTEGER,
  endedAt INTEGER, durationSec REAL, timeCost REAL, orders TEXT,
  ordersCost REAL, total REAL, cogs REAL, discountAmount REAL,
  discountLabel TEXT, timeDiscountAmount REAL, timeDiscountLabel TEXT,
  ordersDiscountAmount REAL, ordersDiscountLabel TEXT,
  splitBill INTEGER, paymentMethod TEXT,
  cashAmount REAL, visaAmount REAL, instapayAmount REAL, shiftId TEXT,
  rateSegments TEXT
);

CREATE TABLE IF NOT EXISTS Shifts (
  id TEXT PRIMARY KEY,
  cashierUsername TEXT, openedAt INTEGER, closedAt INTEGER,
  openingBalance REAL, closingActualCash REAL, expectedCash REAL,
  discrepancy REAL, forced INTEGER, openedLat REAL, openedLng REAL,
  closedLat REAL, closedLng REAL, businessDayId TEXT, kotCounter INTEGER
);

CREATE TABLE IF NOT EXISTS StaffOrders (
  id TEXT PRIMARY KEY,
  ts INTEGER, staffName TEXT, items TEXT, totalAmount REAL, cogs REAL,
  processedBy TEXT, shiftId TEXT
);

CREATE TABLE IF NOT EXISTS RestockLog (
  id TEXT PRIMARY KEY,
  ts INTEGER, materialId TEXT, materialName TEXT, qtyAdded REAL,
  carryoverAdded REAL, newTotal REAL, unitCost REAL, performedBy TEXT
);

CREATE TABLE IF NOT EXISTS WasteInvoices (
  id TEXT PRIMARY KEY,
  invoiceNumber INTEGER, ts INTEGER, materialId TEXT, materialName TEXT,
  unit TEXT, wastedQty REAL, reason TEXT, reasonLabel TEXT, note TEXT,
  unitCost REAL, totalCost REAL, loggedBy TEXT, shiftId TEXT
);

CREATE TABLE IF NOT EXISTS InventorySnapshots (
  id TEXT PRIMARY KEY,
  month TEXT, archivedAt INTEGER, materialId TEXT, materialName TEXT,
  unit TEXT, category TEXT, openingBalance REAL, purchasesIn REAL,
  salesWasteOut REAL, finalSystemBalance REAL, finalActualCount REAL,
  unitCost REAL, totalValue REAL, archivedBy TEXT
);

CREATE TABLE IF NOT EXISTS BusinessDays (
  id TEXT PRIMARY KEY,
  label TEXT, openedAt INTEGER, closedAt INTEGER, totalRevenue REAL,
  totalCash REAL, totalVisa REAL, totalInstapay REAL, totalExpenses REAL,
  netProfit REAL, shiftCount INTEGER, closedBy TEXT
);

-- Admin dashboard's daily cash reconciliation snapshots. dateLabel is the
-- calendar day (YYYY-MM-DD) this snapshot covers, NOT necessarily the
-- day it was recorded on -- an admin could reconcile after midnight for
-- the day just ending. Multiple snapshots per day are allowed (e.g. a
-- correction later in the day); the history keeps every one recorded,
-- it never overwrites a prior entry.
CREATE TABLE IF NOT EXISTS DailyReconciliations (
  id TEXT PRIMARY KEY,
  shiftId TEXT, dateLabel TEXT, recordedAt INTEGER, recordedBy TEXT,
  totalRevenue REAL, instapayTotal REAL, visaTotal REAL, expensesTotal REAL,
  expectedCash REAL, actualCash REAL, variance REAL
);

-- Indexes on the columns every report/lookup actually filters by —
-- Sheets never needed these (it scans everything), SQLite benefits a lot
-- from them once history grows past a few hundred rows.
CREATE INDEX IF NOT EXISTS idx_sessions_shift ON Sessions(shiftId);
CREATE INDEX IF NOT EXISTS idx_sessions_ts ON Sessions(endedAt);
CREATE INDEX IF NOT EXISTS idx_ledger_shift ON Ledger(shiftId);
CREATE INDEX IF NOT EXISTS idx_ledger_ts ON Ledger(ts);
CREATE INDEX IF NOT EXISTS idx_activity_ts ON ActivityLogs(ts);
CREATE INDEX IF NOT EXISTS idx_batches_material ON Batches(materialId);
CREATE INDEX IF NOT EXISTS idx_void_status ON VoidRequests(status);
`;

module.exports = { SCHEMA_SQL };
