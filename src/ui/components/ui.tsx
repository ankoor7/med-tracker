import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

// Stage 19 minimalistic theme: pill buttons, soft surfaces, calm accents.
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg hover:brightness-110 disabled:opacity-50',
  secondary: 'bg-slate-800/80 text-slate-100 hover:bg-slate-700 disabled:opacity-50',
  ghost: 'text-slate-300 hover:bg-slate-800/70',
  danger: 'bg-status-missed/90 text-slate-950 hover:bg-status-missed disabled:opacity-50',
};

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      className={`rounded-full px-4 py-2 text-sm font-semibold transition-[background-color,filter,opacity] disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl border border-white/5 bg-slate-900/70 p-5 shadow-soft backdrop-blur-sm ${className}`}
    >
      {children}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  /** Short, plain-language explanation rendered under the field (Stage 18 FR-18.10). */
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</span>
      {children}
      {hint && <span className="text-xs font-normal normal-case text-slate-500">{hint}</span>}
    </label>
  );
}

export const inputClass =
  'rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus-visible:border-accent-muted';

/**
 * Stage 18 FR-18.10 (AC10): a medication reference that cannot be resolved
 * (truly orphaned — not the common "deactivated" or "deleted" case, which
 * resolve to the real name) MUST render this, never the raw id string.
 */
export const UNKNOWN_MED_NAME = 'Unknown medication';

export function ColorDot({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="inline-block h-3 w-3 shrink-0 rounded-full"
      style={{ backgroundColor: color }}
    />
  );
}

/**
 * Circular progress ring — a calm, glanceable readout. Pure SVG; `value` is
 * 0..1. Renders a faint track plus a colored arc, with optional centered
 * content (a big number + label).
 */
export function Ring({
  value,
  size = 168,
  stroke = 14,
  color = '#2cb1a6',
  children,
  'aria-label': ariaLabel,
}: {
  value: number;
  size?: number;
  stroke?: number;
  color?: string;
  children?: ReactNode;
  'aria-label'?: string;
}) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const dash = circumference * clamped;

  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
      role="img"
      aria-label={ariaLabel}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          className="text-slate-800/70"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          style={{ transition: 'stroke-dasharray 600ms cubic-bezier(0.4, 0, 0.2, 1)' }}
        />
      </svg>
      {children && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          {children}
        </div>
      )}
    </div>
  );
}

/** Big calm numeric readout with a small label underneath. */
export function Stat({
  value,
  label,
  className = '',
}: {
  value: ReactNode;
  label: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col ${className}`}>
      <span className="text-3xl font-semibold tabular-nums text-slate-50">{value}</span>
      <span className="text-xs uppercase tracking-wide text-slate-400">{label}</span>
    </div>
  );
}
