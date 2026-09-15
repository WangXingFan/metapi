import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { FlowRealmAdapter } from './flowRealm.js';

vi.mock('../siteProxy.js', () => ({
  withSiteProxyRequestInit: async (_url: string, options: unknown) => options,
}));

describe('FlowRealmAdapter', () => {
  const adapter = new FlowRealmAdapter();
  let server: ReturnType<typeof createServer> | undefined;

  async function serve(handler: (req: IncomingMessage, res: ServerResponse) => void) {
    server = createServer(handler);
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  function reply(res: ServerResponse, payload: unknown, status = 200) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  }

  afterEach(async () => {
    if (server) {
      const active = server;
      server = undefined;
      active.closeAllConnections();
      await new Promise<void>((resolve, reject) => active.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('logs in with email, verifies the session, and preserves remaining point balance', async () => {
    const requests: { path?: string; method?: string; auth?: string; console?: string | string[]; body: string }[] = [];
    const base = await serve((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        requests.push({ path: req.url, method: req.method, auth: req.headers.authorization, console: req.headers['x-flowrealm-console'], body });
        if (req.url === '/auth/login') {
          reply(res, { ok: true, authenticated: true, token: 'session-token' });
        } else if (req.url === '/api/me/profile' && req.headers.authorization === 'Bearer session-token') {
          reply(res, { authenticated: true, user: { email: 'user@example.com', name: '测试账户', quota: 42, quota_used: 1 } });
        } else {
          reply(res, { detail: { code: 'authentication_required', error: '未登录或登录已过期' } }, 401);
        }
      });
    });

    const login = await adapter.login(`${base}/`, ' user@example.com ', 'password');
    expect(login).toEqual({ success: true, accessToken: 'session-token', username: 'user@example.com' });
    expect(JSON.parse(requests[0].body)).toEqual({ email: 'user@example.com', password: 'password' });
    expect(requests[0]).toMatchObject({ method: 'POST', console: '1' });
    expect(await adapter.verifyToken(base, login.accessToken!)).toMatchObject({
      tokenType: 'session',
      userInfo: { username: 'user@example.com', email: 'user@example.com', displayName: '测试账户' },
      balance: { balance: 42, used: 1, quota: 43 },
      apiToken: null,
    });
    expect(requests.slice(1).every((request) => request.auth === 'Bearer session-token')).toBe(true);
  });

  it.each([
    { ok: false, authenticated: false, message: '密码错误' },
    { ok: true, authenticated: true },
    { ok: true, authenticated: false, token: 'not-authenticated' },
    { ok: true, authenticated: true, token: '' },
  ])('rejects unsuccessful or incomplete login responses: %j', async (payload) => {
    const base = await serve((_req, res) => reply(res, payload));
    expect((await adapter.login(base, 'user@example.com', 'password')).success).toBe(false);
  });

  it('claims a new reward once and does not report it again on repeated check-in', async () => {
    let claims = 0;
    const requests: { path?: string; method?: string; auth?: string; body: string }[] = [];
    const base = await serve((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        requests.push({ path: req.url, method: req.method, auth: req.headers.authorization, body });
        claims += 1;
        reply(res, { checked_in: true, created: claims === 1, granted_amount: 18, remaining_amount: 17 });
      });
    });
    expect(await adapter.checkin(base, 'session-token')).toEqual({
      success: true, message: '签到成功，获得 18 点额度', reward: '18 点',
    });
    expect(await adapter.checkin(base, 'session-token')).toEqual({ success: true, message: '今天已经签到' });
    expect(requests).toEqual(Array(2).fill({ path: '/api/me/checkin', method: 'POST', auth: 'Bearer session-token', body: '{}' }));
  });

  it.each([
    { checked_in: false, created: false },
    { checked_in: true },
    { checked_in: true, created: true, granted_amount: -1 },
    { checked_in: true, created: true, granted_amount: '18' },
    {},
  ])('does not silently accept malformed check-in responses: %j', async (payload) => {
    const base = await serve((_req, res) => reply(res, payload));
    expect((await adapter.checkin(base, 'token')).success).toBe(false);
  });

  it.each([200, 401])('preserves an expired session error for automatic relogin (HTTP %i)', async (status) => {
    const base = await serve((_req, res) => reply(res, {
      detail: { code: 'authentication_required', error: '未登录或登录已过期' },
    }, status));
    expect(await adapter.checkin(base, 'expired')).toMatchObject({ success: false, message: expect.stringContaining('HTTP 401') });
    await expect(adapter.getBalance(base, 'expired')).rejects.toThrow('HTTP 401');
    expect(await adapter.getUserInfo(base, 'expired')).toBeNull();
  });

  it.each([
    { authenticated: false, user: { quota: 42, quota_used: 1 } },
    { authenticated: true, user: { quota: null, quota_used: 1 } },
    { authenticated: true, user: { quota: 42, quota_used: -1 } },
    { authenticated: true },
  ])('rejects invalid balances instead of overwriting the stored value with zero: %j', async (payload) => {
    const base = await serve((_req, res) => reply(res, payload));
    await expect(adapter.getBalance(base, 'token')).rejects.toThrow();
  });

  it('preserves a genuine zero balance', async () => {
    const base = await serve((_req, res) => reply(res, { authenticated: true, user: { quota: 0, quota_used: 5 } }));
    expect(await adapter.getBalance(base, 'token')).toEqual({ balance: 0, used: 5, quota: 5 });
  });

  it('verifies API keys using the model endpoint without treating them as sessions', async () => {
    const base = await serve((req, res) => {
      if (req.url === '/v1/models' && req.headers.authorization === 'Bearer sk-test') {
        reply(res, { data: [{ id: 'gpt-image-2' }, { id: 'auto' }, {}] });
      } else {
        reply(res, { detail: { error: 'unauthorized' } }, 401);
      }
    });
    expect(await adapter.verifyToken(base, 'sk-test')).toEqual({ tokenType: 'apikey', models: ['gpt-image-2', 'auto'] });
  });

  it.each(['FlowRealm', '流光绘境', 'New API'])('detects a custom domain using public display metadata: %s', async (name) => {
    const base = await serve((req, res) => req.url === '/public/display' ? reply(res, { project_name: name }) : reply(res, {}, 404));
    expect(await adapter.detect(base)).toBe(name !== 'New API');
  });
});
