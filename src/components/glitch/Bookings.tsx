import { useEffect, useMemo, useState } from "react";
import { useStore, fmtMoney, EVENT_BOOKING_STATUSES } from "@/lib/glitch-store";
import type { EventBooking, EventBookingStatus, EventDepositPaymentMethod } from "@/lib/glitch-store";
import { PartyPopper, Plus, Phone, X, Edit2, CheckCircle2, XCircle, DoorOpen, Trash2 } from "lucide-react";

type Tab = "upcoming" | "past" | "all";

const STATUS_STYLES: Record<EventBookingStatus, string> = {
  confirmed: "bg-[oklch(0.7_0.19_260/0.15)] text-[oklch(0.7_0.19_260)] border-[oklch(0.7_0.19_260/0.4)]",
  pending: "bg-[oklch(0.85_0.18_85/0.2)] text-[oklch(0.6_0.15_85)] border-[oklch(0.85_0.18_85/0.5)]",
  completed: "bg-[oklch(0.78_0.2_155/0.15)] text-[oklch(0.78_0.2_155)] border-[oklch(0.78_0.2_155/0.4)]",
  cancelled: "bg-[oklch(0.62_0.24_25/0.12)] text-[oklch(0.62_0.24_25)] border-[oklch(0.62_0.24_25/0.4)]",
};

