import { useEffect, useState } from 'react';
import { Clock, Calendar as CalendarIcon, Pill, Activity, BarChart3 } from 'lucide-react';
import { useStore } from '../store/store';
import { parseTakeParam } from '../reminders/push';
import { RemindersProvider } from '../reminders/context';
import { Disclaimer } from './components/Disclaimer';
import { CatchUpBanner } from './components/CatchUpBanner';
import { StartDatePrompt } from './components/StartDatePrompt';
import { TodayScreen } from './screens/TodayScreen';
import { CalendarScreen } from './screens/CalendarScreen';
import { MedsScreen } from './screens/MedsScreen';
import { EventsScreen } from './screens/EventsScreen';
import { HistoryScreen } from './screens/HistoryScreen';

// Stage 18 FR-18.12 merged the old Schedule tab into Meds: one tab owns a
// medication end to end, including the times and amounts it is taken at.
const TABS = ['Today', 'Calendar', 'Meds', 'Events', 'History'] as const;
type Tab = (typeof TABS)[number];

// Stage 19 FR-19.5/decision 2: a single, low-weight Lucide icon set (not
// hand-drawn SVGs) so the bottom nav reads at a glance with one consistent
// stroke weight — self-contained, tree-shakeable, no runtime CDN fetch.
const TAB_ICONS: Record<Tab, typeof Clock> = {
  Today: Clock,
  Calendar: CalendarIcon,
  Meds: Pill,
  Events: Activity,
  History: BarChart3,
};

function TabIcon({ tab }: { tab: Tab }) {
  const Icon = TAB_ICONS[tab];
  return <Icon width={22} height={22} strokeWidth={1.8} aria-hidden />;
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
        {hydrated && <StartDatePrompt />}

        <main className="flex-1 px-4 py-5 pb-28" role="main">
          {!hydrated ? (
            <p className="text-sm text-slate-400">Loading…</p>
          ) : (
            <>
              {tab === 'Today' && <TodayScreen />}
              {tab === 'Calendar' && <CalendarScreen />}
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
          <div className="mb-3 grid grid-cols-5 gap-0.5 rounded-3xl border border-white/10 bg-slate-900/80 p-1.5 shadow-soft backdrop-blur-md">
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
