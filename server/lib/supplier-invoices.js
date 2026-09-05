// Supplier Purchase Invoice + Supplier Ledger system.
//
// Design choice: this is a genuinely separate ledger from the general
// cash Ledger table, not a reuse of the existing Unpaid Expenses/Settle
// flow — a supplier account is a running balance across many invoices
// and many partial payments (standard accounts-payable behavior), not
// a single debt that gets fully settled in one action. Cash invoices
// still create a normal Ledger entry (so the drawer math everywhere
// else stays correct); deferred ones don't touch the Ledger at all,
// only the supplier's running balance.

function bizSubmitPurchaseInvoice_(deps, body) {
  const { readObjects_, appendObject_, updateObjectById_, newId_ } = deps;
  const items = Array.isArray(body.items) ? body.items : [];
  if (!body.supplierId || items.length === 0) {
    return { ok: false, error: "Select a supplier and add at least one item." };
  }
  if (body.paymentType === "cash") {
    const validSources = ["cash_drawer", "out_of_pocket", "bank_transfer"];
    if (validSources.indexOf(body.paymentSource) === -1) {
      return { ok: false, error: "Select a payment source for a cash invoice." };
    }
  }

  const materials = readObjects_("RawMaterials");
  const materialById = {};
  materials.forEach((m) => { materialById[m.id] = m; });

  let totalAmount = 0;
  const preparedItems = [];
  for (const it of items) {
    const material = materialById[it.materialId];
    if (!material) return { ok: false, error: "One of the selected materials no longer exists." };
    const qty = Number(it.qty);
    const unitPrice = Number(it.unitPrice);
    if (!(qty > 0) || !(unitPrice >= 0)) return { ok: false, error: "Every line item needs a valid quantity and unit price." };
    const subtotal = qty * unitPrice;
    totalAmount += subtotal;
    preparedItems.push({ materialId: it.materialId, materialName: material.name, qty, unitPrice, subtotal });
  }

  const now = Date.now();
  const invoiceId = newId_("pinv");
  const paymentType = body.paymentType === "cash" ? "cash" : "deferred";
  const paymentSource = paymentType === "cash" ? body.paymentSource : null;

  appendObject_("PurchaseInvoices", {
    id: invoiceId, supplierId: body.supplierId, supplierName: body.supplierName || "",
    invoiceDate: body.invoiceDate || now, paymentType, totalAmount, createdAt: now,
    createdBy: body.username, paymentSource,
  });

  const cashLedgerEntryId = paymentType === "cash" ? newId_("ledg") : null;

  preparedItems.forEach((it) => {
    appendObject_("PurchaseInvoiceItems", {
      id: newId_("pinvitem"), invoiceId, materialId: it.materialId, materialName: it.materialName,
      qty: it.qty, unitPrice: it.unitPrice, subtotal: it.subtotal,
    });
    // Stock arrives regardless of payment type — same principle as
    // regular purchases: receiving on credit doesn't change that the
    // material is now physically in hand.
    appendObject_("Batches", {
      id: newId_("batch"), materialId: it.materialId, supplierId: body.supplierId,
      qtyPurchased: it.qty, qtyRemaining: it.qty, unitCost: it.unitPrice, purchasedAt: now, source: "supplierInvoice",
      invoiceId, ledgerId: cashLedgerEntryId,
    });
    updateObjectById_("RawMaterials", it.materialId, { unitCost: it.unitPrice, lastPurchaseCost: it.unitPrice });
  });

  let ledgerEntryId = null;
  if (paymentType === "cash") {
    ledgerEntryId = cashLedgerEntryId;
    appendObject_("Ledger", {
      id: ledgerEntryId, ts: now, amount: totalAmount, direction: "outflow", type: "supplierInvoice",
      category: "Supplier Invoice", description: "Invoice from " + (body.supplierName || "supplier") + " (" + preparedItems.length + " item" + (preparedItems.length === 1 ? "" : "s") + ")",
      supplierId: body.supplierId, staffUsername: body.username, status: "approved", receiptUrl: null,
      paidFromDrawer: paymentSource === "cash_drawer", shiftId: body.shiftId || null, materialId: null,
      qty: null, unitCost: null, paymentSource, paymentStatus: "paid",
    });
  }

  return { ok: true, invoiceId, totalAmount, itemCount: preparedItems.length, paymentType, ledgerEntryId };
}

function bizRecordSupplierPayment_(deps, body) {
  const { appendObject_, newId_ } = deps;
  if (!body.supplierId || !(Number(body.amount) > 0)) {
    return { ok: false, error: "Select a supplier and enter a valid amount." };
  }
  const validSources = ["cash_drawer", "out_of_pocket", "bank_transfer"];
  if (validSources.indexOf(body.paymentSource) === -1) {
    return { ok: false, error: "Select a payment source." };
  }
  const now = Date.now();
  const paymentId = newId_("spay");
  const ledgerEntryId = newId_("ledg");
  appendObject_("SupplierPayments", {
    id: paymentId, supplierId: body.supplierId, ts: now, amount: Number(body.amount),
    paymentSource: body.paymentSource, note: body.note || "", recordedBy: body.username,
    // Stored so a future delete can find and remove exactly this
    // expense entry, rather than guessing by matching fields.
    ledgerEntryId,
  });
  appendObject_("Ledger", {
    id: ledgerEntryId, ts: now, amount: Number(body.amount), direction: "outflow", type: "supplierPayment",
    category: "Supplier Payment", description: "Payment to supplier" + (body.note ? " — " + body.note : ""),
    supplierId: body.supplierId, staffUsername: body.username, status: "approved", receiptUrl: null,
    paidFromDrawer: body.paymentSource === "cash_drawer", shiftId: body.shiftId || null, materialId: null,
    qty: null, unitCost: null, paymentSource: body.paymentSource, paymentStatus: "paid",
  });
  return { ok: true, paymentId, ledgerEntryId };
}

