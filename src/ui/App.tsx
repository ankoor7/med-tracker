import { useEffect, useState } from 'react';
import { useStore } from '../store/store';
import { parseTakeParam } from '../reminders/push';
import { RemindersProvider } from '../reminders/context';
import { Disclaimer } from './components/Disclaimer';
import { CatchUpBanner } from './components/CatchUpBanner';
import { TodayScreen } from './screens/TodayScreen';
import { CalendarScreen } from './screens/CalendarScreen';
import { ScheduleScreen } from './screens/ScheduleScreen';
import { MedsScreen } from './screens/MedsScreen';
import { EventsScreen } from './screens/EventsScreen';
import { HistoryScreen } from './screens/HistoryScreen';

const TABS = ['Today', 'Calendar', 'Schedule', 'Meds', 'Events', 'History'] as const;
type Tab = (typeof TABS)[number];

export default function App() {
  const [tab, setTab] = useState<Tab>('Today');
  const hydrated = useStore((s) => s.hydrated);
  const hydrate = useStore((s) => s.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // "Mark taken" from a push notification (Stage 6 follow-up). A cold-started app
  // carries the instruction in `?take=slotId|scheduledInstant`; a running app
  // receives it as a message from the service worker. Both record the dose the
  // user already scheduled (the app never originates an amount). Runs after
  // hydration so the slot/group is loaded.
  useEffect(() => {
    if (!hydrated) return;
    const take = parseTakeParam(window.location.search);
    if (take) {
      useStore.getState().takeGroup(take.slotId, take.scheduledInstant);
      const url = new URL(window.location.href);
      url.searchParams.delete('take');
      window.history.replaceState({}, '', url.pathname + url.search + url.hash);
    }
    if (!('serviceWorker' in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      const data = e.data as { type?: string; url?: string } | null;
      if (data?.type !== 'steadydose:take' || !data.url) return;
      const t = parseTakeParam(new URL(data.url, window.location.origin).search);
      if (t) useStore.getState().takeGroup(t.slotId, t.scheduledInstant);
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [hydrated]);

  return (
    <RemindersProvider>
      <div className="mx-auto flex min-h-full max-w-2xl flex-col">
        <header className="border-b border-slate-800 px-4 py-3">
          <h1 className="text-lg font-semibold tracking-tight">
            <span className="text-accent-muted">Steady</span>Dose
          </h1>
        </header>
        <Disclaimer />
        <CatchUpBanner />

        <main className="flex-1 px-4 py-6" role="main">
          {!hydrated ? (
            <p className="text-sm text-slate-400">Loading…</p>
          ) : (
            <>
              {tab === 'Today' && <TodayScreen />}
              {tab === 'Calendar' && <CalendarScreen />}
              {tab === 'Schedule' && <ScheduleScreen />}
              {tab === 'Meds' && <MedsScreen />}
              {tab === 'Events' && <EventsScreen />}
              {tab === 'History' && <HistoryScreen />}
            </>
          )}
        </main>

        <nav
          aria-label="Primary"
          className="sticky bottom-0 grid grid-cols-6 border-t border-slate-800 bg-slate-950"
        >
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              aria-current={tab === t ? 'page' : undefined}
              className={
                'px-2 py-3 text-sm transition-colors ' +
                (tab === t
                  ? 'font-semibold text-accent-muted'
                  : 'text-slate-400 hover:text-slate-200')
              }
            >
              {t}
            </button>
          ))}
        </nav>
      </div>
    </RemindersProvider>
  );
}
