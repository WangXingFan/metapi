import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NewApiAdapter } from './newApi.js';
import { OneApiAdapter } from './oneApi.js';
import { OneHubAdapter } from './oneHub.js';
import { VeloeraAdapter } from './veloera.js';
import { tokenKeysMatch } from './tokenManagement.js';

describe('upstream token management', () => {
  let server: Server;
  let baseUrl: string;
  let masked: boolean;
  let cookieOnly: boolean;
  let revealSupported: boolean;
  let updates: any[];
  let deleted: number;
  let extraToken: boolean;
  let batchReveals: number;
  let singleReveals: number;
  const fullKey = 'sk-abc-complete-value-1234';
  const detail = {
    id: 7, name: 'original', group: 'cckcc', key: fullKey, status: 1,
    unlimited_quota: false, remain_quota: 123456, expired_time: 1900000000,
    allow_ips: '127.0.0.1', model_limits_enabled: true, model_limits: 'gpt-test',
    cross_group_retry: true,
  };

  beforeEach(async () => {
    masked = false;
    cookieOnly = false;
    revealSupported = true;
    updates = [];
    deleted = 0;
    extraToken = false;
    batchReveals = 0;
    singleReveals = 0;
    server = createServer(async (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      if (cookieOnly && !req.headers.cookie?.includes('session=')) {
        res.writeHead(401);
        res.end(JSON.stringify({ success: false }));
        return;
      }
      if (req.url?.startsWith('/api/token/?')) {
        const items = [{ ...detail, key: masked ? 'abc***1234' : fullKey }];
        if (extraToken) items.push({ ...detail, id: 8, name: 'another', key: 'def***5678' });
        res.end(JSON.stringify({ success: true, data: { items } }));
      } else if (req.url === '/api/token/batch/keys' && req.method === 'POST') {
        batchReveals++;
        res.end(JSON.stringify({ success: true, data: { keys: { 7: fullKey, 8: 'sk-def-complete-value-5678' } } }));
      } else if (req.url === '/api/token/7/key' && req.method === 'POST') {
        singleReveals++;
        res.end(JSON.stringify(revealSupported ? { success: true, data: { key: fullKey } } : { success: false }));
      } else if (req.url === '/api/token/7' && req.method === 'DELETE') {
        deleted++;
        res.end(JSON.stringify({ success: true }));
      } else if (req.url === '/api/token/7') {
        res.end(JSON.stringify({ success: true, data: detail }));
      } else if (req.url === '/api/token/' && req.method === 'PUT') {
        let body = '';
        for await (const chunk of req) body += chunk;
        updates.push(JSON.parse(body));
        res.end(JSON.stringify({ success: true }));
      } else if (req.url === '/api/token/' && req.method === 'POST') {
        res.end(JSON.stringify({ success: true }));
      } else if (req.url === '/api/user/self') {
        res.end(JSON.stringify({ success: true, data: { id: 42, username: 'test-user' } }));
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ success: false }));
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it.each(['new-api', 'one-api'])('updates %s metadata without resetting quotas, expiration or restrictions', async (platform) => {
    const adapter = platform === 'new-api' ? new NewApiAdapter() : new OneApiAdapter();
    const result = await adapter.updateApiToken(baseUrl, 'session', {
      name: 'original', key: fullKey.replace(/^sk-/, ''), tokenGroup: 'cckcc',
    }, { name: 'renamed', group: 'cckpro' }, 42);
    expect(result).toBe(true);
    expect(updates).toEqual([{ ...detail, name: 'renamed', group: 'cckpro' }]);
  });

  it.each([false, true])('automatically reads complete New API keys, including cookie sessions (%s)', async (useCookie) => {
    masked = true;
    cookieOnly = useCookie;
    const adapter = new NewApiAdapter();
    expect(await adapter.createApiToken(baseUrl, 'session', 42, { name: 'original' })).toBeTruthy();
    expect(await adapter.getApiTokens(baseUrl, 'session', 42)).toEqual([{
      name: 'original', key: fullKey, enabled: true, tokenGroup: 'cckcc',
    }]);
  });

  it('preserves masked values when the upstream does not expose full keys', async () => {
    masked = true;
    revealSupported = false;
    const tokens = await new NewApiAdapter().getApiTokens(baseUrl, 'session', 42);
    expect(tokens[0].key).toBe('abc***1234');
  });

  it('uses one batch reveal when syncing multiple masked New API keys', async () => {
    masked = true;
    extraToken = true;
    const tokens = await new NewApiAdapter().getApiTokens(baseUrl, 'session', 42);
    expect(tokens.map((token) => token.key)).toEqual([fullKey, 'sk-def-complete-value-5678']);
    expect(batchReveals).toBe(1);
    expect(singleReveals).toBe(0);
  });

  it('updates masked New API tokens through cookie authentication', async () => {
    masked = true;
    cookieOnly = true;
    const result = await new NewApiAdapter().updateApiToken(baseUrl, 'session', {
      name: 'original', key: fullKey, tokenGroup: 'cckcc',
    }, { group: 'cckpro' }, 42);
    expect(result).toBe(true);
    expect(updates[0]).toEqual({ ...detail, group: 'cckpro' });
  });

  it('deletes the upstream token even when the list returns masked keys', async () => {
    masked = true;
    expect(await new NewApiAdapter().deleteApiToken(baseUrl, 'session', fullKey.replace(/^sk-/, ''), 42)).toBe(true);
    expect(deleted).toBe(1);
  });

  it('does not claim upstream deletion succeeded when a masked key cannot be resolved', async () => {
    masked = true;
    revealSupported = false;
    expect(await new NewApiAdapter().deleteApiToken(baseUrl, 'session', fullKey, 42)).toBe(false);
    expect(deleted).toBe(0);
  });

  it('declares unsupported updates explicitly for thin adapters', () => {
    expect(new OneHubAdapter().apiTokenCapabilities.update).toBe(false);
    expect(new VeloeraAdapter().apiTokenCapabilities).toEqual({ create: false, update: false, delete: false });
  });

  it('does not treat a completely masked key as an identity match', () => {
    expect(tokenKeysMatch('sk-***', fullKey)).toBe(false);
    expect(tokenKeysMatch('abc***1234', fullKey)).toBe(true);
  });
});
