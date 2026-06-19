import { useEffect, useState } from 'react';
import { useStore } from '../store/store';
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
