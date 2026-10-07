import { useState } from "react";
import { createPortal } from "react-dom";
import { useStore } from "@/lib/glitch-store";
import { Plus, Trash2, Shield, User, Save, Pencil, X, KeyRound, ShieldAlert } from "lucide-react";

export function UsersPage() {
  const { state, addAccount, deleteAccount, updateAccount } = useStore();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "cashier">("cashier");
  const [err, setErr] = useState("");
  // Confirm & Create is gated behind the currently logged-in admin
  // re-entering their own password (step-up re-authentication) --
  // nothing is sent to the server until that password is filled in and
  // the modal's own submit runs; see ConfirmCreateAccountModal below.
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Admin self-edit form
  const me = state.currentUser;
  const [selfUsername, setSelfUsername] = useState(me?.username ?? "");
  const [selfPassword, setSelfPassword] = useState("");
  const [selfMsg, setSelfMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // Row editing state
  const [editing, setEditing] = useState<string | null>(null);
  const [editUsername, setEditUsername] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [rowMsg, setRowMsg] = useState<string | null>(null);

  // Opens the password-confirmation modal instead of submitting
  // directly -- the actual addAccount call (and therefore the request
  // to the server) only happens from inside that modal, once the
  // current admin's password has been entered and verified.
  const openConfirm = () => {
    setErr("");
    if (!username || !password) { setErr("Fill both fields"); return; }
    setConfirmOpen(true);
  };

  const submitWithAdminPassword = async (adminPassword: string) => {
    const res = await addAccount({ username, password, role, adminPassword });
    if (!res.ok) return res;
    setUsername(""); setPassword(""); setRole("cashier");
    setConfirmOpen(false);
    return res;
  };

  const saveSelf = async () => {
    setSelfMsg(null);
    if (!me) return;
    const res = await updateAccount(me.username, {
      username: selfUsername.trim() || me.username,
      password: selfPassword,
    });
    if (!res.ok) { setSelfMsg({ kind: "err", text: res.error ?? "Update failed" }); return; }
    setSelfPassword("");
    setSelfMsg({ kind: "ok", text: "Credentials updated" });
    setTimeout(() => setSelfMsg(null), 2500);
  };

  const beginEdit = (u: string) => {
    setEditing(u);
    setEditUsername(u);
    setEditPassword("");
    setRowMsg(null);
  };
  const saveEdit = async (original: string) => {
    const res = await updateAccount(original, { username: editUsername.trim(), password: editPassword || undefined });
    if (!res.ok) { setRowMsg(res.error ?? "Update failed"); return; }
    setEditing(null);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">User Management</h1>
        <p className="text-sm text-muted-foreground mt-1 font-mono uppercase tracking-widest">Provision employee accounts</p>
      </div>

      {/* Admin self credentials */}
      {me?.role === "admin" && (
        <div className="glass rounded-2xl p-6 border border-black/30">
          <h2 className="text-lg font-semibold mb-1 flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-black" /> My Admin Credentials
          </h2>
          <p className="text-xs text-muted-foreground font-mono uppercase tracking-widest mb-4">
            Change your own username and password
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Username</label>
              <input
                type="password"
                autoComplete="off"
                value={selfUsername}
                onChange={(e) => setSelfUsername(e.target.value)}
                className="mt-1 w-full bg-white/70 rounded-lg px-3 py-2.5 text-sm border border-black/10 font-mono"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-widest text-muted-foreground">New Password</label>
              <input
                type="password"
                autoComplete="new-password"
                placeholder="Leave blank to keep current"
                value={selfPassword}
                onChange={(e) => setSelfPassword(e.target.value)}
                className="mt-1 w-full bg-white/70 rounded-lg px-3 py-2.5 text-sm border border-black/10 font-mono"
              />
            </div>
            <div className="flex items-end">
              <button
                onClick={saveSelf}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-gradient-to-r from-black to-black text-white font-bold uppercase tracking-wider text-xs"
              >
                <Save className="w-4 h-4" /> Save
              </button>
            </div>
          </div>
          {selfMsg && (
            <div className={`mt-3 text-xs font-mono ${selfMsg.kind === "ok" ? "text-[oklch(0.78_0.2_155)]" : "text-[oklch(0.62_0.24_25)]"}`}>
              {selfMsg.kind === "ok" ? "✓ " : "⚠ "}{selfMsg.text}
            </div>
          )}
        </div>
      )}

      <div className="glass rounded-2xl p-6">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2"><Plus className="w-4 h-4" /> Create Account</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="bg-white/70 rounded-lg px-3 py-2.5 text-sm border border-black/10"
          />
          <input
            type="password"
            autoComplete="new-password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="bg-white/70 rounded-lg px-3 py-2.5 text-sm border border-black/10"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as "admin" | "cashier")}
            className="bg-white/70 rounded-lg px-3 py-2.5 text-sm border border-black/10"
          >
            <option value="cashier">Cashier</option>
            <option value="admin">Admin</option>
          </select>
          <button
            onClick={openConfirm}
            className="rounded-lg bg-gradient-to-r from-[oklch(0.7_0.19_260)] to-[oklch(0.65_0.24_305)] text-[#2b2416] font-semibold text-sm shadow-[0_0_20px_oklch(0.7_0.19_260/0.4)]"
          >
            Create
          </button>
        </div>
        {err && <div className="mt-3 text-sm text-[oklch(0.62_0.24_25)]">{err}</div>}
      </div>

      {confirmOpen && (
        <ConfirmCreateAccountModal
          newUsername={username}
          newRole={role}
          onSubmit={submitWithAdminPassword}
          onClose={() => setConfirmOpen(false)}
        />
      )}

      <div className="glass rounded-2xl p-6">
        <h2 className="text-lg font-semibold mb-4">Employee Roster</h2>
        {rowMsg && <div className="mb-3 text-xs text-[oklch(0.62_0.24_25)] font-mono">⚠ {rowMsg}</div>}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-widest text-muted-foreground border-b border-black/8">
                <th className="text-left py-2 px-2">Username</th>
                <th className="text-left py-2 px-2">Role</th>
                <th className="text-left py-2 px-2">Password</th>
                <th className="py-2 px-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {state.accounts.map((a) => {
                const isEditing = editing === a.username;
                const isSelf = a.username === state.currentUser?.username;
                return (
                  <tr key={a.username} className="border-b border-black/8">
                    <td className="py-3 px-2 font-semibold">
                      {isEditing ? (
                        <input
                          value={editUsername}
                          onChange={(e) => setEditUsername(e.target.value)}
                          className="bg-white/70 rounded px-2 py-1 text-sm border border-black/10 w-full font-mono"
                        />
                      ) : a.username}
                    </td>
                    <td className="py-3 px-2">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] uppercase tracking-widest font-bold border ${
                        a.role === "admin"
                          ? "bg-black/15 text-white border-black/50"
                          : "bg-[oklch(0.7_0.19_260/0.15)] text-[oklch(0.7_0.19_260)] border-[oklch(0.7_0.19_260/0.4)]"
                      }`}>
                        {a.role === "admin" ? <Shield className="w-3 h-3" /> : <User className="w-3 h-3" />}
                        {a.role}
                      </span>
                    </td>
                    <td className="py-3 px-2 font-mono text-xs text-muted-foreground">
                      {isEditing ? (
                        <input
                          type="password"
                          autoComplete="new-password"
                          placeholder="Leave blank to keep current"
                          value={editPassword}
                          onChange={(e) => setEditPassword(e.target.value)}
                          className="bg-white/70 rounded px-2 py-1 text-sm border border-black/10 w-full font-mono"
                        />
                      ) : "••••••••"}
                    </td>
                    <td className="py-3 px-2 text-right">
                      <div className="inline-flex items-center gap-2">
                        {isEditing ? (
                          <>
                            <button onClick={() => saveEdit(a.username)} className="text-[oklch(0.78_0.2_155)] hover:opacity-80" title="Save">
                              <Save className="w-4 h-4" />
                            </button>
                            <button onClick={() => setEditing(null)} className="text-muted-foreground hover:text-[#2b2416]" title="Cancel">
                              <X className="w-4 h-4" />
                            </button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => beginEdit(a.username)} className="text-[oklch(0.7_0.19_260)] hover:opacity-80" title="Edit">
                              <Pencil className="w-4 h-4" />
                            </button>
                            {!isSelf && (
                              <button onClick={() => void deleteAccount(a.username)} className="text-muted-foreground hover:text-[oklch(0.62_0.24_25)]" title="Delete">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// Step-up re-authentication before creating a new login: the current
// admin must re-enter their OWN password right now (verified fresh
// server-side via addAccount -> login_, not just trusted off the
// already-open session) before the account is actually created.
// Nothing reaches the server until this password field is filled in
// and "Confirm & Create" is pressed.
function ConfirmCreateAccountModal({ newUsername, newRole, onSubmit, onClose }: {
  newUsername: string;
  newRole: "admin" | "cashier";
  onSubmit: (adminPassword: string) => Promise<{ ok: boolean; error?: string }>;
  onClose: () => void;
}) {
  const [adminPassword, setAdminPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!adminPassword) { setErr("Enter your admin password."); return; }
    setErr(null);
    setSubmitting(true);
    try {
      const res = await onSubmit(adminPassword);
      if (!res.ok) { setErr(res.error ?? "Could not create the account."); return; }
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[220] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md" onClick={() => !submitting && onClose()}>
      <div className="w-full max-w-sm glass-strong rounded-2xl border-2 border-black/50" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-black/10">
          <div className="flex items-center gap-2 font-mono uppercase tracking-widest text-xs text-black">
            <ShieldAlert className="w-4 h-4" /> Confirm Your Password
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-[#2b2416]"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-sm text-muted-foreground">
            Re-enter your admin password to create <strong>{newUsername}</strong> ({newRole}).
          </p>
          <div>
            <label className="text-xs uppercase tracking-widest text-muted-foreground">Your Admin Password / كلمة السر</label>
            <input
              autoFocus type="password" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
              className="mt-1 w-full bg-white/70 border border-black/10 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          {err && <div className="text-sm text-[oklch(0.62_0.24_25)]">{err}</div>}
        </div>
        <div className="p-4 border-t border-black/10 flex justify-end gap-2">
          <button onClick={onClose} disabled={submitting} className="px-4 py-2 rounded-lg text-sm bg-black/5 hover:bg-black/8 border border-black/10">Cancel</button>
          <button
            onClick={() => void submit()}
            disabled={submitting || !adminPassword}
            className="px-4 py-2 rounded-lg text-sm bg-gradient-to-r from-black to-black text-white font-semibold disabled:opacity-60"
          >
            {submitting ? "Verifying..." : "Confirm & Create"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
