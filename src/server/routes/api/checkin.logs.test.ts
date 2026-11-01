import Fastify, { type FastifyInstance } from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('checkin history query', () => {
  let app: FastifyInstance;
  let module: typeof import('../../db/index.js');
  let dataDir: string;
  let accountId: number;
  const previousDataDir = process.env.DATA_DIR;
  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'metapi-checkin-pagination-'));
    process.env.DATA_DIR = dataDir;
    await import('../../db/migrate.js');
    module = await import('../../db/index.js');
    app = Fastify();
    await app.register((await import('./checkin.js')).checkinRoutes);
    const { db, schema } = module;
    const site = await db.insert(schema.sites).values({ name: 'site', url: 'https://checkin.invalid', platform: 'new-api', customHeaders: '{"Authorization":"site-secret"}' }).returning().get();
    const account = await db.insert(schema.accounts).values({ siteId: site.id, username: 'user', accessToken: 'session-secret', apiToken: 'api-secret', extraConfig: '{"passwordCipher":"cipher-secret"}' }).returning().get();
    accountId = account.id;
    await db.insert(schema.checkinLogs).values(Array.from({ length: 125 }, (_, index) => ({
      accountId, status: index < 120 ? 'success' : 'failed', createdAt: '2026-10-20 12:00:00', message: `history-${index}`,
    }))).run();
    await db.insert(schema.checkinLogs).values({ accountId, status: 'success', createdAt: '2026-10-31 12:00:00' }).run();
  });
  afterAll(async () => {
    await app.close();
    await module.closeDbConnections();
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('filters the complete history before paging, counts matches and omits credentials', async () => {
    const query = `paged=1&limit=50&offset=100&accountId=${accountId}&status=success&from=2026-10-20T00:00:00Z&to=2026-10-21T00:00:00Z`;
    const response = await app.inject({ url: `/api/checkin/logs?${query}` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ total: 120, counts: { all: 125, success: 120, failed: 5, skipped: 0 }, offset: 100, limit: 50 });
    expect(response.json().logs).toHaveLength(20);
    expect(response.json().logs[0].checkin_logs.message).toBe('history-19');
    expect(response.json().logs[0].accounts).toEqual({ id: accountId, username: 'user' });
    for (const secret of ['session-secret', 'api-secret', 'cipher-secret', 'site-secret']) expect(response.body).not.toContain(secret);
  });

  it.each(['limit=-1', 'limit=201', 'limit=oops', 'offset=-1', 'accountId=0', 'from=not-a-date', 'status=other'])('rejects invalid query %s', async (query) => {
    expect((await app.inject({ url: `/api/checkin/logs?${query}` })).statusCode).toBe(400);
  });

  it('preserves the legacy array response for callers without paged=1', async () => {
    const response = await app.inject({ url: '/api/checkin/logs?limit=2' });
    expect(response.json()).toHaveLength(2);
  });
});
