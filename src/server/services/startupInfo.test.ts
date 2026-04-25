import { describe, expect, it } from 'vitest';
import { buildStartupEndpoints, buildStartupSummaryLines } from './startupInfo.js';

describe('startupInfo', () => {
  it('builds single-port endpoint summary for the Lite console and admin health API', () => {
    const endpoints = buildStartupEndpoints({
      port: 4000,
      host: '0.0.0.0',
      authToken: 'admin-token',
    });

    expect(endpoints.baseUrl).toBe('http://127.0.0.1:4000');
    expect(endpoints.adminDashboardUrl).toBe('http://127.0.0.1:4000');
    expect(endpoints.adminApiExample).toBe('http://127.0.0.1:4000/api/settings/auth/info');
    expect(endpoints).not.toHaveProperty('proxyApiExample');
  });

  it('renders copy-ready Lite startup summary lines without proxy endpoints', () => {
    const lines = buildStartupSummaryLines({
      port: 4000,
      host: '0.0.0.0',
      authToken: 'admin-token',
    });

    expect(lines.some((line) => line.includes('metapi running'))).toBe(true);
    expect(lines.some((line) => line.includes('Lite console: http://127.0.0.1:4000'))).toBe(true);
    expect(lines.some((line) => line.includes('/api/settings/auth/info'))).toBe(true);
    expect(lines.some((line) => line.includes('/v1/chat/completions'))).toBe(false);
    expect(lines.some((line) => line.includes('Proxy'))).toBe(false);
  });
});
