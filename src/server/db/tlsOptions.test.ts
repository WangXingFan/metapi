import { describe, expect, it } from 'vitest';
import { buildDatabaseTlsOptions } from './tlsOptions.js';

describe('database TLS policy', () => {
  it('verifies certificates by default and requires an explicit insecure opt-out', () => {
    expect(buildDatabaseTlsOptions({})).toEqual({ rejectUnauthorized: true });
    expect(buildDatabaseTlsOptions({ DB_SSL_REJECT_UNAUTHORIZED: 'false' })).toEqual({ rejectUnauthorized: false });
    expect(buildDatabaseTlsOptions({ DB_SSL_REJECT_UNAUTHORIZED: 'invalid' })).toEqual({ rejectUnauthorized: true });
  });
});
