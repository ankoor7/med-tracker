import { describe, expect, it } from 'vitest';
import { buildMedicationList, buildPreVisitSummary, startOfIsoWeek } from './clinicalReport';
import { med, slot, eventType, eventInstance, regimenChange, settings } from '../test/fixtures';
import type { Dataset } from './types';

// A fixed "now" in BST (London is UTC+1 in June), local date 2026-06-30.
const NOW = Date.parse('2026-06-30T12:00:00Z');
const AT = (iso: string) => Date.parse(iso);

function baseDataset(over: Partial<Dataset> = {}): Dataset {
  return {
    medications: [
      med({
        id: 'lam',
        name: 'Lamotrigine',
        strength: '150 mg',
        form: 'tablet',
        adjustWhenLate: true,
      }),
    ],
    slots: [
      slot({ id: 's1', time: '08:00', label: 'Morning', items: [{ medId: 'lam', dose: 150 }] }),
    ],
    doseLog: [],
    doseOverrides: [],
    eventTypes: [],
    eventInstances: [],
    regimenChanges: [],
    scheduleSnapshots: [],
    settings: settings({ zone: 'Europe/London', assumeTakenOnTime: false }),
    ...over,
  };
}

describe('startOfIsoWeek', () => {
  it('returns the Monday of the week for any day', () => {
    expect(startOfIsoWeek('2026-06-10')).toBe('2026-06-08'); // Wed → Mon
    expect(startOfIsoWeek('2026-06-08')).toBe('2026-06-08'); // Mon → itself
    expect(startOfIsoWeek('2026-06-14')).toBe('2026-06-08'); // Sun → prior Mon
    expect(startOfIsoWeek('2026-06-20')).toBe('2026-06-15'); // Sat → Mon
  });
});

describe('buildMedicationList (P0 #7)', () => {
  it('lists active meds with label, schedule, guardrails; excludes inactive', () => {
    const data = baseDataset({
      medications: [
        med({ id: 'lam', name: 'Lamotrigine', strength: '150 mg', form: 'tablet', unit: 'mg' }),
        med({ id: 'vd', name: 'Vitamin D', unit: 'IU' }),
        med({ id: 'old', name: 'Retired', active: false }),
      ],
      slots: [
        slot({
          id: 's-eve',
          time: '20:00',
          label: 'Evening',
          items: [{ medId: 'lam', dose: 150 }],
        }),
        slot({
          id: 's-am',
          time: '08:00',
          label: 'Morning',
          items: [
            { medId: 'lam', dose: 100 },
            { medId: 'vd', dose: 1000 },
          ],
        }),
      ],
    });
    const list = buildMedicationList(data);
    // Both share the 08:00 first slot, so the tie-break is by label
    // ("Lamotrigine…" < "Vitamin D").
    expect(list.map((m) => m.medId)).toEqual(['lam', 'vd']);
    const lam = list.find((m) => m.medId === 'lam')!;
    expect(lam.label).toBe('Lamotrigine 150 mg — Tablet');
    expect(lam.times).toEqual([
      { time: '08:00', label: 'Morning', dose: 100 },
      { time: '20:00', label: 'Evening', dose: 150 },
    ]);
    expect(list.some((m) => m.medId === 'old')).toBe(false);
  });
});

