// Edit/delete for procurement records — both regular purchases
// (Ledger entries with a linked batch) and multi-item Supplier
// Invoices. Core safety rule throughout: if the stock a purchase
// brought in has already been touched by a later sale/waste/etc
// (qtyRemaining !== qtyPurchased on its batch), editing or deleting
// it is BLOCKED with a clear message — reversing something that's
// already been partially consumed would either go negative or
// silently misstate what's actually in stock.

function findLinkedBatch(readObjects_, ledgerId) {
  return readObjects_("Batches").find((b) => b.ledgerId === ledgerId) || null;
}

function batchIsUntouched(batch) {
  return Math.abs(Number(batch.qtyRemaining) - Number(batch.qtyPurchased)) < 1e-9;
}

function bizDeletePurchase_(deps, ledgerId) {
  const { readObjects_, deleteObjectById_ } = deps;
  const entry = readObjects_("Ledger").find((l) => l.id === ledgerId);
  if (!entry) return { ok: false, error: "Entry not found." };

  const batch = findLinkedBatch(readObjects_, ledgerId);
  if (batch && !batchIsUntouched(batch)) {
    const used = Number(batch.qtyPurchased) - Number(batch.qtyRemaining);
    return { ok: false, error: "Can't delete — " + used + " of the " + batch.qtyPurchased + " purchased has already been used in sales or waste. Nothing was changed." };
  }

  if (batch) deleteObjectById_("Batches", batch.id);
  deleteObjectById_("Ledger", ledgerId);
  return { ok: true, materialId: entry.materialId || null };
}

function bizUpdatePurchase_(deps, body) {
  const { readObjects_, updateObjectById_ } = deps;
  const entry = readObjects_("Ledger").find((l) => l.id === body.ledgerId);
  if (!entry) return { ok: false, error: "Entry not found." };

  const qtyChanging = body.qty !== undefined && Number(body.qty) !== Number(entry.qty);
  const costChanging = body.unitCost !== undefined && Number(body.unitCost) !== Number(entry.unitCost);
  const batch = findLinkedBatch(readObjects_, body.ledgerId);

  if ((qtyChanging || costChanging) && batch && !batchIsUntouched(batch)) {
    const used = Number(batch.qtyPurchased) - Number(batch.qtyRemaining);
    return { ok: false, error: "Can't change quantity or cost — " + used + " of the " + batch.qtyPurchased + " purchased has already been used. You can still edit the description, category, or supplier." };
  }

  const newQty = qtyChanging ? Number(body.qty) : Number(entry.qty);
  const newCost = costChanging ? Number(body.unitCost) : Number(entry.unitCost);
  const ledgerPatch = {};
  if (body.description !== undefined) ledgerPatch.description = body.description;
  if (body.category !== undefined) ledgerPatch.category = body.category;
  if (body.supplierId !== undefined) ledgerPatch.supplierId = body.supplierId;
  if (qtyChanging) ledgerPatch.qty = newQty;
  if (costChanging) ledgerPatch.unitCost = newCost;
  if (qtyChanging || costChanging) ledgerPatch.amount = newQty * newCost;

  updateObjectById_("Ledger", body.ledgerId, ledgerPatch);

  if (batch && (qtyChanging || costChanging)) {
    updateObjectById_("Batches", batch.id, { qtyPurchased: newQty, qtyRemaining: newQty, unitCost: newCost });
  }

  return { ok: true };
}

function bizDeleteSupplierInvoice_(deps, invoiceId) {
  const { readObjects_, deleteObjectById_ } = deps;
  const invoice = readObjects_("PurchaseInvoices").find((i) => i.id === invoiceId);
  if (!invoice) return { ok: false, error: "Invoice not found." };

  const batches = readObjects_("Batches").filter((b) => b.invoiceId === invoiceId);
  const touched = batches.filter((b) => !batchIsUntouched(b));
  if (touched.length > 0) {
    const items = readObjects_("PurchaseInvoiceItems").filter((it) => it.invoiceId === invoiceId);
    const names = touched.map((b) => {
      const item = items.find((it) => it.materialId === b.materialId);
      return item ? item.materialName : b.materialId;
    });
    return { ok: false, error: "Can't delete — some items on this invoice have already been used: " + names.join(", ") + ". Nothing was changed." };
  }

  const linkedLedgerId = batches.length > 0 ? batches[0].ledgerId : null;
  batches.forEach((b) => deleteObjectById_("Batches", b.id));
  readObjects_("PurchaseInvoiceItems").filter((it) => it.invoiceId === invoiceId).forEach((it) => deleteObjectById_("PurchaseInvoiceItems", it.id));
  if (linkedLedgerId) deleteObjectById_("Ledger", linkedLedgerId);
  deleteObjectById_("PurchaseInvoices", invoiceId);

  return { ok: true, supplierId: invoice.supplierId };
}

module.exports = { bizDeletePurchase_, bizUpdatePurchase_, bizDeleteSupplierInvoice_, findLinkedBatch, batchIsUntouched };
