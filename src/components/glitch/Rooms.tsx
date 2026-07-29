import { useEffect, useState } from "react";
import { useStore, fmtDuration, fmtMoney, VOID_REASON_LABELS, MENU_CATEGORIES, type Room, type Session, type PaymentMethod, type VoidReason, type MenuCategory, type MenuItem } from "@/lib/glitch-store";
import { Play, Square, Plus, Minus, Printer, X, Crown, Gamepad2, Banknote, CreditCard, ShieldAlert, MessageSquare, Check, ChefHat, ArrowRightLeft, SplitSquareHorizontal } from "lucide-react";

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

  const roomZone = state.rooms.filter((r) => r.zone === "room");
  const loungeZone = state.rooms.filter((r) => r.zone === "lounge");
  const splitZone = state.rooms.filter((r) => r.zone === "split");
  // Any room or lounge table is a valid transfer target regardless of which
  // view you're on — transfer is explicitly cross-zone.
  const transferTargets = [...roomZone, ...loungeZone];
  const primaryZone = scope === "room" ? roomZone : loungeZone;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{scope === "room" ? "Rooms Management" : "Lounge Management"}</h1>
        <p className="text-sm text-muted-foreground mt-1 font-mono uppercase tracking-widest">
          {scope === "room"
            ? `${roomZone.length - 1} Bays · 1 VIP Suite`
            : `${loungeZone.length} Standard Tables`}
        </p>
      </div>

      {!activeShift && (
        <div className="glass rounded-2xl p-4 border border-[oklch(0.82_0.16_85/0.4)] text-sm text-[oklch(0.82_0.16_85)]">
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

      {/* Split invoices are shown on both Rooms and Lounge views so whoever
          created one can always find and check it out. */}
      {splitZone.length > 0 && (
        <div>
          <h2 className="text-sm uppercase tracking-widest text-muted-foreground font-mono mb-3">Split Invoices</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {splitZone.map((r) => (
              <RoomCard key={r.id} room={r} elapsed={computeElapsed(r)} onCheckout={setReceipt} transferTargets={transferTargets} />
            ))}
          </div>
        </div>
      )}

      {receipt && <ReceiptModal session={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
}

function RoomCard({ room, elapsed, onCheckout, transferTargets }: { room: Room; elapsed: number; onCheckout: (s: Session) => void; transferTargets: Room[] }) {
  const { state, startRoom, endRoom, addOrder, setOrderLineQty, setOrderLineNote, setRoomRate, canFulfill, requestVoid } = useStore();
  const isAdmin = state.currentUser?.role === "admin";
  const [split, setSplit] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [ticketOpen, setTicketOpen] = useState(false);
  const [warn, setWarn] = useState<string | null>(null);
  const [editingRate, setEditingRate] = useState(false);
  const [singleRateInput, setSingleRateInput] = useState(String(room.singleRate));
  const [multiRateInput, setMultiRateInput] = useState(String(room.multiRate));
  const [voidTarget, setVoidTarget] = useState<{ menuItemId: string; name: string; maxQty: number } | null>(null);
  const [editingNoteFor, setEditingNoteFor] = useState<string | null>(null);
  const [noteInput, setNoteInput] = useState("");
  const [transferOpen, setTransferOpen] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  const [pickingRateToStart, setPickingRateToStart] = useState(false);

  const timeCost = (elapsed / 3600) * room.hourlyRate;
  const ordersCost = room.orders.reduce((a, o) => a + o.qty * o.price, 0);
  const total = timeCost + ordersCost;

  const cardStyle = room.isVip
    ? "animate-vip bg-gradient-to-br from-[oklch(0.82_0.16_85/0.08)] via-[oklch(0.15_0.03_275/0.6)] to-[oklch(0.65_0.24_305/0.08)] border-[oklch(0.82_0.16_85/0.4)]"
    : room.status === "active"
      ? "animate-pulse-glow border-[oklch(0.78_0.2_155/0.4)]"
      : "border-white/10 hover:border-[oklch(0.7_0.19_260/0.4)] hover:shadow-[0_0_25px_oklch(0.7_0.19_260/0.25)]";

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
    setMenuOpen(false);
  };

  // Increasing qty is a routine correction, unrestricted. Removing/reducing
  // an already-ordered item goes through the formal Void workflow instead —
  // that's the point at which staff could otherwise quietly wipe a sale.
  const increaseQty = async (menuItemId: string, currentQty: number) => {
    const r = await setOrderLineQty(room.id, menuItemId, currentQty + 1);
    if (!r.ok) flashWarn(r.error ?? "Could not update item");
  };

  const [paymentOption, setPaymentOption] = useState<PaymentMethod>("cash");
  const [cashInput, setCashInput] = useState("");
  const [secondaryInput, setSecondaryInput] = useState("");
  const [checkoutErr, setCheckoutErr] = useState<string | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);

  const mixedSum = (parseFloat(cashInput) || 0) + (parseFloat(secondaryInput) || 0);
  const mixedValid = Math.abs(mixedSum - total) < 0.01;
  const isMixed = paymentOption === "mixed_cash_visa" || paymentOption === "mixed_cash_instapay";

  const handleCheckout = async () => {
    setCheckoutErr(null);
    if (isMixed && !mixedValid) {
      setCheckoutErr(`Cash + ${paymentOption === "mixed_cash_visa" ? "Visa" : "InstaPay"} must equal ${fmtMoney(total)} exactly.`);
      return;
    }
    setCheckingOut(true);
    try {
      const res = await endRoom(
        room.id, split, paymentOption,
        isMixed ? parseFloat(cashInput) || 0 : undefined,
        isMixed ? parseFloat(secondaryInput) || 0 : undefined,
      );
      if (res.error) { setCheckoutErr(res.error); return; }
      setCheckoutOpen(false);
      setCashInput(""); setSecondaryInput(""); setPaymentOption("cash");
      if (res.session) onCheckout(res.session);
    } finally {
      setCheckingOut(false);
    }
  };

  return (
    <div className={`glass rounded-2xl p-5 border transition-all relative ${cardStyle}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {room.isVip ? (
            <Crown className="w-5 h-5 text-[oklch(0.82_0.16_85)]" />
          ) : (
            <Gamepad2 className="w-5 h-5 text-[oklch(0.85_0.16_200)]" />
          )}
          <h3 className={`text-lg font-bold tracking-wide ${room.isVip ? "text-gradient-gold" : ""}`}>{room.name}</h3>
          {room.isVip && (
            <span className="text-[9px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-full bg-[oklch(0.82_0.16_85/0.15)] text-[oklch(0.82_0.16_85)] border border-[oklch(0.82_0.16_85/0.5)]">
              Premium
            </span>
          )}
          {room.zone === "split" && (
            <span className="text-[9px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-full bg-[oklch(0.7_0.19_260/0.15)] text-[oklch(0.85_0.16_200)] border border-[oklch(0.7_0.19_260/0.5)]">
              {room.splitInvoiceNumber}
            </span>
          )}
          {room.transferredFrom && (
            <span className="text-[9px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-full bg-white/5 text-muted-foreground border border-white/10">
              from {room.transferredFrom}
            </span>
          )}
        </div>
        <div className={`text-[10px] uppercase tracking-widest font-bold px-2.5 py-1 rounded-full border ${
          room.status === "active"
            ? "bg-[oklch(0.78_0.2_155/0.15)] text-[oklch(0.78_0.2_155)] border-[oklch(0.78_0.2_155/0.5)]"
            : "bg-white/5 text-muted-foreground border-white/10"
        }`}>
          {room.status === "active" ? "● Active" : "○ Available"}
        </div>
      </div>

      {/* Rate */}
      {room.zone === "room" && (
        <div className="mt-3 text-xs">
          {isAdmin && editingRate ? (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-muted-foreground font-mono uppercase tracking-widest">Single</span>
              <input
                type="number" step="0.5" value={singleRateInput}
                onChange={(e) => setSingleRateInput(e.target.value)}
                className="w-16 bg-black/40 border border-white/10 rounded px-2 py-0.5 font-mono text-sm"
              />
              <span className="text-muted-foreground font-mono uppercase tracking-widest">Multi</span>
              <input
                type="number" step="0.5" value={multiRateInput}
                onChange={(e) => setMultiRateInput(e.target.value)}
                className="w-16 bg-black/40 border border-white/10 rounded px-2 py-0.5 font-mono text-sm"
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
                <button className="text-[oklch(0.85_0.16_200)] hover:underline text-[10px] uppercase" onClick={() => setEditingRate(true)}>
                  edit
                </button>
              )}
            </div>
          )}
          {room.status === "active" && room.rateMode && (
            <div className="mt-1 text-[10px] uppercase tracking-widest text-[oklch(0.78_0.2_155)]">
              Running: {room.rateMode} @ {fmtMoney(room.hourlyRate)}/hr
            </div>
          )}
        </div>
      )}

      {/* Timer + cost */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="bg-black/40 rounded-lg p-3 border border-white/5">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Elapsed</div>
          <div className={`mt-1 font-mono text-2xl font-bold ${room.status === "active" ? "text-[oklch(0.85_0.16_200)]" : "text-muted-foreground"}`}>
            {fmtDuration(elapsed)}
          </div>
        </div>
        <div className="bg-black/40 rounded-lg p-3 border border-white/5">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Running Cost</div>
          <div className={`mt-1 font-mono text-2xl font-bold ${room.isVip ? "text-[oklch(0.82_0.16_85)]" : "text-[oklch(0.78_0.2_155)]"}`}>
            {fmtMoney(total)}
          </div>
        </div>
      </div>

      {/* Split bill breakdown */}
      {split && room.status === "active" && (
        <div className="mt-3 p-3 rounded-lg bg-black/30 border border-white/5 text-xs font-mono grid grid-cols-2 gap-2">
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
                  <button
                    onClick={() => setVoidTarget({ menuItemId: o.menuItemId, name: o.name, maxQty: o.qty })}
                    className="w-5 h-5 flex items-center justify-center rounded bg-white/5 border border-white/10 hover:bg-[oklch(0.62_0.24_25/0.2)] hover:text-[oklch(0.75_0.22_25)]"
                    title="Void this item"
                  >
                    <ShieldAlert className="w-3 h-3" />
                  </button>
                  <span className="w-4 text-center text-white">{o.qty}</span>
                  <button
                    onClick={() => increaseQty(o.menuItemId, o.qty)}
                    className="w-5 h-5 flex items-center justify-center rounded bg-white/5 border border-white/10 hover:bg-white/10 hover:text-white"
                    title="Increase"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                  <span className="w-14 text-right">{fmtMoney(o.qty * o.price)}</span>
                  <button
                    onClick={() => { setEditingNoteFor(o.menuItemId); setNoteInput(o.notes ?? ""); }}
                    className={`w-5 h-5 flex items-center justify-center rounded border ${o.notes ? "bg-[oklch(0.82_0.16_85/0.15)] border-[oklch(0.82_0.16_85/0.5)] text-[oklch(0.82_0.16_85)]" : "bg-white/5 border-white/10 hover:bg-white/10"}`}
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
                    className="flex-1 bg-black/40 border border-white/10 rounded px-2 py-1 text-[11px]"
                  />
                  <button
                    onClick={() => { setOrderLineNote(room.id, o.menuItemId, noteInput); setEditingNoteFor(null); }}
                    className="w-5 h-5 flex items-center justify-center rounded bg-[oklch(0.78_0.2_155/0.2)] border border-[oklch(0.78_0.2_155/0.5)] text-[oklch(0.78_0.2_155)]"
                  >
                    <Check className="w-3 h-3" />
                  </button>
                  <button onClick={() => setEditingNoteFor(null)} className="w-5 h-5 flex items-center justify-center rounded bg-white/5 border border-white/10">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ) : o.notes ? (
                <div className="pl-1 mt-0.5 text-[11px] italic text-[oklch(0.82_0.16_85)]">
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
            onClick={() => setTicketOpen(true)}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 text-xs"
          >
            <ChefHat className="w-3.5 h-3.5" /> Ticket
          </button>
        )}
        {room.status === "active" && transferTargets.filter((t) => t.id !== room.id).length > 0 && (
          <button
            onClick={() => setTransferOpen(true)}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 text-xs"
          >
            <ArrowRightLeft className="w-3.5 h-3.5" /> Transfer
          </button>
        )}
        {room.status === "active" && room.orders.length > 0 && (
          <button
            onClick={() => setSplitOpen(true)}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 text-xs"
          >
            <SplitSquareHorizontal className="w-3.5 h-3.5" /> Split
          </button>
        )}
      </div>

      {ticketOpen && <BaristaTicketModal room={room} onClose={() => setTicketOpen(false)} />}
      {transferOpen && (
        <TransferModal room={room} targets={transferTargets.filter((t) => t.id !== room.id)} onClose={() => setTransferOpen(false)} />
      )}
      {splitOpen && <SplitModal room={room} onClose={() => setSplitOpen(false)} />}

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
        <div className="mt-3 text-xs bg-[oklch(0.62_0.24_25/0.15)] border border-[oklch(0.62_0.24_25/0.5)] text-[oklch(0.75_0.22_25)] rounded-lg px-3 py-2 font-mono">
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
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-[oklch(0.7_0.19_260/0.2)] border border-[oklch(0.7_0.19_260/0.5)] text-[oklch(0.85_0.16_200)] font-bold uppercase tracking-wider text-xs"
              >
                Multi {fmtMoney(room.multiRate)}/hr
              </button>
              <button onClick={() => setPickingRateToStart(false)} className="text-muted-foreground hover:text-white px-2"><X className="w-4 h-4" /></button>
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
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-[oklch(0.7_0.19_260/0.15)] border border-[oklch(0.7_0.19_260/0.4)] text-[oklch(0.85_0.16_200)] font-semibold uppercase tracking-wider text-xs hover:bg-[oklch(0.7_0.19_260/0.25)] transition"
              >
                <Plus className="w-4 h-4" /> Order
              </button>
              {menuOpen && <MenuPickerModal room={room} onClose={() => setMenuOpen(false)} onOrder={handleOrder} canFulfill={canFulfill} state={state} />}
            </div>
            <button
              onClick={() => setCheckoutOpen(true)}
              className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[oklch(0.62_0.24_25/0.15)] border border-[oklch(0.62_0.24_25/0.5)] text-[oklch(0.75_0.22_25)] font-semibold uppercase tracking-wider text-xs hover:bg-[oklch(0.62_0.24_25/0.25)] transition"
            >
              <Square className="w-4 h-4" /> End
            </button>
          </>
        )}
      </div>

      {checkoutOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md no-print" onClick={() => setCheckoutOpen(false)}>
          <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto glass-strong rounded-3xl border-2 border-[oklch(0.62_0.24_25/0.5)] shadow-[0_0_60px_oklch(0.62_0.24_25/0.4)]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-5 border-b border-white/10">
              <div className="font-mono uppercase tracking-widest text-base font-bold text-[oklch(0.75_0.22_25)]">{room.name} · Checkout</div>
              <button onClick={() => setCheckoutOpen(false)} className="w-10 h-10 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/15 text-muted-foreground hover:text-white transition"><X className="w-6 h-6" /></button>
            </div>
            <div className="p-6 space-y-5">
              <div className="text-center py-2">
                <div className="text-xs uppercase tracking-widest text-muted-foreground">Total Due</div>
                <div className="text-6xl font-mono font-black mt-2">{fmtMoney(total)}</div>
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
                  className={`flex flex-col items-center gap-2 py-6 rounded-2xl border-2 transition ${paymentOption === "visa" ? "bg-[oklch(0.7_0.19_260/0.3)] border-[oklch(0.7_0.19_260/0.8)] scale-[1.02]" : "bg-[oklch(0.7_0.19_260/0.08)] border-[oklch(0.7_0.19_260/0.3)] hover:bg-[oklch(0.7_0.19_260/0.18)]"} text-[oklch(0.85_0.16_200)]`}
                >
                  <CreditCard className="w-8 h-8" /> <span className="text-base font-bold uppercase">100% Visa</span>
                </button>
                <button
                  onClick={() => setPaymentOption("mixed_cash_visa")}
                  className={`flex flex-col items-center gap-2 py-6 rounded-2xl border-2 transition ${paymentOption === "mixed_cash_visa" ? "bg-[oklch(0.82_0.16_85/0.3)] border-[oklch(0.82_0.16_85/0.8)] scale-[1.02]" : "bg-[oklch(0.82_0.16_85/0.08)] border-[oklch(0.82_0.16_85/0.3)] hover:bg-[oklch(0.82_0.16_85/0.18)]"} text-[oklch(0.82_0.16_85)]`}
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
                <div className="space-y-4 pt-2 p-4 rounded-2xl bg-black/30 border border-white/10">
                  <div>
                    <label className="text-sm uppercase tracking-widest font-bold text-muted-foreground">Enter Cash Amount</label>
                    <input
                      type="number" step="0.01" autoFocus value={cashInput}
                      onChange={(e) => setCashInput(e.target.value)}
                      placeholder="0.00"
                      className="mt-2 w-full bg-black/50 border-2 border-white/15 rounded-xl px-4 py-4 text-2xl font-mono font-bold text-center outline-none focus:border-[oklch(0.7_0.19_260)]"
                    />
                  </div>
                  <div>
                    <label className="text-sm uppercase tracking-widest font-bold text-muted-foreground">
                      Enter {paymentOption === "mixed_cash_visa" ? "Visa" : "InstaPay"} Amount
                    </label>
                    <input
                      type="number" step="0.01" value={secondaryInput}
                      onChange={(e) => setSecondaryInput(e.target.value)}
                      placeholder="0.00"
                      className="mt-2 w-full bg-black/50 border-2 border-white/15 rounded-xl px-4 py-4 text-2xl font-mono font-bold text-center outline-none focus:border-[oklch(0.7_0.19_260)]"
                    />
                  </div>
                  <div className={`flex justify-between text-sm font-mono font-bold px-1 ${mixedValid ? "text-[oklch(0.78_0.2_155)]" : "text-[oklch(0.75_0.22_25)]"}`}>
                    <span>Entered: {fmtMoney(mixedSum)}</span>
                    <span>{mixedValid ? "✓ Matches Total" : `Needs ${fmtMoney(total)}`}</span>
                  </div>
                </div>
              )}

              {checkoutErr && (
                <div className="text-sm p-4 rounded-xl bg-[oklch(0.62_0.24_25/0.2)] border-2 border-[oklch(0.62_0.24_25/0.6)] text-[oklch(0.75_0.22_25)] font-semibold">
                  {checkoutErr}
                </div>
              )}

              <button
                onClick={handleCheckout}
                disabled={checkingOut || (isMixed && !mixedValid)}
                className="w-full mt-2 py-5 rounded-2xl bg-gradient-to-r from-[oklch(0.7_0.19_260)] to-[oklch(0.65_0.24_305)] text-white font-bold text-lg uppercase tracking-wide shadow-[0_0_30px_oklch(0.7_0.19_260/0.5)] disabled:opacity-50"
              >
                {checkingOut ? "Processing..." : "Confirm & Close Ticket"}
              </button>
            </div>
          </div>
        </div>
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
          <span className="w-9 h-5 flex items-center bg-black/50 border border-white/10 rounded-full peer-checked:bg-[oklch(0.7_0.19_260/0.4)] peer-checked:border-[oklch(0.7_0.19_260)] transition" />
          <span className="absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-white shadow transition peer-checked:translate-x-4" />
        </span>
        <span className="uppercase tracking-widest text-[10px]">Split Bill</span>
      </label>
    </div>
  );
}

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

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md no-print" onClick={onClose}>
      <div
        className="w-full max-w-4xl h-[85vh] glass-strong rounded-3xl border-2 border-[oklch(0.7_0.19_260/0.5)] shadow-[0_0_60px_oklch(0.7_0.19_260/0.4)] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
          <div className="font-mono uppercase tracking-widest text-lg font-bold text-[oklch(0.85_0.16_200)]">
            {room.name} · Add Order
          </div>
          <button onClick={onClose} className="w-10 h-10 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/15 text-muted-foreground hover:text-white transition">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Oversized category tabs */}
        <div className="flex items-center gap-2 px-6 py-4 border-b border-white/10 overflow-x-auto shrink-0">
          {categoriesWithItems.length === 0 && (
            <span className="text-sm text-muted-foreground font-mono uppercase tracking-widest">No menu items available</span>
          )}
          {categoriesWithItems.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`shrink-0 px-5 py-3 rounded-xl text-sm font-bold uppercase tracking-wide transition border-2 ${
                activeCategory === cat
                  ? "bg-gradient-to-r from-[oklch(0.7_0.19_260)] to-[oklch(0.65_0.24_305)] text-white border-transparent shadow-[0_0_20px_oklch(0.7_0.19_260/0.6)]"
                  : "bg-white/5 border-white/10 text-muted-foreground hover:bg-white/10 hover:text-white"
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
                      ? "bg-white/5 border-white/10 hover:border-[oklch(0.7_0.19_260/0.6)] hover:bg-[oklch(0.7_0.19_260/0.15)] active:scale-95"
                      : "bg-white/5 border-white/5 opacity-40 cursor-not-allowed"
                  }`}
                >
                  <span className="text-lg font-bold leading-tight">{m.name}</span>
                  <span className="text-2xl font-mono font-black text-[oklch(0.78_0.2_155)]">{fmtMoney(m.price)}</span>
                  {!ok && <span className="text-xs uppercase tracking-widest text-[oklch(0.75_0.22_25)]">Out of stock</span>}
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
    </div>
  );
}

function ReceiptModal({ session, onClose }: { session: Session; onClose: () => void }) {
  const startD = new Date(session.startedAt);
  const endD = new Date(session.endedAt);

  return (
    <div className="print-root fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md glass-strong rounded-2xl border border-white/10 shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <div className="font-mono uppercase tracking-widest text-sm text-[oklch(0.85_0.16_200)]">Receipt</div>
          <button onClick={onClose} className="text-muted-foreground hover:text-white"><X className="w-4 h-4" /></button>
        </div>

        <div className="print-area p-6 font-mono text-sm bg-black/20">
          <div className="text-center mb-4">
            <div className="text-xl font-bold tracking-widest">GLITCH</div>
            <div className="text-[10px] uppercase tracking-[0.3em] opacity-70">PlayStation &amp; Lounge</div>
          </div>
          <div className="border-t border-b border-dashed border-white/30 py-2 my-2 text-xs">
            <div className="flex justify-between"><span>Room</span><span>{session.roomName}</span></div>
            <div className="flex justify-between"><span>Start</span><span>{startD.toLocaleString()}</span></div>
            <div className="flex justify-between"><span>End</span><span>{endD.toLocaleString()}</span></div>
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
              <div className="flex justify-between"><span>Room Time</span><span>{fmtMoney(session.timeCost)}</span></div>

              <div className="mt-3 text-xs uppercase tracking-widest opacity-70">Orders</div>
              {session.orders.length === 0 && <div className="opacity-60">— none —</div>}
              {session.orders.map((o) => (
                <div key={o.menuItemId} className="flex justify-between">
                  <span>{o.qty}× {o.name}</span>
                  <span>{fmtMoney(o.qty * o.price)}</span>
                </div>
              ))}
              <div className="flex justify-between border-t border-dashed border-white/30 mt-2 pt-1">
                <span>Orders Subtotal</span><span>{fmtMoney(session.ordersCost)}</span>
              </div>
            </>
          ) : (
            <>
              <div className="mt-2 flex justify-between"><span>Room Time</span><span>{fmtMoney(session.timeCost)}</span></div>
              {session.orders.map((o) => (
                <div key={o.menuItemId} className="flex justify-between">
                  <span>{o.qty}× {o.name}</span>
                  <span>{fmtMoney(o.qty * o.price)}</span>
                </div>
              ))}
            </>
          )}

          <div className="border-t border-double border-white/40 mt-4 pt-2 flex justify-between text-base font-bold">
            <span>TOTAL</span><span>{fmtMoney(session.total)}</span>
          </div>
          <div className="text-center text-[10px] uppercase tracking-widest mt-4 opacity-70">
            Thank you — Game On.
          </div>
        </div>

        <div className="p-4 border-t border-white/10 flex justify-end gap-2 no-print">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm bg-white/5 hover:bg-white/10 border border-white/10">Close</button>
          <button
            onClick={() => window.print()}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm bg-gradient-to-r from-[oklch(0.7_0.19_260)] to-[oklch(0.65_0.24_305)] text-white shadow-[0_0_20px_oklch(0.7_0.19_260/0.4)]"
          >
            <Printer className="w-4 h-4" /> Print
          </button>
        </div>
      </div>
    </div>
  );
}

function BaristaTicketModal({ room, onClose }: { room: Room; onClose: () => void }) {
  const now = new Date();

  return (
    <div className="print-root fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-sm glass-strong rounded-2xl border border-white/10 shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <div className="flex items-center gap-2 font-mono uppercase tracking-widest text-sm text-[oklch(0.82_0.16_85)]">
            <ChefHat className="w-4 h-4" /> Barista Ticket
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-white"><X className="w-4 h-4" /></button>
        </div>

        {/* No prices here on purpose — this goes to the kitchen, not the customer. */}
        <div className="print-area p-6 font-mono text-sm bg-black/20">
          <div className="text-center mb-3">
            <div className="text-lg font-bold tracking-widest">GLITCH</div>
            <div className="text-[10px] uppercase tracking-[0.3em] opacity-70">Barista Ticket</div>
          </div>
          <div className="border-t border-b border-dashed border-white/30 py-2 my-2 text-xs">
            <div className="flex justify-between"><span>Room</span><span className="font-bold">{room.name}</span></div>
            <div className="flex justify-between"><span>Printed</span><span>{now.toLocaleString()}</span></div>
          </div>

          <div className="mt-3 space-y-3">
            {room.orders.length === 0 && <div className="opacity-60 text-center">— no items —</div>}
            {room.orders.map((o) => (
              <div key={o.menuItemId}>
                <div className="font-bold">{o.qty}× {o.name}</div>
                {o.notes && (
                  <div className="pl-3 text-[oklch(0.82_0.16_85)] italic">
                    → *{o.notes}*
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="p-4 border-t border-white/10 flex justify-end gap-2 no-print">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm bg-white/5 hover:bg-white/10 border border-white/10">Close</button>
          <button
            onClick={() => window.print()}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm bg-gradient-to-r from-[oklch(0.82_0.16_85)] to-[oklch(0.75_0.2_60)] text-black font-semibold shadow-[0_0_20px_oklch(0.82_0.16_85/0.4)]"
          >
            <Printer className="w-4 h-4" /> Print
          </button>
        </div>
      </div>
    </div>
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

  const submit = async () => {
    if (!reason) { setResult({ kind: "err", text: "Select a reason." }); return; }
    if (!waiterName.trim()) { setResult({ kind: "err", text: "Waiter name is required for the audit log." }); return; }
    setSubmitting(true);
    try {
      const res = await requestVoid({ roomId, menuItemId, qty, reason, waiterName: waiterName.trim() });
      if (!res.ok) { setResult({ kind: "err", text: res.error ?? "Void request failed" }); return; }
      setResult({
        kind: "ok",
        text: isAdmin
          ? "Voided immediately."
          : "Sent for admin approval — this item stays on the bill and in Expected Cash until approved.",
      });
      setTimeout(onClose, 1400);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm no-print" onClick={onClose}>
      <div className="w-full max-w-sm glass-strong rounded-2xl border border-[oklch(0.62_0.24_25/0.4)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div className="flex items-center gap-2 font-mono uppercase tracking-widest text-xs text-[oklch(0.75_0.22_25)]">
            <ShieldAlert className="w-4 h-4" /> Void Request
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-white"><X className="w-4 h-4" /></button>
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
              className="mt-1 w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm font-mono"
            />
          </div>

          <div>
            <label className="text-xs uppercase tracking-widest text-muted-foreground">Reason (required)</label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value as VoidReason)}
              className="mt-1 w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm"
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
              className="mt-1 w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm"
            />
          </div>

          {!isAdmin && (
            <p className="text-xs text-[oklch(0.82_0.16_85)]">
              This item stays on the live bill and counts toward Expected Cash until an admin approves it — you cannot void independently.
            </p>
          )}

          {result && (
            <div className={`text-sm p-2.5 rounded-lg border ${result.kind === "ok" ? "bg-[oklch(0.78_0.2_155/0.1)] border-[oklch(0.78_0.2_155/0.4)] text-[oklch(0.78_0.2_155)]" : "bg-[oklch(0.62_0.24_25/0.1)] border-[oklch(0.62_0.24_25/0.4)] text-[oklch(0.75_0.22_25)]"}`}>
              {result.text}
            </div>
          )}
        </div>
        <div className="p-4 border-t border-white/10 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm bg-white/5 hover:bg-white/10 border border-white/10">Cancel</button>
          <button
            onClick={submit}
            disabled={submitting}
            className="px-4 py-2 rounded-lg text-sm bg-[oklch(0.62_0.24_25/0.2)] border border-[oklch(0.62_0.24_25/0.5)] text-[oklch(0.75_0.22_25)] font-semibold disabled:opacity-60"
          >
            {submitting ? "Submitting..." : isAdmin ? "Void Now" : "Submit for Approval"}
          </button>
        </div>
      </div>
    </div>
  );
}

function TransferModal({ room, targets, onClose }: { room: Room; targets: Room[]; onClose: () => void }) {
  const { transferZone } = useStore();
  // Only offer targets that are actually eligible: rooms must be available
  // (can't merge into an already-running timed session), lounge tables can
  // be either.
  const eligibleTargets = targets.filter((t) => t.zone !== "room" || t.status === "available");
  const [targetId, setTargetId] = useState(eligibleTargets[0]?.id ?? "");
  const [rateMode, setRateMode] = useState<"single" | "multi">("single");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const target = eligibleTargets.find((t) => t.id === targetId);
  const targetIsRoom = target?.zone === "room";

  const submit = async () => {
    if (!targetId) return;
    setSubmitting(true);
    setErr(null);
    try {
      const res = await transferZone(room.id, targetId, targetIsRoom ? rateMode : undefined);
      if (!res.ok) { setErr(res.error ?? "Transfer failed"); return; }
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm no-print" onClick={onClose}>
      <div className="w-full max-w-sm glass-strong rounded-2xl border border-white/10" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div className="flex items-center gap-2 font-mono uppercase tracking-widest text-xs text-[oklch(0.85_0.16_200)]">
            <ArrowRightLeft className="w-4 h-4" /> Transfer {room.name}
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            {room.zone === "room"
              ? `This freezes ${room.name}'s time charge right now, folds it into the target as a line item, and moves any remaining orders over.`
              : `This moves ${room.name}'s orders to the target.`} {room.name} becomes available again immediately.
          </p>
          <div>
            <label className="text-xs uppercase tracking-widest text-muted-foreground">Move to</label>
            <select value={targetId} onChange={(e) => setTargetId(e.target.value)} className="mt-1 w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm">
              {eligibleTargets.map((t) => (
                <option key={t.id} value={t.id}>{t.name} {t.zone === "room" ? "(room)" : `(${t.status === "active" ? "active" : "available"} table)`}</option>
              ))}
            </select>
          </div>
          {targetIsRoom && (
            <div>
              <label className="text-xs uppercase tracking-widest text-muted-foreground">Starting rate for {target?.name}</label>
              <div className="mt-1 grid grid-cols-2 gap-2">
                <button
                  onClick={() => setRateMode("single")}
                  className={`py-2 rounded-lg text-xs font-semibold border ${rateMode === "single" ? "bg-[oklch(0.78_0.2_155/0.2)] border-[oklch(0.78_0.2_155/0.5)] text-[oklch(0.78_0.2_155)]" : "bg-white/5 border-white/10 text-muted-foreground"}`}
                >
                  Single {fmtMoney(target?.singleRate ?? 0)}/hr
                </button>
                <button
                  onClick={() => setRateMode("multi")}
                  className={`py-2 rounded-lg text-xs font-semibold border ${rateMode === "multi" ? "bg-[oklch(0.7_0.19_260/0.2)] border-[oklch(0.7_0.19_260/0.5)] text-[oklch(0.85_0.16_200)]" : "bg-white/5 border-white/10 text-muted-foreground"}`}
                >
                  Multi {fmtMoney(target?.multiRate ?? 0)}/hr
                </button>
              </div>
            </div>
          )}
          {err && <div className="text-sm text-[oklch(0.75_0.22_25)]">{err}</div>}
        </div>
        <div className="p-4 border-t border-white/10 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm bg-white/5 hover:bg-white/10 border border-white/10">Cancel</button>
          <button
            onClick={submit}
            disabled={submitting || !targetId}
            className="px-4 py-2 rounded-lg text-sm bg-[oklch(0.7_0.19_260/0.2)] border border-[oklch(0.7_0.19_260/0.5)] text-[oklch(0.85_0.16_200)] font-semibold disabled:opacity-60"
          >
            {submitting ? "Transferring..." : "Confirm Transfer"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SplitModal({ room, onClose }: { room: Room; onClose: () => void }) {
  const { splitOrder, openSplitInterface } = useStore();
  // Right-panel selection: menuItemId -> qty being extracted into the new split invoice.
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

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

  const submit = async () => {
    if (items.length === 0) return;
    setSubmitting(true);
    setErr(null);
    try {
      const res = await splitOrder(room.id, items);
      if (!res.ok) { setErr(res.error ?? "Split failed"); return; }
      setResult("Split invoice created — check the Split Invoices section to check it out independently.");
      setTimeout(onClose, 1600);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm no-print" onClick={onClose}>
      <div className="w-full max-w-2xl glass-strong rounded-2xl border border-white/10" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div className="flex items-center gap-2 font-mono uppercase tracking-widest text-xs text-[oklch(0.85_0.16_200)]">
            <SplitSquareHorizontal className="w-4 h-4" /> Split {room.name}
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        <p className="px-4 pt-3 text-xs text-muted-foreground">
          Move items to the right to extract them into a brand-new, independent invoice. {room.name} keeps everything you don't move (and its timer, if any, keeps running).
        </p>
        <div className="grid grid-cols-2 gap-4 p-4">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Staying on {room.name}</div>
            <div className="space-y-2">
              {room.orders.map((o) => {
                const moved = selected[o.menuItemId] ?? 0;
                const remaining = o.qty - moved;
                if (remaining <= 0) return null;
                return (
                  <div key={o.menuItemId} className="flex items-center justify-between bg-black/30 rounded-lg p-2.5 border border-white/5 text-sm">
                    <span>{remaining}x {o.name}</span>
                    <button onClick={() => move(o.menuItemId, o.qty, 1)} className="w-6 h-6 flex items-center justify-center rounded bg-white/5 border border-white/10 hover:bg-white/10" title="Move one to split">
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-[oklch(0.85_0.16_200)] mb-2">New Split Invoice</div>
            <div className="space-y-2 min-h-[60px]">
              {items.length === 0 && <div className="text-xs text-muted-foreground italic p-2.5">Nothing selected yet</div>}
              {room.orders.filter((o) => selected[o.menuItemId]).map((o) => (
                <div key={o.menuItemId} className="flex items-center justify-between bg-[oklch(0.7_0.19_260/0.1)] rounded-lg p-2.5 border border-[oklch(0.7_0.19_260/0.4)] text-sm">
                  <span>{selected[o.menuItemId]}x {o.name}</span>
                  <button onClick={() => move(o.menuItemId, o.qty, -1)} className="w-6 h-6 flex items-center justify-center rounded bg-white/5 border border-white/10 hover:bg-white/10" title="Move back">
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
            {items.length > 0 && (
              <div className="mt-2 text-xs font-mono text-muted-foreground">Split total: {fmtMoney(selectedTotal)}</div>
            )}
          </div>
        </div>
        {err && <div className="px-4 text-sm text-[oklch(0.75_0.22_25)]">{err}</div>}
        {result && <div className="px-4 text-sm text-[oklch(0.78_0.2_155)]">{result}</div>}
        <div className="p-4 border-t border-white/10 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm bg-white/5 hover:bg-white/10 border border-white/10">Cancel</button>
          <button
            onClick={submit}
            disabled={submitting || items.length === 0}
            className="px-4 py-2 rounded-lg text-sm bg-[oklch(0.7_0.19_260/0.2)] border border-[oklch(0.7_0.19_260/0.5)] text-[oklch(0.85_0.16_200)] font-semibold disabled:opacity-60"
          >
            {submitting ? "Splitting..." : "Create Split Invoice"}
          </button>
        </div>
      </div>
    </div>
  );
}
