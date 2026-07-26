import { describe, expect, it } from 'vitest';
import { sideEffectsForMedication, validateEventAttribution } from './sideEffects';
import { eventInstance, eventType, logEntry, med } from '../test/fixtures';
import type { Dataset } from './types';

const AT = (iso: string) => Date.parse(iso);

// A dataset slice with one live medication ("lam") and one logged dose of it.
function attributionData(
  over: Partial<Pick<Dataset, 'medications' | 'doseLog'>> = {},
): Pick<Dataset, 'medications' | 'doseLog'> {
  return {
    medications: [
      med({ id: 'lam', name: 'Lamotrigine' }),
      med({ id: 'lev', name: 'Levetiracetam' }),
    ],
    doseLog: [logEntry({ id: 'dose-1', medId: 'lam' }), logEntry({ id: 'dose-2', medId: 'lev' })],
    ...over,
  };
}

describe('validateEventAttribution (FR-24.4, AC4)', () => {
  it('accepts an event with no attribution at all (the pre-Stage-24 case)', () => {
    expect(validateEventAttribution(attributionData(), {})).toEqual([]);
    expect(
      validateEventAttribution(attributionData(), { medId: undefined, doseLogEntryId: undefined }),
    ).toEqual([]);
  });

  it('accepts a medId that resolves to a live medication', () => {
    expect(validateEventAttribution(attributionData(), { medId: 'lam' })).toEqual([]);
  });

  it('accepts a medId and doseLogEntryId that resolve and agree', () => {
    expect(
      validateEventAttribution(attributionData(), { medId: 'lam', doseLogEntryId: 'dose-1' }),
    ).toEqual([]);
  });

  it('accepts an INACTIVE (retired but not deleted) medication — a stopped med is the interesting case', () => {
    const data = attributionData({
      medications: [med({ id: 'lam', name: 'Lamotrigine', active: false })],
    });
    expect(validateEventAttribution(data, { medId: 'lam' })).toEqual([]);
  });

  it('rejects a medId that matches nothing in the dataset', () => {
    const errors = validateEventAttribution(attributionData(), { medId: 'ghost' });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('medication');
  });

  it('rejects a medId whose medication is deleted (tombstoned)', () => {
    const data = attributionData({
      medications: [med({ id: 'lam', deleted: true })],
    });
    const errors = validateEventAttribution(data, { medId: 'lam' });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('medication');
  });

  it('rejects a doseLogEntryId that matches nothing in the dose log', () => {
    const errors = validateEventAttribution(attributionData(), {
      medId: 'lam',
      doseLogEntryId: 'ghost',
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('logged dose');
  });

  it('rejects a doseLogEntryId whose entry is deleted (tombstoned)', () => {
    const data = attributionData({
      doseLog: [logEntry({ id: 'dose-1', medId: 'lam', deleted: true })],
    });
    const errors = validateEventAttribution(data, { medId: 'lam', doseLogEntryId: 'dose-1' });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('logged dose');
  });

  it('rejects a doseLogEntryId with no medId — a dose attribution implies its medication', () => {
    const errors = validateEventAttribution(attributionData(), { doseLogEntryId: 'dose-1' });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('medication');
  });

  it('rejects a dose whose medication disagrees with the stated medId (mismatched pair)', () => {
    const errors = validateEventAttribution(attributionData(), {
      medId: 'lam',
      doseLogEntryId: 'dose-2', // dose-2 is a Levetiracetam dose
    });
    expect(errors).toEqual([
      'The logged dose this event is attributed to is for a different medication.',
    ]);
  });

  it('does not add a mismatch error on top of a dangling medId', () => {
    const errors = validateEventAttribution(attributionData(), {
      medId: 'ghost',
      doseLogEntryId: 'dose-1',
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('medication this event is attributed to no longer exists');
  });

  it('reports every problem at once when both references dangle', () => {
    const errors = validateEventAttribution(attributionData(), {
      medId: 'ghost',
      doseLogEntryId: 'also-ghost',
    });
    expect(errors).toEqual([
      'The medication this event is attributed to no longer exists.',
      'The logged dose this event is attributed to no longer exists.',
    ]);
  });

  it('carries no causal or prescriptive language in its messages', () => {
    const banned = [/caused? by/i, /linked to/i, /due to/i, /consider/i, /should/i, /recommend/i];
    const messages = [
      ...validateEventAttribution(attributionData(), { medId: 'ghost' }),
      ...validateEventAttribution(attributionData(), { doseLogEntryId: 'dose-1' }),
      ...validateEventAttribution(attributionData(), { medId: 'lam', doseLogEntryId: 'ghost' }),
      ...validateEventAttribution(attributionData(), { medId: 'lam', doseLogEntryId: 'dose-2' }),
    ];
    expect(messages.length).toBeGreaterThan(0);
    for (const message of messages) {
      for (const phrase of banned) expect(message).not.toMatch(phrase);
    }
  });
});

// ---- FR-24.5 / AC5 -----------------------------------------------------------

const JUNE_1 = AT('2026-06-01T00:00:00Z');
const JUNE_10 = AT('2026-06-10T00:00:00Z');
const JUNE_20 = AT('2026-06-20T00:00:00Z');

function resolverData(
  over: Partial<Pick<Dataset, 'eventTypes' | 'eventInstances'>> = {},
): Pick<Dataset, 'eventTypes' | 'eventInstances'> {
  return {
    eventTypes: [eventType({ id: 'drowsy', name: 'Drowsiness', category: 'side-effect' })],
    eventInstances: [],
    ...over,
  };
}

/**
 * The minimal attributed dataset several inclusion tests share: one live
 * "drowsy" instance `a`, attributed to `lam`, on JUNE_10. Extracted only to stop
 * the identical four-line literal repeating — each test still asserts the
 * resolved ids literally, so what is being proven stays visible at the call site.
 */
const oneAttributedToLam = () => [
  eventInstance({ id: 'a', typeId: 'drowsy', medId: 'lam', occurredAt: JUNE_10 }),
];

describe('sideEffectsForMedication (FR-24.5, AC5)', () => {
  it('returns only the instances attributed to the given medication', () => {
    const data = resolverData({
      eventInstances: [
        eventInstance({ id: 'a', typeId: 'drowsy', medId: 'lam', occurredAt: JUNE_10 }),
        eventInstance({ id: 'b', typeId: 'drowsy', medId: 'lev', occurredAt: JUNE_10 }),
        eventInstance({ id: 'c', typeId: 'drowsy', occurredAt: JUNE_10 }), // unattributed
      ],
    });
    expect(sideEffectsForMedication(data, 'lam').map((e) => e.id)).toEqual(['a']);
  });

  it('returns newest first, breaking ties by id', () => {
    const data = resolverData({
      eventInstances: [
        eventInstance({ id: 'old', typeId: 'drowsy', medId: 'lam', occurredAt: JUNE_1 }),
        eventInstance({ id: 'new', typeId: 'drowsy', medId: 'lam', occurredAt: JUNE_20 }),
        eventInstance({ id: 'mid-b', typeId: 'drowsy', medId: 'lam', occurredAt: JUNE_10 }),
        eventInstance({ id: 'mid-a', typeId: 'drowsy', medId: 'lam', occurredAt: JUNE_10 }),
      ],
    });
    expect(sideEffectsForMedication(data, 'lam').map((e) => e.id)).toEqual([
      'new',
      'mid-a',
      'mid-b',
      'old',
    ]);
  });

  it('does not mutate the caller’s instance array', () => {
    const instances = [
      eventInstance({ id: 'old', typeId: 'drowsy', medId: 'lam', occurredAt: JUNE_1 }),
      eventInstance({ id: 'new', typeId: 'drowsy', medId: 'lam', occurredAt: JUNE_20 }),
    ];
    const data = resolverData({ eventInstances: instances });
    sideEffectsForMedication(data, 'lam');
    expect(instances.map((e) => e.id)).toEqual(['old', 'new']);
  });

  it('excludes deleted instances', () => {
    const data = resolverData({
      eventInstances: [
        eventInstance({ id: 'a', typeId: 'drowsy', medId: 'lam', occurredAt: JUNE_10 }),
        eventInstance({
          id: 'gone',
          typeId: 'drowsy',
          medId: 'lam',
          occurredAt: JUNE_10,
          deleted: true,
        }),
      ],
    });
    expect(sideEffectsForMedication(data, 'lam').map((e) => e.id)).toEqual(['a']);
  });

  it('excludes instances whose event type is deleted or missing entirely', () => {
    const data = resolverData({
      eventTypes: [
        eventType({ id: 'drowsy', category: 'side-effect' }),
        eventType({ id: 'dead', deleted: true }),
      ],
      eventInstances: [
        eventInstance({ id: 'kept', typeId: 'drowsy', medId: 'lam', occurredAt: JUNE_10 }),
        eventInstance({ id: 'type-deleted', typeId: 'dead', medId: 'lam', occurredAt: JUNE_10 }),
        eventInstance({ id: 'orphan', typeId: 'nowhere', medId: 'lam', occurredAt: JUNE_10 }),
      ],
    });
    expect(sideEffectsForMedication(data, 'lam').map((e) => e.id)).toEqual(['kept']);
  });

  it('INCLUDES instances of an archived type — archiving hides the type, not its history', () => {
    const data = resolverData({
      eventTypes: [eventType({ id: 'drowsy', category: 'side-effect', archived: true })],
      eventInstances: oneAttributedToLam(),
    });
    expect(sideEffectsForMedication(data, 'lam').map((e) => e.id)).toEqual(['a']);
  });

  it('returns attributed events of any category, not just side-effect types', () => {
    const data = resolverData({
      eventTypes: [
        eventType({ id: 'drowsy', category: 'side-effect' }),
        eventType({ id: 'seizure' }), // no category — general/flare
      ],
      eventInstances: [
        eventInstance({ id: 'se', typeId: 'drowsy', medId: 'lam', occurredAt: JUNE_20 }),
        eventInstance({ id: 'flare', typeId: 'seizure', medId: 'lam', occurredAt: JUNE_10 }),
      ],
    });
    expect(sideEffectsForMedication(data, 'lam').map((e) => e.id)).toEqual(['se', 'flare']);
  });

  it('filters to the window: `from` inclusive, `to` exclusive', () => {
    const data = resolverData({
      eventInstances: [
        eventInstance({ id: 'before', typeId: 'drowsy', medId: 'lam', occurredAt: JUNE_1 - 1 }),
        eventInstance({ id: 'on-from', typeId: 'drowsy', medId: 'lam', occurredAt: JUNE_1 }),
        eventInstance({ id: 'inside', typeId: 'drowsy', medId: 'lam', occurredAt: JUNE_10 }),
        eventInstance({ id: 'on-to', typeId: 'drowsy', medId: 'lam', occurredAt: JUNE_20 }),
        eventInstance({ id: 'after', typeId: 'drowsy', medId: 'lam', occurredAt: JUNE_20 + 1 }),
      ],
    });
    expect(
      sideEffectsForMedication(data, 'lam', { from: JUNE_1, to: JUNE_20 }).map((e) => e.id),
    ).toEqual(['inside', 'on-from']);
  });

  it('returns everything when no window is given', () => {
    const data = resolverData({
      eventInstances: [
        eventInstance({ id: 'ancient', typeId: 'drowsy', medId: 'lam', occurredAt: 0 }),
        eventInstance({ id: 'recent', typeId: 'drowsy', medId: 'lam', occurredAt: JUNE_20 }),
      ],
    });
    expect(sideEffectsForMedication(data, 'lam').map((e) => e.id)).toEqual(['recent', 'ancient']);
  });

  it('returns an empty list for a medication with nothing attributed to it', () => {
    const data = resolverData({ eventInstances: oneAttributedToLam() });
    expect(sideEffectsForMedication(data, 'lev')).toEqual([]);
  });
});
