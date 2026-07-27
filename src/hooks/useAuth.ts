"use client";

import { useCallback, useEffect, useState } from "react";
import type { AuthUser } from "@/lib/types";

export type AuthState = {
  user: AuthUser | null;
  /** True until the first /api/auth/me answers, so the UI can avoid flashing. */
  loading: boolean;
  signIn: (username: string, password: string) => Promise<string | null>;
  register: (username: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
};

/**
 * The session, as the browser sees it.
 *
 * The two submit functions resolve to an error string or null rather than
 * throwing: every caller is a form that needs to render the message, and
 * try/catch around an await in a submit handler is noise.
 */
export function useAuth(): AuthState {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : { user: null }))
      .then((payload: { user: AuthUser | null }) => {
        if (!cancelled) setUser(payload.user);
      })
      .catch(() => {
        /* offline: treated as a guest, which the map still serves */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const post = useCallback(
    async (path: string, username: string, password: string): Promise<string | null> => {
      try {
        const res = await fetch(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password }),
        });
        const payload = await res.json().catch(() => null);
        if (!res.ok) return payload?.error ?? `That didn't work (${res.status}).`;
        setUser(payload.user as AuthUser);
        return null;
      } catch {
        return "The request never reached the server. Check your connection.";
      }
    },
    [],
  );

  const signIn = useCallback(
    (u: string, p: string) => post("/api/auth/login", u, p),
    [post],
  );
  const register = useCallback(
    (u: string, p: string) => post("/api/auth/register", u, p),
    [post],
  );

  const signOut = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* the cookie is httpOnly, so the server is the only place that can clear
         it — but a failed logout must still not leave the UI stuck signed in */
    }
    setUser(null);
  }, []);

  return { user, loading, signIn, register, signOut };
}
