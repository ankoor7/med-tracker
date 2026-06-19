// Oura API v2 client — a typed port with two implementations:
//   - HttpOuraClient: real fetch against the documented v2 endpoints, with
//     cursor pagination and a clearly-marked bearer-token (auth) seam.
//   - MockOuraClient: deterministic offline data from `fixtures.ts` (the default
//     while real auth is unwired).
//
// The store and UI depend only on the `OuraClient` interface, so swapping mock
// for live later is a one-line change at the factory.

import type { OuraCollectionResponse, OuraDailyReadiness, OuraDailyStress } from '../core/oura';
import type { ISODate } from '../core/types';
import { OURA_API_BASE, type OuraAuthProvider, type OuraConfig } from './config';
import { generateOuraFixtures } from './fixtures';

/** Inclusive `start_date`/`end_date` window (the v2 query params). */
export interface OuraDateRange {
  startDate: ISODate;
  endDate: ISODate;
}

/** The narrow surface the rest of the app consumes. */
export interface OuraClient {
  getDailyReadiness(range: OuraDateRange): Promise<OuraDailyReadiness[]>;
  getDailyStress(range: OuraDateRange): Promise<OuraDailyStress[]>;
}

/** Thrown by the live client on a non-2xx response. */
export class OuraApiError extends Error {
  constructor(
    readonly status: number,
    readonly endpoint: string,
    message: string,
  ) {
    super(message);
    this.name = 'OuraApiError';
  }
}

const READINESS_PATH = '/v2/usercollection/daily_readiness';
const STRESS_PATH = '/v2/usercollection/daily_stress';

type FetchLike = typeof fetch;

/**
 * Live HTTP client. Implemented in full against the documented endpoints, but it
 * only works once a real token is provided via the `OuraAuthProvider` seam — that
 * is the single place real OAuth/PAT wiring lands later.
 */
export class HttpOuraClient implements OuraClient {
  constructor(
    private readonly auth: OuraAuthProvider,
    private readonly baseUrl: string = OURA_API_BASE,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  getDailyReadiness(range: OuraDateRange): Promise<OuraDailyReadiness[]> {
    return this.collect<OuraDailyReadiness>(READINESS_PATH, range);
  }

  getDailyStress(range: OuraDateRange): Promise<OuraDailyStress[]> {
    return this.collect<OuraDailyStress>(STRESS_PATH, range);
  }

  /** Follow the v2 `next_token` cursor until the collection is exhausted. */
  private async collect<T>(path: string, range: OuraDateRange): Promise<T[]> {
    const token = await this.auth.getAccessToken();
    if (!token) {
      throw new OuraApiError(401, path, 'no Oura access token (auth not wired)');
    }

    const out: T[] = [];
    let nextToken: string | null = null;
    do {
      const url = new URL(this.baseUrl + path);
      url.searchParams.set('start_date', range.startDate);
      url.searchParams.set('end_date', range.endDate);
      if (nextToken) url.searchParams.set('next_token', nextToken);

      const res = await this.fetchImpl(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new OuraApiError(res.status, path, `Oura request failed: ${res.status}`);
      }
      const body = (await res.json()) as OuraCollectionResponse<T>;
      out.push(...body.data);
      nextToken = body.next_token;
    } while (nextToken);

    return out;
  }
}

/** Offline mock backed by the deterministic fixture generator. No network. */
export class MockOuraClient implements OuraClient {
  getDailyReadiness(range: OuraDateRange): Promise<OuraDailyReadiness[]> {
    return Promise.resolve(generateOuraFixtures(range).readiness);
  }

  getDailyStress(range: OuraDateRange): Promise<OuraDailyStress[]> {
    return Promise.resolve(generateOuraFixtures(range).stress);
  }
}

/**
 * Pick the client for a config. Mock today (auth unwired); 'live' returns the
 * HTTP client wrapping a token provider built from the config's access token.
 */
export function createOuraClient(config: OuraConfig): OuraClient {
  if (config.mode === 'live') {
    const auth: OuraAuthProvider = {
      // Token is static until real auth (OAuth2 refresh) lands at this seam.
      getAccessToken() {
        return Promise.resolve(config.accessToken);
      },
    };
    return new HttpOuraClient(auth, config.baseUrl);
  }
  return new MockOuraClient();
}
