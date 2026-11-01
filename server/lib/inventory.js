const { readObjects_, appendObject_, updateObjectById_ } = require("../db");
const { newId_ } = require("./util");
const { consumeFifo_, restoreFifo_, writeBatchesBack_, getState_, setState_, readSessions_ } = require("./state");

const WASTE_INVOICE_REASONS = {
  spill: "Spill",
  expired: "Expired",
  training: "Training",
  prepError: "Preparation Error",
};

// Distinct from Wasted/Marketing (which wastes finished MENU ITEMS off
// the virtual table, deducting their recipe ingredients). This wastes a
// RAW MATERIAL directly — spoiled coffee beans, an expired carton of
// milk — with no menu item or recipe involved at all.
function bizSubmitWasteInvoice_(materialId, wastedQty, reason, note, username, shiftId) {
  if (!WASTE_INVOICE_REASONS[reason]) return { ok: false, error: "Select a reason (Spill, Expired, or Training)." };
  const qty = Number(wastedQty) || 0;
  if (qty <= 0) return { ok: false, error: "Enter a wasted quantity greater than zero." };

  const material = readObjects_("RawMaterials").find((m) => m.id === materialId);
  if (!material) return { ok: false, error: "Material not found." };

  const batches = readObjects_("Batches");
  const remaining = batches.filter((b) => b.materialId === materialId).reduce((a, b) => a + Number(b.qtyRemaining), 0);
  if (qty > remaining + 1e-9) {
    return { ok: false, error: `Only ${remaining} ${material.unit} of ${material.name} in stock — can't waste ${qty}.` };
  }

  const res = consumeFifo_(batches, materialId, qty);
  writeBatchesBack_(batches, res.touched);

  const state = getState_();
  state.wasteInvoiceCounter = (state.wasteInvoiceCounter || 0) + 1;
  const invoiceNumber = state.wasteInvoiceCounter;
  setState_(state);

  const now = Date.now();
  const invoice = {
    id: newId_("wasteinv"), invoiceNumber, ts: now, materialId, materialName: material.name,
    unit: material.unit, wastedQty: qty, reason, reasonLabel: WASTE_INVOICE_REASONS[reason], note: note || "",
    unitCost: material.unitCost, totalCost: res.cost, loggedBy: username, shiftId: shiftId || null,
  };
  appendObject_("WasteInvoices", invoice);

  if (res.cost > 0) {
    appendObject_("Ledger", {
      id: newId_("ledg"), ts: now, amount: res.cost, direction: "outflow", type: "manualAdjustment",
      category: "Raw Material Waste", description: `Waste Invoice #${String(invoiceNumber).padStart(3, "0")}: ${qty} ${material.unit} ${material.name} — ${WASTE_INVOICE_REASONS[reason]}${note ? " (" + note + ")" : ""}`,
      supplierId: null, staffUsername: username, status: "approved", receiptUrl: null,
      paidFromDrawer: false, shiftId: shiftId || null, materialId, qty, unitCost: material.unitCost, paymentSource: null,
    });
  }

  return { ok: true, invoice };
}

