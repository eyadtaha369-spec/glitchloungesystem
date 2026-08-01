const { db } = require("../db");
const { sha256Hex_ } = require("./crypto");

// Direct port of Code.gs's login_(username, password).
function login_(username, password) {
  const hash = sha256Hex_(String(password || ""));
  const row = db.prepare("SELECT username, role FROM Accounts WHERE username = ? AND passwordHash = ?").get(username, hash);
  return row ? { ok: true, username: row.username, role: row.role } : { ok: false };
}

function roleForUsername_(username) {
  const row = db.prepare("SELECT role FROM Accounts WHERE username = ?").get(username);
  return row ? row.role : "unknown";
}

// Direct port of Code.gs's requireRole_ — throws if the username doesn't
// exist or isn't one of the allowed roles.
function requireRole_(username, allowedRoles) {
  const role = roleForUsername_(username);
  if (role === "unknown" || !allowedRoles.includes(role)) {
    throw new Error("Forbidden: " + username + " (" + role + ") is not permitted to do this.");
  }
  return role;
}

function getAccounts_() {
  return db.prepare("SELECT username, role FROM Accounts").all();
}

module.exports = { login_, roleForUsername_, requireRole_, getAccounts_ };
