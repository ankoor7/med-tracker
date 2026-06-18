import { describe, expect, it } from 'vitest';
import { EXPORT_APP_TAG, exportCSV, exportJSON, mergeDatasets, parseImport } from './transfer';
import type { Dataset } from '../core/types';
import { logEntry, med, settings, slot } from '../test/fixtures';

function dataset(over: Partial<Dataset> = {}): Dataset {
  return {
    medications: over.medications ?? [med({ id: 'm1', name: 'Levo', updatedAt: 1000, version: 1 })],
    slots: over.slots ?? [
      slot({
        id: 's1',
        time: '08:00',
        items: [{ medId: 'm1', dose: 100 }],
        updatedAt: 1000,
        version: 1,
      }),
    ],
    doseLog: over.doseLog ?? [
      logEntry({ id: 'l1', medId: 'm1', slotId: 's1', updatedAt: 1000, version: 1 }),
    ],
    doseOverrides: over.doseOverrides ?? [],
    settings: over.settings ?? settings({ zone: 'Europe/London', updatedAt: 1000, version: 1 }),
  };
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
      settings: original.settings,
    };
    expect(mergeDatasets(empty, result.data, 'replace')).toEqual(original);
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