// "اعتماد كبداية شهر جديد" — Monthly Rollover. For EVERY material: takes
// the current Actual Stock (physical count) if one has been entered,
// otherwise falls back to the current System Balance; consolidates all
// existing batches into ONE new batch representing that quantity (same
// spirit as restock's carryover folding); sets that as the new,
// permanently-locked Opening Stock for the new period; and clears the
// Actual Count so it correctly shows "not yet counted this period"
// until the next physical audit. Consolidating batches is what actually
// resets the Purchases/In and Sales & Waste/Out counters — both are
// DERIVED from the full batch history, so starting that history over
// from one new batch is what makes them read zero for the new period.
function bizRolloverInventory_(username) {
  const materials = readObjects_("RawMaterials");
  const batches = readObjects_("Batches");

  // Require a real physical count for every material before allowing
  // the period to close — otherwise the "new Opening Balance" for
  // whatever's missing would silently fall back to the system's own
  // calculated number, defeating the entire point of a physical audit.
  const missing = materials.filter((m) => m.actualStock === null || m.actualStock === undefined || m.actualStock === "");
  if (missing.length > 0) {
    return { ok: false, error: "Enter Actual Stock for all materials before confirming the audit — missing: " + missing.map((m) => m.name).join(", ") };
  }

  const now = Date.now();
  const monthLabel = (function () {
    const d = new Date(now);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  })();
  let count = 0;

  materials.forEach((m) => {
    const matBatches = batches.filter((b) => b.materialId === m.id);
    const initialStock = matBatches.reduce((a, b) => a + Number(b.qtyPurchased), 0);
    const systemBalance = matBatches.reduce((a, b) => a + Number(b.qtyRemaining), 0);
    const actualStock = (m.actualStock === null || m.actualStock === undefined || m.actualStock === "") ? null : Number(m.actualStock);
    const newOpening = actualStock !== null ? actualStock : systemBalance;

    // Snapshot the period that's ENDING — captured BEFORE the reset
    // below, since consolidating batches is what makes Purchases/In and
    // Sales&Waste/Out correctly read zero for the new period. Without
    // this snapshot, that history would just be gone the moment the
    // rollover ran, with no way to look back at a past month.
    const openingStock = Number(m.openingStock) || 0;
    const purchasesIn = Math.round((initialStock - openingStock) * 1e6) / 1e6;
    const salesWasteOut = initialStock - systemBalance;
    const unitCost = Number(m.unitCost) || 0;
    appendObject_("InventorySnapshots", {
      id: newId_("snap"), month: monthLabel, archivedAt: now, materialId: m.id, materialName: m.name,
      unit: m.unit, category: m.category || "", openingBalance: openingStock, purchasesIn, salesWasteOut,
      finalSystemBalance: systemBalance, finalActualCount: actualStock, unitCost,
      totalValue: Math.round((actualStock !== null ? actualStock : systemBalance) * unitCost * 100) / 100,
      archivedBy: username || null,
    });

    matBatches.forEach((b) => updateObjectById_("Batches", b.id, { qtyPurchased: 0, qtyRemaining: 0 }));
    if (newOpening > 0) {
      appendObject_("Batches", {
        id: newId_("batch"), materialId: m.id, supplierId: null,
        qtyPurchased: newOpening, qtyRemaining: newOpening, unitCost: m.unitCost,
        purchasedAt: now, source: "openingStock",
      });
    }
    updateObjectById_("RawMaterials", m.id, { openingStock: newOpening, actualStock: null, actualStockUpdatedAt: null, actualStockUpdatedBy: null });
    count++;
  });

  return { ok: true, count, month: monthLabel };
}

function adjustStock_(materialId, deltaQty, reason, note, username) {
  const batches = readObjects_("Batches");
  const before = batches.filter((b) => b.materialId === materialId).reduce((a, b) => a + Number(b.qtyRemaining), 0);
  let cost = 0;
  if (deltaQty > 0) {
    appendObject_("Batches", { id: newId_("batch"), materialId, supplierId: null, qtyPurchased: deltaQty, qtyRemaining: deltaQty, unitCost: 0, purchasedAt: Date.now(), source: "dailyFresh" });
  } else if (deltaQty < 0) {
    const res = consumeFifo_(batches, materialId, Math.abs(deltaQty));
    cost = res.cost;
    writeBatchesBack_(batches, res.touched);
  }
  const after = before + deltaQty;

  if (reason === "waste" && deltaQty < 0 && cost > 0) {
    appendObject_("Ledger", {
      id: newId_("ledg"), ts: Date.now(), amount: cost, direction: "outflow", type: "manualAdjustment",
      category: "Operational Waste / Damaged Goods", description: "Manual stock adjustment: " + (note || "waste"),
      supplierId: null, staffUsername: username, status: "approved", receiptUrl: null,
      paidFromDrawer: false, shiftId: null, materialId, qty: Math.abs(deltaQty), unitCost: null, paymentSource: null,
    });
  }
  return { before, after, cost };
}

