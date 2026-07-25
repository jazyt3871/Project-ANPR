"use client";

import { type ReactNode, useEffect } from "react";
import { X } from "lucide-react";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/* -------------------------------------------------------------------------- */

type ButtonProps = {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "quiet";
  size?: "md" | "lg";
  disabled?: boolean;
  loading?: boolean;
  className?: string;
  type?: "button" | "submit";
};

export function Button({
  children,
  onClick,
  variant = "primary",
  size = "md",
  disabled,
  loading,
  className,
  type = "button",
}: ButtonProps) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40";
  const sizes = { md: "h-10 px-4 text-sm", lg: "h-12 px-5 text-[0.9375rem]" };
  const variants = {
    primary: "bg-sodium text-sodium-ink hover:brightness-110 active:brightness-95",
    ghost: "border border-rule text-ink hover:bg-raised",
    quiet: "text-graphite hover:text-ink",
  };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(base, sizes[size], variants[variant], className)}
    >
      {children}
    </button>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Bottom sheet under 768px, right-hand rail above it. Same component either
 * way — the capture flow shouldn't need to know which one it's living in.
 */
export function Sheet({
  open,
  onClose,
  title,
  eyebrow,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  eyebrow?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[1000] flex flex-col justify-end md:flex-row md:justify-end">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="sheet-rise relative flex max-h-[92dvh] w-full flex-col border-t border-rule bg-panel md:h-full md:max-h-none md:w-[26rem] md:border-l md:border-t-0"
        style={{ boxShadow: "var(--shadow-lift)" }}
      >
        <header className="flex items-start justify-between gap-3 border-b border-rule px-5 pt-5 pb-4">
          <div className="min-w-0">
            {eyebrow ? <p className="eyebrow mb-1.5">{eyebrow}</p> : null}
            <h2 className="text-[1.0625rem] leading-snug font-medium tracking-tight text-ink">
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1.5 -mt-1 grid size-9 shrink-0 place-items-center rounded-lg text-graphite hover:bg-raised hover:text-ink"
          >
            <X className="size-[18px]" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>

        {footer ? (
          <footer
            className="border-t border-rule px-5 pt-4"
            style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
          >
            {footer}
          </footer>
        ) : null}
      </aside>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/** A labelled measured value. Every number in the app is set in mono. */
export function FieldRow({
  label,
  value,
  tone = "ink",
}: {
  label: string;
  value: ReactNode;
  tone?: "ink" | "good" | "warn" | "bad" | "muted";
}) {
  const tones = {
    ink: "text-ink",
    good: "text-fix-good",
    warn: "text-fix-warn",
    bad: "text-fix-bad",
    muted: "text-graphite",
  };
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-rule/70 py-2.5 last:border-b-0">
      <span className="eyebrow shrink-0">{label}</span>
      <span className={cx("readout text-right text-sm", tones[tone])}>{value}</span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Errors state what happened and what to do about it. No apologies, no mood.
 */
export function Notice({
  tone = "warn",
  icon,
  title,
  children,
  action,
}: {
  tone?: "warn" | "bad" | "info";
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const tones = {
    warn: "border-fix-warn/35 bg-fix-warn/[0.07] text-fix-warn",
    bad: "border-fix-bad/35 bg-fix-bad/[0.07] text-fix-bad",
    info: "border-rule bg-raised text-graphite",
  };

  return (
    <div className={cx("rounded-xl border p-3.5", tones[tone])} role="status">
      <div className="flex gap-2.5">
        {icon ? <span className="mt-px shrink-0">{icon}</span> : null}
        <div className="min-w-0 space-y-1">
          <p className="text-[0.8125rem] leading-snug font-medium">{title}</p>
          {children ? (
            <p className="text-[0.8125rem] leading-relaxed text-graphite">{children}</p>
          ) : null}
          {action ? <div className="pt-1.5">{action}</div> : null}
        </div>
      </div>
    </div>
  );
}
