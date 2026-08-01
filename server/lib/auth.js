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

function addAccount_(username, password, role) {
  if (!username || !password || !role) return { ok: false, error: "Missing fields" };
  const existing = db.prepare("SELECT username FROM Accounts WHERE username = ?").get(username);
  if (existing) return { ok: false, error: "Username already exists" };
  db.prepare("INSERT INTO Accounts (username, passwordHash, role) VALUES (?, ?, ?)").run(username, sha256Hex_(password), role);
  return { ok: true };
}

function updateAccount_(originalUsername, patch) {
  const existing = db.prepare("SELECT * FROM Accounts WHERE username = ?").get(originalUsername);
  if (!existing) return { ok: false, error: "Account not found" };
  const nextUsername = (patch.username && patch.username.trim()) || existing.username;
  if (nextUsername !== existing.username) {
    const clash = db.prepare("SELECT username FROM Accounts WHERE username = ?").get(nextUsername);
    if (clash) return { ok: false, error: "Username already exists" };
  }
  const nextHash = patch.password && patch.password.length > 0 ? sha256Hex_(patch.password) : existing.passwordHash;
  const nextRole = patch.role || existing.role;
  db.prepare("DELETE FROM Accounts WHERE username = ?").run(originalUsername);
  db.prepare("INSERT INTO Accounts (username, passwordHash, role) VALUES (?, ?, ?)").run(nextUsername, nextHash, nextRole);
  return { ok: true };
}

function deleteAccount_(username) {
  const info = db.prepare("DELETE FROM Accounts WHERE username = ?").run(username);
  return info.changes > 0 ? { ok: true } : { ok: false, error: "Account not found" };
}

module.exports = { login_, roleForUsername_, requireRole_, getAccounts_, addAccount_, updateAccount_, deleteAccount_ };
