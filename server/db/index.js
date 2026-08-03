const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const { SCHEMA_SQL } = require("./schema");

// The actual database FILE lives right next to this server, on the host
// laptop's hard drive — this is the one file that IS your business.
// Back it up like you'd back up anything irreplaceable.
const DB_PATH = process.env.GLITCH_DB_PATH || path.join(__dirname, "..", "glitch.db");

// Using Node's BUILT-IN SQLite (available since Node 22.5, stable in the
// versions this app targets) instead of the better-sqlite3 package on
// purpose — better-sqlite3 is a native addon that needs to compile C++
// code on install, which requires Python + a full C++ build toolchain on
// Windows. That's a heavy, error-prone ask for a laptop that just needs
// to run a POS. node:sqlite needs none of that: it ships inside Node
// itself, zero extra installs, same core API (prepare/run/get/all,
// @param named bindings, ON CONFLICT upserts — all verified to behave
// identically before this switch was made).
const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL"); // safe for multiple registers writing concurrently
// If the file is ever momentarily locked by anything else — another
// stray process still holding it open, a backup's checkpoint, a slow
// disk — wait up to 5 seconds for it to clear instead of immediately
// failing the request with "database is locked". Genuinely observed
// this exact error during testing (a leftover process from an earlier
// session still had the file open); this makes that class of problem
// self-heal instead of surfacing as a broken button.
db.exec("PRAGMA busy_timeout = 5000");
db.exec(SCHEMA_SQL);

// Migration: CREATE TABLE IF NOT EXISTS only applies to brand-new
// databases — an existing glitch.db from before this feature won't
// automatically gain these columns. ALTER TABLE ADD COLUMN has no
// "IF NOT EXISTS" in SQLite, so guard each with try/catch instead;
// running against an already-migrated database is then a harmless no-op.
function addColumnIfMissing_(table, column, type) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  } catch (err) {
    if (!/duplicate column/i.test(err.message)) throw err;
  }
}
addColumnIfMissing_("Sessions", "timeDiscountAmount", "REAL");
addColumnIfMissing_("Sessions", "timeDiscountLabel", "TEXT");
addColumnIfMissing_("Sessions", "ordersDiscountAmount", "REAL");
addColumnIfMissing_("Sessions", "ordersDiscountLabel", "TEXT");
addColumnIfMissing_("RawMaterials", "openingStock", "REAL");

const KNOWN_TABLES = [
  "RawMaterials", "Suppliers", "RecurringExpenses", "Batches", "Ledger",
  "VoidRequests", "ActivityLogs", "Sessions", "Shifts", "StaffOrders",
  "RestockLog", "BusinessDays", "WasteInvoices",
];

function assertTable(table) {
  if (!KNOWN_TABLES.includes(table)) throw new Error("Unknown table: " + table);
}

// Mirrors Code.gs's readObjects_(sheetName) — returns every row as a plain
// object. Sheets never enforced types (everything came back loosely
// typed); this does the same on purpose so ported handler code that does
// `Number(x.amount)` or `!!x.applied` keeps working unchanged.
function readObjects_(table) {
  assertTable(table);
  return db.prepare(`SELECT * FROM ${table}`).all();
}

// Mirrors Code.gs's appendObject_(sheetName, obj) — inserts one row.
// Missing keys become NULL (same as an empty Sheets cell).
function appendObject_(table, obj) {
  assertTable(table);
  const cols = Object.keys(obj);
  const placeholders = cols.map((c) => "@" + c).join(", ");
  const stmt = db.prepare(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${placeholders})`);
  const row = {};
  cols.forEach((c) => {
    const v = obj[c];
    row[c] = v === undefined || v === null ? null : (typeof v === "boolean" ? (v ? 1 : 0) : v);
  });
  stmt.run(row);
}

// Mirrors Code.gs's updateObjectById_(sheetName, id, patch) — merges only
// the given fields into the existing row, leaves everything else alone.
// Returns true/false the same way the Sheets version did (false = no such row).
function updateObjectById_(table, id, patch) {
  assertTable(table);
  const cols = Object.keys(patch);
  if (cols.length === 0) return true;
  const setClause = cols.map((c) => `${c} = @${c}`).join(", ");
  const row = { id };
  cols.forEach((c) => {
    const v = patch[c];
    row[c] = v === undefined || v === null ? null : (typeof v === "boolean" ? (v ? 1 : 0) : v);
  });
  const info = db.prepare(`UPDATE ${table} SET ${setClause} WHERE id = @id`).run(row);
  return info.changes > 0;
}

function deleteObjectById_(table, id) {
  assertTable(table);
  const info = db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
  return info.changes > 0;
}

// ---- AppState: same single-blob pattern as the Sheets version ----
function getStateRaw_() {
  const row = db.prepare("SELECT json FROM AppState WHERE id = 1").get();
  return row ? row.json : null;
}
function setStateRaw_(jsonText) {
  db.prepare(
    "INSERT INTO AppState (id, json) VALUES (1, @json) " +
    "ON CONFLICT(id) DO UPDATE SET json = @json"
  ).run({ json: jsonText });
}

module.exports = {
  db, DB_PATH,
  readObjects_, appendObject_, updateObjectById_, deleteObjectById_,
  getStateRaw_, setStateRaw_,
};
