# GLITCH Local Server — Phase 2 Offline Backend

Replaces Google Sheets + Apps Script with a local Node server + a real
SQLite file on your hard drive, speaking the **exact same** request
protocol your frontend already uses — no frontend changes needed, only
which URL it points at.

## Status: first working slice — tested end-to-end, not the full system yet

**Verified working right now** (real test run, not a guess):
login → open shift (with automatic business day creation) → start a
room with a rate → add an order → server correctly rejects it when
there's insufficient stock, accepts it when there is → checkout →
FIFO inventory deduction, exact COGS calculation, session persisted,
activity log correctly recorded. The numbers came out exactly right:
2 lattes correctly cost 5.72 EGP in ingredients (18g coffee × 2 ×
0.02 + 200ml milk × 2 × 0.01 + 1 cup × 2 × 0.5) and deducted exactly
that much stock.

**Actions implemented (12):** login, getState, startRoom, addOrder,
setOrderLineQty, setOrderLineNote, extendRoomTime, pauseRoom,
resumeRoom, endRoom, openShift, endShift.

**NOT implemented yet (~65 actions):** voids, procurement/restocking,
inventory corrections, split bills, transfers, staff orders, reports,
business day close, production reset, menu/material management, user
management. Calling one of these from the app right now returns a
clear "not implemented" error — it will never silently fail or
corrupt data, but large parts of the app won't work until these are
ported too, across upcoming sessions.

**Intentionally NOT ported:** geofence shift-location checking. It
exists to verify a cashier is physically at your venue over the
public internet; on a LAN you already control, it doesn't add
anything, so shifts can open from any register on your network.

## Migrating your real data from the live cloud site

This is a **separate, one-time step** — after installing and creating your
first account, run:

```bash
node migrate-from-sheets.js
```

It needs 4 settings — either in `server/.env` or as environment variables:

```
CLOUD_URL=https://script.google.com/.../exec     (your live Apps Script web app URL)
CLOUD_SECRET=<your live APPS_SCRIPT_SECRET>
CLOUD_ADMIN_USER=<a real admin username on the live site>
CLOUD_ADMIN_PASS=<that admin's password>
```

This pulls your real menu, room names/rates, raw materials, current stock
batches, suppliers, and recurring expenses from the live site and writes
them into the local database, replacing the placeholder starter set.
**Accounts (usernames + roles) are listed at the end but passwords are
never migrated** — the cloud API deliberately never exposes password
hashes — recreate each one with `create-account.js` using a new password.

**Not migrated yet**: historical Sessions, Shifts, Ledger, ActivityLogs,
and other past-activity records. The app works fully for everything
going forward; old reports just won't show pre-migration history.

## Setup

No Python, no Visual Studio Build Tools, no compilation — this uses
Node's own built-in SQLite (Node 22.5+), not a native addon package.
You'll see one harmless line like `ExperimentalWarning: SQLite is an
experimental feature` every time it runs — that's just Node's normal
notice for a newer built-in feature, not an error.

```bash
cd server
npm install
```

Create your first login:

```bash
node create-account.js <username> <password> admin
```

Run it:

```bash
npm start
```

By default it listens on port 4000 with a placeholder shared secret
(`change-me-local-secret`) — fine to leave as-is on a private home/venue
network. To customize either one, create `server/.env`:
```
PORT=4000
GLITCH_LOCAL_SECRET=pick-your-own-long-random-string
```

You should see:
```
GLITCH local server listening on http://0.0.0.0:4000
Actions implemented so far: login, getState, startRoom, ...
```

The database file is created automatically at `server/glitch.db` on
first run. **Back this file up regularly** — it is your entire
business's data once you're running locally.

## Pointing the app at it

In the main app's environment (`.env` when running locally, or
whatever config the Electron shell uses):

```
APPS_SCRIPT_URL=http://<host-laptop-IP>:4000/
APPS_SCRIPT_SECRET=change-me-local-secret   # or your custom GLITCH_LOCAL_SECRET, must match exactly
```

Use the **host laptop's actual LAN IP** (e.g. `http://192.168.1.50:4000/`),
not `localhost`, so other registers on the network can reach it too.
Find it on the host with `ipconfig` (Windows) and look for "IPv4
Address" under your active network adapter.

## Multiple registers on one network

Every register (including the host machine itself) opens the app in
a browser pointed at the host's address — same UI everyone already
knows. The host is the only machine that needs Node.js and this
server running; the others are just clients.

Fired 10 genuinely simultaneous requests from different "registers" at
the same room and confirmed zero lost updates (all 10 items landed
correctly) and that opening a second shift while one's already active
is correctly rejected every time, even under concurrent load. Node's
single-threaded event loop combined with this server's synchronous
SQLite calls means two requests can never actually interleave
mid-write — there's no window for the kind of race condition a
multi-register setup would otherwise risk.

## Automatic backups

Runs once the moment the server starts, then every 24 hours after
that for as long as it keeps running — saved to `server/backups/`,
keeping the most recent 30. Each backup checkpoints the database
first (merges any pending writes) so it's always a complete,
consistent snapshot, never a half-written one. Copy any of these
files to a USB drive anytime for extra offsite insurance — they're
just plain files.

## Building the desktop .exe

From the repo root (not `server/`):

```bash
npm install
npm run electron:build
```

This produces an installer in `electron-dist/`. **This step has to
run on your own Windows machine** — I can write and verify the
configuration, but I can't produce or test a real Windows binary from
here. First run `npm run electron:dev` to sanity-check the shell opens
correctly against your local server before building the installer.

