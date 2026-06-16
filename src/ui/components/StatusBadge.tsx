import type { OccurrenceStatus } from '../../core';

const STYLES: Record<OccurrenceStatus, string> = {
  taken: 'bg-green-950 text-status-taken border-green-800',
  due: 'bg-yellow-950 text-status-due border-yellow-800',
  missed: 'bg-red-950 text-status-missed border-red-800',
  upcoming: 'bg-slate-800 text-status-upcoming border-slate-700',
};

const LABELS: Record<OccurrenceStatus, string> = {
  taken: 'Taken',
  due: 'Due',
  missed: 'Missed',
  upcoming: 'Upcoming',
};

export function StatusBadge({ status }: { status: OccurrenceStatus }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-xs font-medium ${STYLES[status]}`}
      data-status={status}
    >
      {LABELS[status]}
    </span>
  );
}
