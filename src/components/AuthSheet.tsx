"use client";

import { useEffect, useState } from "react";
import { KeyRound, TriangleAlert, UserPlus } from "lucide-react";
import { Button, Notice, Sheet } from "@/components/ui/primitives";

export type AuthSheetProps = {
  open: boolean;
  onClose: () => void;
  /** Which tab opens first. Both are always reachable from inside. */
  initialMode?: "signin" | "register";
  onSignIn: (username: string, password: string) => Promise<string | null>;
  onRegister: (username: string, password: string) => Promise<string | null>;
  /** Shown above the form when a specific action triggered the prompt. */
  reason?: string;
};

const MIN_PASSWORD = 12;

export function AuthSheet({
  open,
  onClose,
  initialMode = "signin",
  onSignIn,
  onRegister,
  reason,
}: AuthSheetProps) {
  const [mode, setMode] = useState<"signin" | "register">(initialMode);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // This component stays mounted while `open` is false, so useState(initialMode)
  // captures only whichever mode was requested first — every later open would
  // ignore the prop and show the wrong tab. Re-sync each time it opens, and
  // clear anything left over from the previous attempt.
  useEffect(() => {
    if (!open) return;
    setMode(initialMode);
    setError(null);
    setPassword("");
  }, [open, initialMode]);

  const registering = mode === "register";
  // Only enforced client-side for registration: an existing account may predate
  // any rule, and telling someone their correct password is "too short" at the
  // sign-in form is both wrong and confusing.
  const tooShort = registering && password.length > 0 && password.length < MIN_PASSWORD;
  const canSubmit = username.trim().length >= 3 && password.length > 0 && !tooShort && !busy;

  function switchMode(next: "signin" | "register") {
    setMode(next);
    setError(null);
  }

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    const message = registering
      ? await onRegister(username.trim(), password)
      : await onSignIn(username.trim(), password);
    setBusy(false);

    if (message) {
      setError(message);
      return;
    }
    // Never leave a password sitting in component state after it has been used.
    setPassword("");
    setUsername("");
    onClose();
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      eyebrow={registering ? "New account" : "Welcome back"}
      title={registering ? "Create an account" : "Sign in"}
    >
      <div className="space-y-5">
        {reason ? (
          <Notice tone="info" title={reason}>
            Browsing the map never needs an account — only adding and removing
            cameras does.
          </Notice>
        ) : null}

        <div className="flex gap-1 rounded-lg border border-rule p-1">
          <button
            type="button"
            onClick={() => switchMode("signin")}
            className={`h-9 flex-1 rounded-md text-sm font-medium transition-colors ${
              !registering ? "bg-raised text-ink" : "text-graphite hover:text-ink"
            }`}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => switchMode("register")}
            className={`h-9 flex-1 rounded-md text-sm font-medium transition-colors ${
              registering ? "bg-raised text-ink" : "text-graphite hover:text-ink"
            }`}
          >
            Register
          </button>
        </div>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="space-y-1.5">
            <label htmlFor="auth-username" className="eyebrow block">
              Username
            </label>
            <input
              id="auth-username"
              name="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={32}
              className="h-11 w-full rounded-lg border border-rule bg-raised px-3 text-sm text-ink outline-none focus:border-sodium"
            />
            {registering ? (
              <p className="text-[0.75rem] text-graphite">
                3–32 characters: letters, numbers, and . _ - only.
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="auth-password" className="eyebrow block">
              Password
            </label>
            <input
              id="auth-password"
              name="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={registering ? "new-password" : "current-password"}
              className="h-11 w-full rounded-lg border border-rule bg-raised px-3 text-sm text-ink outline-none focus:border-sodium"
            />
            {registering ? (
              <p className={`text-[0.75rem] ${tooShort ? "text-fix-warn" : "text-graphite"}`}>
                At least {MIN_PASSWORD} characters. Length matters more than
                symbols — a few unrelated words beats P@ssw0rd.
              </p>
            ) : null}
          </div>

          {error ? (
            <Notice tone="bad" icon={<TriangleAlert className="size-4" />} title={error} />
          ) : null}

          <Button type="submit" size="lg" disabled={!canSubmit} loading={busy} className="w-full">
            {registering ? <UserPlus className="size-4" /> : <KeyRound className="size-4" />}
            {busy
              ? registering
                ? "Creating…"
                : "Signing in…"
              : registering
                ? "Create account"
                : "Sign in"}
          </Button>
        </form>
      </div>
    </Sheet>
  );
}
