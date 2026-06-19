import { useMemo, useState } from 'react';
import {
  adherenceTimeline,
  buildOuraOverlay,
  correlateAdherence,
  formatDateTimeWithZone,
  type OuraMetric,
} from '../../core';
import { useStore } from '../../store/store';
import { useNow } from '../lib/useNow';
import { Button, Card } from './ui';
import { OuraCorrelationChart } from './OuraCorrelationChart';

// Days of adherence to align against Oura data. Matches the store's Oura fetch
// window so the overlay axis and the fetched data span the same period.
const OVERLAY_DAYS = 30;

const METRIC_TABS: { value: OuraMetric; label: string }[] = [
  { value: 'readiness', label: 'Readiness' },
  { value: 'stress', label: 'Stress' },
];

/** Plain-English gloss of a Pearson coefficient for a non-statistician user. */
function describeCorrelation(r: number | null, metric: OuraMetric): string {
  if (r == null) return 'Not enough overlapping days to estimate a correlation yet.';
  const strength = Math.abs(r) < 0.2 ? 'little' : Math.abs(r) < 0.5 ? 'a weak' : 'a notable';
  const dir = r > 0 ? 'higher' : 'lower';
  const noun = metric === 'readiness' ? 'readiness' : 'high-stress time';
  return `Shows ${strength} link: ${dir} ${noun} tends to coincide with better adherence (r = ${r.toFixed(2)}).`;
}

// Health-data correlation panel. Pulls Oura (mock by default) and overlays the
// chosen metric on medication adherence. All shaping/maths lives in core.
export function OuraPanel() {
  const now = useNow();
  const slots = useStore((s) => s.slots);
  const medications = useStore((s) => s.medications);
  const doseLog = useStore((s) => s.doseLog);
  const settings = useStore((s) => s.settings);
  const ouraSummaries = useStore((s) => s.ouraSummaries);
  const ouraStatus = useStore((s) => s.ouraStatus);
  const ouraLastSyncedAt = useStore((s) => s.ouraLastSyncedAt);
  const ouraError = useStore((s) => s.ouraError);
  const syncOura = useStore((s) => s.syncOura);

  const [metric, setMetric] = useState<OuraMetric>('readiness');

  const overlay = useMemo(() => {
    const timeline = adherenceTimeline(
      slots,
      medications,
      doseLog,
      settings.zone,
      OVERLAY_DAYS,
      now,
    );
    return buildOuraOverlay(ouraSummaries, timeline);
  }, [slots, medications, doseLog, settings.zone, now, ouraSummaries]);

  const correlation = useMemo(() => correlateAdherence(overlay, metric), [overlay, metric]);

  const hasData = ouraSummaries.length > 0;
  const syncing = ouraStatus === 'syncing';

  return (
    <Card>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Oura health correlations</h3>
        <Button variant="secondary" onClick={() => void syncOura()} disabled={syncing}>
          {syncing ? 'Syncing…' : hasData ? 'Refresh' : 'Connect Oura (mock)'}
        </Button>
      </div>

      <p className="mb-3 text-xs text-slate-500">
        Overlays Oura Ring metrics on your medication adherence so you can eyeball correlations.
        Demo data is mocked offline — live Oura account sync is not wired yet.
      </p>

      {ouraStatus === 'error' && (
        <p className="mb-2 text-xs text-red-300">Couldn’t fetch Oura data: {ouraError}</p>
      )}

      {!hasData ? (
        <p className="text-sm text-slate-400">
          No Oura data yet. Tap <strong>Connect Oura (mock)</strong> to load sample readiness and
          stress data and chart it against adherence.
        </p>
      ) : (
        <>
          <div
            className="mb-3 inline-flex overflow-hidden rounded-md border border-slate-700"
            role="tablist"
            aria-label="Oura metric"
          >
            {METRIC_TABS.map((t) => (
              <button
                key={t.value}
                type="button"
                role="tab"
                aria-selected={metric === t.value}
                onClick={() => setMetric(t.value)}
                className={
                  'px-3 py-1.5 text-xs transition-colors ' +
                  (metric === t.value
                    ? 'bg-slate-800 font-semibold text-accent-muted'
                    : 'text-slate-400 hover:text-slate-200')
                }
              >
                {t.label}
              </button>
            ))}
          </div>

          <OuraCorrelationChart points={overlay} metric={metric} />

          <p className="mt-2 text-xs text-slate-400">
            {describeCorrelation(correlation.coefficient, metric)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Based on {correlation.n} day{correlation.n === 1 ? '' : 's'} with both medication and
            Oura data.
            {ouraLastSyncedAt != null && (
              <> · Last synced {formatDateTimeWithZone(ouraLastSyncedAt, settings.zone)}</>
            )}
          </p>
          <p className="mt-1 text-[11px] text-slate-600">
            Correlation is not causation — this is a personal-insight aid, not medical advice.
          </p>
        </>
      )}
    </Card>
  );
}
