const { readObjects_, appendObject_, updateObjectById_ } = require("../db");
const { newId_ } = require("./util");
const { consumeFifo_, writeBatchesBack_ } = require("./state");

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

module.exports = { adjustStock_, bizRestockMaterial_ };
