// Direct port of Code.gs's defaultAppState_(). Since you chose to migrate
// your real data (Option B), this only actually gets used if the local
// database is ever completely empty — the migration script populates the
// real menu/rooms/materials instead of this placeholder starter set.
function defaultAppState_() {
  const menu = [
    { id: "latte", name: "Latte", price: 4.5, category: "Hot Drinks", ingredients: [{ stockId: "coffee", qty: 18 }, { stockId: "milk", qty: 200 }, { stockId: "cups", qty: 1 }] },
    { id: "espresso", name: "Espresso", price: 3.0, category: "Hot Drinks", ingredients: [{ stockId: "coffee", qty: 18 }, { stockId: "cups", qty: 1 }] },
    { id: "soda-drink", name: "Soda", price: 2.5, category: "Soft Drinks", ingredients: [{ stockId: "soda", qty: 1 }] },
    { id: "chips-snack", name: "Chips", price: 2.0, category: "Extras", ingredients: [{ stockId: "chips", qty: 1 }] },
  ];
  const rooms = [];
  for (let i = 1; i <= 8; i++) {
    rooms.push({ id: "room-" + i, name: "Room " + i, isVip: false, hourlyRate: 0, singleRate: 5, multiRate: 8, rateMode: null, status: "available", startedAt: null, orders: [], zone: "room", splitInvoiceNumber: null, transferredFrom: null, isOwnerTable: false, isPaused: false, pausedAt: null, pausedDurationSec: 0, timeAdjustmentSec: 0 });
  }
  rooms.push({ id: "room-vip", name: "VIP", isVip: true, hourlyRate: 0, singleRate: 10, multiRate: 15, rateMode: null, status: "available", startedAt: null, orders: [], zone: "room", splitInvoiceNumber: null, transferredFrom: null, isOwnerTable: false, isPaused: false, pausedAt: null, pausedDurationSec: 0, timeAdjustmentSec: 0 });
  for (let i = 1; i <= 6; i++) {
    rooms.push({ id: "lounge-" + i, name: "Lounge Table " + i, isVip: false, hourlyRate: 0, singleRate: 0, multiRate: 0, rateMode: null, status: "available", startedAt: null, orders: [], zone: "lounge", splitInvoiceNumber: null, transferredFrom: null, isOwnerTable: false, isPaused: false, pausedAt: null, pausedDurationSec: 0, timeAdjustmentSec: 0 });
  }
  for (let i = 1; i <= 6; i++) {
    rooms.push({ id: "owner-" + i, name: "Owner Table " + i, isVip: false, hourlyRate: 0, singleRate: 0, multiRate: 0, rateMode: null, status: "available", startedAt: null, orders: [], zone: "lounge", splitInvoiceNumber: null, transferredFrom: null, isOwnerTable: true, isPaused: false, pausedAt: null, pausedDurationSec: 0, timeAdjustmentSec: 0 });
  }
  rooms.push({ id: "waste-marketing", name: "Wasted / Marketing / هدر وماركتينج", isVip: false, hourlyRate: 0, singleRate: 0, multiRate: 0, rateMode: null, status: "active", startedAt: Date.now(), orders: [], zone: "waste", splitInvoiceNumber: null, transferredFrom: null, isOwnerTable: false, isPaused: false, pausedAt: null, pausedDurationSec: 0, timeAdjustmentSec: 0 });
  return {
    rooms: rooms, menu: menu, sessions: [], activity: [], cashRecords: [],
    actualCashInput: 0, shifts: [], activeShiftId: null, businessDayId: null, orderCounter: 0, wasteInvoiceCounter: 0, fraudThresholdPercent: 2,
    geofenceEnabled: false, cafeLat: 0, cafeLng: 0, geofenceRadiusMeters: 50,
  };
}

module.exports = { defaultAppState_ };
