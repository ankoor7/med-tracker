import { useRemindersContext } from '../../reminders/reminderContext';

// In-app catch-up (FR-6.5 / AC5): reminders that came due while the app was
// closed (or that could not fire as OS notifications) are surfaced here on open.
export function CatchUpBanner() {
  const { catchUp, dismissCatchUp } = useRemindersContext();
  if (catchUp.length === 0) return null;

  return (
    <div
      role="status"
      className="mx-4 mt-3 rounded-md border border-status-due/30 bg-status-due/10 p-3 text-sm text-slate-100"
    >
      <div className="mb-1 flex items-center justify-between">
        <strong>While you were away</strong>
        <button
          type="button"
          onClick={dismissCatchUp}
          className="text-xs text-status-due hover:text-status-due/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-status-due"
        >
          Dismiss
        </button>
      </div>
      <ul className="list-disc pl-5">
        {catchUp.map((r) => (
          <li key={r.id}>{r.body}</li>
        ))}
      </ul>
    </div>
  );
}
