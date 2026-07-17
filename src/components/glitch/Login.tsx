import { useState } from "react";
import { useStore } from "@/lib/glitch-store";
import { Gamepad2, LogIn, User, Lock } from "lucide-react";
import logo from "@/assets/glitch-logo.jpg";

export function Login() {
  const { login } = useStore();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      const ok = await login(username.trim(), password);
      if (!ok) setErr("Invalid username or password.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md glass-strong rounded-2xl p-8 neon-blue">
        <div className="flex flex-col items-center mb-8">
          <img src={logo} alt="GLITCH" className="w-20 h-20 rounded-full object-cover mb-4 ring-2 ring-[oklch(0.82_0.16_85/0.5)] shadow-[0_0_30px_oklch(0.82_0.16_85/0.4)]" />
          <h1 className="text-3xl font-bold tracking-widest text-gradient-gold">GLITCH</h1>
          <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground mt-1">PlayStation & Lounge</p>
          <div className="mt-4 flex items-center gap-2 text-sm text-[oklch(0.85_0.16_200)]">
            <Gamepad2 className="w-4 h-4" />
            <span className="font-mono uppercase tracking-widest">Lounge Manager</span>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="text-xs uppercase tracking-wider text-muted-foreground">Username</label>
            <div className="mt-1 relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                autoFocus
                type="text"
                autoComplete="off"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-black/40 border border-white/10 rounded-lg pl-10 pr-3 py-2.5 outline-none focus:border-[oklch(0.7_0.19_260)] focus:shadow-[0_0_0_3px_oklch(0.7_0.19_260/0.25)] transition"
                placeholder="Username"
              />
            </div>
          </div>
          <div>
            <label className="text-xs uppercase tracking-wider text-muted-foreground">Password</label>
            <div className="mt-1 relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-black/40 border border-white/10 rounded-lg pl-10 pr-3 py-2.5 outline-none focus:border-[oklch(0.7_0.19_260)] focus:shadow-[0_0_0_3px_oklch(0.7_0.19_260/0.25)] transition"
                placeholder="••••••••"
              />
            </div>
          </div>
          {err && <div className="text-sm text-[oklch(0.7_0.22_25)] bg-[oklch(0.62_0.24_25/0.15)] border border-[oklch(0.62_0.24_25/0.4)] rounded-lg p-3">{err}</div>}
          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-lg bg-gradient-to-r from-[oklch(0.7_0.19_260)] to-[oklch(0.65_0.24_305)] text-white font-semibold tracking-wider uppercase text-sm shadow-[0_0_25px_oklch(0.7_0.19_260/0.5)] hover:shadow-[0_0_40px_oklch(0.7_0.19_260/0.7)] transition disabled:opacity-60"
          >
            <LogIn className="w-4 h-4" /> {loading ? "Checking..." : "Access Console"}
          </button>
        </form>
      </div>
    </div>
  );
}
