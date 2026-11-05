// Usage:  node scripts/make-owner-hash.mjs "your new owner password"
// Prints the value to paste into OWNER_PASSWORD_HASH (local .env and Vercel).
import { scryptSync, randomBytes } from "node:crypto";
const pw = process.argv[2];
if (!pw || pw.length < 8) {
  console.error('Give a password of at least 8 characters:  node scripts/make-owner-hash.mjs "your password"');
  process.exit(1);
}
const salt = randomBytes(16);
const hash = scryptSync(pw, salt, 32);
console.log("\nOWNER_PASSWORD_HASH=scrypt:" + salt.toString("hex") + ":" + hash.toString("hex") + "\n");
