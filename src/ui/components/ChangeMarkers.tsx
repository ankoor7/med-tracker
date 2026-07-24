import { useEffect, useRef, useState } from 'react';
import {
  formatDateTimeWithZone,
  groupChangesByDay,
  type IanaZone,
  type ISODate,
  type RegimenChange,
  type RegimenChangeGroup,
  type RegimenChangeKind,
  type RegimenFieldChange,
} from '../../core';

// Stage 16 — regimen-change markers. A presentational layer that overlays
// date-placed markers on a timeline chart (adherence / blood-level). Same-day
// changes are grouped into one marker (FR-16.6); activating one opens a detail
// popover listing the field-level diffs (FR-16.5). The layer is purely derived
// from RegimenChange records — it never authors a change.

// Coarse styling + a human label per kind, used by the marker dot and detail.
interface KindMeta {
  label: string;
  className: string;
}

const KIND_META: Record<RegimenChangeKind, KindMeta> = {
  'medication-added': { label: 'Medication added', className: 'bg-accent' },
  'medication-reactivated': { label: 'Medication resumed', className: 'bg-accent' },
  'medication-updated': { label: 'Prescription changed', className: 'bg-amber-500' },
  'medication-retired': { label: 'Medication retired', className: 'bg-slate-500' },
  'slot-added': { label: 'Slot added', className: 'bg-accent' },
  'slot-updated': { label: 'Schedule changed', className: 'bg-amber-500' },
  'slot-removed': { label: 'Slot removed', className: 'bg-slate-500' },
};

/**
 * Records can arrive from a newer build (sync) carrying a kind this one does not
 * know. Fall back rather than dereferencing undefined — an unlabelled marker is
 * recoverable, a blank History screen is not.
 */
function metaFor(kind: RegimenChangeKind): KindMeta {
  return KIND_META[kind] ?? { label: 'Regimen changed', className: 'bg-amber-500' };
}

/**
 * The field-level `from → to` diff rows for one change, in display-ready form
 * (null renders as an em dash). Shared by the marker popover and the History
 * screen's Changes list so both read the diff identically.
 */
export function FieldDiffList({ changes }: { changes: RegimenFieldChange[] }) {
  return (
    <ul className="mt-1 flex flex-col gap-0.5">
      {changes.map((field, i) => (
        <li key={i} className="text-xs text-slate-400">
          <span className="text-slate-300">{field.field}:</span> {field.from ?? '—'} →{' '}
          {field.to ?? '—'}
        </li>
      ))}
    </ul>
  );
}

/** The marker's accent follows the first change's kind when a day is mixed. */
function groupKind(group: RegimenChangeGroup): RegimenChangeKind {
  return group.changes[0]!.kind;
}

function groupLabel(group: RegimenChangeGroup): string {
  if (group.changes.length === 1) return group.changes[0]!.summary;
  return `${group.changes.length} regimen changes on ${group.date}`;
}

export interface ChangeMarkersProps {
  changes: RegimenChange[];
  zone: IanaZone;
  /**
   * Maps a change's local date to a horizontal position over the chart as a
   * percentage (0–100), or null when the date falls outside the plotted range.
   * The chart owns its x-axis, so it supplies this.
   */
  xForDate: (date: ISODate) => number | null;
}

/**
 * Absolutely-positioned overlay of grouped change markers. Render inside a
 * `relative` wrapper around the chart; the layer ignores pointer events except
 * on the markers themselves so the chart underneath stays interactive.
 */
export function ChangeMarkers({ changes, zone, xForDate }: ChangeMarkersProps) {
  const [openDate, setOpenDate] = useState<ISODate | null>(null);
  const groups = groupChangesByDay(changes, zone);
  const positioned = groups
    .map((group) => ({ group, left: xForDate(group.date) }))
    .filter((p): p is { group: RegimenChangeGroup; left: number } => p.left != null);

  if (positioned.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0">
      {positioned.map(({ group, left }) => {
        const meta = metaFor(groupKind(group));
        const open = openDate === group.date;
        return (
          <div
            key={group.date}
            className="pointer-events-none absolute top-0 -translate-x-1/2"
            style={{ left: `${left}%` }}
          >
            <button
              type="button"
              className="pointer-events-auto relative flex h-4 w-4 items-center justify-center rounded-full border border-slate-900 ring-1 ring-slate-700 focus:outline-none focus:ring-2 focus:ring-accent"
              aria-label={groupLabel(group)}
              aria-expanded={open}
              onClick={() => setOpenDate(open ? null : group.date)}
            >
              <span className={`h-2.5 w-2.5 rounded-full ${meta.className}`} />
              {group.changes.length > 1 && (
                <span className="absolute -right-1.5 -top-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-slate-200 px-0.5 text-[8px] font-semibold text-slate-900">
                  {group.changes.length}
                </span>
              )}
            </button>
            {open && <ChangeDetail group={group} onClose={() => setOpenDate(null)} />}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Popover listing every change in a same-day group: its kind, summary, the
 * `from → to` field diffs, and an optional note, with the local date/time.
 */
export function ChangeDetail({
  group,
  onClose,
}: {
  group: RegimenChangeGroup;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKey);
    // Defer so the opening click does not immediately close it.
    const t = setTimeout(() => document.addEventListener('mousedown', onClick), 0);
    return () => {
      document.removeEventListener('keydown', onKey);
      clearTimeout(t);
      document.removeEventListener('mousedown', onClick);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={`Regimen changes on ${group.date}`}
      className="pointer-events-auto absolute left-1/2 top-6 z-10 w-64 max-w-[80vw] -translate-x-1/2 rounded-md border border-slate-700 bg-slate-900 p-3 text-left shadow-lg"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-slate-300">{group.date}</span>
        <button
          type="button"
          className="text-xs text-slate-500 hover:text-slate-300 focus:outline-none focus:text-slate-200"
          aria-label="Close"
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      <ul className="flex flex-col gap-2">
        {group.changes.map((c) => (
          <li key={c.id} className="border-t border-slate-800 pt-2 first:border-t-0 first:pt-0">
            <div className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${metaFor(c.kind).className}`} />
              <span className="text-[11px] uppercase tracking-wide text-slate-500">
                {metaFor(c.kind).label}
              </span>
            </div>
            <p className="mt-0.5 text-sm font-medium text-slate-100">{c.summary}</p>
            <FieldDiffList changes={c.changes} />
            {c.note && <p className="mt-1 text-xs italic text-slate-400">“{c.note}”</p>}
            <p className="mt-1 text-[10px] text-slate-600">
              {formatDateTimeWithZone(c.changedAt, c.zone)}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
