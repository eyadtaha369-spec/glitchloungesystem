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

// Deliberately formatDateLabel_ (a direct Cairo-pinned calendar read),
// NOT businessDayLabelForTs_ (which also subtracts the 7.5-hour grace
// window) -- the admin picks a plain calendar date here (a <input
// type="date">, no time-of-day at all), not a real event timestamp, so
// applying the grace-window shift would push a plain midnight value
// back onto the PREVIOUS calendar day, one off from what was actually
// selected.
const { formatDateLabel_ } = require("./shifts");

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
      // The admin already picks an explicit Invoice Date on this form
      // (which can be any past date, not just "today") -- that's the
      // authoritative source of which business day this expense belongs
      // to, so it's used directly here instead of "now"/the active
      // shift's day. Before this field existed, a backdated cash invoice
      // silently reported under today regardless of the date the admin
      // actually picked.
      expenseDate: formatDateLabel_(Number(body.invoiceDate) || now),
    });
  }

  return { ok: true, invoiceId, totalAmount, itemCount: preparedItems.length, paymentType, ledgerEntryId };
}

// Settling a deferred ("آجل") supplier invoice — خيارات طريقة الخصم
// (expenseScope) decides WHOSE cash this comes out of:
//   "daily_shift"  — خصم من إيراد اليوم (شيفت حالي): comes out of
//      today's active shift, same as any other same-day expense. If
//      paid in cash, it reduces that shift's Expected Drawer Cash
//      exactly like a normal drawer expense would.
//   "monthly"      — خصم من إيراد/أرباح الشهر: deliberately NOT tied
//      to any shift and NEVER reduces a shift's Expected Drawer —
//      the cashier closing today's till shouldn't see a discrepancy
//      for money that came out of the business's monthly cash, not
//      their drawer. It still fully counts against this month's
//      P&L/Net Revenue (via isSettledSupplierPayment_'s cash-basis,
//      ts-based matching on the frontend, independent of shiftId).
// Defaults to "daily_shift" if omitted, for backward compatibility
// with any already-queued request from before this field existed.
// Mirrors Code.gs's recordSupplierPayment_ exactly, including the
// fixed category and explicit expenseDate added alongside the
// "critical accounting mismatch" fix (see Code.gs for the full
// reasoning on both).
const SUPPLIER_DEBT_PAYMENT_CATEGORY_ = "Supplier Debt Payment / سداد فاتورة آجل";
function bizRecordSupplierPayment_(deps, body) {
  const { readObjects_, appendObject_, newId_, expenseDateForShift_ } = deps;
  if (!body.supplierId || !(Number(body.amount) > 0)) {
    return { ok: false, error: "Select a supplier and enter a valid amount." };
  }
  const validSources = ["cash_drawer", "out_of_pocket", "bank_transfer"];
  if (validSources.indexOf(body.paymentSource) === -1) {
    return { ok: false, error: "Select a payment source." };
  }
  const expenseScope = body.expenseScope === "monthly" ? "monthly" : "daily_shift";
  const supplier = readObjects_("Suppliers").find((s) => s.id === body.supplierId);
  const supplierName = supplier ? supplier.name : "Supplier";
  // Optional — the admin may pick a specific outstanding deferred
  // invoice this payment is settling, purely for the paper trail
  // (folded into the description + stored on both rows); the
  // supplier's running balance itself stays undifferentiated.
  const invoice = body.invoiceId
    ? readObjects_("PurchaseInvoices").find((i) => i.id === body.invoiceId && i.supplierId === body.supplierId)
    : null;
  const invoiceRef = invoice ? (invoice.referenceNumber || ("#" + invoice.id.slice(-6))) : null;
  const now = Date.now();
  const paymentId = newId_("spay");
  const ledgerEntryId = newId_("ledg");
  const resolvedShiftId = expenseScope === "monthly" ? null : (body.shiftId || null);
  const paidFromDrawer = expenseScope === "monthly" ? false : body.paymentSource === "cash_drawer";
  appendObject_("SupplierPayments", {
    id: paymentId, supplierId: body.supplierId, ts: now, amount: Number(body.amount),
    paymentSource: body.paymentSource, note: body.note || "", recordedBy: body.username,
    // Stored so a future delete can find and remove exactly this
    // expense entry, rather than guessing by matching fields.
    ledgerEntryId,
    invoiceId: body.invoiceId || null,
  });
  appendObject_("Ledger", {
    id: ledgerEntryId, ts: now, amount: Number(body.amount), direction: "outflow", type: "supplierPayment",
    category: SUPPLIER_DEBT_PAYMENT_CATEGORY_,
    description: "سداد فاتورة آجلة - " + supplierName + (invoiceRef ? " — Invoice " + invoiceRef : "") + (body.note ? " — " + body.note : ""),
    supplierId: body.supplierId, staffUsername: body.username, status: "approved", receiptUrl: null,
    paidFromDrawer, shiftId: resolvedShiftId, materialId: null,
    qty: null, unitCost: null, paymentSource: body.paymentSource, paymentStatus: "paid",
    expenseScope,
    // Bound to whichever shift was ACTUALLY active at the moment of
    // payment (raw body.shiftId, not resolvedShiftId, which is nulled
    // for "monthly" scope purely to keep this out of that shift's own
    // drawer reconciliation) -- this is what makes the payment
    // immediately show up under Reports -> Expenses History for the
    // right business day instead of "No expenses logged on this date".
    expenseDate: expenseDateForShift_(body.shiftId || null, now),
    linkedPaymentId: paymentId,
    invoiceId: body.invoiceId || null,
  });
  return { ok: true, paymentId, ledgerEntryId, shiftId: resolvedShiftId };
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
      referenceNumber: inv.referenceNumber || null,
      supplierId: inv.supplierId || null,
      items: items.map((it) => ({ id: it.id, materialId: it.materialId, materialName: it.materialName, qty: Number(it.qty), unitPrice: Number(it.unitPrice) })),
    });
  });
  payments.forEach((p) => {
    entries.push({
      ts: Number(p.ts), type: "payment", description: "سداد فاتورة آجلة" + (p.note ? " — " + p.note : ""),
      amount: Number(p.amount), debit: 0, credit: Number(p.amount), paymentType: null, id: p.id,
      invoiceId: p.invoiceId || null,
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

// One-time data-repair tool for supplier debt payments recorded before
// this fix shipped — mirrors Code.gs's "resyncSupplierPaymentExpenses"
// case exactly. See that case's comment for the full reasoning.
function bizResyncSupplierPaymentExpenses_(deps) {
  const { readObjects_, updateObjectById_ } = deps;
  const paymentsByLedgerId = {};
  readObjects_("SupplierPayments").forEach((p) => { if (p.ledgerEntryId) paymentsByLedgerId[p.ledgerEntryId] = p; });
  const corrections = [];
  readObjects_("Ledger").forEach((entry) => {
    if (entry.type !== "supplierPayment") return;
    const patch = {};
    const correctDate = deps.expenseDateForShift_(entry.shiftId || null, entry.ts);
    if (entry.expenseDate !== correctDate) patch.expenseDate = correctDate;
    if (entry.category !== SUPPLIER_DEBT_PAYMENT_CATEGORY_) patch.category = SUPPLIER_DEBT_PAYMENT_CATEGORY_;
    const linkedPayment = paymentsByLedgerId[entry.id];
    if (linkedPayment && entry.linkedPaymentId !== linkedPayment.id) patch.linkedPaymentId = linkedPayment.id;
    if (Object.keys(patch).length === 0) return;
    updateObjectById_("Ledger", entry.id, patch);
    corrections.push({
      id: entry.id, description: entry.description, amount: entry.amount,
      fromExpenseDate: entry.expenseDate || null, toExpenseDate: patch.expenseDate || entry.expenseDate || null,
      fromCategory: entry.category, toCategory: patch.category || entry.category,
    });
  });
  return { ok: true, count: corrections.length, corrections };
}

module.exports = {
  bizSubmitPurchaseInvoice_, bizRecordSupplierPayment_, bizDeleteSupplierPayment_, bizClearExpensesLedger_,
  bizGetSupplierBalances_, bizGetSupplierLedger_, bizResyncSupplierPaymentExpenses_,
};
