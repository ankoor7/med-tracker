import { describe, expect, it } from 'vitest';
import { runMigrations, type Migration } from './migrations';
import { med, settings, slot } from '../test/fixtures';
import type { Dataset } from '../core/types';

function dataset(): Dataset {
  return {
    medications: [med({ id: 'a' })],
    slots: [slot({ id: 's1', items: [{ medId: 'a', dose: 1 }] })],
    doseLog: [],
    doseOverrides: [],
    eventTypes: [],
    eventInstances: [],
    regimenChanges: [],
    appointments: [],
    settings: settings(),
  };
}

describe('runMigrations', () => {
  it('no-op: empty migration list leaves data intact (AC5 scaffold)', () => {
    const data = dataset();
    const { data: out, version } = runMigrations(data, 1, []);
    expect(out).toEqual(data);
    expect(version).toBe(1);
  });

  it('applies a forward migration and bumps the version', () => {
    const tagAll: Migration = {
      version: 2,
      description: 'tag medications',
      migrate: (d) => ({
        ...d,
        medications: d.medications.map((m) => ({ ...m, notes: 'migrated' })),
      }),
    };
    const { data, version } = runMigrations(dataset(), 1, [tagAll]);
    expect(version).toBe(2);
    expect(data.medications.every((m) => m.notes === 'migrated')).toBe(true);
  });

  it('applies multiple migrations in ascending order', () => {
    const order: number[] = [];
    const m2: Migration = {
      version: 2,
      description: 'two',
      migrate: (d) => {
        order.push(2);
        return d;
      },
    };
    const m3: Migration = {
      version: 3,
      description: 'three',
      migrate: (d) => {
        order.push(3);
        return d;
      },
    };
    // Pass out of order to prove the runner sorts.
    const { version } = runMigrations(dataset(), 1, [m3, m2]);
    expect(order).toEqual([2, 3]);
    expect(version).toBe(3);
  });

  it('skips migrations at or below the current version', () => {
    const ran: number[] = [];
    const m2: Migration = {
      version: 2,
      description: 'two',
      migrate: (d) => {
        ran.push(2);
        return d;
      },
    };
    const { version } = runMigrations(dataset(), 2, [m2]);
    expect(ran).toEqual([]);
    expect(version).toBe(2);
  });
});
