// Usage:
//   node create-account.js <username> <password> <role>
// Example:
//   node create-account.js owner MySecurePass123 admin
//
// User management via the app's own Users page isn't ported yet, so this
// is the way to create your first login (and any future ones) until it is.
const { db } = require("./db");
const { sha256Hex_ } = require("./lib/crypto");

const [, , username, password, roleArg] = process.argv;
const role = (roleArg || "admin").toLowerCase() === "cashier" ? "cashier" : "admin";

if (!username || !password) {
  console.log("Usage: node create-account.js <username> <password> [admin|cashier]");
  console.log("Example: node create-account.js owner MySecurePass123 admin");
  process.exit(1);
}

const hash = sha256Hex_(password);
db.prepare(
  "INSERT INTO Accounts (username, passwordHash, role) VALUES (?, ?, ?) " +
  "ON CONFLICT(username) DO UPDATE SET passwordHash = excluded.passwordHash, role = excluded.role"
).run(username, hash, role);

console.log(`Saved: "${username}" as ${role}. You can log in with this now.`);
