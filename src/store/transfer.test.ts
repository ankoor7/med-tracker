import { describe, expect, it } from 'vitest';
import { EXPORT_APP_TAG, exportCSV, exportJSON, mergeDatasets, parseImport } from './transfer';
import type { Dataset } from '../core/types';
import {
  eventInstance,
  eventType,
  logEntry,
  med,
  regimenChange,
  settings,
  slot,
} from '../test/fixtures';

/** Baseline dataset shared by every test below; `over` replaces whole fields. */
function datasetDefaults(): Dataset {
  return {
    medications: [med({ id: 'm1', name: 'Levo', updatedAt: 1000, version: 1 })],
    slots: [
      slot({
        id: 's1',
        time: '08:00',
        items: [{ medId: 'm1', dose: 100 }],
        updatedAt: 1000,
        version: 1,
      }),
    ],
    doseLog: [logEntry({ id: 'l1', medId: 'm1', slotId: 's1', updatedAt: 1000, version: 1 })],
    doseOverrides: [],
    eventTypes: [eventType({ id: 'et1', updatedAt: 1000, version: 1 })],
    eventInstances: [
      eventInstance({ id: 'ei1', typeId: 'et1', occurredAt: 1000, updatedAt: 1000, version: 1 }),
    ],
    regimenChanges: [
      regimenChange({ id: 'rc1', slotId: 's1', changedAt: 1000, updatedAt: 1000, version: 1 }),
    ],
    scheduleSnapshots: [],
    settings: settings({ zone: 'Europe/London', updatedAt: 1000, version: 1 }),
  };
}

function dataset(over: Partial<Dataset> = {}): Dataset {
  return { ...datasetDefaults(), ...over };
}

/**
 * Export `original` to JSON text and parse it straight back, returning the
 * imported Dataset. Throws with the parser's own reason if the round trip
 * failed, so a caller can assert on the data directly instead of repeating the
 * export/import/ok-guard preamble — and a failure names *why* rather than
 * reading as a bare `expected false to be true`.
 */
function roundTrip(original: Dataset): Dataset {
  const result = parseImport(exportJSON(original));
  if (!result.ok) throw new Error(`export/import round trip failed: ${result.reason}`);
  return result.data;
}

describe('JSON export/import round-trip (AC5)', () => {
  it('round-trips a full dataset into an empty app', () => {
    const original = dataset();
    const json = exportJSON(original);
    const result = parseImport(json);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Import into an empty app (replace) reproduces the original exactly.
    const empty: Dataset = {
      medications: [],
      slots: [],
      doseLog: [],
      doseOverrides: [],
      eventTypes: [],
      eventInstances: [],
      regimenChanges: [],
      scheduleSnapshots: [],
      settings: original.settings,
    };
    expect(mergeDatasets(empty, result.data, 'replace')).toEqual(original);
  });

  it('round-trips a medication’s strength and form (Stage 22, FR-22.4/AC4)', () => {
    const original = dataset({
      medications: [
        med({
          id: 'm1',
          name: 'Levo',
          strength: '500 mg',
          form: 'tablet',
          updatedAt: 1,
          version: 1,
        }),
      ],
    });
    expect(roundTrip(original).medications[0]).toMatchObject({
      strength: '500 mg',
      form: 'tablet',
    });
  });

  // Stage 24 (FR-24.6, AC3, P0 #5) — occurrence-linked side-effect
  // attribution must survive a full JSON export/import round-trip, both when
  // present and — for a pre-Stage-24 (unattributed) event — in its absence.
  it('round-trips an attributed eventInstance and a categorised eventType (FR-24.6)', () => {
    const original = dataset({
      eventTypes: [
        eventType({ id: 'et1', name: 'Nausea', category: 'side-effect', updatedAt: 1, version: 1 }),
      ],
      eventInstances: [
        eventInstance({
          id: 'ei1',
          typeId: 'et1',
          occurredAt: 1000,
          medId: 'm1',
          doseLogEntryId: 'l1',
          updatedAt: 1,
          version: 1,
        }),
      ],
    });
    const imported = roundTrip(original);
    expect(imported.eventTypes[0]).toMatchObject({ category: 'side-effect' });
    expect(imported.eventInstances[0]).toMatchObject({ medId: 'm1', doseLogEntryId: 'l1' });
  });

  it('preserves the absence of attribution/category through export/import (AC3)', () => {
    const original = dataset({
      eventTypes: [eventType({ id: 'et1', name: 'Seizure', updatedAt: 1, version: 1 })],
      eventInstances: [
        eventInstance({ id: 'ei1', typeId: 'et1', occurredAt: 1000, updatedAt: 1, version: 1 }),
      ],
    });
    // The wire format is JSON text — parse it back to plain objects rather
    // than trusting the in-memory Dataset, so an explicit `undefined` key
    // surviving only in memory can't masquerade as a preserved absence.
    const parsedJson = JSON.parse(exportJSON(original));
    expect('category' in parsedJson.data.eventTypes[0]).toBe(false);
    expect('medId' in parsedJson.data.eventInstances[0]).toBe(false);
    expect('doseLogEntryId' in parsedJson.data.eventInstances[0]).toBe(false);

    const imported = roundTrip(original);
    const [importedType] = imported.eventTypes;
    const [importedInstance] = imported.eventInstances;
    expect(importedType).toBeDefined();
    expect(importedInstance).toBeDefined();
    if (!importedType || !importedInstance) return;
    expect('category' in importedType).toBe(false);
    expect('medId' in importedInstance).toBe(false);
    expect('doseLogEntryId' in importedInstance).toBe(false);
  });

  it('rejects a non-SteadyDose file', () => {
    expect(parseImport(JSON.stringify({ hello: 'world' }))).toMatchObject({ ok: false });
  });

  it('rejects malformed JSON', () => {
    expect(parseImport('{not json')).toMatchObject({ ok: false });
  });

  it('rejects an export whose record fails the shared schema', () => {
    const bad = {
      app: EXPORT_APP_TAG,
      schemaVersion: 1,
      exportedAt: 0,
      data: {
        medications: [{ id: 'm1' }], // missing required fields
        slots: [],
        doseLog: [],
        settings: settings(),
      },
    };
    const result = parseImport(JSON.stringify(bad));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/medications/);
  });
});

