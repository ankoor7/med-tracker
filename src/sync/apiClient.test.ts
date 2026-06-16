import { describe, expect, it, vi } from 'vitest';
import { ApiError, syncRequest } from './apiClient';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('syncRequest', () => {
  it('POSTs JSON with a bearer token and returns the parsed body', async () => {
    const fetchMock = vi.fn((_url: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(jsonResponse({ changes: [], token: 0 })),
    );
    const out = await syncRequest(
      'http://api.test',
      'jwt-123',
      '/sync/pull',
      { since: 5 },
      fetchMock as unknown as typeof fetch,
    );

    expect(out).toEqual({ changes: [], token: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://api.test/sync/pull');
    expect(init?.method).toBe('POST');
    const headers = init?.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer jwt-123');
    expect(headers['content-type']).toBe('application/json');
    expect(init?.body).toBe(JSON.stringify({ since: 5 }));
  });

  it('throws ApiError(401) on unauthorized', async () => {
    const fetchMock = vi.fn((_url: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(jsonResponse({ error: 'unauthorized' }, 401)),
    );
    await expect(
      syncRequest('http://api.test', 'bad', '/sync/pull', {}, fetchMock as unknown as typeof fetch),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('throws ApiError on other non-2xx responses', async () => {
    const fetchMock = vi.fn((_url: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(jsonResponse({ error: 'boom' }, 500)),
    );
    const err = await syncRequest(
      'http://api.test',
      't',
      '/sync/push',
      {},
      fetchMock as unknown as typeof fetch,
    ).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(500);
  });
});
