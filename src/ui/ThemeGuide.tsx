import { useEffect, useState } from 'react';
import type { OccurrenceStatus } from '../core';
import { Button, Card, Field, inputClass, ColorDot, Ring, Stat } from './components/ui';
import { StatusBadge } from './components/StatusBadge';
import { Modal } from './components/Modal';
import { ConfirmDialog } from './components/ConfirmDialog';

/**
 * Stage 19 Unit 3 (FR-19.8, AC19.5) — a developer-facing theme guide: renders
 * every shared primitive from `components/ui.tsx`, `StatusBadge.tsx`,
 * `Modal.tsx` and `ConfirmDialog.tsx`, plus the token layer's swatches, with
 * an in-page light/dark toggle. NOT part of the patient app flow — see
 * `main.tsx` for the dev-only, query-param-gated entry point that reaches
 * this component. Presentation only; no core/store/sync imports.
 */

const STATUSES: OccurrenceStatus[] = ['upcoming', 'due', 'taken', 'missed', 'skipped'];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">{title}</h2>
      {children}
    </section>
  );
}

function Swatch({
  label,
  sub,
  style,
}: {
  label: string;
  sub?: string;
  style: React.CSSProperties;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="h-14 w-full rounded-xl border border-white/10" style={style} />
      <span className="text-xs font-medium text-slate-200">{label}</span>
      {sub && <span className="text-[11px] text-slate-500">{sub}</span>}
    </div>
  );
}

const COLOR_SWATCHES: Array<{ label: string; varName: string }> = [
  { label: 'slate-50', varName: '--sd-slate-50-rgb' },
  { label: 'slate-100', varName: '--sd-slate-100-rgb' },
  { label: 'slate-200', varName: '--sd-slate-200-rgb' },
  { label: 'slate-300', varName: '--sd-slate-300-rgb' },
  { label: 'slate-400', varName: '--sd-slate-400-rgb' },
  { label: 'slate-500', varName: '--sd-slate-500-rgb' },
  { label: 'slate-600', varName: '--sd-slate-600-rgb' },
  { label: 'slate-700', varName: '--sd-slate-700-rgb' },
  { label: 'slate-800', varName: '--sd-slate-800-rgb' },
  { label: 'slate-900', varName: '--sd-slate-900-rgb' },
  { label: 'slate-950', varName: '--sd-slate-950-rgb' },
  { label: 'accent', varName: '--sd-accent-rgb' },
  { label: 'accent-fg', varName: '--sd-accent-fg-rgb' },
  { label: 'accent-muted', varName: '--sd-accent-muted-rgb' },
  { label: 'status-taken', varName: '--sd-status-taken-rgb' },
  { label: 'status-due', varName: '--sd-status-due-rgb' },
  { label: 'status-missed', varName: '--sd-status-missed-rgb' },
  { label: 'status-upcoming', varName: '--sd-status-upcoming-rgb' },
];

const RADIUS_SWATCHES: Array<{ label: string; varName: string }> = [
  { label: 'radius-sm', varName: '--sd-radius-sm' },
  { label: 'radius-md', varName: '--sd-radius-md' },
  { label: 'radius-lg', varName: '--sd-radius-lg' },
  { label: 'radius-xl', varName: '--sd-radius-xl' },
  { label: 'radius-full', varName: '--sd-radius-full' },
];

const TYPE_SWATCHES: Array<{ label: string; className: string }> = [
  { label: 'text-3xl (Stat value)', className: 'text-3xl font-semibold tabular-nums' },
  { label: 'text-xl (app title)', className: 'text-xl font-semibold tracking-tight' },
  { label: 'text-sm (body)', className: 'text-sm' },
  {
    label: 'text-xs uppercase tracking-wide (label)',
    className: 'text-xs uppercase tracking-wide',
  },
];

