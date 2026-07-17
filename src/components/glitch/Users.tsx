import { useState } from "react";
import { useStore } from "@/lib/glitch-store";
import { Plus, Trash2, Shield, User, Save, Pencil, X, KeyRound } from "lucide-react";

export function UsersPage() {
  const { state, addAccount, deleteAccount, updateAccount } = useStore();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "cashier">("cashier");
  const [err, setErr] = useState("");

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

  const submit = async () => {
    setErr("");
    if (!username || !password) { setErr("Fill both fields"); return; }
    const ok = await addAccount({ username, password, role });
    if (!ok) { setErr("Username already exists"); return; }
    setUsername(""); setPassword(""); setRole("cashier");
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
        <div className="glass rounded-2xl p-6 border border-[oklch(0.82_0.16_85/0.3)]">
          <h2 className="text-lg font-semibold mb-1 flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-[oklch(0.82_0.16_85)]" /> My Admin Credentials
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
                className="mt-1 w-full bg-black/40 rounded-lg px-3 py-2.5 text-sm border border-white/10 font-mono"
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
                className="mt-1 w-full bg-black/40 rounded-lg px-3 py-2.5 text-sm border border-white/10 font-mono"
              />
            </div>
            <div className="flex items-end">
              <button
                onClick={saveSelf}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-gradient-to-r from-[oklch(0.82_0.16_85)] to-[oklch(0.9_0.13_95)] text-black font-bold uppercase tracking-wider text-xs shadow-[0_0_20px_oklch(0.82_0.16_85/0.4)]"
              >
                <Save className="w-4 h-4" /> Save
              </button>
            </div>
          </div>
          {selfMsg && (
            <div className={`mt-3 text-xs font-mono ${selfMsg.kind === "ok" ? "text-[oklch(0.78_0.2_155)]" : "text-[oklch(0.75_0.22_25)]"}`}>
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
            className="bg-black/40 rounded-lg px-3 py-2.5 text-sm border border-white/10"
          />
          <input
            type="password"
            autoComplete="new-password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="bg-black/40 rounded-lg px-3 py-2.5 text-sm border border-white/10"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as "admin" | "cashier")}
            className="bg-black/40 rounded-lg px-3 py-2.5 text-sm border border-white/10"
          >
            <option value="cashier">Cashier</option>
            <option value="admin">Admin</option>
          </select>
          <button
            onClick={submit}
            className="rounded-lg bg-gradient-to-r from-[oklch(0.7_0.19_260)] to-[oklch(0.65_0.24_305)] text-white font-semibold text-sm shadow-[0_0_20px_oklch(0.7_0.19_260/0.4)]"
          >
            Create
          </button>
        </div>
        {err && <div className="mt-3 text-sm text-[oklch(0.75_0.22_25)]">{err}</div>}
      </div>

      <div className="glass rounded-2xl p-6">
        <h2 className="text-lg font-semibold mb-4">Employee Roster</h2>
        {rowMsg && <div className="mb-3 text-xs text-[oklch(0.75_0.22_25)] font-mono">⚠ {rowMsg}</div>}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-widest text-muted-foreground border-b border-white/5">
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
                  <tr key={a.username} className="border-b border-white/5">
                    <td className="py-3 px-2 font-semibold">
                      {isEditing ? (
                        <input
                          value={editUsername}
                          onChange={(e) => setEditUsername(e.target.value)}
                          className="bg-black/40 rounded px-2 py-1 text-sm border border-white/10 w-full font-mono"
                        />
                      ) : a.username}
                    </td>
                    <td className="py-3 px-2">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] uppercase tracking-widest font-bold border ${
                        a.role === "admin"
                          ? "bg-[oklch(0.82_0.16_85/0.15)] text-[oklch(0.82_0.16_85)] border-[oklch(0.82_0.16_85/0.5)]"
                          : "bg-[oklch(0.85_0.16_200/0.15)] text-[oklch(0.85_0.16_200)] border-[oklch(0.85_0.16_200/0.4)]"
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
                          className="bg-black/40 rounded px-2 py-1 text-sm border border-white/10 w-full font-mono"
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
                            <button onClick={() => setEditing(null)} className="text-muted-foreground hover:text-white" title="Cancel">
                              <X className="w-4 h-4" />
                            </button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => beginEdit(a.username)} className="text-[oklch(0.85_0.16_200)] hover:opacity-80" title="Edit">
                              <Pencil className="w-4 h-4" />
                            </button>
                            {!isSelf && (
                              <button onClick={() => void deleteAccount(a.username)} className="text-muted-foreground hover:text-[oklch(0.75_0.22_25)]" title="Delete">
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
