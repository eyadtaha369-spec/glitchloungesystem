import { useState } from "react";
import { useStore } from "@/lib/glitch-store";
import { Plus, Trash2, Shield, User } from "lucide-react";

export function UsersPage() {
  const { state, addAccount, deleteAccount } = useStore();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "cashier">("cashier");
  const [err, setErr] = useState("");

  const submit = () => {
    setErr("");
    if (!username || !password) { setErr("Fill both fields"); return; }
    const ok = addAccount({ username, password, role });
    if (!ok) { setErr("Username already exists"); return; }
    setUsername(""); setPassword(""); setRole("cashier");
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">User Management</h1>
        <p className="text-sm text-muted-foreground mt-1 font-mono uppercase tracking-widest">Provision employee accounts</p>
      </div>

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
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-widest text-muted-foreground border-b border-white/5">
                <th className="text-left py-2 px-2">Username</th>
                <th className="text-left py-2 px-2">Role</th>
                <th className="text-left py-2 px-2">Password</th>
                <th className="py-2 px-2"></th>
              </tr>
            </thead>
            <tbody>
              {state.accounts.map((a) => (
                <tr key={a.username} className="border-b border-white/5">
                  <td className="py-3 px-2 font-semibold">{a.username}</td>
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
                  <td className="py-3 px-2 font-mono text-xs text-muted-foreground">{a.password}</td>
                  <td className="py-3 px-2 text-right">
                    {a.username !== state.currentUser?.username && (
                      <button onClick={() => deleteAccount(a.username)} className="text-muted-foreground hover:text-[oklch(0.75_0.22_25)]">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