describe('mergeDatasets', () => {
  it('replace takes the import wholesale', () => {
    const base = dataset();
    const incoming = dataset({
      medications: [med({ id: 'm9', name: 'New', updatedAt: 5, version: 1 })],
    });
    expect(mergeDatasets(base, incoming, 'replace')).toEqual(incoming);
  });

  it('merge keeps the newer record per id (LWW)', () => {
    const base = dataset({
      medications: [med({ id: 'm1', name: 'Old', updatedAt: 1000, version: 1 })],
    });
    const incoming = dataset({
      medications: [
        med({ id: 'm1', name: 'Newer', updatedAt: 2000, version: 2 }),
        med({ id: 'm2', name: 'Added', updatedAt: 1500, version: 1 }),
      ],
    });
    const merged = mergeDatasets(base, incoming, 'merge');
    const byId = new Map(merged.medications.map((m) => [m.id, m]));
    expect(byId.get('m1')?.name).toBe('Newer');
    expect(byId.get('m2')?.name).toBe('Added');
  });

  it('merge keeps the older local record when the import is stale', () => {
    const base = dataset({
      medications: [med({ id: 'm1', name: 'Local', updatedAt: 3000, version: 3 })],
    });
    const incoming = dataset({
      medications: [med({ id: 'm1', name: 'Stale', updatedAt: 1000, version: 1 })],
    });
    const merged = mergeDatasets(base, incoming, 'merge');
    expect(merged.medications.find((m) => m.id === 'm1')?.name).toBe('Local');
  });

  it('merge resolves the settings singleton by updatedAt', () => {
    const base = dataset({ settings: settings({ zone: 'UTC', updatedAt: 1000, version: 1 }) });
    const incoming = dataset({
      settings: settings({ zone: 'Asia/Tokyo', updatedAt: 2000, version: 2 }),
    });
    expect(mergeDatasets(base, incoming, 'merge').settings.zone).toBe('Asia/Tokyo');
  });
});

describe('CSV export (AC6)', () => {
  it('emits a header and one row per non-deleted log entry', () => {
    const data = dataset({
      doseLog: [
        logEntry({ id: 'l1', medId: 'm1', dose: 100, unit: 'mcg', zone: 'Europe/London' }),
        logEntry({ id: 'l2', medId: 'm1', deleted: true }),
      ],
    });
    const csv = exportCSV(data);
    const lines = csv.split('\n');
    expect(lines[0]).toContain('id,medication,scheduled,actual');
    expect(lines).toHaveLength(2); // header + one live row
    expect(lines[1]).toContain('Levo');
  });

  it('escapes fields containing commas or quotes', () => {
    const data = dataset({
      medications: [med({ id: 'm1', name: 'Levo, "extra"', updatedAt: 1, version: 1 })],
      doseLog: [logEntry({ id: 'l1', medId: 'm1' })],
    });
    const csv = exportCSV(data);
    expect(csv).toContain('"Levo, ""extra"""');
  });
});
