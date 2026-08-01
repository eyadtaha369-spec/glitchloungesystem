const fs = require("fs");
const path = require("path");
const { db, DB_PATH } = require("../db");

const BACKUP_DIR = process.env.GLITCH_BACKUP_DIR || path.join(__dirname, "..", "backups");
const KEEP_COUNT = 30; // roughly a month of nightly backups

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

// Runs a full backup: checkpoints the WAL first (merges any pending writes
// into the main .db file, so the copy is a complete, consistent snapshot
// rather than a half-written one), then copies the file.
function runBackup() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  try {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } catch (err) {
    console.error("Backup: WAL checkpoint failed, backing up anyway:", err.message);
  }
  const dest = path.join(BACKUP_DIR, `glitch-${timestamp()}.db`);
  fs.copyFileSync(DB_PATH, dest);
  pruneOldBackups();
  console.log("Backup saved:", dest);
  return dest;
}

function pruneOldBackups() {
  const files = fs.readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith("glitch-") && f.endsWith(".db"))
    .map((f) => ({ name: f, path: path.join(BACKUP_DIR, f), mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  files.slice(KEEP_COUNT).forEach((f) => fs.unlinkSync(f.path));
}

// Runs once immediately on server start (so you're never more than one
// server restart away from a fresh backup), then every 24 hours after
// that for as long as the server process stays running.
function scheduleBackups() {
  runBackup();
  setInterval(runBackup, 24 * 60 * 60 * 1000);
}

module.exports = { runBackup, scheduleBackups, BACKUP_DIR };
