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

## Setup

```bash
cd server
npm install
```

Create `server/.env` (or set these as real environment variables):

```
PORT=4000
GLITCH_LOCAL_SECRET=pick-a-long-random-string-here
```

Run it:

```bash
npm start
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
APPS_SCRIPT_SECRET=pick-a-long-random-string-here   # must match GLITCH_LOCAL_SECRET above
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
