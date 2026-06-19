import type { OccurrenceStatus } from '../../core';

const STYLES: Record<OccurrenceStatus, string> = {
  taken: 'bg-status-taken/15 text-status-taken border-status-taken/30',
  due: 'bg-status-due/15 text-status-due border-status-due/30',
  missed: 'bg-status-missed/15 text-status-missed border-status-missed/30',
  upcoming: 'bg-slate-700/40 text-slate-300 border-white/10',
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