export function ThemeGuide() {
  const [theme, setTheme] = useState<'light' | 'dark'>(
    () => (document.documentElement.dataset.theme as 'light' | 'dark' | undefined) ?? 'dark',
  );
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Sync `<html data-theme>` to React state on every change, INCLUDING first
  // mount. Without this, the initial `theme` state (which defaults to
  // 'dark' when the root has no theme yet) is a label with nothing behind
  // it: the page keeps rendering whatever the root already had — falling
  // through to `prefers-color-scheme` — while claiming "Current theme:
  // dark". That's a mislabelled first paint, exactly what this guide exists
  // to catch.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  function toggleTheme() {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }

  return (
    <div className="mx-auto flex min-h-full max-w-3xl flex-col gap-8 px-5 py-6 text-slate-100">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">SteadyDose theme guide</h1>
          <p className="text-sm text-slate-400">
            Dev-only reference (Stage 19 FR-19.8) — every shared primitive and design token, in both
            themes. Not part of the patient app.
          </p>
        </div>
        <Button
          variant="secondary"
          onClick={toggleTheme}
          data-testid="theme-guide-toggle"
          aria-label="Toggle light/dark theme"
        >
          {theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
        </Button>
      </header>

      <p className="text-xs text-slate-500" data-testid="theme-guide-current-theme">
        Current theme: <strong className="text-slate-300">{theme}</strong>
      </p>

      <Section title="Colour tokens">
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          {COLOR_SWATCHES.map((s) => (
            <Swatch
              key={s.label}
              label={s.label}
              style={{ backgroundColor: `rgb(var(${s.varName}))` }}
            />
          ))}
        </div>
      </Section>

      <Section title="Radius tokens">
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
          {RADIUS_SWATCHES.map((s) => (
            <Swatch
              key={s.label}
              label={s.label}
              style={{
                backgroundColor: 'rgb(var(--sd-accent-rgb))',
                borderRadius: `var(${s.varName})`,
              }}
            />
          ))}
        </div>
      </Section>

      <Section title="Elevation token">
        <div
          className="h-16 w-48 rounded-2xl bg-slate-900"
          style={{ boxShadow: 'var(--sd-shadow-soft)' }}
        />
        <span className="text-xs text-slate-500">--sd-shadow-soft</span>
      </Section>

      <Section title="Typography">
        <div className="flex flex-col gap-2">
          {TYPE_SWATCHES.map((t) => (
            <div key={t.label} className="flex items-baseline gap-3">
              <span className={t.className}>Adjusted dose, on schedule</span>
              <span className="text-[11px] text-slate-500">{t.label}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Button">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="primary" disabled>
            Primary disabled
          </Button>
          <Button variant="primary" autoFocus data-testid="theme-guide-focus-button">
            Focus me (tab-focus ring)
          </Button>
        </div>
      </Section>

      <Section title="Card">
        <Card>
          <p className="text-sm text-slate-300">
            A `Card` — the soft-surface container used across every screen.
          </p>
        </Card>
      </Section>

      <Section title="Field">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Name">
            <input className={inputClass} placeholder="Medication name" aria-label="Name" />
          </Field>
          <Field
            label="Half-life (hours)"
            hint="Time for half the dose to clear your system — used to judge lateness."
          >
            <input className={inputClass} type="number" aria-label="Half-life hours" />
          </Field>
          <div className="flex flex-col gap-1.5 text-sm">
            <Field label="Name">
              <input
                className={inputClass}
                aria-label="Name"
                aria-invalid
                data-testid="theme-guide-field-error-input"
              />
            </Field>
            {/* Error pattern as used in MedicationEditor.tsx (FR-18.8): a
                separate message under the Field, not a Field prop. */}
            <p className="-mt-2 text-xs text-red-300">Name is required.</p>
          </div>
        </div>
      </Section>

      <Section title="inputClass">
        <input
          className={inputClass}
          placeholder="Plain inputClass input"
          aria-label="Example input"
        />
      </Section>

      <Section title="ColorDot">
        <div className="flex items-center gap-3" data-testid="theme-guide-colordots">
          <ColorDot color="#2954d8" />
          <ColorDot color="#047857" />
          <ColorDot color="#be123c" />
        </div>
      </Section>

      <Section title="Ring">
        <div className="flex flex-wrap gap-6">
          <Ring value={0.72} aria-label="72% adherence">
            <Stat value="72%" label="Adherence" />
          </Ring>
          <Ring value={0} color="#8891a0" aria-label="0% adherence" />
        </div>
      </Section>

      <Section title="Stat">
        <div className="flex gap-8">
          <Stat value="12" label="Doses this week" />
          <Stat value="3" label="Missed doses" />
        </div>
      </Section>

      <Section title="StatusBadge">
        <div className="flex flex-wrap items-center gap-2">
          {STATUSES.map((status) => (
            <StatusBadge key={status} status={status} />
          ))}
          {/* "On time" / assumed — a softer variant of "taken" (Stage 18
              assume-taken-on-time policy), not a distinct OccurrenceStatus. */}
          <StatusBadge key="assumed" status="taken" assumed />
        </div>
      </Section>

      <Section title="Modal">
        <Button onClick={() => setModalOpen(true)} data-testid="theme-guide-open-modal">
          Open modal
        </Button>
        {modalOpen && (
          <Modal title="Example modal" onClose={() => setModalOpen(false)}>
            <p className="text-sm text-slate-300">
              Modal body content. Built on React Aria&apos;s `ModalOverlay` + `Dialog`.
            </p>
          </Modal>
        )}
      </Section>

      <Section title="ConfirmDialog">
        <Button
          variant="danger"
          onClick={() => setConfirmOpen(true)}
          data-testid="theme-guide-open-confirm"
        >
          Open confirm dialog
        </Button>
        {confirmOpen && (
          <ConfirmDialog
            title="Delete this medication?"
            body="This is the destructive-action confirmation pattern (Stage 18 FR-18.5), rendered as role=alertdialog."
            onConfirm={() => setConfirmOpen(false)}
            onCancel={() => setConfirmOpen(false)}
          />
        )}
      </Section>
    </div>
  );
}
