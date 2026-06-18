import { describe, expect, it } from 'vitest';
import {
  OCCURRENCE_TOLERANCE_MS,
  entryMatchesOccurrence,
  logEntryOccurrenceKey,
  occurrenceKey,
  overrideMatchesOccurrence,
  plannedOccurrenceKey,
} from './occurrence';
import { resolveWallTimeToInstant } from './time';
import { logEntry, override } from '../test/fixtures';

const LONDON = 'Europe/London';
const NEW_YORK = 'America/New_York';
const DATE = '2026-06-16';

describe('occurrence key', () => {
  it('composes (slotId, medId, localDate) and is stable for the same triple', () => {
    expect(occurrenceKey('s1', 'm1', DATE)).toBe(plannedOccurrenceKey('s1', 'm1', DATE));
    expect(occurrenceKey('s1', 'm1', DATE)).not.toBe(occurrenceKey('s2', 'm1', DATE));
  });

  it('keys a log entry by the zone it was taken in, not the host zone', () => {
    const scheduledInstant = resolveWallTimeToInstant(DATE, '08:00', LONDON);
    const entry = logEntry({ slotId: 's1', medId: 'm1', scheduledInstant, zone: LONDON });
    expect(logEntryOccurrenceKey(entry)).toBe(occurrenceKey('s1', 'm1', DATE));
  });
});

describe('entryMatchesOccurrence', () => {
  it('matches the same slot/med/day even after a mid-day zone change (AC6)', () => {
    // Logged at the London 08:00 slot, then the active zone changes to New York.
    const loggedInstant = resolveWallTimeToInstant(DATE, '08:00', LONDON);
    const entry = logEntry({
      slotId: 's1',
      medId: 'm1',
      scheduledInstant: loggedInstant,
      zone: LONDON,
    });

    // The planned occurrence now resolves 08:00 in New York — a different UTC
    // instant (5h later), so the old exact-instant equality would miss.
    const plannedInstant = resolveWallTimeToInstant(DATE, '08:00', NEW_YORK);
    expect(plannedInstant).not.toBe(loggedInstant);

    expect(entryMatchesOccurrence(entry, 's1', 'm1', plannedInstant, DATE)).toBe(true);
  });

  it('does not match a different slot or medication', () => {
    const instant = resolveWallTimeToInstant(DATE, '08:00', LONDON);
    const entry = logEntry({ slotId: 's1', medId: 'm1', scheduledInstant: instant, zone: LONDON });
    expect(entryMatchesOccurrence(entry, 's2', 'm1', instant, DATE)).toBe(false);
    expect(entryMatchesOccurrence(entry, 's1', 'm2', instant, DATE)).toBe(false);
  });

  it('does not match a different calendar day', () => {
    const instant = resolveWallTimeToInstant(DATE, '08:00', LONDON);
    const entry = logEntry({ slotId: 's1', medId: 'm1', scheduledInstant: instant, zone: LONDON });
    const otherDay = resolveWallTimeToInstant('2026-06-17', '08:00', LONDON);
    expect(entryMatchesOccurrence(entry, 's1', 'm1', otherDay, '2026-06-17')).toBe(false);
  });

  it('falls back to the instant tolerance near a date boundary', () => {
    // Entry keyed to one local date, planned occurrence to the neighbouring date,
    // but the instants are within tolerance — the secondary match catches it.
    const planned = resolveWallTimeToInstant(DATE, '00:30', LONDON);
    const entry = logEntry({
      slotId: 's1',
      medId: 'm1',
      scheduledInstant: planned - OCCURRENCE_TOLERANCE_MS,
      zone: LONDON,
    });
    expect(logEntryOccurrenceKey(entry)).not.toBe(plannedOccurrenceKey('s1', 'm1', DATE));
    expect(entryMatchesOccurrence(entry, 's1', 'm1', planned, DATE)).toBe(true);
    // Just outside tolerance, and on a different local date: no match.
    const farEntry = logEntry({
      slotId: 's1',
      medId: 'm1',
      scheduledInstant: planned - OCCURRENCE_TOLERANCE_MS - 1,
      zone: LONDON,
    });
    expect(entryMatchesOccurrence(farEntry, 's1', 'm1', planned, DATE)).toBe(false);
  });
});

describe('overrideMatchesOccurrence (Stage 12)', () => {
  it('matches on the occurrence key and rejects a different med/slot', () => {
    const planned = resolveWallTimeToInstant(DATE, '08:00', LONDON);
    const o = override({ slotId: 's1', medId: 'm1', scheduledInstant: planned, zone: LONDON });
    expect(overrideMatchesOccurrence(o, 's1', 'm1', planned, DATE)).toBe(true);
    expect(overrideMatchesOccurrence(o, 's2', 'm1', planned, DATE)).toBe(false);
    expect(overrideMatchesOccurrence(o, 's1', 'm2', planned, DATE)).toBe(false);
  });

  it('stays matched across a zone change via the stored override zone', () => {
    const planned = resolveWallTimeToInstant(DATE, '08:00', LONDON);
    const o = override({ slotId: 's1', medId: 'm1', scheduledInstant: planned, zone: LONDON });
    // Viewing the same occurrence resolved in New York: instants differ, but the
    // occurrence key (computed in the override's own zone) still matches.
    const nyPlanned = resolveWallTimeToInstant(DATE, '08:00', NEW_YORK);
    expect(overrideMatchesOccurrence(o, 's1', 'm1', nyPlanned, DATE)).toBe(true);
  });
});
