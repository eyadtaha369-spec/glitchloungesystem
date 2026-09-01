import { memo, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import logo from "@/assets/glitch-logo-mark.png";
import { printSmart } from "@/lib/print";
import { useStore, fmtDuration, fmtMoney, computeTimeCost, VOID_REASON_LABELS, WASTE_MARKETING_REASON_LABELS, MENU_CATEGORIES, type Room, type Session, type PaymentMethod, type VoidReason, type WasteMarketingReason, type MenuCategory, type MenuItem } from "@/lib/glitch-store";
import { Play, Square, Pause, Plus, Minus, Printer, X, Crown, Gamepad2, Banknote, CreditCard, ShieldAlert, MessageSquare, Check, ChefHat, ArrowRightLeft, SplitSquareHorizontal, Clock } from "lucide-react";

// Stable reference (never recreated) — passing `[]` inline as a prop
// creates a brand-new array every render, which alone defeats
// React.memo on whatever receives it.
const EMPTY_ROOMS: Room[] = [];

// Default toLocaleString() produces long strings like "8/6/2026,
// 1:30:03 AM" — combined with a label on a printed receipt's narrow
// width, that's long enough to run past the printer's actual
// printable area. Seconds-level precision isn't needed on a receipt
// timestamp anyway, so this drops both the year and the seconds.
function fmtReceiptTime(d: Date): string {
  const datePart = d.toLocaleDateString(undefined, { month: "numeric", day: "numeric" });
  const timePart = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${datePart} ${timePart}`;
}

// Mirrors the server's effectiveDurationSec_: elapsed seconds at an
// arbitrary point in time, excluding all paused time. Used to freeze the
// checkout bill to the exact moment "End" was clicked.
function effectiveElapsedAt(room: Room, atMs: number): number {
  if (!room.startedAt) return 0;
  const raw = (atMs - room.startedAt) / 1000;
  const pausedSoFar = (room.pausedDurationSec || 0) + (room.isPaused && room.pausedAt ? (atMs - room.pausedAt) / 1000 : 0);
  return Math.max(0, raw - pausedSoFar + (room.timeAdjustmentSec || 0));
}

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  visa: "Visa",
  mixed_cash_visa: "Cash + Visa",
  mixed_cash_instapay: "Cash + InstaPay",
};

export function RoomsPage() {
  return <ZonePage scope="room" />;
}
export function LoungePage() {
  return <ZonePage scope="lounge" />;
}

function ZonePage({ scope }: { scope: "room" | "lounge" }) {
  const { state, computeElapsed, activeShift } = useStore();
  const [, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick((n) => n + 1), 1000); return () => clearInterval(id); }, []);

  const [receipt, setReceipt] = useState<Session | null>(null);

  // Memoized on state.rooms specifically (not the 1-second tick) — these
  // arrays would otherwise get a brand-new reference every second even
  // when nothing in them changed, which alone defeats React.memo on every
  // RoomCard below regardless of how carefully IT is memoized.
  const roomZone = useMemo(() => state.rooms.filter((r) => r.zone === "room"), [state.rooms]);
  const loungeZone = useMemo(() => state.rooms.filter((r) => r.zone === "lounge"), [state.rooms]);
  const standardTables = useMemo(() => loungeZone.filter((r) => !r.isOwnerTable), [loungeZone]);
  const ownerTables = useMemo(() => loungeZone.filter((r) => r.isOwnerTable), [loungeZone]);
  const wasteTable = useMemo(() => state.rooms.find((r) => r.zone === "waste"), [state.rooms]);
  // Any room or lounge table is a valid transfer target regardless of which
  // view you're on — transfer is explicitly cross-zone.
  const transferTargets = useMemo(() => [...roomZone, ...loungeZone], [roomZone, loungeZone]);
  const primaryZone = scope === "room" ? roomZone : standardTables;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{scope === "room" ? "Rooms Management" : "Lounge Management"}</h1>
        <p className="text-sm text-muted-foreground mt-1 font-mono uppercase tracking-widest">
          {scope === "room"
            ? `${roomZone.length - 1} Bays · 1 VIP Suite`
            : `${standardTables.length} Standard Tables · ${ownerTables.length} Owner Tables`}
        </p>
      </div>

      {!activeShift && (
        <div className="glass rounded-2xl p-4 border border-black/40 text-sm text-black">
          No shift is open — open one from the Dashboard before starting {scope === "room" ? "rooms" : "tables"} or taking orders.
        </div>
      )}

      <div>
        <h2 className="text-sm uppercase tracking-widest text-muted-foreground font-mono mb-3">
          {scope === "room" ? "Rooms & VIP" : "Lounge Tables"}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {primaryZone.map((r) => (
            <RoomCard key={r.id} room={r} elapsed={computeElapsed(r)} onCheckout={setReceipt} transferTargets={transferTargets} />
          ))}
        </div>
      </div>

      {scope === "lounge" && ownerTables.length > 0 && (
        <div>
          <h2 className="text-sm uppercase tracking-widest text-black font-mono mb-3">Owner Tables — Automatic 25% Discount</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {ownerTables.map((r) => (
              <RoomCard key={r.id} room={r} elapsed={computeElapsed(r)} onCheckout={setReceipt} transferTargets={transferTargets} />
            ))}
          </div>
        </div>
      )}

      {scope === "lounge" && wasteTable && (
        <div>
          <h2 className="text-sm uppercase tracking-widest text-[oklch(0.62_0.24_25)] font-mono mb-3">Wasted / Marketing — Remakes, Complaints &amp; Complimentary</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            <RoomCard room={wasteTable} elapsed={0} onCheckout={setReceipt} transferTargets={EMPTY_ROOMS} />
          </div>
        </div>
      )}

      {receipt && <ReceiptModal session={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
}

// Minimalist entry-point card: name, icon, a status badge, and — only
// while active — the two numbers that actually matter at a glance
// (elapsed time, running cost). Every other control (order management,
// pause/resume, split, transfer, KOT, checkout) lives one click away in
// RoomDetailModal, not cluttering the grid.
const RoomCard = memo(function RoomCard({ room, elapsed, onCheckout, transferTargets }: { room: Room; elapsed: number; onCheckout: (s: Session) => void; transferTargets: Room[] }) {
  const [open, setOpen] = useState(false);
  const isActive = room.status === "active";
  const timeCost = computeTimeCost(room, elapsed);
  const ordersCost = room.orders.reduce((a, o) => a + o.qty * o.price, 0);
  const total = timeCost + ordersCost;
  const itemCount = room.orders.reduce((a, o) => a + o.qty, 0);

  const cardStyle = room.isVip
    ? "animate-vip bg-gradient-to-br from-black/8 via-[oklch(0.15_0.03_275/0.6)] to-[oklch(0.65_0.24_305/0.08)] border-black/40"
    : isActive
      ? "animate-pulse-glow border-[oklch(0.78_0.2_155/0.4)]"
      : "border-black/10 hover:border-[oklch(0.7_0.19_260/0.4)] hover:shadow-[0_0_25px_oklch(0.7_0.19_260/0.25)]";

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`w-full text-start glass rounded-2xl p-6 border transition-all cursor-pointer ${cardStyle}`}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 min-w-0">
            {room.isVip ? (
              <Crown className="w-6 h-6 text-black shrink-0" />
            ) : (
              <Gamepad2 className="w-6 h-6 text-[oklch(0.7_0.19_260)] shrink-0" />
            )}
            <h3 className={`text-lg font-bold tracking-wide truncate ${room.isVip ? "text-gradient-gold" : ""}`}>{room.name}</h3>
          </div>
          <span
            className={`shrink-0 text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full border ${
              isActive
                ? "bg-[oklch(0.78_0.2_155/0.15)] text-[oklch(0.78_0.2_155)] border-[oklch(0.78_0.2_155/0.5)]"
                : "bg-black/5 text-muted-foreground border-black/10"
            }`}
          >
            {isActive ? "Running" : "Available"}
          </span>
        </div>

        {room.isOwnerTable && (
          <div className="mb-3 text-[9px] uppercase tracking-widest font-bold text-black">Owner · 25% Off</div>
        )}

        {room.zone === "waste" ? (
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white/70 rounded-xl p-3 border border-black/8">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Items</div>
              <div className="mt-1 font-mono text-xl font-bold text-black">{itemCount}</div>
            </div>
            <div className="bg-white/70 rounded-xl p-3 border border-black/8">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Value</div>
              <div className="mt-1 font-mono text-xl font-bold text-black">{fmtMoney(total)}</div>
            </div>
          </div>
        ) : isActive ? (
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white/70 rounded-xl p-4 border border-black/8">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Elapsed{room.isPaused ? " (Paused)" : ""}</div>
              <div className={`mt-1 font-mono text-2xl font-bold ${room.isPaused ? "text-[#8B5CF6]" : "text-[oklch(0.7_0.19_260)]"}`}>{fmtDuration(elapsed)}</div>
            </div>
            <div className="bg-white/70 rounded-xl p-4 border border-black/8">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Cost</div>
              <div className={`mt-1 font-mono text-2xl font-bold ${room.isVip ? "text-black" : "text-[oklch(0.78_0.2_155)]"}`}>{fmtMoney(total)}</div>
            </div>
          </div>
        ) : (
          <div className="py-3 text-center text-xs text-muted-foreground font-mono uppercase tracking-widest">Tap to start a session</div>
        )}
      </button>

      {open && (
        <RoomDetailModal room={room} elapsed={elapsed} onCheckout={onCheckout} transferTargets={transferTargets} onClose={() => setOpen(false)} />
      )}
    </>
  );
});

const RoomDetailModal = memo(function RoomDetailModal({ room, elapsed, onCheckout, transferTargets, onClose }: { room: Room; elapsed: number; onCheckout: (s: Session) => void; transferTargets: Room[]; onClose: () => void }) {
  const { state, startRoom, endRoom, pauseRoom, resumeRoom, logWasteMarketing, nextKotNumber, extendRoomTime, switchRateMode, addOrder, setOrderLineQty, setOrderLineNote, setRoomRate, renameRoom, canFulfill, requestVoid } = useStore();
  const isAdmin = state.currentUser?.role === "admin";
  const [split, setSplit] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [frozenAt, setFrozenAt] = useState<number | null>(null);
  const [ticketOpen, setTicketOpen] = useState(false);
  const [kotNumber, setKotNumber] = useState<number | null>(null);
  const [fetchingKot, setFetchingKot] = useState(false);
  const [warn, setWarn] = useState<string | null>(null);
  const [switchModeConfirm, setSwitchModeConfirm] = useState<"single" | "multi" | null>(null);
  const [switchingMode, setSwitchingMode] = useState(false);
  const [editingRate, setEditingRate] = useState(false);
  const [singleRateInput, setSingleRateInput] = useState(String(room.singleRate));
  const [multiRateInput, setMultiRateInput] = useState(String(room.multiRate));
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(room.name);
  const [voidTarget, setVoidTarget] = useState<{ menuItemId: string; name: string; maxQty: number } | null>(null);
  const [editingNoteFor, setEditingNoteFor] = useState<string | null>(null);
  const [noteInput, setNoteInput] = useState("");
  const [transferOpen, setTransferOpen] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  const [extendTimeOpen, setExtendTimeOpen] = useState(false);
  const [wasteReasonOpen, setWasteReasonOpen] = useState(false);
  const [pickingRateToStart, setPickingRateToStart] = useState(false);

  const timeCost = computeTimeCost(room, elapsed);
  const ordersCost = room.orders.reduce((a, o) => a + o.qty * o.price, 0);
  const total = timeCost + ordersCost;

  const cardStyle = room.isVip
    ? "animate-vip bg-gradient-to-br from-black/8 via-[oklch(0.15_0.03_275/0.6)] to-[oklch(0.65_0.24_305/0.08)] border-black/40"
    : room.isPaused
      ? "bg-[#8B5CF6]/10 border-[#8B5CF6] border-2"
      : room.status === "active"
        ? "animate-pulse-glow border-[oklch(0.78_0.2_155/0.4)]"
        : "border-black/10 hover:border-[oklch(0.7_0.19_260/0.4)] hover:shadow-[0_0_25px_oklch(0.7_0.19_260/0.25)]";

  const flashWarn = (msg: string) => {
    setWarn(msg);
    setTimeout(() => setWarn(null), 3000);
  };

  const handleStart = async (rateMode?: "single" | "multi") => {
    if (room.zone === "room" && !rateMode) {
      setPickingRateToStart(true);
      return;
    }
    setPickingRateToStart(false);
    const r = await startRoom(room.id, rateMode);
    if (!r.ok) flashWarn(r.error ?? "Could not start room");
  };

  const handleOrder = async (menuItemId: string) => {
    const r = await addOrder(room.id, menuItemId, 1);
    if (!r.ok) flashWarn(r.error ?? "Order failed");
    // Deliberately stays open — picking one item shouldn't force closing
    // and reopening the picker for every additional item on the order.
    // Closed explicitly via the X button or tapping outside instead.
  };

  // Increasing qty is a routine correction, unrestricted. Removing/reducing
  // an already-ordered item goes through the formal Void workflow instead —
  // that's the point at which staff could otherwise quietly wipe a sale.
  const increaseQty = async (menuItemId: string, currentQty: number) => {
    const r = await setOrderLineQty(room.id, menuItemId, currentQty + 1);
    if (!r.ok) flashWarn(r.error ?? "Could not update item");
  };

  const [paymentOption, setPaymentOption] = useState<PaymentMethod>("cash");
  const [secondaryInput, setSecondaryInput] = useState("");
  const [checkoutErr, setCheckoutErr] = useState<string | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);
  const [timeDiscountType, setTimeDiscountType] = useState<"fixed" | "percent">("fixed");
  const [timeDiscountInput, setTimeDiscountInput] = useState("");
  const [ordersDiscountType, setOrdersDiscountType] = useState<"fixed" | "percent">("fixed");
  const [ordersDiscountInput, setOrdersDiscountInput] = useState("");

  // Once "End" is clicked, frozenAt locks the bill to that exact instant —
  // the customer isn't charged extra time for however long the payment
  // step takes. checkoutTotal (not the live, still-ticking `total`) is
  // what the modal displays and what's actually charged.
  const checkoutElapsed = frozenAt !== null ? Math.floor(effectiveElapsedAt(room, frozenAt)) : elapsed;
  const checkoutTimeCost = (checkoutElapsed / 3600) * room.hourlyRate;
  const checkoutPreDiscountTotal = checkoutTimeCost + ordersCost;
  const previewDiscount = (base: number, type: "fixed" | "percent", raw: string) => {
    const v = parseFloat(raw) || 0;
    if (v <= 0) return 0;
    const amt = type === "percent" ? base * (v / 100) : v;
    return Math.round(Math.max(0, Math.min(amt, base)) * 100) / 100;
  };
  const timeDiscountPreview = previewDiscount(checkoutTimeCost, timeDiscountType, timeDiscountInput);
  const ordersDiscountPreview = previewDiscount(ordersCost, ordersDiscountType, ordersDiscountInput);
  const hasManualDiscount = timeDiscountPreview > 0 || ordersDiscountPreview > 0;
  const checkoutDiscountAmount = hasManualDiscount
    ? timeDiscountPreview + ordersDiscountPreview
    : room.isOwnerTable ? Math.round(checkoutPreDiscountTotal * 0.25 * 100) / 100 : 0;
  const checkoutTotal = checkoutPreDiscountTotal - checkoutDiscountAmount;

  const isMixed = paymentOption === "mixed_cash_visa" || paymentOption === "mixed_cash_instapay";
  const secondaryAmount = parseFloat(secondaryInput) || 0;
  // Cashier enters only the Visa/InstaPay amount — Cash is always
  // whatever's left of the total, computed automatically.
  const cashAmount = Math.max(0, checkoutTotal - secondaryAmount);
  const secondaryExceedsTotal = secondaryAmount > checkoutTotal + 0.005;

  const handleCheckout = async () => {
    setCheckoutErr(null);
    if (isMixed && (secondaryAmount <= 0 || secondaryExceedsTotal)) {
      setCheckoutErr(
        secondaryExceedsTotal
          ? `${paymentOption === "mixed_cash_visa" ? "Visa" : "InstaPay"} amount can't exceed the total (${fmtMoney(checkoutTotal)}).`
          : `Enter the ${paymentOption === "mixed_cash_visa" ? "Visa" : "InstaPay"} amount.`,
      );
      return;
    }
    setCheckingOut(true);
    try {
      const res = await endRoom(
        room.id, split, paymentOption,
        isMixed ? cashAmount : undefined,
        isMixed ? secondaryAmount : undefined,
        frozenAt ?? undefined,
        hasManualDiscount ? {
          timeDiscountType, timeDiscountValue: parseFloat(timeDiscountInput) || 0,
          ordersDiscountType, ordersDiscountValue: parseFloat(ordersDiscountInput) || 0,
        } : undefined,
      );
      if (res.error) { setCheckoutErr(res.error); return; }
      setCheckoutOpen(false);
      setFrozenAt(null);
      setSecondaryInput(""); setPaymentOption("cash");
      if (res.session) onCheckout(res.session);
    } finally {
      setCheckingOut(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
    <div className={`glass rounded-2xl p-5 border transition-all relative w-full max-w-lg max-h-[92vh] overflow-y-auto ${cardStyle}`} onClick={(e) => e.stopPropagation()}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          {room.isVip ? (
            <Crown className="w-5 h-5 text-black shrink-0" />
          ) : (
            <Gamepad2 className="w-5 h-5 text-[oklch(0.7_0.19_260)] shrink-0" />
          )}
          {editingName ? (
            <div className="flex items-center gap-1.5 min-w-0">
              <input
                autoFocus value={nameInput} onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { void renameRoom(room.id, nameInput); setEditingName(false); } if (e.key === "Escape") { setNameInput(room.name); setEditingName(false); } }}
                className="w-32 bg-white/70 border border-black/10 rounded px-2 py-1 text-sm font-bold"
              />
              <button onClick={() => { void renameRoom(room.id, nameInput); setEditingName(false); }} className="text-[oklch(0.78_0.2_155)] hover:opacity-80"><Check className="w-4 h-4" /></button>
              <button onClick={() => { setNameInput(room.name); setEditingName(false); }} className="text-muted-foreground hover:text-[#2b2416]"><X className="w-4 h-4" /></button>
            </div>
          ) : (
            <h3 className={`text-lg font-bold tracking-wide truncate ${room.isVip ? "text-gradient-gold" : ""}`}>{room.name}</h3>
          )}
          {isAdmin && !editingName && (
            <button onClick={() => setEditingName(true)} className="text-muted-foreground hover:text-[#2b2416] shrink-0" title="Rename">
              <MessageSquare className="w-3.5 h-3.5" />
            </button>
          )}
          {room.isOwnerTable && (
            <span className="text-[9px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-full bg-black/15 text-white border border-black/50 shrink-0">
              Owner · 25% Off
            </span>
          )}
          {room.isVip && (
            <span className="text-[9px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-full bg-black/15 text-white border border-black/50 shrink-0">
              Premium
            </span>
          )}
          {room.zone === "split" && (
            <span className="text-[9px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-full bg-[oklch(0.7_0.19_260/0.15)] text-[oklch(0.7_0.19_260)] border border-[oklch(0.7_0.19_260/0.5)] shrink-0">
              {room.splitInvoiceNumber}
            </span>
          )}
          {room.transferredFrom && (
            <span className="text-[9px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-full bg-black/5 text-muted-foreground border border-black/10 shrink-0">
              from {room.transferredFrom}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className={`text-[10px] uppercase tracking-widest font-bold px-2.5 py-1 rounded-full border ${
          room.isPaused
            ? "bg-[#8B5CF6]/20 text-[#8B5CF6] border-[#8B5CF6]/60"
            : room.status === "active"
            ? "bg-[oklch(0.78_0.2_155/0.15)] text-[oklch(0.78_0.2_155)] border-[oklch(0.78_0.2_155/0.5)]"
            : "bg-black/5 text-muted-foreground border-black/10"
        }`}>
          {room.isPaused ? "⏸ Paused" : room.status === "active" ? "● Active" : "○ Available"}
        </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-[#2b2416] bg-black/5 hover:bg-black/10 rounded-full p-1.5" title="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {room.isPaused && (
        <div className="mt-2 text-[10px] uppercase tracking-widest text-black font-mono" dir="rtl">
          موقوف مؤقتاً — الوقت متوقف
        </div>
      )}

      {/* Rate */}
      {room.zone === "room" && (
        <div className="mt-3 text-xs">
          {isAdmin && editingRate ? (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-muted-foreground font-mono uppercase tracking-widest">Single</span>
              <input
                type="number" step="0.5" value={singleRateInput}
                onChange={(e) => setSingleRateInput(e.target.value)}
                className="w-16 bg-white/70 border border-black/10 rounded px-2 py-0.5 font-mono text-sm"
              />
              <span className="text-muted-foreground font-mono uppercase tracking-widest">Multi</span>
              <input
                type="number" step="0.5" value={multiRateInput}
                onChange={(e) => setMultiRateInput(e.target.value)}
                className="w-16 bg-white/70 border border-black/10 rounded px-2 py-0.5 font-mono text-sm"
              />
              <button
                className="text-[oklch(0.78_0.2_155)] hover:underline"
                onClick={() => { void setRoomRate(room.id, parseFloat(singleRateInput) || 0, parseFloat(multiRateInput) || 0); setEditingRate(false); }}
              >save</button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground font-mono uppercase tracking-widest">Rate</span>
              <span className="font-mono font-semibold">Single {fmtMoney(room.singleRate)}/hr · Multi {fmtMoney(room.multiRate)}/hr</span>
              {isAdmin && (
                <button className="text-[oklch(0.7_0.19_260)] hover:underline text-[10px] uppercase" onClick={() => setEditingRate(true)}>
                  edit
                </button>
              )}
            </div>
          )}
          {room.status === "active" && room.rateMode && (
            <div className="mt-1 flex items-center gap-2 text-[10px] uppercase tracking-widest text-[oklch(0.78_0.2_155)]">
              <span>Running: {room.rateMode} @ {fmtMoney(room.hourlyRate)}/hr</span>
              {!room.isPaused && (
                <button
                  onClick={() => setSwitchModeConfirm(room.rateMode === "single" ? "multi" : "single")}
                  className="px-1.5 py-0.5 rounded border border-[oklch(0.7_0.19_260/0.5)] text-[oklch(0.7_0.19_260)] normal-case tracking-normal font-semibold hover:bg-[oklch(0.7_0.19_260/0.1)]"
                  title={`Switch to ${room.rateMode === "single" ? "Multi" : "Single"}`}
                >
                  Switch to {room.rateMode === "single" ? "Multi" : "Single"}
                </button>
              )}
            </div>
          )}
          {switchModeConfirm && (
            <div className="fixed inset-0 z-[210] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm no-print" onClick={() => setSwitchModeConfirm(null)}>
              <div className="w-full max-w-sm glass-strong rounded-2xl border border-[oklch(0.7_0.19_260/0.4)] p-5" onClick={(e) => e.stopPropagation()}>
                <h3 className="text-base font-bold mb-2">Switch to {switchModeConfirm === "single" ? "Single" : "Multi"}?</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Freezes the current {room.rateMode} time at {fmtMoney(room.hourlyRate)}/hr, then starts billing the
                  rest of this session at {fmtMoney(switchModeConfirm === "single" ? room.singleRate : room.multiRate)}/hr.
                  The final bill will show both periods separately.
                </p>
                <div className="flex justify-end gap-2">
                  <button onClick={() => setSwitchModeConfirm(null)} disabled={switchingMode} className="px-3 py-1.5 rounded-lg text-sm bg-black/5 border border-black/10">Cancel</button>
                  <button
                    onClick={async () => {
                      if (!switchModeConfirm) return;
                      setSwitchingMode(true);
                      try {
                        const res = await switchRateMode(room.id, switchModeConfirm);
                        if (!res.ok) { flashWarn(res.error ?? "Could not switch mode"); }
                        setSwitchModeConfirm(null);
                      } finally {
                        setSwitchingMode(false);
                      }
                    }}
                    disabled={switchingMode}
                    className="px-3 py-1.5 rounded-lg text-sm font-bold bg-gradient-to-r from-[oklch(0.7_0.19_260)] to-[oklch(0.65_0.24_305)] text-[#2b2416] disabled:opacity-50"
                  >
                    {switchingMode ? "Switching..." : "Confirm Switch"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Timer + cost (waste table shows item count + retail value instead — it has no timer) */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        {room.zone === "waste" ? (
          <>
            <div className="bg-white/70 rounded-lg p-3 border border-black/8">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Items Logged</div>
              <div className="mt-1 font-mono text-2xl font-bold text-black">{room.orders.reduce((a, o) => a + o.qty, 0)}</div>
            </div>
            <div className="bg-white/70 rounded-lg p-3 border border-black/8">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Retail Value</div>
              <div className="mt-1 font-mono text-2xl font-bold text-black">{fmtMoney(total)}</div>
            </div>
          </>
        ) : (
          <>
            <div className="bg-white/70 rounded-lg p-3 border border-black/8">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Elapsed{room.isPaused ? " (Paused)" : ""}</div>
              <div className={`mt-1 font-mono text-2xl font-bold ${room.isPaused ? "text-[#8B5CF6]" : room.status === "active" ? "text-[oklch(0.7_0.19_260)]" : "text-muted-foreground"}`}>
                {fmtDuration(elapsed)}
              </div>
            </div>
            <div className="bg-white/70 rounded-lg p-3 border border-black/8">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Running Cost</div>
              <div className={`mt-1 font-mono text-2xl font-bold ${room.isVip ? "text-black" : "text-[oklch(0.78_0.2_155)]"}`}>
                {fmtMoney(total)}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Split bill breakdown */}
      {split && room.status === "active" && (
        <div className="mt-3 p-3 rounded-lg bg-white/60 border border-black/8 text-xs font-mono grid grid-cols-2 gap-2">
          <div>
            <div className="text-muted-foreground uppercase tracking-widest text-[9px]">Time</div>
            <div>{fmtMoney(timeCost)}</div>
          </div>
          <div>
            <div className="text-muted-foreground uppercase tracking-widest text-[9px]">Orders</div>
            <div>{fmtMoney(ordersCost)}</div>
          </div>
        </div>
      )}

      {/* Orders */}
      {room.orders.length > 0 && (
        <div className="mt-3 text-xs font-mono space-y-1.5 max-h-40 overflow-y-auto no-print">
          {room.orders.map((o) => (
            <div key={o.menuItemId} className="text-muted-foreground">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate">{o.name}</span>
                <div className="flex items-center gap-1.5 shrink-0">
                  {o.menuItemId === "item-water" ? (
                    <button
                      onClick={() => void setOrderLineQty(room.id, o.menuItemId, o.qty - 1)}
                      className="w-5 h-5 flex items-center justify-center rounded bg-black/5 border border-black/10 hover:bg-black/8 hover:text-[#2b2416]"
                      title="Remove — no approval needed for the default water bottle"
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                  ) : (
                    <button
                      onClick={() => setVoidTarget({ menuItemId: o.menuItemId, name: o.name, maxQty: o.qty })}
                      className="w-5 h-5 flex items-center justify-center rounded bg-black/5 border border-black/10 hover:bg-[oklch(0.62_0.24_25/0.2)] hover:text-[oklch(0.62_0.24_25)]"
                      title="Void this item"
                    >
                      <ShieldAlert className="w-3 h-3" />
                    </button>
                  )}
                  <span className="w-4 text-center text-[#2b2416]">{o.qty}</span>
                  <button
                    onClick={() => increaseQty(o.menuItemId, o.qty)}
                    className="w-5 h-5 flex items-center justify-center rounded bg-black/5 border border-black/10 hover:bg-black/8 hover:text-[#2b2416]"
                    title="Increase"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                  <span className="w-14 text-right">{fmtMoney(o.qty * o.price)}</span>
                  <button
                    onClick={() => { setEditingNoteFor(o.menuItemId); setNoteInput(o.notes ?? ""); }}
                    className={`w-5 h-5 flex items-center justify-center rounded border ${o.notes ? "bg-black/15 border-black/50 text-white" : "bg-black/5 border-black/10 hover:bg-black/8"}`}
                    title="Add/edit note"
                  >
                    <MessageSquare className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {editingNoteFor === o.menuItemId ? (
                <div className="flex items-center gap-1.5 mt-1 pl-1">
                  <input
                    autoFocus
                    value={noteInput}
                    onChange={(e) => setNoteInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { setOrderLineNote(room.id, o.menuItemId, noteInput); setEditingNoteFor(null); }
                      if (e.key === "Escape") setEditingNoteFor(null);
                    }}
                    placeholder="e.g. Extra Sugar, Skimmed Milk"
                    className="flex-1 bg-white/70 border border-black/10 rounded px-2 py-1 text-[11px]"
                  />
                  <button
                    onClick={() => { setOrderLineNote(room.id, o.menuItemId, noteInput); setEditingNoteFor(null); }}
                    className="w-5 h-5 flex items-center justify-center rounded bg-[oklch(0.78_0.2_155/0.2)] border border-[oklch(0.78_0.2_155/0.5)] text-[oklch(0.78_0.2_155)]"
                  >
                    <Check className="w-3 h-3" />
                  </button>
                  <button onClick={() => setEditingNoteFor(null)} className="w-5 h-5 flex items-center justify-center rounded bg-black/5 border border-black/10">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ) : o.notes ? (
                <div className="pl-1 mt-0.5 text-[11px] italic text-black">
                  → *{o.notes}*
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 mt-2 no-print">
        {room.orders.length > 0 && (
          <button
            onClick={async () => {
              setFetchingKot(true);
              try {
                const res = await nextKotNumber();
                setKotNumber(res.ok && res.number ? res.number : null);
                setTicketOpen(true);
              } finally {
                setFetchingKot(false);
              }
            }}
            disabled={fetchingKot}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-black/5 border border-black/10 hover:bg-black/8 text-xs disabled:opacity-60"
          >
            <ChefHat className="w-3.5 h-3.5" /> Send to Kitchen
          </button>
        )}
        {room.status === "active" && transferTargets.filter((t) => t.id !== room.id).length > 0 && (
          <button
            onClick={() => setTransferOpen(true)}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-black/5 border border-black/10 hover:bg-black/8 text-xs"
          >
            <ArrowRightLeft className="w-3.5 h-3.5" /> Transfer
          </button>
        )}
        {room.status === "active" && room.orders.length > 0 && (
          <button
            onClick={() => setSplitOpen(true)}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-black/5 border border-black/10 hover:bg-black/8 text-xs"
          >
            <SplitSquareHorizontal className="w-3.5 h-3.5" /> Split
          </button>
        )}
      </div>

      {ticketOpen && <BaristaTicketModal room={room} kotNumber={kotNumber} onClose={() => setTicketOpen(false)} />}
      {transferOpen && (
        <TransferModal room={room} targets={transferTargets.filter((t) => t.id !== room.id)} onClose={() => setTransferOpen(false)} />
      )}
      {splitOpen && <SplitModal room={room} onClose={() => setSplitOpen(false)} />}
      {extendTimeOpen && <ExtendTimeModal room={room} elapsed={elapsed} extendRoomTime={extendRoomTime} onClose={() => setExtendTimeOpen(false)} />}
      {wasteReasonOpen && <WasteReasonModal room={room} logWasteMarketing={logWasteMarketing} onClose={() => setWasteReasonOpen(false)} />}

      {voidTarget && (
        <VoidRequestModal
          roomId={room.id}
          roomName={room.name}
          menuItemId={voidTarget.menuItemId}
          itemName={voidTarget.name}
          maxQty={voidTarget.maxQty}
          onClose={() => setVoidTarget(null)}
          requestVoid={requestVoid}
        />
      )}

      {warn && (
        <div className="mt-3 text-xs bg-[oklch(0.62_0.24_25/0.15)] border border-[oklch(0.62_0.24_25/0.5)] text-[oklch(0.62_0.24_25)] rounded-lg px-3 py-2 font-mono">
          ⚠ {warn}
        </div>
      )}

      {/* Actions */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {room.status === "available" ? (
          pickingRateToStart ? (
            <div className="flex-1 flex items-center gap-2">
              <button
                onClick={() => handleStart("single")}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-[oklch(0.78_0.2_155/0.2)] border border-[oklch(0.78_0.2_155/0.5)] text-[oklch(0.78_0.2_155)] font-bold uppercase tracking-wider text-xs"
              >
                Single {fmtMoney(room.singleRate)}/hr
              </button>
              <button
                onClick={() => handleStart("multi")}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-[oklch(0.7_0.19_260/0.2)] border border-[oklch(0.7_0.19_260/0.5)] text-[oklch(0.7_0.19_260)] font-bold uppercase tracking-wider text-xs"
              >
                Multi {fmtMoney(room.multiRate)}/hr
              </button>
              <button onClick={() => setPickingRateToStart(false)} className="text-muted-foreground hover:text-[#2b2416] px-2"><X className="w-4 h-4" /></button>
            </div>
          ) : (
            <button
              onClick={() => handleStart()}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-gradient-to-r from-[oklch(0.78_0.2_155)] to-[oklch(0.7_0.2_170)] text-black font-bold uppercase tracking-wider text-xs shadow-[0_0_20px_oklch(0.78_0.2_155/0.4)] hover:shadow-[0_0_30px_oklch(0.78_0.2_155/0.7)] transition"
            >
              <Play className="w-4 h-4" /> Start
            </button>
          )
        ) : (
          <>
            <div className="flex-1">
              <button
                onClick={() => setMenuOpen(true)}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-[oklch(0.7_0.19_260/0.15)] border border-[oklch(0.7_0.19_260/0.4)] text-[oklch(0.7_0.19_260)] font-semibold uppercase tracking-wider text-xs hover:bg-[oklch(0.7_0.19_260/0.25)] transition"
              >
                <Plus className="w-4 h-4" /> Order
              </button>
              {menuOpen && <MenuPickerModal room={room} onClose={() => setMenuOpen(false)} onOrder={handleOrder} canFulfill={canFulfill} state={state} />}
            </div>
            {room.zone === "room" && (
              room.isPaused ? (
                <button
                  onClick={() => void resumeRoom(room.id)}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[oklch(0.78_0.2_155/0.15)] border border-[oklch(0.78_0.2_155/0.5)] text-[oklch(0.78_0.2_155)] font-semibold uppercase tracking-wider text-xs hover:bg-[oklch(0.78_0.2_155/0.25)] transition"
                >
                  <Play className="w-4 h-4" /> Resume
                </button>
              ) : (
                <button
                  onClick={() => void pauseRoom(room.id)}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-black/15 border border-black/50 text-white font-semibold uppercase tracking-wider text-xs hover:bg-black/25 transition"
                >
                  <Pause className="w-4 h-4" /> Pause
                </button>
              )
            )}
            {room.zone === "room" && (
              <button
                onClick={() => setExtendTimeOpen(true)}
                className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[oklch(0.7_0.19_260/0.15)] border border-[oklch(0.7_0.19_260/0.4)] text-[oklch(0.7_0.19_260)] font-semibold uppercase tracking-wider text-xs hover:bg-[oklch(0.7_0.19_260/0.25)] transition"
                title="Extend Time"
              >
                <Clock className="w-4 h-4" />
              </button>
            )}
            {room.zone === "waste" ? (
              <button
                onClick={() => setWasteReasonOpen(true)}
                disabled={room.orders.length === 0}
                className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-black/15 border border-black/50 text-white font-semibold uppercase tracking-wider text-xs hover:bg-black/25 transition disabled:opacity-40"
              >
                <ShieldAlert className="w-4 h-4" /> Log as Waste/Marketing
              </button>
            ) : (
              <button
                onClick={() => { setFrozenAt(Date.now()); setCheckoutOpen(true); }}
                className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[oklch(0.62_0.24_25/0.15)] border border-[oklch(0.62_0.24_25/0.5)] text-[oklch(0.62_0.24_25)] font-semibold uppercase tracking-wider text-xs hover:bg-[oklch(0.62_0.24_25/0.25)] transition"
              >
                <Square className="w-4 h-4" /> End
              </button>
            )}
          </>
        )}
      </div>

      {checkoutOpen && createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md no-print" onClick={() => { setCheckoutOpen(false); setFrozenAt(null); }}>
          <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto glass-strong rounded-3xl border-2 border-[oklch(0.62_0.24_25/0.5)] shadow-[0_0_60px_oklch(0.62_0.24_25/0.4)]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-5 border-b border-black/10">
              <div className="font-mono uppercase tracking-widest text-base font-bold text-[oklch(0.62_0.24_25)]">{room.name} · Checkout</div>
              <button onClick={() => { setCheckoutOpen(false); setFrozenAt(null); }} className="w-10 h-10 flex items-center justify-center rounded-full bg-black/5 hover:bg-black/10 text-muted-foreground hover:text-[#2b2416] transition"><X className="w-6 h-6" /></button>
            </div>
            <div className="p-6 space-y-5">
              {room.zone === "room" && (
                <div className="text-center text-[10px] uppercase tracking-widest text-black font-mono">
                  Timer frozen at {fmtDuration(checkoutElapsed)} — no extra time is being charged while you complete this payment
                </div>
              )}

              <div className="rounded-2xl bg-black/5 border border-black/8 p-4 space-y-3">
                <div className="text-xs uppercase tracking-widest font-bold text-muted-foreground">Discounts (optional)</div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Time Discount</label>
                    <div className="mt-1 flex gap-1.5">
                      <input
                        type="number" min="0" step="0.01" value={timeDiscountInput}
                        onChange={(e) => setTimeDiscountInput(e.target.value)}
                        placeholder="0"
                        className="min-w-0 flex-1 bg-white/70 border border-black/10 rounded-lg px-2.5 py-2 text-sm font-mono"
                      />
                      <div className="flex rounded-lg border border-black/10 overflow-hidden shrink-0">
                        <button
                          onClick={() => setTimeDiscountType("fixed")}
                          className={`px-2.5 py-2 text-xs font-bold ${timeDiscountType === "fixed" ? "bg-[oklch(0.7_0.19_260/0.25)] text-[#2b2416]" : "bg-white/50 text-muted-foreground"}`}
                        >EGP</button>
                        <button
                          onClick={() => setTimeDiscountType("percent")}
                          className={`px-2.5 py-2 text-xs font-bold border-l border-black/10 ${timeDiscountType === "percent" ? "bg-[oklch(0.7_0.19_260/0.25)] text-[#2b2416]" : "bg-white/50 text-muted-foreground"}`}
                        >%</button>
                      </div>
                    </div>
                    {timeDiscountPreview > 0 && <div className="text-[10px] text-[oklch(0.78_0.2_155)] mt-1 font-mono">-{fmtMoney(timeDiscountPreview)}</div>}
                  </div>
                  <div>
                    <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Orders Discount</label>
                    <div className="mt-1 flex gap-1.5">
                      <input
                        type="number" min="0" step="0.01" value={ordersDiscountInput}
                        onChange={(e) => setOrdersDiscountInput(e.target.value)}
                        placeholder="0"
                        className="min-w-0 flex-1 bg-white/70 border border-black/10 rounded-lg px-2.5 py-2 text-sm font-mono"
                      />
                      <div className="flex rounded-lg border border-black/10 overflow-hidden shrink-0">
                        <button
                          onClick={() => setOrdersDiscountType("fixed")}
                          className={`px-2.5 py-2 text-xs font-bold ${ordersDiscountType === "fixed" ? "bg-[oklch(0.7_0.19_260/0.25)] text-[#2b2416]" : "bg-white/50 text-muted-foreground"}`}
                        >EGP</button>
                        <button
                          onClick={() => setOrdersDiscountType("percent")}
                          className={`px-2.5 py-2 text-xs font-bold border-l border-black/10 ${ordersDiscountType === "percent" ? "bg-[oklch(0.7_0.19_260/0.25)] text-[#2b2416]" : "bg-white/50 text-muted-foreground"}`}
                        >%</button>
                      </div>
                    </div>
                    {ordersDiscountPreview > 0 && <div className="text-[10px] text-[oklch(0.78_0.2_155)] mt-1 font-mono">-{fmtMoney(ordersDiscountPreview)}</div>}
                  </div>
                </div>
                {!hasManualDiscount && room.isOwnerTable && (
                  <div className="text-[10px] text-black font-mono">Owner Discount (25%) applies automatically — enter a discount above to override it instead.</div>
                )}
              </div>

              <div className="text-center py-2">
                <div className="text-xs uppercase tracking-widest text-muted-foreground">
                  {checkoutDiscountAmount > 0 ? (
                    <>Subtotal {fmtMoney(checkoutPreDiscountTotal)} − Discount {fmtMoney(checkoutDiscountAmount)}</>
                  ) : (
                    "Total Due"
                  )}
                </div>
                <div className="text-6xl font-mono font-black mt-2">{fmtMoney(checkoutTotal)}</div>
              </div>
              <div className="text-sm uppercase tracking-widest font-bold text-muted-foreground pt-2">Payment Method</div>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setPaymentOption("cash")}
                  className={`flex flex-col items-center gap-2 py-6 rounded-2xl border-2 transition ${paymentOption === "cash" ? "bg-[oklch(0.78_0.2_155/0.3)] border-[oklch(0.78_0.2_155/0.8)] scale-[1.02]" : "bg-[oklch(0.78_0.2_155/0.08)] border-[oklch(0.78_0.2_155/0.3)] hover:bg-[oklch(0.78_0.2_155/0.18)]"} text-[oklch(0.78_0.2_155)]`}
                >
                  <Banknote className="w-8 h-8" /> <span className="text-base font-bold uppercase">100% Cash</span>
                </button>
                <button
                  onClick={() => setPaymentOption("visa")}
                  className={`flex flex-col items-center gap-2 py-6 rounded-2xl border-2 transition ${paymentOption === "visa" ? "bg-[oklch(0.7_0.19_260/0.3)] border-[oklch(0.7_0.19_260/0.8)] scale-[1.02]" : "bg-[oklch(0.7_0.19_260/0.08)] border-[oklch(0.7_0.19_260/0.3)] hover:bg-[oklch(0.7_0.19_260/0.18)]"} text-[oklch(0.7_0.19_260)]`}
                >
                  <CreditCard className="w-8 h-8" /> <span className="text-base font-bold uppercase">100% Visa</span>
                </button>
                <button
                  onClick={() => setPaymentOption("mixed_cash_visa")}
                  className={`flex flex-col items-center gap-2 py-6 rounded-2xl border-2 transition ${paymentOption === "mixed_cash_visa" ? "bg-black/30 border-black/80 scale-[1.02]" : "bg-black/8 border-black/30 hover:bg-black/18"} text-white`}
                >
                  <SplitSquareHorizontal className="w-8 h-8" /> <span className="text-base font-bold uppercase text-center leading-tight">Cash + Visa</span>
                </button>
                <button
                  onClick={() => setPaymentOption("mixed_cash_instapay")}
                  className={`flex flex-col items-center gap-2 py-6 rounded-2xl border-2 transition ${paymentOption === "mixed_cash_instapay" ? "bg-[oklch(0.65_0.24_305/0.3)] border-[oklch(0.65_0.24_305/0.8)] scale-[1.02]" : "bg-[oklch(0.65_0.24_305/0.08)] border-[oklch(0.65_0.24_305/0.3)] hover:bg-[oklch(0.65_0.24_305/0.18)]"} text-[oklch(0.75_0.2_305)]`}
                >
                  <SplitSquareHorizontal className="w-8 h-8" /> <span className="text-base font-bold uppercase text-center leading-tight">Cash + InstaPay</span>
                </button>
              </div>

              {isMixed && (
                <div className="space-y-4 pt-2 p-4 rounded-2xl bg-white/60 border border-black/10">
                  <div>
                    <label className="text-sm uppercase tracking-widest font-bold text-muted-foreground">
                      Enter {paymentOption === "mixed_cash_visa" ? "Visa" : "InstaPay"} Amount
                    </label>
                    <input
                      type="number" step="0.01" autoFocus value={secondaryInput}
                      onChange={(e) => setSecondaryInput(e.target.value)}
                      placeholder="0.00"
                      max={total}
                      className={`mt-2 w-full bg-white/80 border-2 rounded-xl px-4 py-4 text-2xl font-mono font-bold text-center outline-none focus:border-[oklch(0.7_0.19_260)] ${secondaryExceedsTotal ? "border-[oklch(0.62_0.24_25/0.6)]" : "border-black/12"}`}
                    />
                  </div>
                  <div className="flex items-center justify-between rounded-xl bg-[oklch(0.78_0.2_155/0.1)] border border-[oklch(0.78_0.2_155/0.3)] px-4 py-4">
                    <span className="text-sm uppercase tracking-widest font-bold text-[oklch(0.78_0.2_155)]">Cash (Auto-Calculated)</span>
                    <span className="text-2xl font-mono font-bold text-[oklch(0.78_0.2_155)]">{fmtMoney(cashAmount)}</span>
                  </div>
                  {secondaryExceedsTotal && (
                    <div className="text-sm font-mono font-bold text-[oklch(0.62_0.24_25)] px-1">
                      {paymentOption === "mixed_cash_visa" ? "Visa" : "InstaPay"} amount can't exceed the total ({fmtMoney(total)}).
                    </div>
                  )}
                </div>
              )}

              {checkoutErr && (
                <div className="text-sm p-4 rounded-xl bg-[oklch(0.62_0.24_25/0.2)] border-2 border-[oklch(0.62_0.24_25/0.6)] text-[oklch(0.62_0.24_25)] font-semibold">
                  {checkoutErr}
                </div>
              )}

              <button
                onClick={handleCheckout}
                disabled={checkingOut}
                className="w-full mt-2 py-5 rounded-2xl bg-gradient-to-r from-[oklch(0.7_0.19_260)] to-[oklch(0.65_0.24_305)] text-[#2b2416] font-bold text-lg uppercase tracking-wide shadow-[0_0_30px_oklch(0.7_0.19_260/0.5)] disabled:opacity-50"
              >
                {checkingOut ? "Processing..." : "Confirm & Close Ticket"}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* Split toggle */}
      <label className="mt-3 flex items-center gap-2 cursor-pointer text-xs text-muted-foreground select-none">
        <span className="relative">
          <input
            type="checkbox"
            checked={split}
            onChange={(e) => setSplit(e.target.checked)}
            className="peer sr-only"
          />
          <span className="w-9 h-5 flex items-center bg-white/80 border border-black/10 rounded-full peer-checked:bg-[oklch(0.7_0.19_260/0.4)] peer-checked:border-[oklch(0.7_0.19_260)] transition" />
          <span className="absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-white shadow transition peer-checked:translate-x-4" />
        </span>
        <span className="uppercase tracking-widest text-[10px]">Split Bill</span>
      </label>
    </div>
    </div>
  );
});

// Large, high-contrast, touch-friendly menu picker with category tabs
// across the top — replaces the old small dropdown list entirely.
function MenuPickerModal({ room, onClose, onOrder, canFulfill, state }: {
  room: Room;
  onClose: () => void;
  onOrder: (menuItemId: string) => void;
  canFulfill: (menuItemId: string, qty: number) => boolean;
  state: ReturnType<typeof useStore>["state"];
}) {
  const categoriesWithItems = MENU_CATEGORIES.filter((c) => state.menu.some((m) => m.category === c));
  const [activeCategory, setActiveCategory] = useState<MenuCategory | null>(categoriesWithItems[0] ?? null);
  const itemsInCategory = state.menu.filter((m) => m.category === activeCategory);

  return createPortal(
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md no-print" onClick={onClose}>
      <div
        className="w-full max-w-4xl h-[85vh] glass-strong rounded-3xl border-2 border-[oklch(0.7_0.19_260/0.5)] shadow-[0_0_60px_oklch(0.7_0.19_260/0.4)] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/10 shrink-0">
          <div className="font-mono uppercase tracking-widest text-lg font-bold text-[oklch(0.7_0.19_260)]">
            {room.name} · Add Order
          </div>
          <button onClick={onClose} className="w-10 h-10 flex items-center justify-center rounded-full bg-black/5 hover:bg-black/10 text-muted-foreground hover:text-[#2b2416] transition">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Oversized category tabs */}
        <div className="flex flex-wrap items-center gap-2 px-6 py-4 border-b border-black/10 shrink-0">
          {categoriesWithItems.length === 0 && (
            <span className="text-sm text-muted-foreground font-mono uppercase tracking-widest">No menu items available</span>
          )}
          {categoriesWithItems.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`shrink-0 px-5 py-3 rounded-xl text-sm font-bold uppercase tracking-wide transition border-2 ${
                activeCategory === cat
                  ? "bg-gradient-to-r from-[oklch(0.7_0.19_260)] to-[oklch(0.65_0.24_305)] text-[#2b2416] border-transparent shadow-[0_0_20px_oklch(0.7_0.19_260/0.6)]"
                  : "bg-black/5 border-black/10 text-muted-foreground hover:bg-black/8 hover:text-[#2b2416]"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Large touch-friendly item grid */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {itemsInCategory.map((m: MenuItem) => {
              const ok = canFulfill(m.id, 1);
              return (
                <button
                  key={m.id}
                  disabled={!ok}
                  onClick={() => onOrder(m.id)}
                  className={`flex flex-col items-start gap-2 p-5 rounded-2xl text-left border-2 transition ${
                    ok
                      ? "bg-black/5 border-black/10 hover:border-[oklch(0.7_0.19_260/0.6)] hover:bg-[oklch(0.7_0.19_260/0.15)] active:scale-95"
                      : "bg-black/5 border-black/8 opacity-40 cursor-not-allowed"
                  }`}
                >
                  <span className="text-lg font-bold leading-tight">{m.name}</span>
                  <span className="text-2xl font-mono font-black text-[oklch(0.78_0.2_155)]">{fmtMoney(m.price)}</span>
                  {!ok && <span className="text-xs uppercase tracking-widest text-[oklch(0.62_0.24_25)]">Out of stock</span>}
                </button>
              );
            })}
            {activeCategory && itemsInCategory.length === 0 && (
              <div className="col-span-full text-center text-sm text-muted-foreground font-mono uppercase tracking-widest py-10">
                No items in {activeCategory} yet
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ReceiptModal({ session, onClose }: { session: Session; onClose: () => void }) {
  const startD = new Date(session.startedAt);
  const endD = new Date(session.endedAt);
  const [logoReady, setLogoReady] = useState(false);
  useEffect(() => {
    const img = new Image();
    img.onload = () => setLogoReady(true);
    img.src = logo;
    if (img.complete) setLogoReady(true);
  }, []);

  return createPortal(
    <div className="print-root fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-lg glass-strong rounded-2xl border border-black/10 shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-black/10">
          <div className="font-mono uppercase tracking-widest text-sm text-[oklch(0.7_0.19_260)]">Receipt</div>
          <button onClick={onClose} className="text-muted-foreground hover:text-[#2b2416]"><X className="w-4 h-4" /></button>
        </div>

        <div className="print-area p-6 font-mono text-sm bg-white/50">
          <div className="text-center mb-4 receipt-block">
            <img src={logo} alt="GLITCH" className="w-40 h-auto mx-auto receipt-logo" />
            <div className="text-xl font-bold tracking-widest mt-1">GLITCH</div>
            <div className="text-sm font-bold uppercase tracking-[0.15em] mt-1">PlayStation &amp; Lounge</div>
          </div>
          <div className="border-b border-dashed border-black/40 py-2 my-2 text-xs receipt-block">
            <div className="flex justify-between"><span>Order #</span><span className="font-bold">{session.orderNumber}</span></div>
            <div className="flex justify-between"><span>Room</span><span>{session.roomName}</span></div>
            <div className="flex justify-between"><span>Start</span><span>{fmtReceiptTime(startD)}</span></div>
            <div className="flex justify-between"><span>End</span><span>{fmtReceiptTime(endD)}</span></div>
            <div className="flex justify-between"><span>Duration</span><span>{fmtDuration(session.durationSec)}</span></div>
            <div className="flex justify-between"><span>Payment</span><span className="uppercase">{PAYMENT_LABELS[session.paymentMethod]}</span></div>
            {session.paymentMethod === "mixed_cash_visa" && (
              <>
                <div className="flex justify-between text-[10px] opacity-80"><span>&nbsp;&nbsp;Cash</span><span>{fmtMoney(session.cashAmount)}</span></div>
                <div className="flex justify-between text-[10px] opacity-80"><span>&nbsp;&nbsp;Visa</span><span>{fmtMoney(session.visaAmount)}</span></div>
              </>
            )}
            {session.paymentMethod === "mixed_cash_instapay" && (
              <>
                <div className="flex justify-between text-[10px] opacity-80"><span>&nbsp;&nbsp;Cash</span><span>{fmtMoney(session.cashAmount)}</span></div>
                <div className="flex justify-between text-[10px] opacity-80"><span>&nbsp;&nbsp;InstaPay</span><span>{fmtMoney(session.instapayAmount)}</span></div>
              </>
            )}
          </div>

          {session.splitBill ? (
            <>
              <div className="mt-3 text-xs uppercase tracking-widest opacity-70">Time</div>
              <div className="flex justify-between receipt-line"><span>Room Time</span><span>{fmtMoney(session.timeCost)}</span></div>

              <div className="mt-3 text-xs uppercase tracking-widest opacity-70">Orders</div>
              {session.orders.length === 0 && <div className="opacity-60">— none —</div>}
              {session.orders.map((o) => (
                <div key={o.menuItemId} className="flex justify-between receipt-line">
                  <span>{o.qty}× {o.name}</span>
                  <span>{fmtMoney(o.qty * o.price)}</span>
                </div>
              ))}
              <div className="flex justify-between border-t border-dashed border-black/20 mt-2 pt-1">
                <span>Orders Subtotal</span><span>{fmtMoney(session.ordersCost)}</span>
              </div>
            </>
          ) : (
            <>
              <div className="mt-2 flex justify-between receipt-line"><span>Room Time</span><span>{fmtMoney(session.timeCost)}</span></div>
              {session.orders.map((o) => (
                <div key={o.menuItemId} className="flex justify-between receipt-line">
                  <span>{o.qty}× {o.name}</span>
                  <span>{fmtMoney(o.qty * o.price)}</span>
                </div>
              ))}
            </>
          )}

          <div className="flex justify-between border-t border-dashed border-black/40 mt-3 pt-2 text-sm font-bold">
            <span>Subtotal</span><span>{fmtMoney(session.timeCost + session.ordersCost)}</span>
          </div>
          {session.timeDiscountAmount > 0 && (
            <div className="flex justify-between text-xs text-black receipt-line">
              <span>{session.timeDiscountLabel ?? "Time Discount"}</span><span>-{fmtMoney(session.timeDiscountAmount)}</span>
            </div>
          )}
          {session.ordersDiscountAmount > 0 && (
            <div className="flex justify-between text-xs text-black receipt-line">
              <span>{session.ordersDiscountLabel ?? "Orders Discount"}</span><span>-{fmtMoney(session.ordersDiscountAmount)}</span>
            </div>
          )}
          {session.discountAmount > 0 && session.timeDiscountAmount === 0 && session.ordersDiscountAmount === 0 && (
            <div className="flex justify-between text-xs text-black receipt-line">
              <span>{session.discountLabel ?? "Discount"}</span><span>-{fmtMoney(session.discountAmount)}</span>
            </div>
          )}
          <div className="border-t border-double border-black/25 mt-2 pt-2 flex justify-between text-base font-bold receipt-block receipt-total">
            <span>TOTAL</span><span>{fmtMoney(session.total)}</span>
          </div>
          <div className="text-center text-sm font-bold uppercase tracking-widest mt-4">
            Thank you — Game Over.
          </div>
        </div>

        <div className="p-4 border-t border-black/10 flex justify-end gap-2 no-print">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm bg-black/5 hover:bg-black/8 border border-black/10">Close</button>
          <button
            onClick={() => void printSmart()}
            disabled={!logoReady}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm bg-gradient-to-r from-[oklch(0.7_0.19_260)] to-[oklch(0.65_0.24_305)] text-[#2b2416] shadow-[0_0_20px_oklch(0.7_0.19_260/0.4)] disabled:opacity-60"
          >
            <Printer className="w-4 h-4" /> {logoReady ? "Print" : "Preparing..."}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function BaristaTicketModal({ room, kotNumber: kotNumberProp, onClose }: { room: Room; kotNumber: number | null; onClose: () => void }) {
  const { state } = useStore();
  const now = new Date();
  // Clean sequential #001, #002... resetting each shift — not a random
  // hash — so kitchen staff can spot a missed ticket at a glance. Falls
  // back to a timestamp only if the shift lookup somehow failed.
  const kotNumber = kotNumberProp !== null ? "#" + String(kotNumberProp).padStart(3, "0") : "KOT-" + String(now.getTime()).slice(-6);
  const [logoReady, setLogoReady] = useState(false);
  useEffect(() => {
    const img = new Image();
    img.onload = () => setLogoReady(true);
    img.src = logo;
    if (img.complete) setLogoReady(true);
  }, []);

  return createPortal(
    <div className="print-root fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md glass-strong rounded-2xl border border-black/10 shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-black/10">
          <div className="flex items-center gap-2 font-mono uppercase tracking-widest text-sm text-black">
            <ChefHat className="w-4 h-4" /> Kitchen Order Ticket
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-[#2b2416]"><X className="w-4 h-4" /></button>
        </div>

        {/* No prices/totals here on purpose — this goes to the kitchen, not the customer. */}
        <div className="print-area p-6 font-mono text-sm bg-white/50">
          <div className="text-center mb-3 receipt-block">
            <img src={logo} alt="GLITCH" className="w-32 h-auto mx-auto receipt-logo" />
            <div className="text-lg font-bold tracking-widest mt-1">GLITCH</div>
            <div className="text-sm font-bold uppercase tracking-[0.15em] mt-1">Kitchen Order Ticket</div>
          </div>
          <div className="border-t border-b border-dashed border-black/20 py-2 my-2 text-xs receipt-block">
            <div className="flex justify-between"><span>Table/Room</span><span className="font-bold">{room.name}</span></div>
            <div className="flex justify-between"><span>KOT #</span><span className="font-bold">{kotNumber}</span></div>
            <div className="flex justify-between"><span>Time</span><span>{fmtReceiptTime(now)}</span></div>
            <div className="flex justify-between"><span>Server</span><span>{state.currentUser?.username ?? "—"}</span></div>
          </div>

          <div className="mt-3 space-y-3">
            {room.orders.length === 0 && <div className="opacity-60 text-center">— no items —</div>}
            {room.orders.map((o) => (
              <div key={o.menuItemId} className="receipt-line">
                <div className="font-bold">{o.qty}× {o.name}</div>
                {o.notes && (
                  <div className="pl-3 text-black italic">
                    → *{o.notes}*
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="p-4 border-t border-black/10 flex justify-end gap-2 no-print">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm bg-black/5 hover:bg-black/8 border border-black/10">Close</button>
          <button
            onClick={() => void printSmart()}
            disabled={!logoReady}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm bg-gradient-to-r from-black to-black text-white font-semibold disabled:opacity-60"
          >
            <Printer className="w-4 h-4" /> {logoReady ? "Print" : "Preparing..."}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function VoidRequestModal({ roomId, roomName, menuItemId, itemName, maxQty, onClose, requestVoid }: {
  roomId: string;
  roomName: string;
  menuItemId: string;
  itemName: string;
  maxQty: number;
  onClose: () => void;
  requestVoid: ReturnType<typeof useStore>["requestVoid"];
}) {
  const { state } = useStore();
  const isAdmin = state.currentUser?.role === "admin";
  const [qty, setQty] = useState(maxQty);
  const [reason, setReason] = useState<VoidReason | "">("");
  const [waiterName, setWaiterName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [confirmingUnapproved, setConfirmingUnapproved] = useState(false);

  const submit = async (approvingAdminUsername?: string, approvingAdminPassword?: string, routeUnapproved?: boolean) => {
    if (!reason) { setResult({ kind: "err", text: "Select a reason." }); return; }
    if (!waiterName.trim()) { setResult({ kind: "err", text: "Waiter name is required for the audit log." }); return; }
    setSubmitting(true);
    try {
      const res = await requestVoid({ roomId, menuItemId, qty, reason, waiterName: waiterName.trim(), approvingAdminUsername, approvingAdminPassword, routeUnapproved });
      if (!res.ok) { setResult({ kind: "err", text: res.error ?? "Void request failed" }); return; }
      setResult({
        kind: "ok",
        text: routeUnapproved
          ? "Removed from the bill immediately — routed to the Unapproved Voids queue for mandatory admin review."
          : isAdmin || approvingAdminUsername
            ? "Cancelled immediately" + (approvingAdminUsername ? ` — authorized by admin ${approvingAdminUsername}.` : ".")
            : "Sent for admin approval — this item stays on the bill and in Expected Cash until approved.",
      });
      setTimeout(onClose, 1400);
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm no-print" onClick={onClose}>
      <div className="w-full max-w-sm glass-strong rounded-2xl border border-[oklch(0.62_0.24_25/0.4)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-black/10">
          <div className="flex items-center gap-2 font-mono uppercase tracking-widest text-xs text-[oklch(0.62_0.24_25)]">
            <ShieldAlert className="w-4 h-4" /> Void Request
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-[#2b2416]"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-3">
          <div className="text-sm">
            <span className="text-muted-foreground">{roomName} —</span> <span className="font-semibold">{itemName}</span>
          </div>

          <div>
            <label className="text-xs uppercase tracking-widest text-muted-foreground">Quantity to void</label>
            <input
              type="number" min={1} max={maxQty} value={qty}
              onChange={(e) => setQty(Math.max(1, Math.min(maxQty, +e.target.value)))}
              className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm font-mono"
            />
          </div>

          <div>
            <label className="text-xs uppercase tracking-widest text-muted-foreground">Reason (required)</label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value as VoidReason)}
              className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">Select a reason...</option>
              {Object.entries(VOID_REASON_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs uppercase tracking-widest text-muted-foreground">Waiter assigned to table (required)</label>
            <input
              value={waiterName}
              onChange={(e) => setWaiterName(e.target.value)}
              placeholder="Waiter's name"
              className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm"
            />
          </div>

          {!isAdmin && (
            <p className="text-xs text-black">
              This item stays on the live bill and counts toward Expected Cash until an admin approves it — you cannot cancel independently. Have an admin here now? They can authorize it instantly instead.
            </p>
          )}

          {confirmingUnapproved && (
            <div className="text-xs p-3 rounded-lg border bg-[oklch(0.62_0.24_25/0.1)] border-[oklch(0.62_0.24_25/0.4)] text-[oklch(0.62_0.24_25)] space-y-2">
              <p className="font-semibold">No admin available — remove this item now?</p>
              <p>It will come off the bill and inventory will be deducted immediately, before any review. This goes into the Unapproved Voids queue and must be reconciled by an admin later — it's permanently on record with your name attached.</p>
            </div>
          )}

          {result && (
            <div className={`text-sm p-2.5 rounded-lg border ${result.kind === "ok" ? "bg-[oklch(0.78_0.2_155/0.1)] border-[oklch(0.78_0.2_155/0.4)] text-[oklch(0.78_0.2_155)]" : "bg-[oklch(0.62_0.24_25/0.1)] border-[oklch(0.62_0.24_25/0.4)] text-[oklch(0.62_0.24_25)]"}`}>
              {result.text}
            </div>
          )}
        </div>
        <div className="p-4 border-t border-black/10 flex flex-wrap justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm bg-black/5 hover:bg-black/8 border border-black/10">Cancel</button>
          {!isAdmin && !confirmingUnapproved && (
            <>
              <button
                onClick={() => setConfirmingUnapproved(true)}
                disabled={submitting}
                className="px-4 py-2 rounded-lg text-sm bg-black/5 border border-black/10 text-muted-foreground hover:bg-[oklch(0.62_0.24_25/0.1)] hover:text-[oklch(0.62_0.24_25)] disabled:opacity-60"
              >
                No Admin Available
              </button>
              <button
                onClick={() => setAuthOpen(true)}
                disabled={submitting}
                className="px-4 py-2 rounded-lg text-sm bg-black/15 border border-black/50 text-white font-semibold disabled:opacity-60"
              >
                Get Admin Approval Now
              </button>
            </>
          )}
          {confirmingUnapproved ? (
            <>
              <button onClick={() => setConfirmingUnapproved(false)} className="px-4 py-2 rounded-lg text-sm bg-black/5 hover:bg-black/8 border border-black/10">Back</button>
              <button
                onClick={() => submit(undefined, undefined, true)}
                disabled={submitting}
                className="px-4 py-2 rounded-lg text-sm bg-[oklch(0.62_0.24_25/0.2)] border border-[oklch(0.62_0.24_25/0.6)] text-[oklch(0.62_0.24_25)] font-bold disabled:opacity-60"
              >
                {submitting ? "Removing..." : "Confirm — Remove Now, Review Later"}
              </button>
            </>
          ) : (
            <button
              onClick={() => submit()}
              disabled={submitting}
              className="px-4 py-2 rounded-lg text-sm bg-[oklch(0.62_0.24_25/0.2)] border border-[oklch(0.62_0.24_25/0.5)] text-[oklch(0.62_0.24_25)] font-semibold disabled:opacity-60"
            >
              {submitting ? "Submitting..." : isAdmin ? "Void Now" : "Submit for Approval"}
            </button>
          )}
        </div>
      </div>

      {authOpen && (
        <AdminAuthModal
          description={`Authorize cancelling ${qty}x ${itemName} on ${roomName}`}
          onClose={() => setAuthOpen(false)}
          onAuthorized={(adminUsername, adminPassword) => {
            setAuthOpen(false);
            void submit(adminUsername, adminPassword);
          }}
        />
      )}
    </div>,
    document.body,
  );
}

// Generic Admin Authorization modal — a manager-key-style override. Any
// cashier-initiated critical action that needs an admin to approve it on
// the spot (rather than through an async approval queue) can reuse this.
function AdminAuthModal({ description, onClose, onAuthorized }: {
  description: string;
  onClose: () => void;
  onAuthorized: (adminUsername: string, adminPassword: string) => void;
}) {
  const { verifyAdminAuth } = useStore();
  const [adminUsername, setAdminUsername] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [checking, setChecking] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    if (!adminUsername.trim() || !adminPassword) { setErr("Enter the admin's username and password."); return; }
    setChecking(true);
    try {
      const res = await verifyAdminAuth(adminUsername.trim(), adminPassword);
      if (!res.ok) { setErr("Authorization failed — check the username and password, and that the account is an admin."); return; }
      onAuthorized(res.adminUsername ?? adminUsername.trim(), adminPassword);
    } finally {
      setChecking(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[220] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md" onClick={onClose}>
      <div className="w-full max-w-sm glass-strong rounded-2xl border-2 border-black/50" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-black/10">
          <div className="flex items-center gap-2 font-mono uppercase tracking-widest text-xs text-black">
            <ShieldAlert className="w-4 h-4" /> Admin Authorization Required
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-[#2b2416]"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-sm text-muted-foreground">{description}</p>
          <div>
            <label className="text-xs uppercase tracking-widest text-muted-foreground">Admin Username</label>
            <input
              autoFocus value={adminUsername} onChange={(e) => setAdminUsername(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
              className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs uppercase tracking-widest text-muted-foreground">Admin Password / PIN</label>
            <input
              type="password" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
              className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          {err && <div className="text-sm text-[oklch(0.62_0.24_25)]">{err}</div>}
        </div>
        <div className="p-4 border-t border-black/10 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm bg-black/5 hover:bg-black/8 border border-black/10">Cancel</button>
          <button
            onClick={submit}
            disabled={checking}
            className="px-4 py-2 rounded-lg text-sm bg-gradient-to-r from-black to-black text-white font-semibold disabled:opacity-60"
          >
            {checking ? "Verifying..." : "Authorize"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function WasteReasonModal({ room, logWasteMarketing, onClose }: {
  room: Room;
  logWasteMarketing: ReturnType<typeof useStore>["logWasteMarketing"];
  onClose: () => void;
}) {
  const [reason, setReason] = useState<WasteMarketingReason | "">("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const itemCount = room.orders.reduce((a, o) => a + o.qty, 0);
  const retailValue = room.orders.reduce((a, o) => a + o.qty * o.price, 0);

  const submit = async () => {
    if (!reason) { setErr("Select a reason."); return; }
    setErr(null);
    setSubmitting(true);
    try {
      const res = await logWasteMarketing(room.id, reason, note.trim() || undefined);
      if (!res.ok) { setErr(res.error ?? "Could not log this."); return; }
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm no-print" onClick={onClose}>
      <div className="w-full max-w-sm glass-strong rounded-2xl border border-black/50" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-black/10">
          <div className="flex items-center gap-2 font-mono uppercase tracking-widest text-xs text-black">
            <ShieldAlert className="w-4 h-4" /> Log as Waste/Marketing
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-[#2b2416]"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-4 space-y-4">
          <div className="rounded-lg bg-black/5 border border-black/8 p-3 text-xs font-mono flex justify-between">
            <span>{itemCount} item{itemCount === 1 ? "" : "s"}</span>
            <span className="font-bold text-black">{fmtMoney(retailValue)} retail value</span>
          </div>

          <div>
            <label className="text-xs uppercase tracking-widest text-muted-foreground">Reason (required)</label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value as WasteMarketingReason)}
              className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2.5 text-sm"
            >
              <option value="">Select a reason...</option>
              {(Object.keys(WASTE_MARKETING_REASON_LABELS) as WasteMarketingReason[]).map((r) => (
                <option key={r} value={r}>{WASTE_MARKETING_REASON_LABELS[r]}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs uppercase tracking-widest text-muted-foreground">Note (optional)</label>
            <input
              value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. which customer, which order..."
              className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2.5 text-sm"
            />
          </div>

          {err && <div className="text-xs text-[oklch(0.62_0.24_25)]">{err}</div>}
        </div>
        <div className="p-4 border-t border-black/10 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm bg-black/5 hover:bg-black/8 border border-black/10">Cancel</button>
          <button
            onClick={() => void submit()}
            disabled={submitting || !reason}
            className="px-4 py-2 rounded-lg text-sm bg-gradient-to-r from-black to-black text-white font-bold disabled:opacity-40"
          >
            {submitting ? "Logging..." : "Confirm & Log"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ExtendTimeModal({ room, elapsed, extendRoomTime, onClose }: {
  room: Room;
  elapsed: number;
  extendRoomTime: ReturnType<typeof useStore>["extendRoomTime"];
  onClose: () => void;
}) {
  const { state } = useStore();
  const isAdmin = state.currentUser?.role === "admin";
  const currentMins = Math.floor(elapsed / 60);
  const [mode, setMode] = useState<"quick" | "custom" | "range">("quick");
  const [customTarget, setCustomTarget] = useState(String(currentMins));
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Default range to "however long it's actually run so far" — the
  // user drags these to whatever the correct duration should have
  // been, and we compute the delta from that, same underlying
  // mechanism as the other two modes.
  const nowD = new Date();
  const fromDefault = new Date(nowD.getTime() - elapsed * 1000);
  const [rangeFrom, setRangeFrom] = useState(`${String(fromDefault.getHours()).padStart(2, "0")}:${String(fromDefault.getMinutes()).padStart(2, "0")}`);
  const [rangeTo, setRangeTo] = useState(`${String(nowD.getHours()).padStart(2, "0")}:${String(nowD.getMinutes()).padStart(2, "0")}`);

  const applyDelta = async (deltaSec: number) => {
    setErr(null);
    setSubmitting(true);
    try {
      const res = await extendRoomTime(room.id, deltaSec);
      if (!res.ok) { setErr(res.error ?? "Could not adjust time"); return; }
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const targetMins = parseInt(customTarget, 10);
  const customDeltaSec = isNaN(targetMins) ? 0 : (targetMins * 60) - elapsed;
  const customInvalid = isNaN(targetMins) || customDeltaSec <= 0;

  // Range mode: parse the two HH:MM values into a duration, treating
  // an end time earlier than start as spanning past midnight — the
  // duration itself is what matters, not which calendar day it falls
  // on, since this modal only ever adjusts today's active session.
  const parseHM = (s: string) => {
    const [h, m] = s.split(":").map((n) => parseInt(n, 10));
    return isNaN(h) || isNaN(m) ? null : h * 60 + m;
  };
  const fromMins = parseHM(rangeFrom);
  const toMins = parseHM(rangeTo);
  const rangeDurationMin = fromMins !== null && toMins !== null ? (toMins >= fromMins ? toMins - fromMins : toMins + 1440 - fromMins) : null;
  const rangeDeltaSec = rangeDurationMin !== null ? rangeDurationMin * 60 - elapsed : 0;
  const rangeInvalid = rangeDurationMin === null || rangeDeltaSec === 0;
  const rangeIsReduction = rangeDeltaSec < 0;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm no-print" onClick={onClose}>
      <div className="w-full max-w-sm glass-strong rounded-2xl border border-[oklch(0.7_0.19_260/0.4)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-black/10">
          <div className="flex items-center gap-2 font-mono uppercase tracking-widest text-xs text-[oklch(0.7_0.19_260)]">
            <Clock className="w-4 h-4" /> Adjust Time — {room.name}
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-[#2b2416]"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-4 space-y-4">
          <div className="text-center">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Current Elapsed Time</div>
            <div className="text-2xl font-mono font-bold">{fmtDuration(elapsed)}</div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <button onClick={() => setMode("quick")} className={`py-2 rounded-lg text-xs font-bold uppercase tracking-wide border-2 ${mode === "quick" ? "bg-[oklch(0.7_0.19_260/0.2)] border-[oklch(0.7_0.19_260/0.6)] text-[#2b2416]" : "bg-black/5 border-black/10 text-muted-foreground"}`}>
              Quick Add
            </button>
            <button onClick={() => setMode("custom")} className={`py-2 rounded-lg text-xs font-bold uppercase tracking-wide border-2 ${mode === "custom" ? "bg-[oklch(0.7_0.19_260/0.2)] border-[oklch(0.7_0.19_260/0.6)] text-[#2b2416]" : "bg-black/5 border-black/10 text-muted-foreground"}`}>
              Target Time
            </button>
            <button onClick={() => setMode("range")} className={`py-2 rounded-lg text-xs font-bold uppercase tracking-wide border-2 ${mode === "range" ? "bg-[oklch(0.7_0.19_260/0.2)] border-[oklch(0.7_0.19_260/0.6)] text-[#2b2416]" : "bg-black/5 border-black/10 text-muted-foreground"}`}>
              Time Range
            </button>
          </div>

          {mode === "quick" ? (
            <div className="grid grid-cols-3 gap-2">
              {[15, 30, 60].map((mins) => (
                <button
                  key={mins}
                  onClick={() => void applyDelta(mins * 60)}
                  disabled={submitting}
                  className="py-3 rounded-lg bg-[oklch(0.78_0.2_155/0.15)] border border-[oklch(0.78_0.2_155/0.5)] text-[oklch(0.78_0.2_155)] font-bold text-sm disabled:opacity-60"
                >
                  +{mins} min
                </button>
              ))}
            </div>
          ) : mode === "custom" ? (
            <div>
              <label className="text-xs uppercase tracking-widest text-muted-foreground">New Total Time (minutes)</label>
              <input
                type="number" min={currentMins} value={customTarget}
                onChange={(e) => setCustomTarget(e.target.value)}
                className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-3 text-xl font-mono text-center"
              />
              <p className="text-[11px] text-muted-foreground mt-2">
                Must be at least the current elapsed time ({currentMins} min) — for reducing time instead, use Time Range.
              </p>
              {!customInvalid && (
                <p className="text-xs font-bold text-[oklch(0.78_0.2_155)] mt-1 text-center">
                  Adds +{Math.round(customDeltaSec / 60)} min
                </p>
              )}
              <button
                onClick={() => void applyDelta(customDeltaSec)}
                disabled={submitting || customInvalid}
                className="w-full mt-3 py-3 rounded-lg bg-gradient-to-r from-[oklch(0.7_0.19_260)] to-[oklch(0.65_0.24_305)] text-[#2b2416] font-bold disabled:opacity-40"
              >
                {submitting ? "Applying..." : "Apply New Total Time"}
              </button>
            </div>
          ) : (
            <div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs uppercase tracking-widest text-muted-foreground">Start Time</label>
                  <input type="time" value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm font-mono" />
                </div>
                <div>
                  <label className="text-xs uppercase tracking-widest text-muted-foreground">End Time</label>
                  <input type="time" value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm font-mono" />
                </div>
              </div>
              {rangeDurationMin !== null && (
                <p className="text-xs text-muted-foreground mt-2 text-center">
                  That's a duration of <strong>{rangeDurationMin} min</strong> —{" "}
                  {rangeIsReduction
                    ? <span className="font-bold text-[#8B5CF6]">reduces by {Math.round(Math.abs(rangeDeltaSec) / 60)} min</span>
                    : <span className="font-bold text-[oklch(0.78_0.2_155)]">adds {Math.round(rangeDeltaSec / 60)} min</span>}
                </p>
              )}
              {rangeIsReduction && !isAdmin && (
                <p className="text-[11px] text-[oklch(0.62_0.24_25)] mt-2 text-center">
                  Only an admin can reduce time — ask an admin to make this correction.
                </p>
              )}
              <button
                onClick={() => void applyDelta(rangeDeltaSec)}
                disabled={submitting || rangeInvalid || (rangeIsReduction && !isAdmin)}
                className="w-full mt-3 py-3 rounded-lg bg-gradient-to-r from-[oklch(0.7_0.19_260)] to-[oklch(0.65_0.24_305)] text-[#2b2416] font-bold disabled:opacity-40"
              >
                {submitting ? "Applying..." : "Apply Time Range"}
              </button>
            </div>
          )}

          {err && <div className="text-xs text-[oklch(0.62_0.24_25)]">{err}</div>}
        </div>
        <div className="p-4 border-t border-black/10 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm bg-black/5 hover:bg-black/8 border border-black/10">Close</button>
        </div>
      </div>
    </div>
  );
}

function TransferModal({ room, targets, onClose }: { room: Room; targets: Room[]; onClose: () => void }) {
  const { transferZone } = useStore();
  // Every other room/table is a valid target now — merging into an
  // already-active one is supported on the backend (its own timer
  // keeps running untouched; only the source's orders and a frozen
  // time charge get folded in).
  const eligibleTargets = targets;
  const [targetId, setTargetId] = useState(eligibleTargets[0]?.id ?? "");
  const [rateMode, setRateMode] = useState<"single" | "multi">("single");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const target = eligibleTargets.find((t) => t.id === targetId);
  const targetIsRoom = target?.zone === "room";
  const targetIsActive = target?.status === "active";
  // A rate mode is only meaningful when the room target needs to
  // start fresh — merging into an already-running room keeps using
  // whatever rate it's already on.
  const needsRateMode = targetIsRoom && !targetIsActive;

  const submit = async () => {
    if (!targetId) return;
    setSubmitting(true);
    setErr(null);
    try {
      const res = await transferZone(room.id, targetId, needsRateMode ? rateMode : undefined);
      if (!res.ok) { setErr(res.error ?? "Transfer failed"); return; }
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm no-print" onClick={onClose}>
      <div className="w-full max-w-sm glass-strong rounded-2xl border border-black/10" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-black/10">
          <div className="flex items-center gap-2 font-mono uppercase tracking-widest text-xs text-[oklch(0.7_0.19_260)]">
            <ArrowRightLeft className="w-4 h-4" /> Transfer {room.name}
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-[#2b2416]"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            {targetIsActive
              ? `This freezes ${room.name}'s time charge${room.zone === "room" ? "" : " (none, it has no timer)"} and merges its orders into ${target?.name}'s already-running session — ${target?.name}'s own timer keeps going untouched.`
              : room.zone === "room"
                ? `This freezes ${room.name}'s time charge right now, folds it into the target as a line item, and moves any remaining orders over.`
                : `This moves ${room.name}'s orders to the target.`} {room.name} becomes available again immediately.
          </p>
          <div>
            <label className="text-xs uppercase tracking-widest text-muted-foreground">Move to</label>
            <select value={targetId} onChange={(e) => setTargetId(e.target.value)} className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm">
              {eligibleTargets.map((t) => (
                <option key={t.id} value={t.id}>{t.name} {t.zone === "room" ? (t.status === "active" ? "(room, active — merge)" : "(room, available)") : `(${t.status === "active" ? "active" : "available"} table)`}</option>
              ))}
            </select>
          </div>
          {needsRateMode && (
            <div>
              <label className="text-xs uppercase tracking-widest text-muted-foreground">Starting rate for {target?.name}</label>
              <div className="mt-1 grid grid-cols-2 gap-2">
                <button
                  onClick={() => setRateMode("single")}
                  className={`py-2 rounded-lg text-xs font-semibold border ${rateMode === "single" ? "bg-[oklch(0.78_0.2_155/0.2)] border-[oklch(0.78_0.2_155/0.5)] text-[oklch(0.78_0.2_155)]" : "bg-black/5 border-black/10 text-muted-foreground"}`}
                >
                  Single {fmtMoney(target?.singleRate ?? 0)}/hr
                </button>
                <button
                  onClick={() => setRateMode("multi")}
                  className={`py-2 rounded-lg text-xs font-semibold border ${rateMode === "multi" ? "bg-[oklch(0.7_0.19_260/0.2)] border-[oklch(0.7_0.19_260/0.5)] text-[oklch(0.7_0.19_260)]" : "bg-black/5 border-black/10 text-muted-foreground"}`}
                >
                  Multi {fmtMoney(target?.multiRate ?? 0)}/hr
                </button>
              </div>
            </div>
          )}
          {targetIsActive && targetIsRoom && (
            <div className="text-[11px] text-[#8B5CF6] bg-[#8B5CF6]/10 border border-[#8B5CF6]/30 rounded-lg p-2">
              {target?.name} is already running {target?.rateMode} @ {fmtMoney(target?.hourlyRate ?? 0)}/hr — that continues unchanged.
            </div>
          )}
          {err && <div className="text-sm text-[oklch(0.62_0.24_25)]">{err}</div>}
        </div>
        <div className="p-4 border-t border-black/10 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm bg-black/5 hover:bg-black/8 border border-black/10">Cancel</button>
          <button
            onClick={submit}
            disabled={submitting || !targetId}
            className="px-4 py-2 rounded-lg text-sm bg-[oklch(0.7_0.19_260/0.2)] border border-[oklch(0.7_0.19_260/0.5)] text-[oklch(0.7_0.19_260)] font-semibold disabled:opacity-60"
          >
            {submitting ? "Transferring..." : "Confirm Transfer"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function SplitModal({ room, onClose }: { room: Room; onClose: () => void }) {
  const { splitBill, openSplitInterface } = useStore();
  const [mode, setMode] = useState<"items" | "amount">("items");
  // Items mode: menuItemId -> qty being split off onto the sub-bill.
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [amountInput, setAmountInput] = useState("");
  const [paymentOption, setPaymentOption] = useState<PaymentMethod>("cash");
  const [secondaryInput, setSecondaryInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [discountType, setDiscountType] = useState<"fixed" | "percent">("fixed");
  const [discountInput, setDiscountInput] = useState("");
  const [splitReceipt, setSplitReceipt] = useState<Session | null>(null);
  const [logoReady, setLogoReady] = useState(false);
  useEffect(() => {
    const img = new Image();
    img.onload = () => setLogoReady(true);
    img.src = logo;
    if (img.complete) setLogoReady(true);
  }, []);

  useEffect(() => {
    openSplitInterface(room.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const move = (menuItemId: string, maxQty: number, delta: number) => {
    setSelected((prev) => {
      const next = Math.max(0, Math.min(maxQty, (prev[menuItemId] ?? 0) + delta));
      const copy = { ...prev };
      if (next === 0) delete copy[menuItemId];
      else copy[menuItemId] = next;
      return copy;
    });
  };

  const items = Object.entries(selected).map(([menuItemId, qty]) => ({ menuItemId, qty }));
  const selectedTotal = room.orders.reduce((a, o) => a + (selected[o.menuItemId] ?? 0) * o.price, 0);
  const preDiscountSplitTotal = mode === "items" ? selectedTotal : parseFloat(amountInput) || 0;
  const discountPreview = (() => {
    const v = parseFloat(discountInput) || 0;
    if (v <= 0) return 0;
    const amt = discountType === "percent" ? preDiscountSplitTotal * (v / 100) : v;
    return Math.round(Math.max(0, Math.min(amt, preDiscountSplitTotal)) * 100) / 100;
  })();
  const hasManualDiscount = discountPreview > 0;
  const splitTotal = preDiscountSplitTotal - (hasManualDiscount ? discountPreview : (room.isOwnerTable ? Math.round(preDiscountSplitTotal * 0.25 * 100) / 100 : 0));

  const isMixed = paymentOption === "mixed_cash_visa" || paymentOption === "mixed_cash_instapay";
  // Cashier enters only the Visa/InstaPay amount — Cash is auto-calculated.
  const secondaryAmount = parseFloat(secondaryInput) || 0;
  const cashAmount = Math.max(0, splitTotal - secondaryAmount);
  const secondaryExceedsTotal = secondaryAmount > splitTotal + 0.005;

  const submit = async () => {
    setErr(null);
    if (mode === "items" && items.length === 0) { setErr("Select at least one item to split."); return; }
    if (mode === "amount" && preDiscountSplitTotal <= 0) { setErr("Enter a valid split amount."); return; }
    if (isMixed && (secondaryAmount <= 0 || secondaryExceedsTotal)) {
      setErr(
        secondaryExceedsTotal
          ? `${paymentOption === "mixed_cash_visa" ? "Visa" : "InstaPay"} amount can't exceed the sub-bill total (${fmtMoney(splitTotal)}).`
          : `Enter the ${paymentOption === "mixed_cash_visa" ? "Visa" : "InstaPay"} amount.`,
      );
      return;
    }
    setSubmitting(true);
    try {
      const res = await splitBill({
        roomId: room.id,
        mode,
        items: mode === "items" ? items : undefined,
        customAmount: mode === "amount" ? preDiscountSplitTotal : undefined,
        paymentMethod: paymentOption,
        cashAmount: isMixed ? cashAmount : undefined,
        secondaryAmount: isMixed ? secondaryAmount : undefined,
        discountType: hasManualDiscount ? discountType : undefined,
        discountValue: hasManualDiscount ? parseFloat(discountInput) || 0 : undefined,
      });
      if (!res.ok) { setErr(res.error ?? "Split payment failed"); return; }
      if (res.session) setSplitReceipt(res.session);
    } finally {
      setSubmitting(false);
    }
  };

  // After a successful split, show the printable split receipt right here
  // instead of closing — the cashier prints it immediately, then closes.
  if (splitReceipt) {
    return createPortal(
      <div className="print-root fixed inset-0 z-[210] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="w-full max-w-lg glass-strong rounded-2xl border border-black/10 shadow-2xl">
          <div className="flex items-center justify-between p-4 border-b border-black/10">
            <div className="font-mono uppercase tracking-widest text-sm text-[oklch(0.78_0.2_155)]">Split Receipt</div>
            <button onClick={onClose} className="text-muted-foreground hover:text-[#2b2416]"><X className="w-4 h-4" /></button>
          </div>
          <div className="print-area p-6 font-mono text-sm bg-white/50">
            <div className="text-center mb-4 receipt-block">
              <img src={logo} alt="GLITCH" className="w-40 h-auto mx-auto receipt-logo" />
              <div className="text-xl font-bold tracking-widest mt-1">GLITCH</div>
              <div className="text-sm font-bold uppercase tracking-[0.15em] mt-1">Split Payment Receipt</div>
            </div>
            <div className="border-t border-b border-dashed border-black/20 py-2 my-2 text-xs receipt-block">
              <div className="flex justify-between"><span>Table/Room</span><span className="font-bold">{room.name}</span></div>
              <div className="flex justify-between"><span>Time</span><span>{fmtReceiptTime(new Date(splitReceipt.endedAt))}</span></div>
              <div className="flex justify-between"><span>Payment</span><span className="uppercase">{PAYMENT_LABELS[splitReceipt.paymentMethod]}</span></div>
              {(splitReceipt.paymentMethod === "mixed_cash_visa" || splitReceipt.paymentMethod === "mixed_cash_instapay") && (
                <>
                  <div className="flex justify-between text-[10px] opacity-80"><span>&nbsp;&nbsp;Cash</span><span>{fmtMoney(splitReceipt.cashAmount)}</span></div>
                  <div className="flex justify-between text-[10px] opacity-80">
                    <span>&nbsp;&nbsp;{splitReceipt.paymentMethod === "mixed_cash_visa" ? "Visa" : "InstaPay"}</span>
                    <span>{fmtMoney(splitReceipt.paymentMethod === "mixed_cash_visa" ? splitReceipt.visaAmount : splitReceipt.instapayAmount)}</span>
                  </div>
                </>
              )}
            </div>
            <div className="mt-2 space-y-1">
              {splitReceipt.orders.map((o) => (
                <div key={o.menuItemId} className="flex justify-between receipt-line">
                  <span>{o.qty}× {o.name}</span>
                  <span>{fmtMoney(o.qty * o.price)}</span>
                </div>
              ))}
            </div>
            {splitReceipt.discountAmount > 0 && (
              <>
                <div className="flex justify-between border-t border-dashed border-black/20 mt-2 pt-1 text-xs">
                  <span>Subtotal</span><span>{fmtMoney(splitReceipt.ordersCost)}</span>
                </div>
                <div className="flex justify-between text-xs text-black receipt-line">
                  <span>{splitReceipt.discountLabel ?? "Discount"}</span><span>-{fmtMoney(splitReceipt.discountAmount)}</span>
                </div>
              </>
            )}
            <div className="border-t border-double border-black/25 mt-3 pt-2 flex justify-between text-base font-bold receipt-block receipt-total">
              <span>SUB-BILL TOTAL</span><span>{fmtMoney(splitReceipt.total)}</span>
            </div>
            <div className="text-center text-sm font-bold uppercase tracking-widest mt-4">Partial Payment — Table Remains Open</div>
          </div>
          <div className="p-4 border-t border-black/10 flex justify-end gap-2 no-print">
            <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm bg-black/5 hover:bg-black/8 border border-black/10">Close</button>
            <button
              onClick={() => void printSmart()}
              disabled={!logoReady}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm bg-gradient-to-r from-[oklch(0.78_0.2_155)] to-[oklch(0.7_0.2_170)] text-black font-semibold shadow-[0_0_20px_oklch(0.78_0.2_155/0.4)] disabled:opacity-60"
            >
              <Printer className="w-4 h-4" /> {logoReady ? "Print" : "Preparing..."}
            </button>
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm no-print" onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto glass-strong rounded-2xl border border-black/10" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-black/10">
          <div className="flex items-center gap-2 font-mono uppercase tracking-widest text-xs text-[oklch(0.7_0.19_260)]">
            <SplitSquareHorizontal className="w-4 h-4" /> Split Payment — {room.name}
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-[#2b2416]"><X className="w-4 h-4" /></button>
        </div>
        <p className="px-4 pt-3 text-xs text-muted-foreground">
          Takes an immediate partial payment against {room.name}'s live bill. {room.name} stays open with its remaining balance reduced accordingly — nothing new appears on the dashboard.
        </p>

        <div className="flex gap-2 px-4 pt-3">
          <button
            onClick={() => setMode("items")}
            className={`flex-1 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wide border-2 transition ${mode === "items" ? "bg-[oklch(0.7_0.19_260/0.2)] border-[oklch(0.7_0.19_260/0.5)] text-[oklch(0.7_0.19_260)]" : "bg-black/5 border-black/10 text-muted-foreground"}`}
          >
            Split by Items
          </button>
          <button
            onClick={() => setMode("amount")}
            className={`flex-1 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wide border-2 transition ${mode === "amount" ? "bg-[oklch(0.7_0.19_260/0.2)] border-[oklch(0.7_0.19_260/0.5)] text-[oklch(0.7_0.19_260)]" : "bg-black/5 border-black/10 text-muted-foreground"}`}
          >
            Split by Amount
          </button>
        </div>

        {mode === "items" ? (
          <div className="grid grid-cols-2 gap-4 p-4">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Remaining on {room.name}</div>
              <div className="space-y-2">
                {room.orders.map((o) => {
                  const moved = selected[o.menuItemId] ?? 0;
                  const remaining = o.qty - moved;
                  if (remaining <= 0) return null;
                  return (
                    <div key={o.menuItemId} className="flex items-center justify-between bg-white/60 rounded-lg p-2.5 border border-black/8 text-sm">
                      <span>{remaining}x {o.name}</span>
                      <button onClick={() => move(o.menuItemId, o.qty, 1)} className="w-6 h-6 flex items-center justify-center rounded bg-black/5 border border-black/10 hover:bg-black/8" title="Move to sub-bill">
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
                {room.orders.length === 0 && <div className="text-xs text-muted-foreground italic">No items on this bill</div>}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-[oklch(0.7_0.19_260)] mb-2">Sub-Bill (pay now)</div>
              <div className="space-y-2 min-h-[60px]">
                {items.length === 0 && <div className="text-xs text-muted-foreground italic p-2.5">Nothing selected yet</div>}
                {room.orders.filter((o) => selected[o.menuItemId]).map((o) => (
                  <div key={o.menuItemId} className="flex items-center justify-between bg-[oklch(0.7_0.19_260/0.1)] rounded-lg p-2.5 border border-[oklch(0.7_0.19_260/0.4)] text-sm">
                    <span>{selected[o.menuItemId]}x {o.name}</span>
                    <button onClick={() => move(o.menuItemId, o.qty, -1)} className="w-6 h-6 flex items-center justify-center rounded bg-black/5 border border-black/10 hover:bg-black/8" title="Move back">
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="p-4">
            <label className="text-xs uppercase tracking-widest text-muted-foreground">Custom Split Amount</label>
            <input
              type="number" step="0.01" autoFocus value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              placeholder="0.00"
              className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-4 py-3 text-2xl font-mono font-bold"
            />
            <p className="text-xs text-muted-foreground mt-2">Not tied to specific items — reduces {room.name}'s remaining balance by this amount directly.</p>
          </div>
        )}

        <div className="px-4 pb-2">
          <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Discount (optional)</label>
          <div className="mt-1 flex gap-1.5">
            <input
              type="number" min="0" step="0.01" value={discountInput}
              onChange={(e) => setDiscountInput(e.target.value)}
              placeholder="0"
              className="min-w-0 flex-1 bg-white/70 border border-black/10 rounded-lg px-2.5 py-2 text-sm font-mono"
            />
            <div className="flex rounded-lg border border-black/10 overflow-hidden shrink-0">
              <button
                onClick={() => setDiscountType("fixed")}
                className={`px-2.5 py-2 text-xs font-bold ${discountType === "fixed" ? "bg-[oklch(0.7_0.19_260/0.25)] text-[#2b2416]" : "bg-white/50 text-muted-foreground"}`}
              >EGP</button>
              <button
                onClick={() => setDiscountType("percent")}
                className={`px-2.5 py-2 text-xs font-bold border-l border-black/10 ${discountType === "percent" ? "bg-[oklch(0.7_0.19_260/0.25)] text-[#2b2416]" : "bg-white/50 text-muted-foreground"}`}
              >%</button>
            </div>
          </div>
          {!hasManualDiscount && room.isOwnerTable && (
            <div className="text-[10px] text-black font-mono mt-1">Owner Discount (25%) applies automatically — enter a discount above to override it instead.</div>
          )}
        </div>

        <div className="px-4 pb-2 flex justify-between text-sm font-mono">
          <span className="text-muted-foreground">
            {(hasManualDiscount || room.isOwnerTable) && preDiscountSplitTotal - splitTotal > 0
              ? `Subtotal ${fmtMoney(preDiscountSplitTotal)} − Discount ${fmtMoney(preDiscountSplitTotal - splitTotal)}`
              : "Sub-Bill Total"}
          </span>
          <span className="font-bold text-lg">{fmtMoney(splitTotal)}</span>
        </div>

        <div className="px-4 pb-4">
          <div className="text-xs uppercase tracking-widest text-muted-foreground pt-2 pb-2">Payment Method</div>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setPaymentOption("cash")}
              className={`flex flex-col items-center gap-1 py-2.5 rounded-lg border transition ${paymentOption === "cash" ? "bg-[oklch(0.78_0.2_155/0.25)] border-[oklch(0.78_0.2_155/0.6)]" : "bg-[oklch(0.78_0.2_155/0.08)] border-[oklch(0.78_0.2_155/0.3)]"} text-[oklch(0.78_0.2_155)]`}
            >
              <Banknote className="w-4 h-4" /> <span className="text-[11px] font-semibold uppercase">Cash</span>
            </button>
            <button
              onClick={() => setPaymentOption("visa")}
              className={`flex flex-col items-center gap-1 py-2.5 rounded-lg border transition ${paymentOption === "visa" ? "bg-[oklch(0.7_0.19_260/0.25)] border-[oklch(0.7_0.19_260/0.6)]" : "bg-[oklch(0.7_0.19_260/0.08)] border-[oklch(0.7_0.19_260/0.3)]"} text-[oklch(0.7_0.19_260)]`}
            >
              <CreditCard className="w-4 h-4" /> <span className="text-[11px] font-semibold uppercase">Visa</span>
            </button>
            <button
              onClick={() => setPaymentOption("mixed_cash_visa")}
              className={`flex flex-col items-center gap-1 py-2.5 rounded-lg border transition ${paymentOption === "mixed_cash_visa" ? "bg-black/25 border-black/60" : "bg-black/8 border-black/30"} text-white`}
            >
              <SplitSquareHorizontal className="w-4 h-4" /> <span className="text-[10px] font-semibold uppercase">Cash + Visa</span>
            </button>
            <button
              onClick={() => setPaymentOption("mixed_cash_instapay")}
              className={`flex flex-col items-center gap-1 py-2.5 rounded-lg border transition ${paymentOption === "mixed_cash_instapay" ? "bg-[oklch(0.65_0.24_305/0.25)] border-[oklch(0.65_0.24_305/0.6)]" : "bg-[oklch(0.65_0.24_305/0.08)] border-[oklch(0.65_0.24_305/0.3)]"} text-[oklch(0.75_0.2_305)]`}
            >
              <SplitSquareHorizontal className="w-4 h-4" /> <span className="text-[10px] font-semibold uppercase">Cash + InstaPay</span>
            </button>
          </div>

          {isMixed && (
            <div className="space-y-2 mt-3">
              <div>
                <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Enter {paymentOption === "mixed_cash_visa" ? "Visa" : "InstaPay"} Amount</label>
                <input
                  type="number" step="0.01" value={secondaryInput} onChange={(e) => setSecondaryInput(e.target.value)} placeholder="0.00"
                  className={`mt-1 w-full bg-white/70 border rounded-lg px-3 py-2 text-sm font-mono ${secondaryExceedsTotal ? "border-[oklch(0.62_0.24_25/0.6)]" : "border-black/10"}`}
                />
              </div>
              <div className="flex items-center justify-between rounded-lg bg-[oklch(0.78_0.2_155/0.1)] border border-[oklch(0.78_0.2_155/0.3)] px-3 py-2">
                <span className="text-[10px] uppercase tracking-widest text-[oklch(0.78_0.2_155)]">Cash (Auto)</span>
                <span className="text-sm font-mono font-bold text-[oklch(0.78_0.2_155)]">{fmtMoney(cashAmount)}</span>
              </div>
              {secondaryExceedsTotal && (
                <div className="text-xs font-mono text-[oklch(0.62_0.24_25)] px-1">
                  Can't exceed the sub-bill total ({fmtMoney(splitTotal)}).
                </div>
              )}
            </div>
          )}
        </div>

        {err && <div className="px-4 pb-3 text-sm text-[oklch(0.62_0.24_25)]">{err}</div>}

        <div className="p-4 border-t border-black/10 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm bg-black/5 hover:bg-black/8 border border-black/10">Cancel</button>
          <button
            onClick={submit}
            disabled={submitting}
            className="px-5 py-2.5 rounded-lg text-sm bg-[oklch(0.7_0.19_260/0.2)] border border-[oklch(0.7_0.19_260/0.5)] text-[oklch(0.7_0.19_260)] font-semibold disabled:opacity-60"
          >
            {submitting ? "Processing..." : "Confirm & Print Split Receipt"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
