// Server-only. Owner Report unlock: password verified against
// OWNER_PASSWORD_HASH (scrypt, never plain text), then a short-lived
// signed token that expires after 2 minutes of inactivity.
import { scryptSync, timingSafeEqual, createHmac } from "node:crypto";

export const OWNER_IDLE_MS = 2 * 60 * 1000;

export function verifyOwnerPassword(password: string): boolean {
  const stored = process.env.OWNER_PASSWORD_HASH;
  if (!stored) throw new Error("OWNER_PASSWORD_HASH is not set on the server. See the README for how to create it.");
  const [scheme, saltHex, hashHex] = stored.trim().split(":");
  if (scheme !== "scrypt" || !saltHex || !hashHex) throw new Error("OWNER_PASSWORD_HASH is malformed (expected scrypt:<salt>:<hash>).");
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(String(password ?? ""), Buffer.from(saltHex, "hex"), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// Best-effort brute-force brake (per server instance): 5 wrong tries in a
// row locks that account out of the unlock for 60 seconds.
const attempts = new Map<string, { fails: number; lockedUntil: number }>();
export function checkAndRecordAttempt(username: string, ok: boolean): void {
  const now = Date.now();
  const rec = attempts.get(username) ?? { fails: 0, lockedUntil: 0 };
  if (rec.lockedUntil > now) throw new Error("Too many wrong attempts. Wait a minute and try again.");
  if (ok) { attempts.delete(username); return; }
  rec.fails += 1;
  if (rec.fails >= 5) { rec.lockedUntil = now + 60_000; rec.fails = 0; }
  attempts.set(username, rec);
}
export function assertNotLockedOut(username: string): void {
  const rec = attempts.get(username);
  if (rec && rec.lockedUntil > Date.now()) throw new Error("Too many wrong attempts. Wait a minute and try again.");
}

function signingKey(): string {
  const k = process.env.SESSION_SECRET;
  if (!k || k.length < 32) throw new Error("SESSION_SECRET env var is missing or too short.");
  return k;
}
const sign = (payload: string) => createHmac("sha256", signingKey()).update("owner-report|" + payload).digest("hex");

export function issueOwnerToken(username: string): { token: string; expiresAt: number } {
  const expiresAt = Date.now() + OWNER_IDLE_MS;
  const payload = `${username}.${expiresAt}`;
  return { token: `${payload}.${sign(payload)}`, expiresAt };
}

export function assertOwnerToken(token: string | undefined, username: string): void {
  const parts = String(token ?? "").split(".");
  if (parts.length < 3) throw new Error("OWNER_LOCKED");
  const sig = parts.pop() as string;
  const expStr = parts.pop() as string;
  const user = parts.join(".");
  const expected = sign(`${user}.${expStr}`);
  const ok = sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  if (!ok || user !== username || !(Number(expStr) > Date.now())) throw new Error("OWNER_LOCKED");
}
