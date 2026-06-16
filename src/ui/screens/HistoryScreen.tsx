import { useMemo, type ReactNode } from 'react';
import {
  computeAdherence,
  formatDateTimeWithZone,
  formatTimeWithZone,
  type DoseLogEntry,
  type Medication,
} from '../../core';
import { useStore } from '../../store/store';
import { Card, ColorDot, Field, inputClass } from '../components/ui';
import { AccountPanel } from '../components/AccountPanel';
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

  const entries = useMemo(
    () => doseLog.filter((e) => !e.deleted).sort((a, b) => b.actualInstant - a.actualInstant),
    [doseLog],
  );

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">History</h2>

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
      </Card>

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

      <Card>
        <h3 className="mb-2 text-sm font-medium">Dose log</h3>
        {entries.length === 0 && <p className="text-sm text-slate-400">No doses logged yet.</p>}
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
