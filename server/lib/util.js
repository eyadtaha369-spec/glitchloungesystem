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
  ORDER_ITEM_TRANSFERRED: "red", SESSION_TIME_SPLIT_ADJUSTED: "red", EXPENSES_LEDGER_CLEARED: "red",
  EVENT_BOOKING_CREATED: "green", EVENT_BOOKING_UPDATED: "green", EVENT_BOOKING_DELETED: "yellow",
  FIXED_MONTHLY_COST_LOGGED: "green", FIXED_MONTHLY_COST_UPDATED: "yellow", FIXED_MONTHLY_COST_DELETED: "yellow",
  ROOM_AVATAR_UPDATED: "green",
  ROOM_ADDED: "green", ROOM_DELETED: "yellow",
};

// Direct port of Code.gs's logActivity_ — appends one permanent,
// never-updated row.
// A single Google Sheets cell has a hard 50,000 character ceiling —
// this data has to survive being exported and imported into the
// cloud, so anything logged here must stay under that regardless of
// which backend (this one, or Code.gs) originally wrote it. This is a
// defensive backstop, not the primary fix for any specific feature
// that logs too much — it exists so a future mistake like that can
// never again produce a value that fails an entire migration import,
// it just loses detail on that one oversized log entry instead.
const ACTIVITY_LOG_FIELD_LIMIT = 45000;
function safeStringifyForLog_(obj) {
  const json = JSON.stringify(obj);
  if (json.length <= ACTIVITY_LOG_FIELD_LIMIT) return json;
  // The preview slice is itself already-escaped JSON text -- wrapping
  // it as a string VALUE inside another JSON.stringify re-escapes
  // every quote and backslash in it, which can nearly double its
  // length. Budget for the worst case rather than slicing close to
  // the limit and overshooting it after re-escaping.
  const preview = json.slice(0, Math.floor(ACTIVITY_LOG_FIELD_LIMIT / 2) - 200);
  return JSON.stringify({ truncated: true, originalLength: json.length, preview: preview });
}

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
    before: before ? safeStringifyForLog_(before) : null,
    after: after ? safeStringifyForLog_(after) : null,
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
