import { useMemo, useState } from 'react';
import {
  formatTimeWithZone,
  isoDateInZone,
  plannedSlotsForDate,
  type Medication,
  type PlannedOccurrence,
} from '../../core';
import { useStore } from '../../store/store';
import { Button, Card, ColorDot } from '../components/ui';
import { StatusBadge } from '../components/StatusBadge';
import { DoseLogger, type LoggerTarget } from '../components/DoseLogger';
import { useNow } from '../lib/useNow';

export function TodayScreen() {
  const now = useNow();
  const zone = useStore((s) => s.settings.zone);
  const medications = useStore((s) => s.medications);
  const slots = useStore((s) => s.slots);
  const doseLog = useStore((s) => s.doseLog);
  const takeGroup = useStore((s) => s.takeGroup);

  const [target, setTarget] = useState<LoggerTarget | null>(null);

  const today = isoDateInZone(now, zone);
  const planned = useMemo(
    () => plannedSlotsForDate(today, slots, medications, doseLog, zone, now),
    [today, slots, medications, doseLog, zone, now],
  );
  const medById = new Map(medications.map((m) => [m.id, m]));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">Today</h2>
        <span className="text-xs text-slate-400">{today}</span>
      </div>

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
