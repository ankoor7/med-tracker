import { useRemindersContext } from '../../reminders/reminderContext';

// In-app catch-up (FR-6.5 / AC5): reminders that came due while the app was
// closed (or that could not fire as OS notifications) are surfaced here on open.
export function CatchUpBanner() {
  const { catchUp, dismissCatchUp } = useRemindersContext();
  if (catchUp.length === 0) return null;

  return (
    <div
      role="status"
      className="mx-4 mt-3 rounded-md border border-yellow-800 bg-yellow-950/50 p-3 text-sm text-yellow-100"
    >
      <div className="mb-1 flex items-center justify-between">
        <strong>While you were away</strong>
        <button
          type="button"
          onClick={dismissCatchUp}
          className="text-xs text-yellow-300 hover:text-yellow-100"
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
