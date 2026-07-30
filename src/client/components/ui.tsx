// The shared vocabulary. Chips are facts; badges are signals — the two are
// deliberately different shapes so a glance tells you which you're reading.

import type { ReactNode } from "react";

export function Eyebrow({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="eyebrow">{children}</span>
      {right ? <span className="data text-[0.6875rem] text-faint">{right}</span> : null}
    </div>
  );
}

/** A card is anatomy, not a padded box: stacked zones split by hairlines. */
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-lg border border-border bg-surface ${className}`}>{children}</div>;
}

export function Zone({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`border-b border-border p-4 last:border-b-0 ${className}`}>{children}</div>;
}

/** Enumerable fact — file type, column type, page number. Quiet by design. */
export function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-sm border border-border bg-sunken px-1.5 py-0.5 text-[0.6875rem] text-muted">
      {children}
    </span>
  );
}

type Tone = "success" | "warning" | "danger" | "neutral";

const TONES: Record<Tone, string> = {
  success: "bg-success-tint text-success border-success/25",
  warning: "bg-warning-tint text-warning border-warning/25",
  danger: "bg-danger-tint text-danger border-danger/25",
  neutral: "bg-sunken text-muted border-border",
};

/** Status that wants attention. Pill-shaped, normal weight — quiet, not bold. */
export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-normal ${TONES[tone]}`}>
      {children}
    </span>
  );
}

export function Button({
  children,
  onClick,
  variant = "secondary",
  disabled,
  type = "button",
  title,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  disabled?: boolean;
  type?: "button" | "submit";
  title?: string;
  className?: string;
}) {
  const base =
    "inline-flex items-center justify-center gap-1.5 rounded-sm px-2 h-8 text-sm font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none";
  const variants = {
    // Darkens on hover, never lightens. Exactly one of these per screen.
    primary: "bg-primary text-on-primary hover:bg-primary-hover",
    secondary: "border border-border bg-surface text-foreground hover:bg-sunken",
    ghost: "text-muted hover:bg-sunken hover:text-foreground",
    danger: "border border-border bg-surface text-danger hover:bg-danger-tint",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`${base} ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`h-9 w-full rounded-sm border border-border bg-surface px-2.5 text-[0.8125rem] text-foreground placeholder:text-faint focus:border-ring focus:outline-none ${props.className ?? ""}`}
    />
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full rounded-sm border border-border bg-surface px-2.5 py-2 text-[0.8125rem] text-foreground placeholder:text-faint focus:border-ring focus:outline-none ${props.className ?? ""}`}
    />
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold tracking-[0.04em] text-muted">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[0.6875rem] text-faint">{hint}</span> : null}
    </label>
  );
}

/**
 * Borderless by design: an empty bordered box reads as a component that failed
 * to load. The border earns its place once there is something to contain.
 */
export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="px-4 py-12 text-center">
      <p className="text-sm text-muted">{title}</p>
      {hint ? <p className="mt-1 text-xs text-faint">{hint}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function Toolbar({ title, subtitle, children }: { title: ReactNode; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-border bg-background px-6 py-3">
      <div className="min-w-0">
        <h1 className="truncate text-xl font-bold tracking-[-0.01em]">{title}</h1>
        {subtitle ? <p className="truncate text-xs text-muted">{subtitle}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

/**
 * Modal. Uses the native <dialog> element so Esc, focus trapping and the
 * top layer come from the platform rather than from a hand-rolled overlay —
 * and so it works in agent mode, where hover-only affordances do not.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md rounded-xl border border-border bg-surface shadow-[0_8px_24px_rgba(0,0,0,0.16)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
        </div>
        {children}
      </div>
    </div>
  );
}
