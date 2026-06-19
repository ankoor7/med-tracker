import { useMemo, useState, type ReactNode } from 'react';
import {
  activeStrategy,
  adherenceTimeline,
  computeAdherence,
  filterLog,
  formatDateTimeWithZone,
  formatTimeWithZone,
  levelSeriesFor,
  type DoseLogEntry,
  type HistoryFilter,
  type Medication,
} from '../../core';
import { useStore } from '../../store/store';
import { Card, ColorDot, Field, inputClass } from '../components/ui';
import { AccountPanel } from '../components/AccountPanel';
import { RemindersPanel } from '../components/RemindersPanel';
import { AdherenceChart } from '../components/AdherenceChart';
import { BloodLevelChart } from '../components/BloodLevelChart';
import { OuraPanel } from '../components/OuraPanel';
import { DataTransferPanel } from '../components/DataTransferPanel';
import { useNow } from '../lib/useNow';

const COMMON_ZONES = [
  'Europe/London',
  'Europe/Paris',
  'America/New_York',
  'America/Los_Angeles',
  'Asia/Tokyo',
  'Australia/Sydney',
  'UTC',
];

export function HistoryScreen() {
  const now = useNow();
  const slots = useStore((s) => s.slots);
  const medications = useStore((s) => s.medications);
  const doseLog = useStore((s) => s.doseLog);
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);

  const medById = useMemo(() => new Map(medications.map((m) => [m.id, m])), [medications]);

  const [filter, setFilter] = useState<HistoryFilter>({});

  const adherence = useMemo(
    () =>
      computeAdherence(
        slots,
        medications,
        doseLog,
        settings.zone,
        settings.adherenceWindowDays,
        settings.missedDayThreshold,
        now,
      ),
    [slots, medications, doseLog, settings, now],
  );

  const timeline = useMemo(
    () =>
      adherenceTimeline(
        slots,
        medications,
        doseLog,
        settings.zone,
        settings.adherenceWindowDays,
        now,
      ),
    [slots, medications, doseLog, settings.zone, settings.adherenceWindowDays, now],
  );

  const entries = useMemo(
    () => filterLog(doseLog, filter, settings.zone),
    [doseLog, filter, settings.zone],
  );

  // Blood-level chart: the app renders only what the extension provides. Pick the
  // filtered med (or the first one) and ask the extension for a series.
  const levelMed = filter.medId ? medById.get(filter.medId) : medications.find((m) => !m.deleted);
  const levelDoses = useMemo(
    () =>
      levelMed
        ? doseLog
            .filter((e) => !e.deleted && e.status === 'taken' && e.medId === levelMed.id)
            .sort((a, b) => a.actualInstant - b.actualInstant)
        : [],
    [doseLog, levelMed],
  );
  const levelSeries =
    levelMed && levelDoses.length > 0
      ? levelSeriesFor(activeStrategy, {
          med: levelMed,
          doses: levelDoses,
          from: levelDoses[0]!.actualInstant,
          to: now,
        })
      : null;

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-2xl font-semibold tracking-tight">History</h2>

      <AccountPanel />

      {adherence.missedPatternWarning && (
        <div className="rounded-md border border-red-700 bg-red-950/50 p-3 text-sm text-red-200">
          <strong>Missed-pattern warning:</strong> {adherence.missed} timing-sensitive doses missed
          in the last {adherence.windowDays} days (threshold {adherence.threshold}).
        </div>
      )}

      <Card>
        <h3 className="mb-2 text-sm font-medium">
          Adherence — last {adherence.windowDays} days (timing-sensitive only)
        </h3>
        <div className="flex items-baseline gap-4">
          <span className="text-3xl font-semibold text-accent-muted">
            {Math.round(adherence.ratio * 100)}%
          </span>
          <span className="text-xs text-slate-400">
            {adherence.taken} taken · {adherence.missed} missed · {adherence.expected} expected
          </span>
        </div>
        <div className="mt-3">
          <AdherenceChart days={timeline} />
        </div>
      </Card>

      <Card>
        <h3 className="mb-2 text-sm font-medium">
          Predicted blood level{levelMed ? ` — ${levelMed.name}` : ''}
        </h3>
        {levelSeries ? (
          <BloodLevelChart
            series={levelSeries}
            doseMarkers={levelDoses.map((d) => d.actualInstant)}
          />
        ) : (
          <p className="text-sm text-slate-400">
            No predicted curve. SteadyDose computes no pharmacology itself — provide a pharmacology
            extension with a <code>levelSeries</code> function to chart predicted levels here.
          </p>
        )}
      </Card>

      <OuraPanel />

      <Card>
        <h3 className="mb-2 text-sm font-medium">Settings</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Time zone">
            <input
              list="zone-list"
              className={inputClass}
              value={settings.zone}
              onChange={(e) => updateSettings({ zone: e.target.value })}
              aria-label="Time zone"
            />
            <datalist id="zone-list">
              {COMMON_ZONES.map((z) => (
                <option key={z} value={z} />
              ))}
            </datalist>
          </Field>
          <Field label="Adherence window (days)">
            <input
              type="number"
              min="1"
              className={inputClass}
              value={settings.adherenceWindowDays}
              onChange={(e) =>
                updateSettings({ adherenceWindowDays: Math.max(1, Number(e.target.value)) })
              }
              aria-label="Adherence window days"
            />
          </Field>
          <Field label="Missed threshold">
            <input
              type="number"
              min="0"
              className={inputClass}
              value={settings.missedDayThreshold}
              onChange={(e) =>
                updateSettings({ missedDayThreshold: Math.max(0, Number(e.target.value)) })
              }
              aria-label="Missed threshold"
            />
          </Field>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Current zone: {formatTimeWithZone(now, settings.zone)}
        </p>
      </Card>

      <RemindersPanel />

      <DataTransferPanel />

      <Card>
        <h3 className="mb-2 text-sm font-medium">Dose log</h3>
        <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Medication">
            <select
              className={inputClass}
              value={filter.medId ?? ''}
              onChange={(e) => setFilter((f) => ({ ...f, medId: e.target.value || undefined }))}
              aria-label="Filter by medication"
            >
              <option value="">All</option>
              {medications
                .filter((m) => !m.deleted)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="From">
            <input
              type="date"
              className={inputClass}
              value={filter.from ?? ''}
              onChange={(e) => setFilter((f) => ({ ...f, from: e.target.value || undefined }))}
              aria-label="From date"
            />
          </Field>
          <Field label="To">
            <input
              type="date"
              className={inputClass}
              value={filter.to ?? ''}
              onChange={(e) => setFilter((f) => ({ ...f, to: e.target.value || undefined }))}
              aria-label="To date"
            />
          </Field>
        </div>
        {entries.length === 0 && (
          <p className="text-sm text-slate-400">No doses match the current filter.</p>
        )}
        <ul className="flex flex-col divide-y divide-slate-800">
          {entries.map((entry) => (
            <LogRow key={entry.id} entry={entry} med={medById.get(entry.medId)} />
          ))}
        </ul>
      </Card>
    </div>
  );
}

