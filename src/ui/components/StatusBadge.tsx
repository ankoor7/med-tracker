import type { OccurrenceStatus } from '../../core';

const STYLES: Record<OccurrenceStatus, string> = {
  taken: 'bg-status-taken/15 text-status-taken border-status-taken/30',
  due: 'bg-status-due/15 text-status-due border-status-due/30',
  missed: 'bg-status-missed/15 text-status-missed border-status-missed/30',
  upcoming: 'bg-slate-700/40 text-slate-300 border-white/10',
  // Deliberately withheld (Stage 18 FR-18.3) — visually distinct from both
  // "taken" and "missed" so it never reads as a lapse.
  skipped: 'bg-slate-600/20 text-slate-300 border-slate-500/40',
};

const LABELS: Record<OccurrenceStatus, string> = {
  taken: 'Taken',
  due: 'Due',
  missed: 'Missed',
  upcoming: 'Upcoming',
  skipped: 'Skipped',
};

export function StatusBadge({
  status,
  assumed = false,
}: {
  status: OccurrenceStatus;
  // When the dose is "taken" only because the assume-taken-on-time policy filled
  // it in (not a real log entry), render a softer "On time" badge so the user can
  // tell it apart from a dose they explicitly logged — and knows it's editable.
  assumed?: boolean;
}) {
  if (assumed) {
    return (
      <span
        className="rounded-full border border-dashed border-status-taken/40 bg-status-taken/10 px-2 py-0.5 text-xs font-medium text-status-taken/90"
        data-status="taken"
        data-assumed="true"
        title="Assumed taken on time — tap Edit if it was late or missed"
      >
        On time
      </span>
    );
  }
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-xs font-medium ${STYLES[status]}`}
      data-status={status}
    >
      {LABELS[status]}
    </span>
  );
}
