import { readFileSync } from 'node:fs';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../config.js';
import { registerDesktopRoutes } from '../desktop.js';
import { adminApiAuthMiddleware } from './auth.js';

vi.mock('../services/downstreamApiKeyService.js', () => ({
  authorizeDownstreamToken: vi.fn(),
  consumeManagedKeyRequest: vi.fn(),
}));

describe('admin API authentication boundary', () => {
  let app: ReturnType<typeof Fastify>;
  const previousToken = config.authToken;
  const previousAllowlist = config.adminIpAllowlist;
  let protectedHandler = vi.fn();

  beforeEach(async () => {
    config.authToken = 'test-admin-token';
    config.adminIpAllowlist = [];
    app = Fastify();
    app.addHook('onRequest', adminApiAuthMiddleware);
    protectedHandler = vi.fn(async () => ({ fixture: true }));
    app.get('/api/settings/auth/info', protectedHandler);
    app.get('/api/settings/backup/export', protectedHandler);
    app.get('/api/accounts/:id/credentials', protectedHandler);
    await registerDesktopRoutes(app);
  });

  afterEach(async () => {
    config.authToken = previousToken;
    config.adminIpAllowlist = previousAllowlist;
    await app.close();
  });

  it.each([
    '/api/settings/auth/info',
    '/%61pi/settings/auth/info',
    '/a%70i/settings/backup/export?type=all',
    '/ap%69/accounts/1/credentials',
  ])('requires authentication before serving %s', async (url) => {
    expect((await app.inject({ url })).statusCode).toBe(401);
    expect((await app.inject({ url, headers: { authorization: 'Bearer wrong-token' } })).statusCode).toBe(403);
    expect(protectedHandler).not.toHaveBeenCalled();
    expect((await app.inject({ url, headers: { authorization: 'Bearer test-admin-token' } })).statusCode).toBe(200);
  });

  it('applies the IP allowlist to encoded admin paths', async () => {
    config.adminIpAllowlist = ['192.0.2.1'];
    const response = await app.inject({
      url: '/%61pi/settings/backup/export?type=all',
      remoteAddress: '203.0.113.8',
      headers: { authorization: 'Bearer test-admin-token', 'x-forwarded-for': '192.0.2.1' },
    });
    expect(response.statusCode).toBe(403);
    expect(protectedHandler).not.toHaveBeenCalled();
  });

  it('keeps health checks public without granting access based on parameter or query values', async () => {
    for (const url of ['/api/desktop/health', '/%61pi/desktop/health?probe=1']) {
      expect((await app.inject({ url })).statusCode).toBe(200);
    }
    for (const url of ['/api/accounts/health/credentials', '/%61pi/accounts/health/credentials?path=/api/desktop/health']) {
      expect((await app.inject({ url })).statusCode).toBe(401);
    }
    expect(protectedHandler).not.toHaveBeenCalled();
  });

  it('installs the tested boundary in the production server', () => {
    const source = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
    expect(source).toContain("app.addHook('onRequest', adminApiAuthMiddleware)");
  });
});