function LogRow({ entry, med: m }: { entry: DoseLogEntry; med: Medication | undefined }) {
  const late = entry.actualInstant > entry.scheduledInstant + 60_000;
  const overCap = entry.warnings.length > 0;
  return (
    <li className="flex items-start justify-between gap-2 py-2">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <ColorDot color={m?.color ?? '#64748b'} />
          <span className="text-sm font-medium">{m?.name ?? entry.medId}</span>
          <span className="text-xs text-slate-400">
            {entry.dose}
            {entry.unit}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-slate-400">
          {formatDateTimeWithZone(entry.actualInstant, entry.zone)}
          {' · scheduled '}
          {formatTimeWithZone(entry.scheduledInstant, entry.zone)}
        </p>
        {overCap && <p className="text-xs text-red-300">⚠ {entry.warnings.join(' ')}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap justify-end gap-1">
        {entry.adjusted && <Tag className="border-amber-700 text-amber-300">adjusted</Tag>}
        {late && <Tag className="border-slate-600 text-slate-300">late</Tag>}
        {overCap && <Tag className="border-red-700 text-red-300">over-cap</Tag>}
      </div>
    </li>
  );
}

function Tag({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`rounded-full border px-2 py-0.5 text-xs ${className}`}>{children}</span>;
}
