// Local offline backend for GLITCH Lounge OS.
//
// This deliberately implements the EXACT same request/response contract
// as the Google Apps Script version (POST {secret, action, ...} -> JSON),
// so the existing frontend needs ZERO changes — only APPS_SCRIPT_URL in
// its .env changes, to point here instead of Google.
//
// STATUS: first working slice. Covers login, state, and the full room /
// order / shift lifecycle (start, add items, adjust qty, notes, pause,
// resume, extend time, checkout, open/close shift). The remaining ~65
// actions (voids, procurement, inventory restocking, reports, business
// day close, staff orders, etc.) are NOT ported yet — calling one of
// those from the UI right now will return a clear "not implemented"
// error instead of failing silently or corrupting data.

const express = require("express");
const cors = require("cors");
const { readObjects_, updateObjectById_, appendObject_ } = require("./db");
const { newId_, logActivity_ } = require("./lib/util");
const { login_, roleForUsername_, requireRole_ } = require("./lib/auth");
const {
  getState_, setState_, withStockView_,
  readSessions_, appendSessionRow_, readShifts_,
} = require("./lib/state");
const {
  bizStartRoom_, bizAddOrder_, bizSetOrderLineQty_, bizSetOrderLineNote_,
  bizExtendRoomTime_, bizPauseRoom_, bizResumeRoom_, bizEndRoom_,
} = require("./lib/rooms");
const { bizOpenShift_, bizCloseActiveShift_ } = require("./lib/shifts");

const PORT = process.env.PORT || 4000;
const SHARED_SECRET = process.env.GLITCH_LOCAL_SECRET || "change-me-local-secret";

const app = express();
app.use(cors()); // other registers on the LAN need to reach this
app.use(express.json({ limit: "5mb" }));

function json_(obj) {
  return obj;
}

