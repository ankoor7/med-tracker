import type { SyncStatus } from '../../sync/useSync';

const PHASE_STYLES: Record<SyncStatus['phase'], string> = {
  idle: 'bg-slate-800 text-slate-300 border-slate-700',
  syncing: 'bg-slate-800 text-accent-muted border-slate-700',
  synced: 'bg-green-950 text-status-taken border-green-800',
  offline: 'bg-yellow-950 text-status-due border-yellow-800',
  error: 'bg-red-950 text-status-missed border-red-800',
};

function label(status: SyncStatus): string {
  switch (status.phase) {
    case 'syncing':
      return 'Syncing…';
    case 'synced':
      return status.lastSyncedAt
        ? `Synced ${new Date(status.lastSyncedAt).toLocaleTimeString()}`
        : 'Synced';
    case 'offline':
      return 'Offline — will retry';
    case 'error':
      return 'Sync error';
    default:
      return 'Not synced yet';
  }
}

/** Small badge summarising the current sync state. */
export function SyncIndicator({ status }: { status: SyncStatus }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-xs font-medium ${PHASE_STYLES[status.phase]}`}
      data-sync-phase={status.phase}
    >
      {label(status)}
    </span>
  );
}
