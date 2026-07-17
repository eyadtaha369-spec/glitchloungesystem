import { useEffect, useState } from "react";
import { useStore, fmtDuration, fmtMoney, type Room, type Session } from "@/lib/glitch-store";
import { Play, Square, Plus, Printer, X, Crown, Gamepad2 } from "lucide-react";

export function RoomsPage() {
  const { state, computeElapsed } = useStore();
  const [, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick((n) => n + 1), 1000); return () => clearInterval(id); }, []);

  const [receipt, setReceipt] = useState<Session | null>(null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Rooms Management</h1>
        <p className="text-sm text-muted-foreground mt-1 font-mono uppercase tracking-widest">
          8 Bays · 1 VIP Suite
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        {state.rooms.map((r) => (
          <RoomCard key={r.id} room={r} elapsed={computeElapsed(r)} onCheckout={setReceipt} />
        ))}
      </div>

      {receipt && <ReceiptModal session={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
}

function RoomCard({ room, elapsed, onCheckout }: { room: Room; elapsed: number; onCheckout: (s: Session) => void }) {
  const { state, startRoom, endRoom, addOrder, setRoomRate, canFulfill } = useStore();
  const isAdmin = state.currentUser?.role === "admin";
  const [split, setSplit] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [warn, setWarn] = useState<string | null>(null);
  const [editingRate, setEditingRate] = useState(false);
  const [rateInput, setRateInput] = useState(String(room.hourlyRate));

  const timeCost = (elapsed / 3600) * room.hourlyRate;
  const ordersCost = room.orders.reduce((a, o) => a + o.qty * o.price, 0);
  const total = timeCost + ordersCost;

  const cardStyle = room.isVip
    ? "animate-vip bg-gradient-to-br from-[oklch(0.82_0.16_85/0.08)] via-[oklch(0.15_0.03_275/0.6)] to-[oklch(0.65_0.24_305/0.08)] border-[oklch(0.82_0.16_85/0.4)]"
    : room.status === "active"
      ? "animate-pulse-glow border-[oklch(0.78_0.2_155/0.4)]"
      : "border-white/10 hover:border-[oklch(0.7_0.19_260/0.4)] hover:shadow-[0_0_25px_oklch(0.7_0.19_260/0.25)]";

  const handleOrder = async (menuItemId: string) => {
    const r = await addOrder(room.id, menuItemId, 1);
    if (!r.ok) {
      setWarn(r.error ?? "Order failed");
      setTimeout(() => setWarn(null), 3000);
    }
    setMenuOpen(false);
  };

  const handleEnd = async () => {
    const s = await endRoom(room.id, split);
    if (s) onCheckout(s);
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
      <div className="mt-3 flex items-center gap-2 text-xs">
        <span className="text-muted-foreground font-mono uppercase tracking-widest">Rate</span>
        {isAdmin && editingRate ? (
          <>
            <input
              type="number"
              step="0.5"
              value={rateInput}
              onChange={(e) => setRateInput(e.target.value)}
              className="w-20 bg-black/40 border border-white/10 rounded px-2 py-0.5 font-mono text-sm"
            />
            <button
              className="text-[oklch(0.78_0.2_155)] hover:underline"
              onClick={() => { void setRoomRate(room.id, parseFloat(rateInput) || 0); setEditingRate(false); }}
            >save</button>
          </>
        ) : (
          <>
            <span className="font-mono font-semibold">{fmtMoney(room.hourlyRate)}/hr</span>
            {isAdmin && (
              <button className="text-[oklch(0.85_0.16_200)] hover:underline text-[10px] uppercase" onClick={() => setEditingRate(true)}>
                edit
              </button>
            )}
          </>
        )}
      </div>

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
        <div className="mt-3 text-xs font-mono space-y-1 max-h-24 overflow-y-auto">
          {room.orders.map((o) => (
            <div key={o.menuItemId} className="flex justify-between text-muted-foreground">
              <span>{o.qty}× {o.name}</span>
              <span>{fmtMoney(o.qty * o.price)}</span>
            </div>
          ))}
        </div>
      )}

      {warn && (
        <div className="mt-3 text-xs bg-[oklch(0.62_0.24_25/0.15)] border border-[oklch(0.62_0.24_25/0.5)] text-[oklch(0.75_0.22_25)] rounded-lg px-3 py-2 font-mono">
          ⚠ {warn}
        </div>
      )}

      {/* Actions */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {room.status === "available" ? (
          <button
            onClick={() => startRoom(room.id)}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-gradient-to-r from-[oklch(0.78_0.2_155)] to-[oklch(0.7_0.2_170)] text-black font-bold uppercase tracking-wider text-xs shadow-[0_0_20px_oklch(0.78_0.2_155/0.4)] hover:shadow-[0_0_30px_oklch(0.78_0.2_155/0.7)] transition"
          >
            <Play className="w-4 h-4" /> Start
          </button>
        ) : (
          <>
            <div className="flex-1">
              <button
                onClick={() => setMenuOpen(true)}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-[oklch(0.7_0.19_260/0.15)] border border-[oklch(0.7_0.19_260/0.4)] text-[oklch(0.85_0.16_200)] font-semibold uppercase tracking-wider text-xs hover:bg-[oklch(0.7_0.19_260/0.25)] transition"
              >
                <Plus className="w-4 h-4" /> Order
              </button>
              {menuOpen && (
                <div
                  className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm no-print"
                  onClick={() => setMenuOpen(false)}
                >
                  <div
                    className="w-full max-w-sm glass-strong rounded-2xl border border-[oklch(0.7_0.19_260/0.4)] shadow-[0_0_40px_oklch(0.7_0.19_260/0.4)]"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
                      <div className="font-mono uppercase tracking-widest text-xs text-[oklch(0.85_0.16_200)]">
                        {room.name} · Add Order
                      </div>
                      <button onClick={() => setMenuOpen(false)} className="text-muted-foreground hover:text-white">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="p-2 max-h-[60vh] overflow-y-auto">
                      {state.menu.length === 0 && (
                        <div className="text-center text-xs text-muted-foreground font-mono uppercase tracking-widest py-6">
                          No menu items available
                        </div>
                      )}
                      {state.menu.map((m) => {
                        const ok = canFulfill(m.id, 1);
                        return (
                          <button
                            key={m.id}
                            disabled={!ok}
                            onClick={() => handleOrder(m.id)}
                            className={`w-full flex justify-between items-center px-3 py-2.5 rounded-lg text-sm transition ${
                              ok ? "hover:bg-[oklch(0.7_0.19_260/0.15)] border border-transparent hover:border-[oklch(0.7_0.19_260/0.4)]" : "opacity-40 cursor-not-allowed"
                            }`}
                          >
                            <span className="font-semibold">{m.name}</span>
                            <span className="font-mono text-xs text-[oklch(0.78_0.2_155)]">{fmtMoney(m.price)}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
            <button
              onClick={handleEnd}
              className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[oklch(0.62_0.24_25/0.15)] border border-[oklch(0.62_0.24_25/0.5)] text-[oklch(0.75_0.22_25)] font-semibold uppercase tracking-wider text-xs hover:bg-[oklch(0.62_0.24_25/0.25)] transition"
            >
              <Square className="w-4 h-4" /> End
            </button>
          </>
        )}
      </div>

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
