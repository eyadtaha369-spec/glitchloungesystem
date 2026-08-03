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
    updateObjectById_("RawMaterials", materialId, { unitCost });
  }

  appendObject_("RestockLog", { id: newId_("restock"), ts: now, materialId, materialName: material.name, qtyAdded, carryoverAdded: carryover, newTotal, unitCost: finalUnitCost, performedBy: username });

  return { ok: true, materialName: material.name, qtyAdded, carryover, newTotal, unitCost: finalUnitCost };
}

module.exports = { adjustStock_, bizRestockMaterial_, bizSubmitWasteInvoice_, WASTE_INVOICE_REASONS };