function bizRestockMaterial_(materialId, qtyAdded, unitCost, username) {
  if (!qtyAdded || qtyAdded <= 0) return { ok: false, error: "Enter a quantity greater than zero" };
  const materials = readObjects_("RawMaterials");
  const material = materials.find((m) => m.id === materialId);
  if (!material) return { ok: false, error: "Material not found" };

  const batches = readObjects_("Batches");
  const existing = batches.filter((b) => b.materialId === materialId && Number(b.qtyRemaining) > 0);
  const carryover = existing.reduce((a, b) => a + Number(b.qtyRemaining), 0);

  existing.forEach((b) => {
    const consumedFromThisBatch = Number(b.qtyPurchased) - Number(b.qtyRemaining);
    updateObjectById_("Batches", b.id, { qtyPurchased: consumedFromThisBatch, qtyRemaining: 0 });
  });

  const newTotal = qtyAdded + carryover;
  const finalUnitCost = typeof unitCost === "number" && unitCost >= 0 ? unitCost : (Number(material.unitCost) || 0);
  const now = Date.now();
  appendObject_("Batches", { id: newId_("batch"), materialId, supplierId: null, qtyPurchased: newTotal, qtyRemaining: newTotal, unitCost: finalUnitCost, purchasedAt: now, source: "restock" });

  if (typeof unitCost === "number" && unitCost >= 0) {
    updateObjectById_("RawMaterials", materialId, { unitCost, lastPurchaseCost: unitCost });
  }

  appendObject_("RestockLog", { id: newId_("restock"), ts: now, materialId, materialName: material.name, qtyAdded, carryoverAdded: carryover, newTotal, unitCost: finalUnitCost, performedBy: username });

  return { ok: true, materialName: material.name, qtyAdded, carryover, newTotal, unitCost: finalUnitCost };
}


// "Stock Re-alignment" -- admin bulk physical-count override. Sets each
// counted material's system balance to EXACTLY the physical count: a
// deficit consumes batches oldest-first (like a sale would), a surplus
// adds one new "auditBaseline" batch. The count also becomes the
// material's Actual Stock, so the variance reads zero and every future
// POS sale / recipe FIFO deduction starts from this number. Validated in
// full BEFORE anything is written (all-or-nothing). Returns one row per
// material so the caller can write INVENTORY_AUDIT_ADJUSTMENT log lines.
function bizRealignStock_(counts, username) {
  if (!Array.isArray(counts) || counts.length === 0) return { ok: false, error: "Enter at least one physical count." };
  const materials = readObjects_("RawMaterials");
  const batches = readObjects_("Batches");
  const seen = {};
  const plan = [];
  for (let i = 0; i < counts.length; i++) {
    const c = counts[i] || {};
    const material = materials.find((m) => m.id === c.materialId);
    if (!material) return { ok: false, error: "Material not found: " + c.materialId };
    if (seen[material.id]) return { ok: false, error: material.name + " appears twice." };
    seen[material.id] = true;
    const actual = Number(c.actualStock);
    if (c.actualStock === "" || c.actualStock === null || c.actualStock === undefined || !isFinite(actual) || actual < 0 || actual > 1e7) {
      return { ok: false, error: "Invalid count for " + material.name + "." };
    }
    plan.push({ material, actual });
  }
  const now = Date.now();
  const results = [];
  plan.forEach((p) => {
    const m = p.material;
    const before = batches.filter((b) => b.materialId === m.id).reduce((a, b) => a + (Number(b.qtyRemaining) || 0), 0);
    const variance = Math.round((p.actual - before) * 1e6) / 1e6;
    if (variance < -1e-9) {
      const res = consumeFifo_(batches, m.id, Math.abs(variance));
      writeBatchesBack_(batches, res.touched);
    } else if (variance > 1e-9) {
      const res = restoreFifo_(batches, m.id, variance, Number(m.unitCost) || 0, now, "auditBaseline");
      appendObject_("Batches", res.newBatch);
    }
    updateObjectById_("RawMaterials", m.id, { actualStock: p.actual, actualStockUpdatedAt: now, actualStockUpdatedBy: username });
    const unitCost = Number(m.unitCost) || 0;
    results.push({
      materialId: m.id, materialName: m.name, unit: m.unit, expectedStock: before, actualStock: p.actual,
      variance, unitCost, varianceValue: Math.round(Math.abs(variance) * unitCost * 100) / 100,
    });
  });
  return { ok: true, results };
}

