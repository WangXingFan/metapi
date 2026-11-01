import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fetchWithTimeout } from './fetchWithTimeout.js';

describe('response lifetime limits', () => {
  let server: Server;
  let origin: string;
  beforeAll(async () => {
    server = createServer((request, response) => {
      if (request.url === '/large') {
        response.end('0123456789');
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.flushHeaders();
      const timer = setTimeout(() => response.end('{"ok":true}'), 1000);
      response.on('close', () => clearTimeout(timer));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test listener');
    origin = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  it('times out after response headers arrive', async () => {
    await expect((async () => {
      const response = await fetchWithTimeout(origin, {}, { timeoutMs: 100 });
      return response.json();
    })()).rejects.toMatchObject({ name: 'TimeoutError' });
  });
  it('keeps external cancellation connected during body reads', async () => {
    const controller = new AbortController();
    const response = await fetchWithTimeout(origin, { signal: controller.signal });
    controller.abort();
    await expect(response.text()).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('rejects oversized bodies', async () => {
    await expect((async () => {
      const response = await fetchWithTimeout(`${origin}/large`, {}, { maxResponseBytes: 5 });
      return response.text();
    })()).rejects.toThrow('exceeds 5 bytes');
  });
});
