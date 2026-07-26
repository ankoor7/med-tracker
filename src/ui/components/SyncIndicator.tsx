import type { SyncStatus } from '../../sync/useSync';

// Stage 20: theme tokens throughout (was raw green/yellow/red Tailwind
// swatches, which don't invert for the light theme) — same
// bg/text/border-at-15%/30% idiom as StatusBadge.
const PHASE_STYLES: Record<SyncStatus['phase'], string> = {
  idle: 'bg-slate-800/60 text-slate-300 border-slate-700',
  syncing: 'bg-accent/15 text-accent-muted border-accent/30',
  synced: 'bg-status-taken/15 text-status-taken border-status-taken/30',
  offline: 'bg-status-due/15 text-status-due border-status-due/30',
  error: 'bg-status-missed/15 text-status-missed border-status-missed/30',
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
