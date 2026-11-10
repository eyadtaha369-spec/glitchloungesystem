// Corrects the counted cash of ONE closed shift (admin audit-logged action).
//
// Step 1 - look (changes nothing):
//   node scripts/correct-shift-cash.mjs --cashier hassan --date 2026-11-10 --time 09:06:35
// Step 2 - apply:
//   node scripts/correct-shift-cash.mjs --cashier hassan --date 2026-11-10 --time 09:06:35 \
//     --old 2808 --expected 6160.83 --new 6340 --reason "Cashier typed wrong count at closing" --apply
// Needs APPS_SCRIPT_URL + APPS_SCRIPT_SECRET in .env (or the shell) and the
// admin login in ADMIN_USERNAME / ADMIN_PASSWORD (or it asks).
import { readFileSync, existsSync } from "node:fs";
import readline from "node:readline/promises";

if (existsSync(".env")) {
  for (const l of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
const arg = (k) => { const i = process.argv.indexOf("--" + k); return i > -1 ? process.argv[i + 1] : undefined; };
const flag = (k) => process.argv.includes("--" + k);
const { APPS_SCRIPT_URL: url, APPS_SCRIPT_SECRET: secret } = process.env;
if (!url || !secret) { console.error("APPS_SCRIPT_URL / APPS_SCRIPT_SECRET not found in .env"); process.exit(1); }

const cashier = arg("cashier"), date = arg("date"), time = arg("time");
if (!cashier || !date || !time) { console.error("Need --cashier, --date YYYY-MM-DD and --time HH:MM:SS (Cairo time)"); process.exit(1); }

async function call(action, payload) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ secret, ...payload, action }), redirect: "follow" });
  return r.json();
}
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const username = process.env.ADMIN_USERNAME || (await rl.question("Admin username: "));

const st = await call("getState", { username });
const shifts = (st.state?.shifts ?? st.shifts ?? []);
// Cairo is UTC+2 in November (no DST then); match the closing second exactly.
const target = Date.parse(`${date}T${time}+02:00`);
const same = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
const cairoDay = (ts) => new Date(ts).toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });
const hits = shifts.filter((s) => same(s.cashierUsername, cashier) && s.closedAt && Math.abs(s.closedAt - target) < 1500);
if (hits.length !== 1) {
  console.log(`Found ${hits.length} matching shifts (need exactly 1). The server returned ${shifts.length} shifts in total.`);
  console.log("Cashier names seen:", [...new Set(shifts.map((s) => s.cashierUsername))].join(", ") || "(none)");
  console.log(`Closed shifts on ${date} (Cairo date):`);
  for (const s of shifts.filter((s) => s.closedAt && cairoDay(s.closedAt) === date))
    console.log(" ", s.id, s.cashierUsername, new Date(s.closedAt).toLocaleString("en-GB", { timeZone: "Africa/Cairo" }), "counted", s.closingActualCash, "expected", s.expectedCash);
  const last = shifts.filter((s) => s.closedAt).sort((a, b) => b.closedAt - a.closedAt).slice(0, 3);
  console.log("Latest closed shifts the server knows:");
  for (const s of last) console.log(" ", s.id, s.cashierUsername, new Date(s.closedAt).toLocaleString("en-GB", { timeZone: "Africa/Cairo" }));
  process.exit(1);
}
const s = hits[0];
console.log("\nFound shift:", s.id, "\n  cashier        ", s.cashierUsername, "\n  closed (Cairo) ", new Date(s.closedAt).toLocaleString("en-GB", { timeZone: "Africa/Cairo" }),
  "\n  counted cash   ", s.closingActualCash, "\n  expected cash  ", s.expectedCash, "\n  discrepancy    ", s.discrepancy);
if (!flag("apply")) { console.log("\nDry run only - nothing changed. Add --old --expected --new --reason and --apply to correct it."); process.exit(0); }

const oldV = Number(arg("old")), exp = Number(arg("expected")), neu = Number(arg("new")), reason = arg("reason");
if (![oldV, exp, neu].every(Number.isFinite) || !reason) { console.error("--apply needs --old, --expected, --new and --reason"); process.exit(1); }
console.log(`\nWill change counted cash ${oldV} -> ${neu}; discrepancy becomes ${(neu - exp).toFixed(2)}.`);
const password = process.env.ADMIN_PASSWORD || (await rl.question("Admin password: "));
if ((await rl.question("Type CORRECT to confirm: ")) !== "CORRECT") { console.log("Cancelled."); process.exit(0); }
const res = await call("correctShiftCash", { username, password, confirmText: "CORRECT", shiftId: s.id, newClosingActualCash: neu, expectedCashCheck: exp, oldClosingActualCash: oldV, reason });
console.log(res.ok ? "\nDONE. Before:" : "\nFAILED:", res.ok ? JSON.stringify(res.before) + "\nAfter: " + JSON.stringify(res.after) : res.error);
rl.close();