// A supplier's balance = sum of deferred invoice totals - sum of
// payments recorded. Cash invoices never touch the balance at all,
// since nothing was ever owed for them in the first place.
function bizGetSupplierBalances_(deps) {
  const { readObjects_ } = deps;
  const invoices = readObjects_("PurchaseInvoices");
  const payments = readObjects_("SupplierPayments");
  const balances = {};
  invoices.forEach((inv) => {
    if (inv.paymentType !== "deferred") return;
    balances[inv.supplierId] = (balances[inv.supplierId] || 0) + Number(inv.totalAmount);
  });
  payments.forEach((p) => {
    balances[p.supplierId] = (balances[p.supplierId] || 0) - Number(p.amount);
  });
  return balances;
}

function bizGetSupplierLedger_(deps, supplierId) {
  const { readObjects_ } = deps;
  const invoices = readObjects_("PurchaseInvoices").filter((i) => i.supplierId === supplierId);
  const payments = readObjects_("SupplierPayments").filter((p) => p.supplierId === supplierId);
  const invoiceItems = readObjects_("PurchaseInvoiceItems");

  const entries = [];
  invoices.forEach((inv) => {
    const items = invoiceItems.filter((it) => it.invoiceId === inv.id);
    entries.push({
      ts: Number(inv.invoiceDate) || Number(inv.createdAt),
      type: "invoice",
      description: "Invoice — " + items.map((it) => it.materialName + " x" + it.qty).join(", "),
      amount: Number(inv.totalAmount),
      // Debit (increases what's owed) only if deferred — a cash
      // invoice never enters the running balance at all.
      debit: inv.paymentType === "deferred" ? Number(inv.totalAmount) : 0,
      credit: 0,
      paymentType: inv.paymentType,
      id: inv.id,
      // Full detail for the edit form — avoids a second round-trip
      // just to load what's already sitting right here.
      invoiceDate: Number(inv.invoiceDate) || Number(inv.createdAt),
      paymentSource: inv.paymentSource || null,
      items: items.map((it) => ({ id: it.id, materialId: it.materialId, materialName: it.materialName, qty: Number(it.qty), unitPrice: Number(it.unitPrice) })),
    });
  });
  payments.forEach((p) => {
    entries.push({
      ts: Number(p.ts), type: "payment", description: "Payment" + (p.note ? " — " + p.note : ""),
      amount: Number(p.amount), debit: 0, credit: Number(p.amount), paymentType: null, id: p.id,
    });
  });
  entries.sort((a, b) => a.ts - b.ts);

  let running = 0;
  const withBalance = entries.map((e) => {
    running += e.debit - e.credit;
    return Object.assign({}, e, { runningBalance: running });
  });

  return { entries: withBalance.reverse(), currentBalance: running };
}

// A payment is a pure cash transaction reducing the supplier's debt —
// unlike an invoice, it never touches stock, so there's no "already
// consumed" safety check needed here at all. Removes the payment and
// its linked Ledger expense entry together, so a deleted payment can't
// leave a dangling expense still counted in reports.
function bizDeleteSupplierPayment_(deps, paymentId) {
  const { readObjects_, deleteObjectById_ } = deps;
  const payment = readObjects_("SupplierPayments").find((p) => p.id === paymentId);
  if (!payment) return { ok: false, error: "Payment not found." };
  if (payment.ledgerEntryId) deleteObjectById_("Ledger", payment.ledgerEntryId);
  deleteObjectById_("SupplierPayments", paymentId);
  return { ok: true, supplierId: payment.supplierId };
}

// Bulk clear of every settled supplier payment ever recorded.
// Deliberately Ledger-first, not SupplierPayments-first: the Expenses
// Ledger UI reads directly from Ledger entries with type
// "supplierPayment", so clearing has to target that table directly to
// guarantee nothing is left behind, even a payment record that
// somehow has no matching SupplierPayments row. Also removes the
// corresponding SupplierPayments row for each one, for consistency.
// Deliberately explicit-trigger-only (never run automatically): this
// deletes real financial history, so it exists purely as an admin
// tool for correcting a specific known problem (payments mistakenly
// recorded that were never actually paid), not as something that
// runs on app launch or as part of any reset flow.
function bizClearExpensesLedger_(deps) {
  const { readObjects_, deleteObjectById_ } = deps;
  const ledgerEntries = readObjects_("Ledger").filter((l) => l.type === "supplierPayment");
  const payments = readObjects_("SupplierPayments");
  let totalCleared = 0;
  ledgerEntries.forEach((l) => {
    deleteObjectById_("Ledger", l.id);
    totalCleared += Number(l.amount) || 0;
    const matchingPayment = payments.find((p) => p.ledgerEntryId === l.id);
    if (matchingPayment) deleteObjectById_("SupplierPayments", matchingPayment.id);
  });
  return { ok: true, count: ledgerEntries.length, totalCleared, clearedRecords: ledgerEntries };
}

module.exports = { bizSubmitPurchaseInvoice_, bizRecordSupplierPayment_, bizDeleteSupplierPayment_, bizClearExpensesLedger_, bizGetSupplierBalances_, bizGetSupplierLedger_ };