export function BookingsPage({ onNavigateToRooms }: { onNavigateToRooms?: () => void }) {
  const { state, refreshEventBookings, updateEventBooking, deleteEventBooking } = useStore();
  const [tab, setTab] = useState<Tab>("upcoming");
  const [dateFilter, setDateFilter] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingBooking, setEditingBooking] = useState<EventBooking | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EventBooking | null>(null);

  // Loaded lazily when this page is actually visited, not on every
  // login — this data isn't needed anywhere else in the app.
  useEffect(() => { void refreshEventBookings(); }, []);

  const filtered = useMemo(() => {
    const now = Date.now();
    let list = state.eventBookings;
    if (dateFilter) {
      // A specific date always wins over the tab, regardless of
      // whether that date is in the past or future.
      const dayStart = new Date(dateFilter + "T00:00:00").getTime();
      const dayEnd = dayStart + 86400000;
      list = list.filter((b) => b.eventAt >= dayStart && b.eventAt < dayEnd);
    } else if (tab === "upcoming") {
      list = list.filter((b) => b.eventAt >= now);
    } else if (tab === "past") {
      list = list.filter((b) => b.eventAt < now);
    }
    return [...list].sort((a, b) => a.eventAt - b.eventAt);
  }, [state.eventBookings, tab, dateFilter]);

  const markStatus = async (booking: EventBooking, status: EventBookingStatus) => {
    await updateEventBooking(booking.id, { status });
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    await deleteEventBooking(deleteTarget.id);
    setDeleteTarget(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <PartyPopper className="w-8 h-8 text-[oklch(0.65_0.24_305)]" />
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Birthday &amp; Event Bookings</h1>
            <p className="text-sm text-muted-foreground mt-1 font-mono uppercase tracking-widest">حجوزات أعياد الميلاد</p>
          </div>
        </div>
        <button
          onClick={() => { setEditingBooking(null); setFormOpen(true); }}
          className="flex items-center gap-2 px-5 py-3 rounded-xl font-bold uppercase tracking-wide bg-gradient-to-r from-[oklch(0.65_0.24_305)] to-[oklch(0.7_0.19_260)] text-white shadow-[0_0_25px_oklch(0.65_0.24_305/0.4)]"
        >
          <Plus className="w-5 h-5" /> New Booking
        </button>
      </div>

      {/* Date filter + tabs */}
      <div className="glass rounded-2xl p-4 flex items-center justify-between flex-wrap gap-3">
        <div className="flex rounded-xl border border-black/10 overflow-hidden">
          {(["upcoming", "past", "all"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => { setTab(t); setDateFilter(""); }}
              className={`px-4 py-2.5 text-xs font-bold uppercase tracking-wide transition ${
                !dateFilter && tab === t ? "bg-gradient-to-r from-[oklch(0.65_0.24_305)] to-[oklch(0.7_0.19_260)] text-white" : "bg-white/60 text-muted-foreground hover:bg-white/80"
              }`}
            >
              {t === "upcoming" ? "Upcoming Bookings" : t === "past" ? "Past History Archive" : "All Bookings"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)}
            className="bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm font-mono"
          />
          {dateFilter && (
            <button onClick={() => setDateFilter("")} className="text-xs text-muted-foreground hover:text-[#2b2416] underline">Clear date</button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="glass rounded-2xl p-6">
        {filtered.length === 0 ? (
          <div className="text-sm text-muted-foreground font-mono text-center py-12">
            {dateFilter ? "No bookings on this date." : tab === "upcoming" ? "No upcoming bookings." : tab === "past" ? "No past bookings." : "No bookings recorded yet."}
          </div>
        ) : (
          <div className="overflow-x-auto overflow-y-auto max-h-[36rem] border border-black/8 rounded-xl">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white/95 backdrop-blur-sm">
                <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground border-b border-black/10">
                  <th className="pb-2 pt-3 pl-3 pr-3">Customer</th>
                  <th className="pb-2 pt-3 pr-3">Phone</th>
                  <th className="pb-2 pt-3 pr-3">Room</th>
                  <th className="pb-2 pt-3 pr-3">Event Date &amp; Time</th>
                  <th className="pb-2 pt-3 pr-3 text-right">Deposit (EGP)</th>
                  <th className="pb-2 pt-3 pr-3">Payment</th>
                  <th className="pb-2 pt-3 pr-3">Description</th>
                  <th className="pb-2 pt-3 pr-3">Status</th>
                  <th className="pb-2 pt-3 pr-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((b) => (
                  <tr key={b.id} className="border-b border-black/5 align-top">
                    <td className="py-2.5 pl-3 pr-3 font-semibold">{b.customerName}</td>
                    <td className="py-2.5 pr-3">
                      {b.phoneNumber ? (
                        <span className="flex items-center gap-1 font-mono text-xs"><Phone className="w-3 h-3" /> {b.phoneNumber}</span>
                      ) : "—"}
                    </td>
                    <td className="py-2.5 pr-3">{b.roomName ?? "—"}</td>
                    <td className="py-2.5 pr-3 font-mono text-xs">{new Date(b.eventAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</td>
                    <td className="py-2.5 pr-3 text-right font-mono font-bold">{fmtMoney(b.depositAmount)}</td>
                    <td className="py-2.5 pr-3 uppercase text-xs">{b.depositPaymentMethod}</td>
                    <td className="py-2.5 pr-3 max-w-xs truncate" title={b.description}>{b.description || "—"}</td>
                    <td className="py-2.5 pr-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border ${STATUS_STYLES[b.status]}`}>
                        {b.status}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center justify-end gap-1.5 flex-wrap">
                        {b.status !== "completed" && b.status !== "cancelled" && (
                          <button onClick={() => void markStatus(b, "completed")} title="Mark Completed" className="w-7 h-7 flex items-center justify-center rounded bg-[oklch(0.78_0.2_155/0.15)] border border-[oklch(0.78_0.2_155/0.4)] text-[oklch(0.78_0.2_155)] hover:bg-[oklch(0.78_0.2_155/0.25)]">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {b.status !== "cancelled" && b.status !== "completed" && (
                          <button onClick={() => void markStatus(b, "cancelled")} title="Cancel Booking" className="w-7 h-7 flex items-center justify-center rounded bg-[oklch(0.62_0.24_25/0.12)] border border-[oklch(0.62_0.24_25/0.4)] text-[oklch(0.62_0.24_25)] hover:bg-[oklch(0.62_0.24_25/0.22)]">
                            <XCircle className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {onNavigateToRooms && (
                          <button onClick={onNavigateToRooms} title="Go to Rooms — open the room when the customer arrives" className="w-7 h-7 flex items-center justify-center rounded bg-[oklch(0.7_0.19_260/0.12)] border border-[oklch(0.7_0.19_260/0.4)] text-[oklch(0.7_0.19_260)] hover:bg-[oklch(0.7_0.19_260/0.22)]">
                            <DoorOpen className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button onClick={() => { setEditingBooking(b); setFormOpen(true); }} title="Edit" className="w-7 h-7 flex items-center justify-center rounded bg-black/5 border border-black/10 hover:bg-black/10">
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => setDeleteTarget(b)} title="Delete" className="w-7 h-7 flex items-center justify-center rounded bg-black/5 border border-black/10 hover:bg-[oklch(0.62_0.24_25/0.15)] hover:text-[oklch(0.62_0.24_25)]">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {formOpen && (
        <BookingFormModal
          booking={editingBooking}
          onClose={() => setFormOpen(false)}
        />
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={() => setDeleteTarget(null)}>
          <div className="w-full max-w-sm glass-strong rounded-2xl border-2 border-[oklch(0.62_0.24_25/0.5)] p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-bold mb-2 text-[oklch(0.62_0.24_25)]">Delete this booking?</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Permanently removes the booking for <strong>{deleteTarget.customerName}</strong> on{" "}
              {new Date(deleteTarget.eventAt).toLocaleString()}. This can't be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleteTarget(null)} className="px-3 py-1.5 rounded-lg text-sm bg-black/5 border border-black/10">Cancel</button>
              <button onClick={() => void confirmDelete()} className="px-3 py-1.5 rounded-lg text-sm font-bold bg-[oklch(0.62_0.24_25/0.9)] text-white">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function BookingFormModal({ booking, onClose }: { booking: EventBooking | null; onClose: () => void }) {
  const { state, addEventBooking, updateEventBooking } = useStore();
  const isEdit = !!booking;

  const initialDate = booking ? new Date(booking.eventAt) : null;
  const [customerName, setCustomerName] = useState(booking?.customerName ?? "");
  const [phoneNumber, setPhoneNumber] = useState(booking?.phoneNumber ?? "");
  const [roomId, setRoomId] = useState(booking?.roomId ?? "");
  const [eventDate, setEventDate] = useState(() =>
    initialDate ? initialDate.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10)
  );
  const [eventTime, setEventTime] = useState(() =>
    initialDate ? `${String(initialDate.getHours()).padStart(2, "0")}:${String(initialDate.getMinutes()).padStart(2, "0")}` : "18:00"
  );
  const [depositAmount, setDepositAmount] = useState(booking ? String(booking.depositAmount) : "");
  const [depositPaymentMethod, setDepositPaymentMethod] = useState<EventDepositPaymentMethod>(booking?.depositPaymentMethod ?? "cash");
  const [description, setDescription] = useState(booking?.description ?? "");
  const [status, setStatus] = useState<EventBookingStatus>(booking?.status ?? "confirmed");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Rooms and Lounge tables both — any bookable space, per the explicit
  // "Rooms/Lounges" requirement.
  const roomOptions = state.rooms.filter((r) => r.zone === "room" || r.zone === "lounge");

  const submit = async () => {
    setErr(null);
    if (!customerName.trim()) { setErr("Customer name is required."); return; }
    if (!eventDate || !eventTime) { setErr("Event date and time are required."); return; }
    const eventAt = new Date(`${eventDate}T${eventTime}`).getTime();
    if (Number.isNaN(eventAt)) { setErr("Invalid date/time."); return; }
    const room = state.rooms.find((r) => r.id === roomId);

    setSubmitting(true);
    try {
      if (isEdit && booking) {
        const res = await updateEventBooking(booking.id, {
          customerName: customerName.trim(), phoneNumber: phoneNumber.trim(),
          roomId: room?.id ?? null, roomName: room?.name ?? null,
          eventAt, depositAmount: parseFloat(depositAmount) || 0, depositPaymentMethod,
          description, status,
        });
        if (!res.ok) { setErr(res.error ?? "Could not save changes."); return; }
      } else {
        const res = await addEventBooking({
          customerName: customerName.trim(), phoneNumber: phoneNumber.trim(),
          roomId: room?.id, roomName: room?.name,
          eventAt, depositAmount: parseFloat(depositAmount) || 0, depositPaymentMethod,
          description, status,
        });
        if (!res.ok) { setErr(res.error ?? "Could not create the booking."); return; }
      }
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={() => !submitting && onClose()}>
      <div className="w-full max-w-lg max-h-[90vh] flex flex-col glass-strong rounded-2xl border border-[oklch(0.65_0.24_305/0.4)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/8 shrink-0">
          <h3 className="text-lg font-bold">{isEdit ? "Edit Booking" : "New Birthday / Event Booking"}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-[#2b2416]"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <div>
            <label className="text-xs uppercase tracking-widest text-muted-foreground">Customer Name</label>
            <input
              value={customerName} onChange={(e) => setCustomerName(e.target.value)}
              className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2.5 text-sm"
              placeholder="e.g. Mona Ahmed"
            />
          </div>

          <div>
            <label className="text-xs uppercase tracking-widest text-muted-foreground">Phone Number</label>
            <input
              type="tel" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)}
              className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2.5 text-sm font-mono"
              placeholder="e.g. 01012345678"
            />
          </div>

          <div>
            <label className="text-xs uppercase tracking-widest text-muted-foreground">Target Room / Space</label>
            <select
              value={roomId} onChange={(e) => setRoomId(e.target.value)}
              className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2.5 text-sm"
            >
              <option value="">— No specific room yet —</option>
              {roomOptions.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs uppercase tracking-widest text-muted-foreground">Event Date</label>
              <input
                type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)}
                className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2.5 text-sm font-mono"
              />
            </div>
            <div>
              <label className="text-xs uppercase tracking-widest text-muted-foreground">Event Time</label>
              <input
                type="time" value={eventTime} onChange={(e) => setEventTime(e.target.value)}
                className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2.5 text-sm font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs uppercase tracking-widest text-muted-foreground">Deposit Amount (العربون)</label>
              <input
                type="number" min="0" step="0.01" value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)}
                className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2.5 text-sm font-mono"
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="text-xs uppercase tracking-widest text-muted-foreground">Deposit Payment Method</label>
              <select
                value={depositPaymentMethod} onChange={(e) => setDepositPaymentMethod(e.target.value as EventDepositPaymentMethod)}
                className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2.5 text-sm"
              >
                <option value="cash">Cash</option>
                <option value="instapay">InstaPay</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs uppercase tracking-widest text-muted-foreground">Event Description / Special Setup Notes</label>
            <textarea
              value={description} onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2.5 text-sm resize-none"
              placeholder="Decorations, cake details, equipment required..."
            />
          </div>

          <div>
            <label className="text-xs uppercase tracking-widest text-muted-foreground">Booking Status</label>
            <select
              value={status} onChange={(e) => setStatus(e.target.value as EventBookingStatus)}
              className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2.5 text-sm capitalize"
            >
              {EVENT_BOOKING_STATUSES.map((s) => (
                <option key={s} value={s} className="capitalize">{s}</option>
              ))}
            </select>
          </div>

          {err && <div className="text-sm text-[oklch(0.62_0.24_25)]">{err}</div>}
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-black/8 shrink-0">
          <button onClick={onClose} disabled={submitting} className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-black/5 border border-black/10">Cancel</button>
          <button
            onClick={() => void submit()}
            disabled={submitting}
            className="px-5 py-2.5 rounded-lg text-sm font-bold bg-gradient-to-r from-[oklch(0.65_0.24_305)] to-[oklch(0.7_0.19_260)] text-white disabled:opacity-50"
          >
            {submitting ? "Saving..." : isEdit ? "Save Changes" : "Create Booking"}
          </button>
        </div>
      </div>
    </div>
  );
}
