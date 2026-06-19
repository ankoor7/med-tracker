import { describe, expect, it, vi } from 'vitest';
import { HttpOuraClient, MockOuraClient, OuraApiError, createOuraClient } from './ouraClient';
import { parseOuraConfig } from './config';
import type { OuraCollectionResponse, OuraDailyReadiness } from '../core/oura';

const RANGE = { startDate: '2026-06-01', endDate: '2026-06-07' };

describe('parseOuraConfig', () => {
  it('defaults to mock mode with no env', () => {
    expect(parseOuraConfig({}).mode).toBe('mock');
  });

  it('stays in mock mode when live is requested without a token (auth unwired)', () => {
    expect(parseOuraConfig({ VITE_OURA_MODE: 'live' }).mode).toBe('mock');
  });

  it('enters live mode only when both the flag and a token are present', () => {
    const config = parseOuraConfig({ VITE_OURA_MODE: 'live', VITE_OURA_ACCESS_TOKEN: 'tok' });
    expect(config.mode).toBe('live');
    expect(config.accessToken).toBe('tok');
  });
});

describe('MockOuraClient', () => {
  it('returns deterministic readiness + stress for a range, one document per day', async () => {
    const client = new MockOuraClient();
    const r1 = await client.getDailyReadiness(RANGE);
    const r2 = await client.getDailyReadiness(RANGE);
    expect(r1).toHaveLength(7); // 2026-06-01 .. 2026-06-07 inclusive
    expect(r1).toEqual(r2); // deterministic
    const stress = await client.getDailyStress(RANGE);
    expect(stress).toHaveLength(7);
    expect(r1.every((d) => d.score! >= 1 && d.score! <= 100)).toBe(true);
  });

  it('createOuraClient returns a mock client by default', async () => {
    const client = createOuraClient(parseOuraConfig({}));
    expect(client).toBeInstanceOf(MockOuraClient);
    expect(await client.getDailyReadiness(RANGE)).toHaveLength(7);
  });
});

describe('HttpOuraClient', () => {
  const auth = { getAccessToken: async () => 'test-token' };

  it('sends the bearer token and date params, and unwraps `data`', async () => {
    const payload: OuraCollectionResponse<OuraDailyReadiness> = {
      data: [
        {
          id: 'r1',
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
          timestamp: '2026-06-01T03:00:00+00:00',
        },
      ],
      next_token: null,
    };
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(new Response(JSON.stringify(payload), { status: 200 })),
    );
    const client = new HttpOuraClient(auth, 'https://api.example.test', fetchMock as typeof fetch);

    const out = await client.getDailyReadiness(RANGE);
    expect(out).toHaveLength(1);
    const calledUrl = fetchMock.mock.calls[0]![0];
    expect(calledUrl).toContain('/v2/usercollection/daily_readiness');
    expect(calledUrl).toContain('start_date=2026-06-01');
    expect(calledUrl).toContain('end_date=2026-06-07');
    const init = fetchMock.mock.calls[0]![1]!;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-token');
  });

  it('follows the next_token cursor across pages', async () => {
    const page = (data: unknown[], next: string | null) =>
      new Response(JSON.stringify({ data, next_token: next }), { status: 200 });
    const fetchMock = vi
      .fn((_url: string, _init?: RequestInit) => Promise.resolve(page([], null)))
      .mockResolvedValueOnce(page([{ id: 'a' }], 'cursor-2'))
      .mockResolvedValueOnce(page([{ id: 'b' }], null));
    const client = new HttpOuraClient(auth, 'https://api.example.test', fetchMock as typeof fetch);

    const out = await client.getDailyStress(RANGE);
    expect(out).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]![0]).toContain('next_token=cursor-2');
  });

  it('throws OuraApiError on a non-2xx response', async () => {
    const fetchMock = vi.fn(async () => new Response('nope', { status: 429 }));
    const client = new HttpOuraClient(auth, 'https://api.example.test', fetchMock as typeof fetch);
    await expect(client.getDailyReadiness(RANGE)).rejects.toBeInstanceOf(OuraApiError);
  });

  it('throws when no access token is available (auth seam not wired)', async () => {
    const client = new HttpOuraClient(
      { getAccessToken: async () => null },
      'https://api.example.test',
      (async () => new Response('{}', { status: 200 })) as typeof fetch,
    );
    await expect(client.getDailyReadiness(RANGE)).rejects.toMatchObject({ status: 401 });
  });
});
