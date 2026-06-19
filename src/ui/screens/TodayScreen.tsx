import { useMemo, useState } from 'react';
import {
  formatTimeWithZone,
  isoDateInZone,
  plannedSlotsForDate,
  type Medication,
  type PlannedOccurrence,
} from '../../core';
import { useStore } from '../../store/store';
import { Button, Card, ColorDot, Ring, Stat } from '../components/ui';
import { StatusBadge } from '../components/StatusBadge';
import { DoseLogger, type LoggerTarget } from '../components/DoseLogger';
import { useNow } from '../lib/useNow';

export function TodayScreen() {
  const now = useNow();
  const zone = useStore((s) => s.settings.zone);
  const medications = useStore((s) => s.medications);
  const slots = useStore((s) => s.slots);
  const doseLog = useStore((s) => s.doseLog);
  const doseOverrides = useStore((s) => s.doseOverrides);
  const takeGroup = useStore((s) => s.takeGroup);

  const [target, setTarget] = useState<LoggerTarget | null>(null);

  const today = isoDateInZone(now, zone);
  const planned = useMemo(
    () => plannedSlotsForDate(today, slots, medications, doseLog, zone, now, doseOverrides),
    [today, slots, medications, doseLog, zone, now, doseOverrides],
  );
  const medById = new Map(medications.map((m) => [m.id, m]));

  const occurrences = planned.flatMap((s) => s.occurrences);
  const total = occurrences.length;
  const taken = occurrences.filter((o) => o.status === 'taken').length;
  const missed = occurrences.filter((o) => o.status === 'missed').length;
  const remaining = total - taken;
  const pct = total > 0 ? taken / total : 0;
  const ringColor = total > 0 && taken === total ? '#4ade80' : '#2cb1a6';

  const dateLabel = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: zone,
  }).format(now);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-2xl font-semibold tracking-tight">Today</h2>
        <span className="text-xs text-slate-400">{dateLabel}</span>
      </div>

      {total > 0 && (
        <Card className="flex flex-col items-center gap-5 py-7">
          <Ring value={pct} color={ringColor} aria-label={`${taken} of ${total} doses taken today`}>
            <span className="text-4xl font-semibold tabular-nums text-slate-50">
              {taken}
              <span className="text-2xl text-slate-500">/{total}</span>
            </span>
            <span className="mt-1 text-xs uppercase tracking-wide text-slate-400">doses taken</span>
          </Ring>
          <div className="flex items-center gap-8">
            <Stat value={remaining} label="Remaining" />
            {missed > 0 && <Stat value={missed} label="Missed" />}
          </div>
        </Card>
      )}

      {planned.length === 0 && (
        <Card>
          <p className="text-sm text-slate-400">
            No doses scheduled. Add time-slots on the Schedule tab.
          </p>
        </Card>
      )}

      {planned.map((slot) => {
        const remaining = slot.occurrences.filter((o) => o.status !== 'taken');
        return (
          <Card key={slot.slotId}>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <span className="text-base font-semibold">
                  {formatTimeWithZone(slot.scheduledInstant, zone)}
                </span>
                {slot.label && <span className="ml-2 text-sm text-slate-400">{slot.label}</span>}
              </div>
              {remaining.length > 0 && (
                <Button
                  variant="primary"
                  onClick={() => takeGroup(slot.slotId, slot.scheduledInstant)}
                >
                  Take group ({remaining.length})
                </Button>
              )}
            </div>

            <ul className="flex flex-col divide-y divide-slate-800">
              {slot.occurrences.map((occ) => (
                <OccurrenceRow
                  key={occ.medId}
                  occ={occ}
                  med={medById.get(occ.medId)}
                  onLog={() =>
                    setTarget({
                      slotId: occ.slotId,
                      medId: occ.medId,
                      scheduledInstant: occ.scheduledInstant,
                      normalDose: occ.dose,
                    })
                  }
                />
              ))}
            </ul>
          </Card>
        );
      })}

      {target && <DoseLogger target={target} onClose={() => setTarget(null)} />}
    </div>
  );
}

function OccurrenceRow({
  occ,
  med,
  onLog,
}: {
  occ: PlannedOccurrence;
  med: Medication | undefined;
  onLog: () => void;
}) {
  return (
    <li className="flex items-center justify-between gap-2 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <ColorDot color={med?.color ?? '#64748b'} />
        <span className="truncate text-sm">{med?.name ?? occ.medId}</span>
        <span className="text-xs text-slate-400">
          {occ.dose}
          {med?.unit ?? ''}
        </span>
        {occ.overridden && (
          <span
            className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400"
            title="One-time adjusted dose"
          >
            adjusted
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <StatusBadge status={occ.status} />
        {occ.status !== 'taken' && (
          <Button variant="secondary" onClick={onLog}>
            Log
          </Button>
        )}
      </div>
    </li>
  );
}
