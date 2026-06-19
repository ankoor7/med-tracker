import { useEffect, useState, type ReactNode } from 'react';
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

// Minimal line icons (Oura-style) so the bottom nav reads at a glance.
function TabIcon({ tab }: { tab: Tab }) {
  const common = {
    width: 22,
    height: 22,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  const paths: Record<Tab, ReactNode> = {
    Today: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7.5V12l3 2" />
      </>
    ),
    Calendar: (
      <>
        <rect x="3.5" y="4.5" width="17" height="16" rx="2.5" />
        <path d="M3.5 9h17M8 3v3M16 3v3" />
      </>
    ),
    Schedule: (
      <>
        <path d="M8 6h12M8 12h12M8 18h12" />
        <circle cx="4" cy="6" r="1" />
        <circle cx="4" cy="12" r="1" />
        <circle cx="4" cy="18" r="1" />
      </>
    ),
    Meds: (
      <>
        <rect x="3" y="8" width="18" height="8" rx="4" />
        <path d="M12 8v8" />
      </>
    ),
    Events: <path d="M3 13h4l2.5 6 5-15L17 13h4" />,
    History: (
      <>
        <path d="M5 20V10M12 20V4M19 20v-7" />
      </>
    ),
  };
  return <svg {...common}>{paths[tab]}</svg>;
}

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
        <header className="px-5 pb-2 pt-5">
          <h1 className="text-xl font-semibold tracking-tight">
            <span className="text-accent-muted">Steady</span>Dose
          </h1>
        </header>
        <Disclaimer />
        <CatchUpBanner />

        <main className="flex-1 px-4 py-5 pb-28" role="main">
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
          className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-2xl px-4 pb-[env(safe-area-inset-bottom)]"
        >
          <div className="mb-3 grid grid-cols-6 gap-0.5 rounded-3xl border border-white/10 bg-slate-900/80 p-1.5 shadow-soft backdrop-blur-md">
            {TABS.map((t) => {
              const active = tab === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  aria-current={active ? 'page' : undefined}
                  className={
                    'flex flex-col items-center gap-1 rounded-2xl px-1 py-2 text-[10px] font-medium transition-colors ' +
                    (active
                      ? 'bg-accent/15 text-accent-muted'
                      : 'text-slate-500 hover:text-slate-300')
                  }
                >
                  <TabIcon tab={t} />
                  {t}
                </button>
              );
            })}
          </div>
        </nav>
      </div>
    </RemindersProvider>
  );
}
