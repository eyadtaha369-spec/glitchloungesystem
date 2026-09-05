// Central translation dictionary. Organized by feature area so a
// translator or future contributor can find and update strings without
// hunting through component files. Add new keys here — never hardcode
// user-facing text directly in a component once it has an entry here.
//
// Convention: every key exists in BOTH languages. If you add an English
// string, add its Arabic counterpart in the same commit — a missing key
// falls back to the key name itself (visibly wrong, easy to spot), not a
// silent blank.

export type Lang = "en" | "ar";

export const translations = {
  common: {
    save: { en: "Save", ar: "حفظ" },
    cancel: { en: "Cancel", ar: "إلغاء" },
    close: { en: "Close", ar: "إغلاق" },
    delete: { en: "Delete", ar: "حذف" },
    edit: { en: "Edit", ar: "تعديل" },
    confirm: { en: "Confirm", ar: "تأكيد" },
    loading: { en: "Loading...", ar: "جارٍ التحميل..." },
    search: { en: "Search", ar: "بحث" },
    total: { en: "Total", ar: "الإجمالي" },
    subtotal: { en: "Subtotal", ar: "المجموع الفرعي" },
    print: { en: "Print", ar: "طباعة" },
    yes: { en: "Yes", ar: "نعم" },
    no: { en: "No", ar: "لا" },
    error: { en: "Error", ar: "خطأ" },
    checking: { en: "Checking...", ar: "جارٍ التحقق..." },
    success: { en: "Success", ar: "تم بنجاح" },
    admin: { en: "Admin", ar: "مدير" },
    cashier: { en: "Cashier", ar: "كاشير" },
    restrictedZone: { en: "Restricted Zone", ar: "منطقة محظورة" },
    adminCredentialsRequired: { en: "Admin credentials required", ar: "مطلوب بيانات دخول المدير" },
  },

  nav: {
    dashboard: { en: "Dashboard", ar: "لوحة التحكم" },
    rooms: { en: "Rooms", ar: "الغرف" },
    lounge: { en: "Lounge", ar: "الصالة" },
    bookings: { en: "Birthday Bookings", ar: "حجوزات أعياد الميلاد" },
    inventory: { en: "Inventory", ar: "المخزون" },
    procurement: { en: "Procurement", ar: "المشتريات" },
    unpaidExpenses: { en: "Unpaid Expenses", ar: "المصروفات والمشتريات الآجلة" },
    staffOrders: { en: "Staff Orders", ar: "طلبات الموظفين" },
    voidLedger: { en: "Void Ledger", ar: "سجل الإلغاءات" },
    auditTrail: { en: "Audit Trail", ar: "سجل التدقيق" },
    setup: { en: "Setup", ar: "الإعدادات" },
    reports: { en: "Reports", ar: "التقارير" },
    leaderboard: { en: "Leaderboard", ar: "لوحة الصدارة" },
    analytics: { en: "Analytics", ar: "التحليلات" },
    users: { en: "Users", ar: "المستخدمون" },
    logout: { en: "Log Out", ar: "تسجيل الخروج" },
  },

  login: {
    title: { en: "GLITCH", ar: "غليتش" },
    subtitle: { en: "PlayStation & Lounge", ar: "بلايستيشن ولاونج" },
    heading: { en: "Lounge Manager", ar: "مدير الصالة" },
    username: { en: "Username", ar: "اسم المستخدم" },
    password: { en: "Password", ar: "كلمة المرور" },
    accessConsole: { en: "Access Console", ar: "دخول لوحة التحكم" },
    invalidCredentials: { en: "Invalid username or password.", ar: "اسم المستخدم أو كلمة المرور غير صحيحة." },
  },

  shift: {
    openShift: { en: "Open Shift", ar: "بدء الشيفت" },
    endShift: { en: "End Shift", ar: "إنهاء الشيفت" },
    activeShift: { en: "Active Shift", ar: "الشيفت الحالي" },
    noActiveShift: { en: "No Active Shift", ar: "لا يوجد شيفت نشط" },
    openingBalance: { en: "Opening Balance", ar: "الرصيد الافتتاحي" },
    expectedCash: { en: "Expected Cash", ar: "النقد المتوقع" },
    actualCash: { en: "Actual Cash Counted", ar: "النقد الفعلي المعدود" },
    discrepancy: { en: "Discrepancy", ar: "الفرق" },
    cashier: { en: "Cashier", ar: "الكاشير" },
    openShiftRequired: { en: "Open Shift Required", ar: "يجب بدء الشيفت للمتابعة" },
    checkingLocation: { en: "Checking your location...", ar: "جارٍ التحقق من موقعك..." },
    locationAccessRequired: { en: "Location Access Required", ar: "مطلوب الوصول إلى الموقع" },
    locationDenied: { en: "You've blocked location access for this site. You cannot open or close a shift — or reach the POS at all — until you allow it.", ar: "لقد قمت بحظر الوصول إلى الموقع لهذا الموقع. لا يمكنك بدء أو إنهاء الشيفت أو الوصول إلى نظام نقاط البيع حتى تسمح بذلك." },
    locationUnsupported: { en: "This browser/device doesn't support location services, which are required to open a shift.", ar: "هذا المتصفح/الجهاز لا يدعم خدمات الموقع، وهي مطلوبة لبدء الشيفت." },
    locationFailed: { en: "Couldn't get a location fix. Make sure location services are on and try again.", ar: "تعذر تحديد الموقع. تأكد من تفعيل خدمات الموقع وحاول مرة أخرى." },
    tryAgain: { en: "Try Again", ar: "حاول مرة أخرى" },
    enterOpeningCash: { en: "Enter your starting cash drawer amount to begin your shift. None of the previous shift's numbers will be visible to you.", ar: "أدخل مبلغ الدرج الافتتاحي لبدء الشيفت. لن تظهر لك أرقام الشيفت السابق." },
    verifyingLocation: { en: "Verifying Location...", ar: "جارٍ التحقق من الموقع..." },
  },

  rooms: {
    startSession: { en: "Start Session", ar: "بدء الجلسة" },
    endSession: { en: "End", ar: "إنهاء" },
    pause: { en: "Pause", ar: "إيقاف مؤقت" },
    resume: { en: "Resume", ar: "استئناف" },
    available: { en: "Available", ar: "متاحة" },
    active: { en: "Active", ar: "نشطة" },
    elapsed: { en: "Elapsed", ar: "الوقت المنقضي" },
    runningCost: { en: "Running Cost", ar: "التكلفة الحالية" },
    addItem: { en: "Add Item", ar: "إضافة عنصر" },
    sendToKitchen: { en: "Send to Kitchen", ar: "إرسال للمطبخ" },
    checkout: { en: "Checkout", ar: "الدفع" },
    splitBill: { en: "Split Bill", ar: "تقسيم الفاتورة" },
    transfer: { en: "Transfer", ar: "نقل" },
    extendTime: { en: "Extend Time", ar: "تمديد الوقت" },
    voidItem: { en: "Void Item", ar: "إلغاء عنصر" },
  },

  inventory: {
    title: { en: "Stock Inventory", ar: "مخزون المستودع" },
    itemName: { en: "Item Name", ar: "اسم العنصر" },
    unit: { en: "Unit", ar: "الوحدة" },
    unitCost: { en: "Unit Cost", ar: "تكلفة الوحدة" },
    remaining: { en: "Remaining", ar: "المتبقي" },
    stockValue: { en: "Stock Value", ar: "قيمة المخزون" },
    actualStock: { en: "Actual Stock", ar: "المخزون الفعلي" },
    minAlert: { en: "Min Alert", ar: "حد التنبيه الأدنى" },
    restock: { en: "Restock", ar: "إعادة تخزين" },
    adjustStock: { en: "Adjust Stock", ar: "تعديل المخزون" },
    searchPlaceholder: { en: "Search inventory by name...", ar: "ابحث في المخزون بالاسم..." },
  },

  procurement: {
    title: { en: "Procurement", ar: "المشتريات" },
    logPurchase: { en: "Log a Purchase", ar: "تسجيل عملية شراء" },
    supplier: { en: "Supplier", ar: "المورّد" },
    quantity: { en: "Quantity", ar: "الكمية" },
    paymentSource: { en: "Payment Source", ar: "طريقة الدفع" },
    cashDrawer: { en: "Cash Drawer", ar: "من الدرج" },
    outOfPocket: { en: "Out of Pocket", ar: "من الجيب" },
    bankTransfer: { en: "Bank Transfer / Visa / InstaPay", ar: "تحويل بنكي / فيزا / إنستاباي" },
    pendingApproval: { en: "Pending Approval", ar: "بانتظار الموافقة" },
    approved: { en: "Approved", ar: "تمت الموافقة" },
    rejected: { en: "Rejected", ar: "مرفوض" },
  },

  voids: {
    pendingVoid: { en: "Pending Void", ar: "إلغاء معلق" },
    approveVoid: { en: "Approve Void", ar: "الموافقة على الإلغاء" },
    denyVoid: { en: "Deny", ar: "رفض" },
    voidReason: { en: "Reason", ar: "السبب" },
    unapprovedVoids: { en: "Unapproved Voids / Reconcile", ar: "إلغاءات غير معتمدة / تسوية" },
    flagDiscrepancy: { en: "Flag as Discrepancy", ar: "الإبلاغ عن تباين" },
  },

  reports: {
    title: { en: "Reports", ar: "التقارير" },
    dailyRevenue: { en: "Total Daily Revenue", ar: "إجمالي الإيرادات اليومية" },
    shiftSummary: { en: "Shift Summary", ar: "ملخص الشيفت" },
    businessDay: { en: "Business Day", ar: "يوم العمل" },
    closeBusinessDay: { en: "Close Business Day", ar: "إغلاق يوم العمل" },
  },

  receipt: {
    orderNumber: { en: "Order #", ar: "رقم الطلب" },
    room: { en: "Room", ar: "الغرفة" },
    start: { en: "Start", ar: "البداية" },
    end: { en: "End", ar: "النهاية" },
    duration: { en: "Duration", ar: "المدة" },
    payment: { en: "Payment", ar: "الدفع" },
    roomTime: { en: "Room Time", ar: "وقت الغرفة" },
    thankYou: { en: "Thank you — Game Over.", ar: "شكراً لكم — انتهت اللعبة." },
    kitchenOrderTicket: { en: "Kitchen Order Ticket", ar: "طلب المطبخ" },
  },

  dashboard: {
    title: { en: "Command Deck", ar: "لوحة القيادة" },
    subtitle: { en: "Realtime Lounge Metrics", ar: "مقاييس الصالة اللحظية" },
    activeRooms: { en: "Active Rooms", ar: "الغرف النشطة" },
    revenueToday: { en: "Revenue Today", ar: "إيرادات اليوم" },
    revenueThisShift: { en: "Revenue This Shift", ar: "إيرادات هذه الوردية" },
    availableRooms: { en: "Available Rooms", ar: "الغرف المتاحة" },
    stockAlerts: { en: "Stock Alerts", ar: "تنبيهات المخزون" },
    revenueByRoom: { en: "Revenue By Room", ar: "الإيرادات حسب الغرفة" },
    completedPlusLive: { en: "Completed + live", ar: "مكتملة + جارية" },
    max: { en: "MAX", ar: "الأقصى" },
    activityFeed: { en: "Activity Feed", ar: "سجل النشاط" },
    noActivityYet: { en: "No activity yet.", ar: "لا يوجد نشاط بعد." },
    financialOverview: { en: "Daily Financial Reconciliation", ar: "التسوية المالية اليومية" },
    closedOrdersTotal: { en: "Closed Orders Total", ar: "إجمالي الطلبات المغلقة" },
    instapayTotal: { en: "InstaPay", ar: "إنستاباي" },
    visaCardTotal: { en: "Visa / Card", ar: "فيزا / بطاقة" },
    dailyExpenses: { en: "Daily Expenses / Purchases", ar: "المصروفات / المشتريات اليومية" },
    expectedCash: { en: "Expected Cash in Drawer", ar: "النقدية المتوقعة في الدرج" },
    actualCashLabel: { en: "Actual Physical Cash Counted", ar: "النقدية الفعلية المعدودة" },
    actualCashPlaceholder: { en: "Enter counted amount", ar: "أدخل المبلغ المعدود" },
    variance: { en: "Variance", ar: "الفرق" },
    over: { en: "Over", ar: "زيادة" },
    shortage: { en: "Shortage", ar: "عجز" },
    matched: { en: "Matched", ar: "مطابق" },
    saveReconciliation: { en: "Save Reconciliation", ar: "حفظ التسوية" },
    reconciliationSaved: { en: "Reconciliation saved", ar: "تم حفظ التسوية" },
    reconciliationHistory: { en: "Reconciliation History", ar: "سجل التسويات" },
    noHistoryYet: { en: "No reconciliations recorded yet.", ar: "لا توجد تسويات مسجلة بعد." },
  },
} as const;

// Deep key type: "nav.dashboard", "common.save", etc.
type Dict = typeof translations;
type Section = keyof Dict;
export type TranslationKey = { [S in Section]: `${S}.${Extract<keyof Dict[S], string>}` }[Section];

export function translate(key: TranslationKey, lang: Lang): string {
  const [section, item] = key.split(".") as [Section, string];
  const entry = (translations[section] as Record<string, Record<Lang, string>>)[item];
  if (!entry) return key; // visible fallback — easy to spot a missing translation
  return entry[lang];
}