// Where did the stock go? Read-only trace for ONE material: every batch
// ever created for it (by source), plus what the recorded orders should
// have consumed (closed sessions + open rooms, using the CURRENT recipe)
// versus what the batches say was actually used. Whatever isn't
// explained by orders/waste invoices/audit write-offs is reported as
// "unexplained" -- that's the number to chase (wrong unit on entry,
// recipe edited after the fact, staff meals, waste/marketing, etc.).
const TRACE_ADDED_SOURCES_ = { restock: 1, openingStock: 1, dailyFresh: 1, stockedBatch: 1, invoice: 1, supplierInvoice: 1 };
const TRACE_RETURN_SOURCES_ = { orderRestore: 1, auditAdjustment: 1, auditBaseline: 1 };
function bizStockTrace_(materialId) {
  const material = readObjects_("RawMaterials").find((m) => m.id === materialId);
  if (!material) return { ok: false, error: "Material not found" };
  const state = getState_();
  const recipeQty = {};
  (state.menu || []).forEach((item) => {
    const q = (item.ingredients || []).filter((i) => i.stockId === materialId).reduce((a, i) => a + (Number(i.qty) || 0), 0);
    if (q > 0) recipeQty[item.id] = { name: item.name, perUnit: q };
  });
  const batches = readObjects_("Batches").filter((b) => b.materialId === materialId)
    .sort((a, b) => Number(a.purchasedAt) - Number(b.purchasedAt))
    .map((b) => ({ id: b.id, ts: Number(b.purchasedAt) || 0, source: b.source || "purchase", qtyPurchased: Number(b.qtyPurchased) || 0, qtyRemaining: Number(b.qtyRemaining) || 0, unitCost: Number(b.unitCost) || 0 }));
  const orderRows = [];
  const pushOrders = (orders, ts, ref) => {
    (orders || []).forEach((o) => {
      const r = recipeQty[o.menuItemId];
      if (r) orderRows.push({ ts, ref, itemName: r.name, orderQty: Number(o.qty) || 0, perUnit: r.perUnit, consumed: r.perUnit * (Number(o.qty) || 0) });
    });
  };
  readSessions_().forEach((s) => pushOrders(s.orders, s.endedAt, "Order #" + (s.orderNumber || s.id)));
  (state.rooms || []).forEach((r) => pushOrders(r.orders, Date.now(), "Open: " + r.name));
  orderRows.sort((a, b) => b.ts - a.ts);
  const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);
  const added = sum(batches.filter((b) => TRACE_ADDED_SOURCES_[b.source] || !TRACE_RETURN_SOURCES_[b.source]), (b) => b.qtyPurchased);
  const returned = sum(batches.filter((b) => TRACE_RETURN_SOURCES_[b.source]), (b) => b.qtyPurchased);
  const remaining = sum(batches, (b) => b.qtyRemaining);
  const totalUsed = added + returned - remaining;
  const byOrders = sum(orderRows, (r) => r.consumed);
  const wasteInvoices = readObjects_("WasteInvoices").filter((w) => w.materialId === materialId);
  const byWaste = sum(wasteInvoices, (w) => Number(w.wastedQty) || 0);
  const audits = readObjects_("ActivityLogs").filter((l) => (l.actionType === "ACTUAL_STOCK_SET" || l.actionType === "INVENTORY_AUDIT_ADJUSTMENT") && l.after).map((l) => {
    let a = {}; try { a = JSON.parse(l.after); } catch (e) { a = {}; }
    return { ts: Number(l.ts) || 0, actor: l.actorUsername, ...a };
  }).filter((a) => a.materialId === materialId);
  const byAuditWriteOff = sum(audits.filter((a) => a.variance < 0), (a) => Math.abs(a.variance));
  const unexplained = Math.round((totalUsed - byOrders - byWaste - byAuditWriteOff) * 1e6) / 1e6;
  return {
    ok: true, materialName: material.name, unit: material.unit, remaining,
    summary: { added, returned, totalUsed, byOrders, byWaste, byAuditWriteOff, unexplained },
    batches, orderRows: orderRows.slice(0, 200), orderRowCount: orderRows.length,
    wasteInvoices: wasteInvoices.map((w) => ({ ts: Number(w.ts), qty: Number(w.wastedQty), reason: w.reasonLabel })),
    audits, recipes: Object.keys(recipeQty).map((k) => ({ itemName: recipeQty[k].name, perUnit: recipeQty[k].perUnit })),
  };
}

module.exports = { bizRealignStock_, bizStockTrace_, adjustStock_, bizRestockMaterial_, bizSubmitWasteInvoice_, WASTE_INVOICE_REASONS, bizRolloverInventory_ };
