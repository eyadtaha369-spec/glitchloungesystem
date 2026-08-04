const { readObjects_, appendObject_, updateObjectById_ } = require("../db");
const { newId_ } = require("./util");
const { consumeFifo_, writeBatchesBack_, getState_, setState_ } = require("./state");

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

module.exports = { adjustStock_, bizRestockMaterial_, bizSubmitWasteInvoice_, WASTE_INVOICE_REASONS, bizRolloverInventory_ };
