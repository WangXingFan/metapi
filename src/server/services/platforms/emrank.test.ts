import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { EmrankAdapter } from './emrank.js';

vi.mock('../siteProxy.js', () => ({
  withSiteProxyRequestInit: async (_url: string, options: unknown) => options,
}));

describe('EmrankAdapter', () => {
  const adapter = new EmrankAdapter();
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

  it('wraps a bare session JWT as an EMRank cookie and identifies the account', async () => {
    const requests: { path?: string; method?: string; cookie?: string }[] = [];
    const base = await serve((req, res) => {
      requests.push({ path: req.url, method: req.method, cookie: req.headers.cookie });
      if (req.url === '/api/auth/session') {
        reply(res, {
          authenticated: true,
          user: {
            id: 5913,
            username: 'ld_bq_11ab',
            display_name: '懒猫',
            role: 1,
          },
        });
        return;
      }
      if (req.url === '/api/account') {
        reply(res, { quota: '59000000', hard_limit: 250 });
        return;
      }
      reply(res, { message: 'not found' }, 404);
    });

    expect(await adapter.verifyToken(`${base}/`, 'header.payload.signature')).toMatchObject({
      tokenType: 'session',
      userInfo: {
        username: 'ld_bq_11ab',
        displayName: '懒猫',
        role: 1,
      },
      balance: {
        balance: 59,
        used: 0,
        quota: 59,
      },
      apiToken: null,
    });
    expect(requests).toEqual([
      { path: '/api/auth/session', method: 'GET', cookie: '__Host-gateway_session=header.payload.signature' },
      { path: '/api/account', method: 'GET', cookie: '__Host-gateway_session=header.payload.signature' },
    ]);
  });

  it('preserves a complete cookie header', async () => {
    let cookie = '';
    const base = await serve((req, res) => {
      cookie = req.headers.cookie || '';
      reply(res, {
        authenticated: true,
        user: { username: 'emrank-user' },
      });
    });

    await adapter.getUserInfo(base, '__Host-gateway_session=session-jwt; locale=zh-CN');
    expect(cookie).toBe('__Host-gateway_session=session-jwt; locale=zh-CN');
  });

  it('does not post when today has already been claimed', async () => {
    const requests: { path?: string; method?: string; csrf?: string }[] = [];
    const base = await serve((req, res) => {
      requests.push({ path: req.url, method: req.method, csrf: req.headers['x-gateway-csrf'] as string | undefined });
      reply(res, {
        available: true,
        state: {
          can_claim: false,
          message: '今日已领取',
          status: 'already_claimed',
          record: { reward: '5000000', day: '2026-10-19' },
        },
        today: '2026-10-19',
      });
    });

    expect(await adapter.checkin(base, 'session-jwt')).toEqual({
      success: false,
      message: '今日已签到',
      reward: '5',
    });
    expect(requests).toEqual([
      { path: '/api/account/check-ins', method: 'GET', csrf: undefined },
    ]);
  });

  it('claims a daily reward with cookie auth, CSRF header, and an empty JSON body', async () => {
    const requests: { path?: string; method?: string; cookie?: string; csrf?: string; body: string }[] = [];
    const base = await serve((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        requests.push({
          path: req.url,
          method: req.method,
          cookie: req.headers.cookie,
          csrf: req.headers['x-gateway-csrf'] as string | undefined,
          body,
        });
        if (req.method === 'GET') {
          reply(res, {
            available: true,
            state: { can_claim: true, status: 'available' },
          });
          return;
        }
        reply(res, {
          available: true,
          state: {
            can_claim: false,
            message: '签到成功',
            status: 'claimed',
            record: { reward: '4000000', day: '2026-10-19' },
          },
        });
      });
    });

    expect(await adapter.checkin(base, 'session-jwt')).toEqual({
      success: true,
      message: '签到成功，获得 4 额度',
      reward: '4',
    });
    expect(requests).toEqual([
      {
        path: '/api/account/check-ins',
        method: 'GET',
        cookie: '__Host-gateway_session=session-jwt',
        csrf: undefined,
        body: '',
      },
      {
        path: '/api/account/check-ins',
        method: 'POST',
        cookie: '__Host-gateway_session=session-jwt',
        csrf: '1',
        body: '{}',
      },
    ]);
  });

  it('preserves authentication failures from the upstream API', async () => {
    const base = await serve((_req, res) => reply(res, { message: '请先登录' }, 401));

    expect(await adapter.checkin(base, 'expired-cookie')).toMatchObject({
      success: false,
      message: expect.stringContaining('HTTP 401'),
    });
    await expect(adapter.getBalance(base, 'expired-cookie')).rejects.toThrow('HTTP 401');
    expect(await adapter.getUserInfo(base, 'expired-cookie')).toBeNull();
  });

  it('does not advertise EMRank as an inference or password-login provider', async () => {
    expect(await adapter.getModels('https://emrank.tech', 'session-jwt')).toEqual([]);
    expect(await adapter.login('https://emrank.tech', 'user', 'password')).toMatchObject({
      success: false,
      message: expect.stringContaining('LinuxDo'),
    });
  });
});
