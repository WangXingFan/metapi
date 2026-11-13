import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();

vi.mock('undici', () => ({ fetch: fetchMock }));

vi.mock('../db/index.js', () => ({
  db: {},
  schema: { accounts: { id: 'id', siteId: 'siteId' }, sites: { id: 'id' } },
}));

vi.mock('./siteProxy.js', () => ({
  withSiteProxyRequestInit: async (_url: string, init: Record<string, unknown>) => init,
  withAccountProxyOverride: async (_proxy: unknown, fn: () => Promise<unknown>) => fn(),
}));

describe('upstream usage log service', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('uses the upstream log stat endpoint for the 24h spend', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: { quota: 250_000 } }),
    });

    const { fetchUpstreamUsage24hSpend } = await import('./upstreamUsageLogService.js');
    const now = new Date('2026-11-13T12:00:00.000Z');
    const result = await fetchUpstreamUsage24hSpend({
      baseUrl: 'https://upstream.example.com',
      accessToken: 'session-token',
      platform: 'new-api',
      platformUserId: 7,
      now,
    });

    expect(result).toEqual({
      spend: 0.5,
      startAt: '2026-11-12T12:00:00.000Z',
      endAt: '2026-11-13T12:00:00.000Z',
    });
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/log/self/stat?type=2');
  });

  it('falls back to paginated consumption logs when stat is unavailable', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            items: [{ quota: 100_000 }, { cost_usd: 0.2 }],
            total: 2,
          },
        }),
      });

    const { fetchUpstreamUsage24hSpend } = await import('./upstreamUsageLogService.js');
    const result = await fetchUpstreamUsage24hSpend({
      baseUrl: 'https://upstream.example.com',
      accessToken: 'session-token',
      platform: 'new-api',
    });

    expect(result?.spend).toBe(0.4);
  });

  it('keeps the 24h usage snapshot fresh for six hours', async () => {
    const { isUsage24hSnapshotFresh } = await import('./upstreamUsageLogService.js');
    const fetchedAt = '2026-11-13T00:00:00.000Z';
    const snapshot = {
      spend: 1,
      startAt: '2026-11-12T00:00:00.000Z',
      endAt: '2026-11-13T00:00:00.000Z',
      fetchedAt,
    };

    expect(isUsage24hSnapshotFresh(snapshot, Date.parse('2026-11-13T06:00:00.000Z'))).toBe(true);
    expect(isUsage24hSnapshotFresh(snapshot, Date.parse('2026-11-13T06:00:00.001Z'))).toBe(false);
  });
});
