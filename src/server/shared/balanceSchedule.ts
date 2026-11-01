export const DEFAULT_BALANCE_REFRESH_CRON = '0 8 * * *';

// Upgrade the former hourly default, including values saved by older releases.
export function normalizeBalanceRefreshCron(value: string | undefined): string {
  const cron = value?.trim();
  return !cron || cron === '0 * * * *' ? DEFAULT_BALANCE_REFRESH_CRON : cron;
}
