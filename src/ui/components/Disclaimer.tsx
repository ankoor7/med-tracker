// Safety disclaimer — the app originates no dose and is not a medical device.
// PRD §9 risk mitigation; cross-cutting safety concern.
//
// The banner is dismissable and stays hidden across reloads. The dismissal is a
// per-device UI preference, so it persists in the repository `meta` table (not
// synced) — same channel as reminder prefs (`reminders/prefs.ts`).

import { useDismissibleMetaFlag } from '../lib/useDismissibleMetaFlag';

const DISMISS_KEY = 'disclaimerDismissed';

export function Disclaimer() {
  const { state, dismiss } = useDismissibleMetaFlag(DISMISS_KEY);

  if (state !== 'shown') return null;

  return (
    <div className="flex items-start gap-2 border-b border-status-due/30 bg-status-due/10 px-4 py-2 text-xs text-status-due">
      <p className="flex-1">
        SteadyDose records and checks doses against limits you set — it does not calculate doses or
        give medical advice. Confirm your regimen with a clinician.
      </p>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss disclaimer"
        className="-mr-1 shrink-0 rounded p-0.5 text-status-due/80 hover:bg-status-due/15 hover:text-status-due focus-visible:outline focus-visible:outline-2 focus-visible:outline-status-due"
      >
        <svg
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          className="h-4 w-4"
          aria-hidden
        >
          <path d="M5 5l10 10M15 5L5 15" />
        </svg>
      </button>
    </div>
  );
}
