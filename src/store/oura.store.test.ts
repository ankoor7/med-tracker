import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useStore } from './store';
import { LocalRepository, SteadyDoseDB } from './localRepository';
import { setRepository, nullRepository } from './repository';
import { setOuraClient } from '../oura/registry';
import type { OuraClient, OuraDateRange } from '../oura/ouraClient';
import type { OuraDailyReadiness, OuraDailyStress } from '../core/oura';

let dbName: string;
let db: SteadyDoseDB;
let counter = 0;

function resetStore() {
  useStore.setState({
    hydrated: false,
    medications: [],
    slots: [],
    doseLog: [],
    doseOverrides: [],
    ouraSummaries: [],
    ouraStatus: 'idle',
    ouraLastSyncedAt: null,
    ouraError: null,
    settings: {
      zone: 'Europe/London',
      adherenceWindowDays: 7,
      missedDayThreshold: 3,
      updatedAt: 0,
    },
  });
}

/** Records which range it was asked for, so we can assert the fetch window. */
class StubOuraClient implements OuraClient {
  lastRange: OuraDateRange | null = null;
  constructor(
    private readonly readiness: OuraDailyReadiness[],
    private readonly stress: OuraDailyStress[],
  ) {}
  async getDailyReadiness(range: OuraDateRange) {
    this.lastRange = range;
    return this.readiness;
  }
  async getDailyStress() {
    return this.stress;
  }
}

const readiness: OuraDailyReadiness = {
  id: 'r',
  contributors: {
    activity_balance: 1,
    body_temperature: 1,
    hrv_balance: 1,
    previous_day_activity: 1,
    previous_night: 1,
    recovery_index: 1,
    resting_heart_rate: 1,
    sleep_balance: 1,
  },
  day: '2026-06-01',
  score: 80,
  temperature_deviation: 0,
  temperature_trend_deviation: 0,
  timestamp: '2026-06-01T03:00:00+01:00',
};
const stress: OuraDailyStress = {
  id: 's',
  day: '2026-06-01',
  stress_high: 3600,
  recovery_high: 7200,
  day_summary: 'normal',
};

beforeEach(() => {
  dbName = `steadydose-oura-${++counter}-${Date.now()}`;
  db = new SteadyDoseDB(dbName);
  setRepository(new LocalRepository(db));
  resetStore();
});

afterEach(async () => {
  setRepository(nullRepository);
  db.close();
  await SteadyDoseDB.delete(dbName);
});

describe('store.syncOura', () => {
  it('fetches, normalises, and exposes Oura summaries', async () => {
    const client = new StubOuraClient([readiness], [stress]);
    setOuraClient(client);

    await useStore.getState().syncOura();
    const s = useStore.getState();
    expect(s.ouraStatus).toBe('synced');
    expect(s.ouraSummaries).toHaveLength(1);
    expect(s.ouraSummaries[0]).toMatchObject({ day: '2026-06-01', readinessScore: 80 });
    expect(s.ouraLastSyncedAt).not.toBeNull();
  });

  it('requests a 30-day window ending today in the active zone', async () => {
    const client = new StubOuraClient([readiness], [stress]);
    setOuraClient(client);
    await useStore.getState().syncOura();
    const range = client.lastRange!;
    // start_date is 29 days before end_date (inclusive 30-day window).
    expect(range.endDate.length).toBe(10);
    const days = (Date.parse(range.endDate) - Date.parse(range.startDate)) / 86_400_000;
    expect(days).toBe(29);
  });

  it('persists summaries so they reload on the next hydrate', async () => {
    setOuraClient(new StubOuraClient([readiness], [stress]));
    await useStore.getState().syncOura();

    // New store instance over the SAME db: hydrate should rehydrate the cache.
    resetStore();
    await useStore.getState().hydrate();
    expect(useStore.getState().ouraSummaries).toHaveLength(1);
  });

  it('records an error and stays usable when the client throws', async () => {
    setOuraClient({
      getDailyReadiness: async () => {
        throw new Error('network down');
      },
      getDailyStress: async () => [],
    });
    await useStore.getState().syncOura();
    const s = useStore.getState();
    expect(s.ouraStatus).toBe('error');
    expect(s.ouraError).toContain('network down');
  });
});
