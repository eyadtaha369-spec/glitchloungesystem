const { db, appendObject_ } = require("../db");

function newId_(prefix) {
  return prefix + "-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7);
}

// Direct port of Code.gs's ACTION_RISK map — only the entries this first
// slice actually uses so far. Extend as more actions get ported.
const ACTION_RISK = {
  LOGIN_SUCCESS: "green", LOGIN_FAILED: "yellow",
  ROOM_STARTED: "green", ITEM_ADDED: "green", CHECKOUT: "green",
  START_SHIFT: "green", END_SHIFT: "green",
  ORDER_ITEM_TRANSFERRED: "red", SESSION_TIME_SPLIT_ADJUSTED: "red",
};

// Direct port of Code.gs's logActivity_ — appends one permanent,
// never-updated row.
function logActivity_({ actorUsername, actorRole, actionType, location, shiftId, description, before, after }) {
  appendObject_("ActivityLogs", {
    id: newId_("act"),
    ts: Date.now(),
    actorUsername: actorUsername || "",
    actorRole: actorRole || "unknown",
    actionType: actionType,
    location: location || "",
    riskLevel: ACTION_RISK[actionType] || "yellow",
    description: description || "",
    before: before ? JSON.stringify(before) : null,
    after: after ? JSON.stringify(after) : null,
    shiftId: shiftId || null,
  });
}

// Direct port of Code.gs's pushActivity_ — the small in-memory "recent
// feed" that lives INSIDE the state blob (distinct from the permanent
// ActivityLogs table), capped at 100 entries.
function pushActivity_(state, message) {
  state.activity = [{ ts: Date.now(), message: message }, ...(state.activity || [])].slice(0, 100);
}

module.exports = { newId_, logActivity_, pushActivity_ };