describe('buildPreVisitSummary (P0 #6)', () => {
  it('computes the period window ending today', () => {
    const s = buildPreVisitSummary(baseDataset(), { now: NOW, days: 30 });
    expect(s.to).toBe('2026-06-30');
    expect(s.from).toBe('2026-06-01');
    expect(s.days).toBe(30);
    expect(s.medicationCount).toBe(1);
  });

  it('reports overall + per-medication adherence for timing-sensitive meds', () => {
    const s = buildPreVisitSummary(baseDataset(), { now: NOW, days: 30 });
    // assumeTakenOnTime off + no logs → every past scheduled dose is missed.
    expect(s.overall.missed).toBe(30);
    expect(s.perMedication).toHaveLength(1);
    expect(s.perMedication[0]!.label).toBe('Lamotrigine 150 mg — Tablet');
    expect(s.perMedication[0]!.result.missed).toBe(30);
  });

  // A dataset with a "Seizure" type and the given instances — shared by the
  // clustering and highlights cases so their setup isn't duplicated.
  const seizure = (id: string, when: string, severity: number, duration: number) =>
    eventInstance({ id, typeId: 'sz', occurredAt: AT(when), values: { severity, duration } });
  const withSeizures = (...instances: ReturnType<typeof seizure>[]) =>
    baseDataset({
      eventTypes: [eventType({ id: 'sz', name: 'Seizure' })],
      eventInstances: instances,
    });

  it('aggregates flare-up stats per type, in period only, with clustering', () => {
    const data = withSeizures(
      seizure('e1', '2026-06-10T10:00:00Z', 4, 60),
      seizure('e2', '2026-06-11T10:00:00Z', 5, 120),
      seizure('e3', '2026-06-20T10:00:00Z', 3, 90),
      seizure('out', '2026-05-20T10:00:00Z', 5, 300), // out of period
    );
    const s = buildPreVisitSummary(data, { now: NOW, days: 30 });
    expect(s.totalEvents).toBe(3); // the May one is out of the period
    expect(s.events).toHaveLength(1);
    const sz = s.events[0]!;
    expect(sz.count).toBe(3);
    expect(sz.peakWeek).toEqual({ weekStart: '2026-06-08', count: 2 });
    const severity = sz.properties.find((p) => p.id === 'severity')!;
    expect(severity.avg).toBe(4);
    expect(severity.formattedAvg).toBe('4/5');
    const duration = sz.properties.find((p) => p.id === 'duration')!;
    expect(duration.formattedAvg).toBe('1m 30s'); // avg 90s
  });

  it('includes only regimen changes inside the period', () => {
    const data = baseDataset({
      regimenChanges: [
        regimenChange({
          id: 'in',
          kind: 'medication-added',
          summary: 'Lamotrigine added',
          changedAt: AT('2026-06-05T09:00:00Z'),
        }),
        regimenChange({
          id: 'out',
          kind: 'medication-added',
          summary: 'Old added',
          changedAt: AT('2026-04-01T09:00:00Z'),
        }),
      ],
    });
    const s = buildPreVisitSummary(data, { now: NOW, days: 30 });
    expect(s.regimenChanges.map((c) => c.id)).toEqual(['in']);
  });

  it('builds descriptive highlights with no prescriptive language', () => {
    const data = {
      ...withSeizures(
        seizure('e1', '2026-06-10T10:00:00Z', 4, 60),
        seizure('e2', '2026-06-11T10:00:00Z', 5, 120),
      ),
      regimenChanges: [
        regimenChange({
          id: 'in',
          kind: 'medication-added',
          summary: 'Lamotrigine added',
          changedAt: AT('2026-06-05T09:00:00Z'),
        }),
      ],
    };
    const s = buildPreVisitSummary(data, { now: NOW, days: 30 });
    const kinds = s.highlights.map((h) => h.kind);
    expect(kinds).toContain('missed-doses');
    expect(kinds).toContain('medication-started');
    expect(kinds).toContain('event-cluster');
    expect(kinds).toContain('event-total');

    // AC2: nothing prescriptive/advisory in the surfaced copy.
    const banned = [
      'should',
      'recommend',
      'increase',
      'decrease',
      'advise',
      'consider',
      'prescrib',
      'take ',
    ];
    const text = s.highlights.map((h) => h.text.toLowerCase()).join(' | ');
    for (const b of banned) expect(text).not.toContain(b);
  });

  it('omits the regimen section cleanly when no changes were ever recorded', () => {
    const s = buildPreVisitSummary(baseDataset(), { now: NOW, days: 30 });
    expect(s.regimenChanges).toEqual([]);
    expect(s.highlights.some((h) => h.kind === 'medication-started')).toBe(false);
  });
});
