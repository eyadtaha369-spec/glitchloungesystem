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

// Admin-only, per explicit request — bypasses the "already used"
// safety check that bizDeleteSupplierInvoice_ enforces above.
// Deliberately a SEPARATE function rather than a flag on the normal
// delete, so the two code paths stay easy to tell apart and this one
// is never reachable by accident. Reversing stock that's already been
// sold does NOT rewrite anything about those past sales — their cogs
// was already computed and stored on the Session at the moment of
// sale, not recomputed later — but it does mean the Batches table
// loses its record of where that already-consumed stock came from,
// which is the real, accepted tradeoff of forcing this through.
function bizForceDeleteSupplierInvoice_(deps, invoiceId) {
  const { readObjects_, deleteObjectById_ } = deps;
  const invoice = readObjects_("PurchaseInvoices").find((i) => i.id === invoiceId);
  if (!invoice) return { ok: false, error: "Invoice not found." };

  const batches = readObjects_("Batches").filter((b) => b.invoiceId === invoiceId);
  const linkedLedgerId = batches.length > 0 ? batches[0].ledgerId : null;
  batches.forEach((b) => deleteObjectById_("Batches", b.id));
  readObjects_("PurchaseInvoiceItems").filter((it) => it.invoiceId === invoiceId).forEach((it) => deleteObjectById_("PurchaseInvoiceItems", it.id));
  if (linkedLedgerId) deleteObjectById_("Ledger", linkedLedgerId);
  deleteObjectById_("PurchaseInvoices", invoiceId);

  return { ok: true, supplierId: invoice.supplierId };
}

// Edits a supplier invoice: invoiceDate, paymentType/paymentSource, and
// each line item's qty/unitPrice. Still respects the same
// already-touched safety check per item as bizUpdatePurchase_ does —
// editing wasn't part of the explicit "force" request, only deleting
// was, so this stays the safe version. Recomputes totalAmount from
// whatever the items end up being, and keeps the linked Batches and
// Ledger entry in exact sync with the result.
function bizUpdateSupplierInvoice_(deps, body) {
  const { readObjects_, updateObjectById_ } = deps;
  const invoice = readObjects_("PurchaseInvoices").find((i) => i.id === body.invoiceId);
  if (!invoice) return { ok: false, error: "Invoice not found." };
  const existingItems = readObjects_("PurchaseInvoiceItems").filter((it) => it.invoiceId === body.invoiceId);
  const batches = readObjects_("Batches").filter((b) => b.invoiceId === body.invoiceId);
  const items = Array.isArray(body.items) ? body.items : [];

  // Validate every changed item against its batch BEFORE writing
  // anything — an edit either fully applies or fully doesn't.
  for (const it of items) {
    const existing = existingItems.find((e) => e.id === it.id);
    if (!existing) return { ok: false, error: "One of the items on this invoice couldn't be found." };
    const qtyChanging = Number(it.qty) !== Number(existing.qty);
    const priceChanging = Number(it.unitPrice) !== Number(existing.unitPrice);
    if (qtyChanging || priceChanging) {
      const batch = batches.find((b) => b.materialId === existing.materialId);
      if (batch && !batchIsUntouched(batch)) {
        const used = Number(batch.qtyPurchased) - Number(batch.qtyRemaining);
        return { ok: false, error: "Can't change quantity or cost for " + existing.materialName + " — " + used + " of the " + batch.qtyPurchased + " purchased has already been used." };
      }
    }
  }

  let totalAmount = 0;
  items.forEach((it) => {
    const existing = existingItems.find((e) => e.id === it.id);
    const qty = Number(it.qty);
    const unitPrice = Number(it.unitPrice);
    const subtotal = qty * unitPrice;
    totalAmount += subtotal;
    updateObjectById_("PurchaseInvoiceItems", it.id, { qty, unitPrice, subtotal });
    const batch = batches.find((b) => b.materialId === existing.materialId);
    if (batch) updateObjectById_("Batches", batch.id, { qtyPurchased: qty, qtyRemaining: qty, unitCost: unitPrice });
  });

  const invoicePatch = { totalAmount };
  if (body.invoiceDate !== undefined) invoicePatch.invoiceDate = body.invoiceDate;
  if (body.paymentType !== undefined) invoicePatch.paymentType = body.paymentType;
  if (body.paymentSource !== undefined) invoicePatch.paymentSource = body.paymentSource;
  updateObjectById_("PurchaseInvoices", body.invoiceId, invoicePatch);

  const linkedLedgerId = batches.length > 0 ? batches[0].ledgerId : null;
  if (linkedLedgerId) {
    const ledgerPatch = { amount: totalAmount };
    if (body.invoiceDate !== undefined) ledgerPatch.ts = body.invoiceDate;
    if (body.description !== undefined) ledgerPatch.description = body.description;
    updateObjectById_("Ledger", linkedLedgerId, ledgerPatch);
  }

  return { ok: true, supplierId: invoice.supplierId };
}

module.exports = { bizDeletePurchase_, bizUpdatePurchase_, bizDeleteSupplierInvoice_, bizForceDeleteSupplierInvoice_, bizUpdateSupplierInvoice_, findLinkedBatch, batchIsUntouched };
