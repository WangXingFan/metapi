import { readFileSync } from 'node:fs';

export function buildDatabaseTlsOptions(env: NodeJS.ProcessEnv = process.env) {
  return {
    rejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED?.trim().toLowerCase() !== 'false',
    ...(env.DB_SSL_CA_FILE?.trim() ? { ca: readFileSync(env.DB_SSL_CA_FILE.trim(), 'utf8') } : {}),
  };
}
