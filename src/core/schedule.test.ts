import { describe, expect, it } from 'vitest';
import { plannedSlotsForDate } from './schedule';
import { resolveWallTimeToInstant } from './time';
import { logEntry, med, slot } from '../test/fixtures';

const ZONE = 'Europe/London';
const DATE = '2026-06-15';
const at = (time: string) => resolveWallTimeToInstant(DATE, time, ZONE);

describe('plannedSlotsForDate', () => {
  it('groups three meds in one 08:00 slot (AC1)', () => {
    const a = med({ id: 'a' });
    const b = med({ id: 'b' });
    const c = med({ id: 'c' });
    const s = slot({
      id: 's1',
      time: '08:00',
      items: [
        { medId: 'a', dose: 100 },
        { medId: 'b', dose: 50 },
        { medId: 'c', dose: 25 },
      ],
    });
    const now = at('07:00'); // before the slot
    const planned = plannedSlotsForDate(DATE, [s], [a, b, c], [], ZONE, now);

    expect(planned).toHaveLength(1);
    expect(planned[0]!.time).toBe('08:00');
    expect(planned[0]!.occurrences).toHaveLength(3);
    expect(planned[0]!.occurrences.every((o) => o.status === 'upcoming')).toBe(true);
  });

  it('sorts slots by resolved instant', () => {
    const m = med({ id: 'a' });
    const evening = slot({ id: 'pm', time: '20:00', items: [{ medId: 'a', dose: 1 }] });
    const morning = slot({ id: 'am', time: '08:00', items: [{ medId: 'a', dose: 1 }] });
    const planned = plannedSlotsForDate(DATE, [evening, morning], [m], [], ZONE, at('07:00'));
    expect(planned.map((p) => p.slotId)).toEqual(['am', 'pm']);
  });

  it('marks an occurrence taken when a matching log entry exists', () => {
    const m = med({ id: 'a' });
    const s = slot({ id: 's1', time: '08:00', items: [{ medId: 'a', dose: 100 }] });
    const entry = logEntry({
      slotId: 's1',
      medId: 'a',
      scheduledInstant: at('08:00'),
      actualInstant: at('08:05'),
      status: 'taken',
    });
    const planned = plannedSlotsForDate(DATE, [s], [m], [entry], ZONE, at('09:00'));
    const occ = planned[0]!.occurrences[0]!;
    expect(occ.status).toBe('taken');
    expect(occ.logEntryId).toBe(entry.id);
  });

  it('past + untaken: timing-sensitive → missed, flexible → due (AC6)', () => {
    const sensitive = med({ id: 'sens', adjustWhenLate: true });
    const flexible = med({ id: 'flex', adjustWhenLate: false });
    const s = slot({
      id: 's1',
      time: '08:00',
      items: [
        { medId: 'sens', dose: 1 },
        { medId: 'flex', dose: 1 },
      ],
    });
    const planned = plannedSlotsForDate(DATE, [s], [sensitive, flexible], [], ZONE, at('10:00'));
    const byMed = Object.fromEntries(planned[0]!.occurrences.map((o) => [o.medId, o.status]));
    expect(byMed.sens).toBe('missed');
    expect(byMed.flex).toBe('due');
  });

  it('partial group: taken item resolved, others still due (AC5)', () => {
    const a = med({ id: 'a', adjustWhenLate: false });
    const b = med({ id: 'b', adjustWhenLate: false });
    const s = slot({
      id: 's1',
      time: '08:00',
      items: [
        { medId: 'a', dose: 1 },
        { medId: 'b', dose: 1 },
      ],
    });
    const entry = logEntry({ slotId: 's1', medId: 'a', scheduledInstant: at('08:00') });
    const planned = plannedSlotsForDate(DATE, [s], [a, b], [entry], ZONE, at('10:00'));
    const byMed = Object.fromEntries(planned[0]!.occurrences.map((o) => [o.medId, o.status]));
    expect(byMed.a).toBe('taken');
    expect(byMed.b).toBe('due');
  });

  it('skips deleted slots and inactive/deleted meds', () => {
    const active = med({ id: 'a' });
    const inactive = med({ id: 'b', active: false });
    const s = slot({
      id: 's1',
      time: '08:00',
      items: [
        { medId: 'a', dose: 1 },
        { medId: 'b', dose: 1 },
      ],
    });
    const gone = slot({ id: 's2', time: '09:00', deleted: true, items: [{ medId: 'a', dose: 1 }] });
    const planned = plannedSlotsForDate(DATE, [s, gone], [active, inactive], [], ZONE, at('07:00'));
    expect(planned).toHaveLength(1);
    expect(planned[0]!.occurrences.map((o) => o.medId)).toEqual(['a']);
  });
});
