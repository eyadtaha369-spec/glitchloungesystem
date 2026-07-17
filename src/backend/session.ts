import { getSession, updateSession, clearSession, type SessionConfig } from "@tanstack/react-start/server";
import type { SessionUser } from "@/lib/types";

function sessionConfig(): SessionConfig {
  const password = process.env.SESSION_SECRET;
  if (!password || password.length < 32) {
    throw new Error(
      "SESSION_SECRET env var is missing or too short. Set it in Vercel to a random string of at least 32 characters.",
    );
  }
  return {
    password,
    name: "glitch_session",
    maxAge: 60 * 60 * 12, // 12 hours
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    },
  };
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const session = await getSession<SessionUser>(sessionConfig());
  if (session.data.username && session.data.role) {
    return { username: session.data.username, role: session.data.role };
  }
  return null;
}

export async function setCurrentUser(user: SessionUser): Promise<void> {
  await updateSession<SessionUser>(sessionConfig(), user);
}

export async function clearCurrentUser(): Promise<void> {
  await clearSession(sessionConfig());
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new Error("UNAUTHORIZED");
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "admin") throw new Error("FORBIDDEN");
  return user;
}
