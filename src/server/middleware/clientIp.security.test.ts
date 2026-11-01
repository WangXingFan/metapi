import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { buildConfig, buildFastifyOptions, config } from '../config.js';
import { authMiddleware } from './auth.js';
import { createRateLimitGuard, resetRequestRateLimitStore } from './requestRateLimit.js';

describe('trusted client addresses', () => {
  it('does not accept spoofed headers for allowlists or rate limits on direct connections', async () => {
    const previous = config.adminIpAllowlist;
    const app = Fastify({ ...buildFastifyOptions(buildConfig({})), logger: false });
    app.get('/allowlist', { preHandler: authMiddleware }, async () => ({ ok: true }));
    app.get('/limited', { preHandler: createRateLimitGuard({ bucket: 'security-test', max: 1, windowMs: 60_000 }) }, async () => ({ ok: true }));
    try {
      config.adminIpAllowlist = ['127.0.0.1'];
      const headers = { authorization: `Bearer ${config.authToken}`, 'x-forwarded-for': '127.0.0.1' };
      const response = await app.inject({ url: '/allowlist', remoteAddress: '203.0.113.8', headers });
      expect(response.statusCode).toBe(403);
      expect((await app.inject({ url: '/limited', remoteAddress: '203.0.113.8', headers })).statusCode).toBe(200);
      headers['x-forwarded-for'] = '198.51.100.5';
      expect((await app.inject({ url: '/limited', remoteAddress: '203.0.113.8', headers })).statusCode).toBe(429);
    } finally {
      config.adminIpAllowlist = previous;
      resetRequestRateLimitStore();
      await app.close();
    }
  });
});