const handlers = {
  login(body) {
    const result = login_(body.username, body.password);
    if (result.ok) {
      logActivity_({ actorUsername: result.username, actorRole: result.role, actionType: "LOGIN_SUCCESS", description: result.username + " (" + result.role + ") logged in" });
    } else {
      logActivity_({ actorUsername: body.username, actorRole: "unknown", actionType: "LOGIN_FAILED", description: "Failed login attempt for username '" + body.username + "'" });
    }
    return json_(result);
  },

  getState(body) {
    requireRole_(body.username, ["admin", "cashier"]);
    return json_({ state: withStockView_(getState_()) });
  },

  startRoom(body) {
    requireRole_(body.username, ["admin", "cashier"]);
    const result = bizStartRoom_(getState_(), body.roomId, body.rateMode);
    if (result.ok) {
      setState_(result.state);
      const room = result.state.rooms.find((r) => r.id === body.roomId);
      logActivity_({
        actorUsername: body.username, actorRole: roleForUsername_(body.username), actionType: "ROOM_STARTED",
        location: room ? room.name : body.roomId, shiftId: result.state.activeShiftId,
        description: (room ? room.name : body.roomId) + " session started" + (room && room.rateMode ? " (" + room.rateMode + " @ " + room.hourlyRate + " EGP/hr)" : ""),
      });
    }
    return json_({ ok: result.ok, error: result.error || null, state: withStockView_(result.state) });
  },

  extendRoomTime(body) {
    requireRole_(body.username, ["admin", "cashier"]);
    const state0 = getState_();
    const before = state0.rooms.find((r) => r.id === body.roomId);
    const result = bizExtendRoomTime_(state0, body.roomId, body.deltaSec);
    if (!result.ok) return json_({ ok: false, error: result.error, state: withStockView_(result.state) });
    setState_(result.state);
    const after = result.state.rooms.find((r) => r.id === body.roomId);
    logActivity_({
      actorUsername: body.username, actorRole: roleForUsername_(body.username), actionType: "ROOM_TIME_EXTENDED",
      location: before ? before.name : body.roomId, shiftId: result.state.activeShiftId,
      description: (before ? before.name : body.roomId) + " time extended by +" + Math.round((Number(body.deltaSec) || 0) / 60) + " min",
      before: { timeAdjustmentSec: before ? before.timeAdjustmentSec : 0 },
      after: { timeAdjustmentSec: after ? after.timeAdjustmentSec : 0 },
    });
    return json_({ ok: true, state: withStockView_(result.state) });
  },

  pauseRoom(body) {
    requireRole_(body.username, ["admin", "cashier"]);
    const state0 = getState_();
    const before = state0.rooms.find((r) => r.id === body.roomId);
    const result = bizPauseRoom_(state0, body.roomId);
    if (!result.ok) return json_({ ok: false, error: result.error, state: withStockView_(result.state) });
    setState_(result.state);
    logActivity_({
      actorUsername: body.username, actorRole: roleForUsername_(body.username), actionType: "ROOM_PAUSED",
      location: before ? before.name : body.roomId, shiftId: result.state.activeShiftId,
      description: (before ? before.name : body.roomId) + " session paused",
    });
    return json_({ ok: true, state: withStockView_(result.state) });
  },

  resumeRoom(body) {
    requireRole_(body.username, ["admin", "cashier"]);
    const state0 = getState_();
    const before = state0.rooms.find((r) => r.id === body.roomId);
    const result = bizResumeRoom_(state0, body.roomId);
    if (!result.ok) return json_({ ok: false, error: result.error, state: withStockView_(result.state) });
    setState_(result.state);
    logActivity_({
      actorUsername: body.username, actorRole: roleForUsername_(body.username), actionType: "ROOM_RESUMED",
      location: before ? before.name : body.roomId, shiftId: result.state.activeShiftId,
      description: (before ? before.name : body.roomId) + " session resumed",
    });
    return json_({ ok: true, state: withStockView_(result.state) });
  },

  endRoom(body) {
    requireRole_(body.username, ["admin", "cashier"]);
    const batches = readObjects_("Batches");
    const result = bizEndRoom_(getState_(), batches, body.roomId, body.splitBill, body.paymentMethod, body.cashAmount, body.secondaryAmount, body.frozenAt);
    if (result.error) return json_({ session: null, error: result.error, state: withStockView_(result.state) });
    if (result.session) {
      setState_(result.state);
      appendSessionRow_(result.session);
      result.touchedBatchIds.forEach((id) => {
        const b = batches.find((x) => x.id === id);
        if (b) updateObjectById_("Batches", id, { qtyRemaining: b.qtyRemaining });
      });
      appendObject_("Ledger", {
        id: newId_("ledg"), ts: result.session.endedAt, amount: result.session.total, direction: "inflow",
        type: "sale", category: "Room Sale", description: result.session.roomName + " checkout",
        supplierId: null, staffUsername: body.username, status: "approved", receiptUrl: null,
        paidFromDrawer: result.session.cashAmount > 0, shiftId: result.session.shiftId,
        materialId: null, qty: null, unitCost: null, paymentSource: null,
      });
      logActivity_({
        actorUsername: body.username, actorRole: roleForUsername_(body.username),
        actionType: body.splitBill ? "CHECKOUT_SPLIT_BILL" : "CHECKOUT",
        location: result.session.roomName, shiftId: result.session.shiftId,
        description: result.session.roomName + " checked out — " + result.session.total.toFixed(2) + " EGP (" + result.session.paymentMethod + ")",
        before: { orders: result.session.orders },
        after: { total: result.session.total, cogs: result.session.cogs, cashAmount: result.session.cashAmount, visaAmount: result.session.visaAmount, instapayAmount: result.session.instapayAmount },
      });
    }
    return json_({ session: result.session, state: withStockView_(result.state) });
  },

  addOrder(body) {
    requireRole_(body.username, ["admin", "cashier"]);
    const batches = readObjects_("Batches");
    const stateBefore = getState_();
    const roomBefore = stateBefore.rooms.find((r) => r.id === body.roomId);
    const qtyBefore = roomBefore ? (roomBefore.orders.find((o) => o.menuItemId === body.menuItemId) || {}).qty || 0 : 0;
    const result = bizAddOrder_(stateBefore, batches, body.roomId, body.menuItemId, body.qty);
    if (result.ok) {
      setState_(result.state);
      const roomAfter = result.state.rooms.find((r) => r.id === body.roomId);
      const lineAfter = roomAfter ? roomAfter.orders.find((o) => o.menuItemId === body.menuItemId) : null;
      logActivity_({
        actorUsername: body.username, actorRole: roleForUsername_(body.username), actionType: "ITEM_ADDED",
        location: roomAfter ? roomAfter.name : body.roomId, shiftId: result.state.activeShiftId,
        description: "Added " + body.qty + "x " + (lineAfter ? lineAfter.name : body.menuItemId) + " to " + (roomAfter ? roomAfter.name : body.roomId),
        before: { qty: qtyBefore }, after: { qty: lineAfter ? lineAfter.qty : null },
      });
    }
    return json_({ ok: result.ok, error: result.error || null, state: withStockView_(result.state) });
  },

  setOrderLineQty(body) {
    requireRole_(body.username, ["admin", "cashier"]);
    const batches = readObjects_("Batches");
    const stateBefore = getState_();
    const roomBefore = stateBefore.rooms.find((r) => r.id === body.roomId);
    const lineBefore = roomBefore ? roomBefore.orders.find((o) => o.menuItemId === body.menuItemId) : null;
    const result = bizSetOrderLineQty_(stateBefore, batches, body.roomId, body.menuItemId, body.qty);
    if (result.ok) {
      setState_(result.state);
      logActivity_({
        actorUsername: body.username, actorRole: roleForUsername_(body.username), actionType: "ITEM_QTY_CHANGED",
        location: roomBefore ? roomBefore.name : body.roomId, shiftId: result.state.activeShiftId,
        description: (lineBefore ? lineBefore.name : body.menuItemId) + " qty changed to " + body.qty + " on " + (roomBefore ? roomBefore.name : body.roomId),
        before: { qty: lineBefore ? lineBefore.qty : null }, after: { qty: body.qty },
      });
    }
    return json_({ ok: result.ok, error: result.error || null, state: withStockView_(result.state) });
  },

  setOrderLineNote(body) {
    requireRole_(body.username, ["admin", "cashier"]);
    const stateBefore = getState_();
    const result = bizSetOrderLineNote_(stateBefore, body.roomId, body.menuItemId, body.notes);
    if (result.ok) setState_(result.state);
    return json_({ ok: result.ok, error: result.error || null, state: withStockView_(result.state) });
  },

  openShift(body) {
    const role = requireRole_(body.username, ["admin", "cashier"]);
    const state0 = getState_();
    // Geofencing is intentionally NOT ported for the local install — it
    // exists to verify a cashier is physically at a specific venue over
    // the public internet; on a local network you already control, it
    // doesn't add anything. Leave geofenceEnabled off in local state.
    const result = bizOpenShift_(state0, body.username, body.openingBalance, body.lat, body.lng);
    if (result.ok) {
      setState_(result.state);
      logActivity_({
        actorUsername: body.username, actorRole: role, actionType: "START_SHIFT", shiftId: result.state.activeShiftId,
        description: body.username + " started a shift (opening " + (body.openingBalance || 0).toFixed(2) + " EGP)",
        after: { openingBalance: body.openingBalance },
      });
    }
    return json_({ ok: result.ok, error: result.error || null, state: withStockView_(result.state) });
  },

  endShift(body) {
    const role = requireRole_(body.username, ["admin", "cashier"]);
    const state0 = getState_();
    const shiftIdBefore = state0.activeShiftId;
    const ledger = readObjects_("Ledger");
    const result = bizCloseActiveShift_(state0, readSessions_(), ledger, readShifts_(), body.actualCash, false, body.lat, body.lng);
    if (result.ok) {
      setState_(result.state);
      const closed = result.closedShift;
      logActivity_({
        actorUsername: body.username, actorRole: role, actionType: "END_SHIFT", shiftId: shiftIdBefore,
        description: body.username + " ended shift — expected " + (closed ? closed.expectedCash.toFixed(2) : "?") + " EGP, counted " + (closed ? closed.closingActualCash.toFixed(2) : "?") + " EGP",
        after: closed ? { expectedCash: closed.expectedCash, closingActualCash: closed.closingActualCash, discrepancy: closed.discrepancy } : null,
      });
    }
    return json_({ ok: result.ok, error: result.error || null, state: withStockView_(result.state) });
  },
};

app.post("/", (req, res) => {
  const body = req.body || {};
  if (body.secret !== SHARED_SECRET) {
    res.status(403).json({ error: "forbidden — secret mismatch" });
    return;
  }
  const handler = handlers[body.action];
  if (!handler) {
    res.status(200).json({ error: "Action '" + body.action + "' is not implemented in the local server yet." });
    return;
  }
  try {
    const result = handler(body);
    res.status(200).json(result);
  } catch (err) {
    res.status(200).json({ error: String(err && err.message ? err.message : err) });
  }
});

app.get("/health", (req, res) => res.json({ ok: true, actionsImplemented: Object.keys(handlers).length }));

app.listen(PORT, "0.0.0.0", () => {
  console.log("GLITCH local server listening on http://0.0.0.0:" + PORT);
  console.log("Actions implemented so far: " + Object.keys(handlers).join(", "));
});
