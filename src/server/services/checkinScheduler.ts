import cron from 'node-cron';
import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db, schema } from '../db/index.js';
import { refreshAllBalances } from './balanceService.js';
import { checkinAll } from './checkinService.js';
import * as routeRefreshWorkflow from './routeRefreshWorkflow.js';
import { sendNotification } from './notifyService.js';
import { buildDailySummaryNotification, collectDailySummaryMetrics } from './dailySummaryService.js';
import { cleanupConfiguredLogs } from './logCleanupService.js';
import { normalizeLogCleanupRetentionDays } from '../shared/logCleanupRetentionDays.js';
import { CHECKIN_SPREAD_START_CRON } from '../shared/checkinSchedule.js';
import { formatLocalDate, toLocalDayKeyFromStoredUtc } from './localTimeService.js';

export { CHECKIN_SPREAD_START_CRON } from '../shared/checkinSchedule.js';

export type CheckinScheduleMode = 'cron' | 'interval' | 'spread';

let checkinTask: cron.ScheduledTask | null = null;
let checkinIntervalTimer: ReturnType<typeof setInterval> | null = null;
let spreadCheckinTimer: ReturnType<typeof setTimeout> | null = null;
let balanceTask: cron.ScheduledTask | null = null;
let dailySummaryTask: cron.ScheduledTask | null = null;
let logCleanupTask: cron.ScheduledTask | null = null;
const intervalAttemptByAccount = new Map<number, number>();
const spreadAttemptDayByAccount = new Map<number, string>();
let spreadCheckinRunning = false;
let spreadActiveDayKey: string | null = null;
let spreadNextRunAt: string | null = null;
let spreadCurrentAccountId: number | null = null;
let spreadStoppedDayKey: string | null = null;
let spreadLastAccountId: number | null = null;
let spreadLastResult: {
  accountId: number;
  success: boolean;
  status?: string | null;
  message?: string | null;
  completedAt: string;
} | null = null;

const DAILY_SUMMARY_DEFAULT_CRON = '58 23 * * *';
const LOG_CLEANUP_DEFAULT_CRON = '0 6 * * *';
const CHECKIN_INTERVAL_POLL_MS = 60_000;

async function resolveJsonSetting<T>(
  settingKey: string,
  isValid: (value: unknown) => value is T,
  fallback: T,
): Promise<T> {
  try {
    const row = await db.select().from(schema.settings).where(eq(schema.settings.key, settingKey)).get();
    if (row?.value) {
      const parsed = JSON.parse(row.value);
      if (isValid(parsed)) {
        return parsed;
      }
    }
  } catch {}
  return fallback;
}

async function resolveCronSetting(settingKey: string, fallback: string): Promise<string> {
  return resolveJsonSetting(settingKey, (value): value is string => typeof value === 'string' && cron.validate(value), fallback);
}

async function resolveBooleanSetting(settingKey: string, fallback: boolean): Promise<boolean> {
  return resolveJsonSetting(settingKey, (value): value is boolean => typeof value === 'boolean', fallback);
}

async function resolvePositiveIntegerSetting(settingKey: string, fallback: number): Promise<number> {
  return resolveJsonSetting(
    settingKey,
    (value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 1,
    fallback,
  );
}

function createCheckinTask(cronExpr: string) {
  return cron.schedule(cronExpr, async () => {
    console.log(`[Scheduler] Running check-in at ${new Date().toISOString()}`);
    try {
      const results = await checkinAll({ scheduleMode: 'cron' });
      const success = results.filter((r) => r.result.success).length;
      const failed = results.length - success;
      console.log(`[Scheduler] Check-in complete: ${success} success, ${failed} failed`);
    } catch (err) {
      console.error('[Scheduler] Check-in error:', err);
    }
  });
}

type IntervalCheckinCandidate = {
  id: number;
  lastCheckinAt?: string | null;
};

export function selectDueIntervalCheckinAccountIds(
  rows: IntervalCheckinCandidate[],
  intervalHours: number,
  now = new Date(),
  attemptState = intervalAttemptByAccount,
) {
  const nowMs = now.getTime();
  const intervalMs = Math.max(1, intervalHours) * 60 * 60 * 1000;

  return rows
    .filter((row) => {
      const lastCheckinMs = row.lastCheckinAt ? Date.parse(row.lastCheckinAt) : Number.NaN;
      const lastAttemptMs = attemptState.get(row.id);
      if (Number.isFinite(lastCheckinMs)) {
        if (nowMs - lastCheckinMs < intervalMs) return false;
        if (typeof lastAttemptMs === 'number' && lastAttemptMs >= lastCheckinMs && nowMs - lastAttemptMs < intervalMs) {
          return false;
        }
        return true;
      }
      if (typeof lastAttemptMs === 'number' && nowMs - lastAttemptMs < intervalMs) return false;
      return true;
    })
    .map((row) => row.id);
}

async function runIntervalCheckinPass(now = new Date()) {
  const rows = await db
    .select()
    .from(schema.accounts)
    .innerJoin(schema.sites, eq(schema.accounts.siteId, schema.sites.id))
    .all();

  const dueAccountIds = selectDueIntervalCheckinAccountIds(
    rows
      .filter((row: any) => (
        row.accounts?.checkinEnabled === true
        && row.accounts?.status === 'active'
        && row.sites?.status !== 'disabled'
      ))
      .map((row: any) => ({
        id: row.accounts.id,
        lastCheckinAt: row.accounts.lastCheckinAt,
      })),
    config.checkinIntervalHours,
    now,
  );

  if (dueAccountIds.length === 0) return;

  try {
    const results = await checkinAll({
      accountIds: dueAccountIds,
      scheduleMode: 'interval',
    });
    const nowMs = now.getTime();
    for (const item of results) {
      intervalAttemptByAccount.set(item.accountId, nowMs);
    }
    const success = results.filter((r) => r.result.success).length;
    const failed = results.length - success;
    console.log(`[Scheduler] Interval check-in complete: ${success} success, ${failed} failed`);
  } catch (err) {
    console.error('[Scheduler] Interval check-in error:', err);
  }
}

type SpreadCheckinCandidate = {
  id: number;
  lastCheckinAt?: string | null;
};

function parseDailyCronHourMinute(cronExpr: string): { hour: number; minute: number } {
  const match = /^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/.exec((cronExpr || '').trim());
  if (!match) return { hour: 8, minute: 0 };
  const minute = Number(match[1]);
  const hour = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return { hour: 8, minute: 0 };
  }
  return { hour, minute };
}

function hasReachedDailyCheckinStart(now = new Date(), cronExpr = CHECKIN_SPREAD_START_CRON) {
  const { hour, minute } = parseDailyCronHourMinute(cronExpr);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  return nowMinutes >= hour * 60 + minute;
}

export function selectSpreadCheckinAccountId(
  rows: SpreadCheckinCandidate[],
  now = new Date(),
  attemptState = spreadAttemptDayByAccount,
  randomValue = Math.random(),
  dayKey = formatLocalDate(now),
) {
  const candidates = rows.filter((row) => {
    if (toLocalDayKeyFromStoredUtc(row.lastCheckinAt) === dayKey) return false;
    if (attemptState.get(row.id) === dayKey) return false;
    return true;
  });
  if (candidates.length === 0) return null;
  const index = Math.min(candidates.length - 1, Math.max(0, Math.floor(randomValue * candidates.length)));
  return candidates[index]?.id ?? null;
}

function clearSpreadCheckinTimer() {
  if (spreadCheckinTimer) {
    clearTimeout(spreadCheckinTimer);
  }
  spreadCheckinTimer = null;
  spreadNextRunAt = null;
}

function scheduleNextSpreadCheckinStep(dayKey: string | null = spreadActiveDayKey) {
  if (config.checkinScheduleMode !== 'spread') return;
  if (!dayKey) return;
  if (spreadStoppedDayKey === dayKey) return;
  clearSpreadCheckinTimer();
  const delayMs = Math.max(1, config.checkinSpreadIntervalMinutes) * 60 * 1000;
  spreadNextRunAt = new Date(Date.now() + delayMs).toISOString();
  spreadCheckinTimer = setTimeout(() => {
    spreadCheckinTimer = null;
    spreadNextRunAt = null;
    void runSpreadCheckinStep(new Date(), true, dayKey);
  }, delayMs);
}

async function runSpreadCheckinStep(now = new Date(), scheduleNext = false, dayKey = formatLocalDate(now)) {
  const currentDayKey = formatLocalDate(now);
  if (spreadStoppedDayKey && currentDayKey !== spreadStoppedDayKey) spreadStoppedDayKey = null;
  if (currentDayKey !== dayKey) {
    if (spreadActiveDayKey === dayKey) spreadActiveDayKey = null;
    clearSpreadCheckinTimer();
    return;
  }
  if (spreadStoppedDayKey === dayKey) {
    clearSpreadCheckinTimer();
    if (spreadActiveDayKey === dayKey) spreadActiveDayKey = null;
    return;
  }
  spreadActiveDayKey = dayKey;
  if (spreadCheckinRunning) {
    if (scheduleNext) scheduleNextSpreadCheckinStep(dayKey);
    return;
  }
  spreadCheckinRunning = true;
  try {
    const rows = await db
      .select()
      .from(schema.accounts)
      .innerJoin(schema.sites, eq(schema.accounts.siteId, schema.sites.id))
      .all();

    const accountId = selectSpreadCheckinAccountId(
      rows
        .filter((row: any) => (
          row.accounts?.checkinEnabled === true
          && row.accounts?.status === 'active'
          && row.sites?.status !== 'disabled'
        ))
        .map((row: any) => ({
          id: row.accounts.id,
          lastCheckinAt: row.accounts.lastCheckinAt,
        })),
      now,
      spreadAttemptDayByAccount,
      Math.random(),
      dayKey,
    );

    if (!accountId) {
      clearSpreadCheckinTimer();
      spreadCurrentAccountId = null;
      if (spreadActiveDayKey === dayKey) spreadActiveDayKey = null;
      console.log('[Scheduler] Spread check-in complete: no due accounts');
      return;
    }

    spreadCurrentAccountId = accountId;
    const results = await checkinAll({
      accountIds: [accountId],
      scheduleMode: 'spread',
    });
    spreadAttemptDayByAccount.set(accountId, dayKey);
    const result = results.find((item) => item.accountId === accountId)?.result;
    spreadLastAccountId = accountId;
    spreadLastResult = {
      accountId,
      success: result?.success === true,
      status: typeof result?.status === 'string' ? result.status : null,
      message: typeof result?.message === 'string' ? result.message : null,
      completedAt: new Date().toISOString(),
    };
    const success = results.filter((r) => r.result.success).length;
    const failed = results.length - success;
    console.log(`[Scheduler] Spread check-in account ${accountId}: ${success} success, ${failed} failed`);
    if (scheduleNext) {
      scheduleNextSpreadCheckinStep(dayKey);
    }
  } catch (err) {
    console.error('[Scheduler] Spread check-in error:', err);
    if (scheduleNext) {
      scheduleNextSpreadCheckinStep(dayKey);
    }
  } finally {
    spreadCurrentAccountId = null;
    spreadCheckinRunning = false;
  }
}

function createSpreadCheckinTask(cronExpr: string) {
  return cron.schedule(cronExpr, async () => {
    console.log(`[Scheduler] Starting spread check-in at ${new Date().toISOString()}`);
    clearSpreadCheckinTimer();
    const now = new Date();
    await runSpreadCheckinStep(now, true, formatLocalDate(now));
  });
}

export function isSpreadCheckinActive(now = new Date()) {
  const dayKey = formatLocalDate(now);
  return spreadStoppedDayKey !== dayKey && spreadActiveDayKey === dayKey && (spreadCheckinRunning || spreadCheckinTimer !== null);
}

export function stopSpreadCheckinToday(now = new Date()) {
  const dayKey = formatLocalDate(now);
  spreadStoppedDayKey = dayKey;
  clearSpreadCheckinTimer();
  if (spreadActiveDayKey === dayKey) spreadActiveDayKey = null;
  spreadCurrentAccountId = null;
}

type SpreadCheckinStatusAccount = {
  id: number;
  username: string | null;
  siteId: number | null;
  siteName: string | null;
  lastCheckinAt: string | null;
};

function toSpreadCheckinStatusAccount(row: any): SpreadCheckinStatusAccount {
  return {
    id: row.accounts.id,
    username: row.accounts.username ?? null,
    siteId: row.sites?.id ?? null,
    siteName: row.sites?.name ?? null,
    lastCheckinAt: row.accounts.lastCheckinAt ?? null,
  };
}

function isSpreadCheckinEligibleRow(row: any): boolean {
  return (
    row.accounts?.checkinEnabled === true
    && row.accounts?.status === 'active'
    && row.sites?.status !== 'disabled'
  );
}

export async function getSpreadCheckinStatus(now = new Date()) {
  const dayKey = formatLocalDate(now);
  const rows = await db
    .select()
    .from(schema.accounts)
    .innerJoin(schema.sites, eq(schema.accounts.siteId, schema.sites.id))
    .all();

  const eligibleAccounts = rows
    .filter(isSpreadCheckinEligibleRow)
    .map(toSpreadCheckinStatusAccount);
  const completedAccounts = eligibleAccounts.filter((account) => (
    toLocalDayKeyFromStoredUtc(account.lastCheckinAt) === dayKey
    || spreadAttemptDayByAccount.get(account.id) === dayKey
  ));
  const completedAccountIds = new Set(completedAccounts.map((account) => account.id));
  const pendingAccounts = eligibleAccounts.filter((account) => !completedAccountIds.has(account.id));
  const active = spreadActiveDayKey === dayKey && (spreadCheckinRunning || spreadCheckinTimer !== null);
  const currentAccount = spreadCurrentAccountId == null
    ? null
    : eligibleAccounts.find((account) => account.id === spreadCurrentAccountId) ?? null;
  const lastResultToday = spreadLastResult && formatLocalDate(new Date(spreadLastResult.completedAt)) === dayKey
    ? spreadLastResult
    : null;
  const lastAccount = spreadLastAccountId == null || !lastResultToday
    ? null
    : eligibleAccounts.find((account) => account.id === spreadLastAccountId) ?? null;
  const completedCount = completedAccounts.length;
  const eligibleCount = eligibleAccounts.length;

  return {
    mode: config.checkinScheduleMode as CheckinScheduleMode,
    active,
    running: spreadCheckinRunning,
    waiting: active && !spreadCheckinRunning && spreadCheckinTimer !== null,
    dayKey,
    activeDayKey: spreadActiveDayKey,
    intervalMinutes: config.checkinSpreadIntervalMinutes,
    nextRunAt: active ? spreadNextRunAt : null,
    currentAccount,
    lastAccount,
    lastResult: lastResultToday,
    eligibleCount,
    completedCount,
    pendingCount: pendingAccounts.length,
    progressPercent: eligibleCount > 0 ? Math.round((completedCount / eligibleCount) * 100) : 0,
  };
}

export async function startSpreadCheckinNow(now = new Date()) {
  if (isSpreadCheckinActive(now)) {
    return { started: false, reused: true };
  }
  if (config.checkinScheduleMode !== 'spread' || config.checkinCron !== CHECKIN_SPREAD_START_CRON) {
    updateCheckinSchedule({
      mode: 'spread',
      cronExpr: CHECKIN_SPREAD_START_CRON,
      intervalHours: config.checkinIntervalHours,
      spreadIntervalMinutes: config.checkinSpreadIntervalMinutes,
    });
  }
  clearSpreadCheckinTimer();
  spreadNextRunAt = null;
  await runSpreadCheckinStep(now, true, formatLocalDate(now));
  return { started: true, reused: false };
}

function stopCheckinSchedule() {
  checkinTask?.stop();
  checkinTask = null;
  if (checkinIntervalTimer) {
    clearInterval(checkinIntervalTimer);
    checkinIntervalTimer = null;
  }
  clearSpreadCheckinTimer();
  spreadActiveDayKey = null;
  spreadCurrentAccountId = null;
}

function startCheckinSchedule(options: { resumeSpreadToday?: boolean } = {}) {
  stopCheckinSchedule();
  if (config.checkinScheduleMode === 'spread') {
    checkinTask = createSpreadCheckinTask(config.checkinCron || CHECKIN_SPREAD_START_CRON);
    const now = new Date();
    if (options.resumeSpreadToday && hasReachedDailyCheckinStart(now, config.checkinCron || CHECKIN_SPREAD_START_CRON)) {
      void runSpreadCheckinStep(now, true, formatLocalDate(now));
    }
    return;
  }
  if (config.checkinScheduleMode === 'interval') {
    checkinIntervalTimer = setInterval(() => {
      void runIntervalCheckinPass();
    }, CHECKIN_INTERVAL_POLL_MS);
    return;
  }
  checkinTask = createCheckinTask(config.checkinCron);
}

function createBalanceTask(cronExpr: string) {
  return cron.schedule(cronExpr, async () => {
    console.log(`[Scheduler] Refreshing balances at ${new Date().toISOString()}`);
    try {
      await refreshAllBalances();
      await routeRefreshWorkflow.refreshModelsAndRebuildRoutes();
      console.log('[Scheduler] Balance refresh complete');
    } catch (err) {
      console.error('[Scheduler] Balance refresh error:', err);
    }
  });
}

function createDailySummaryTask(cronExpr: string) {
  return cron.schedule(cronExpr, async () => {
    console.log(`[Scheduler] Sending daily summary at ${new Date().toISOString()}`);
    try {
      const metrics = await collectDailySummaryMetrics();
      const { title, message } = buildDailySummaryNotification(metrics);
      await sendNotification(title, message, 'info', {
        bypassThrottle: true,
        requireChannel: true,
        throwOnFailure: true,
      });
      console.log(`[Scheduler] Daily summary sent: ${title}`);
    } catch (err) {
      console.error('[Scheduler] Daily summary error:', err);
    }
  });
}

function createLogCleanupTask(cronExpr: string) {
  return cron.schedule(cronExpr, async () => {
    if (!config.logCleanupConfigured) {
      console.log('[Scheduler] Log cleanup skipped: legacy fallback mode is active');
      return;
    }
    console.log(`[Scheduler] Running log cleanup at ${new Date().toISOString()}`);
    try {
      const result = await cleanupConfiguredLogs();
      if (!result.enabled) {
        console.log('[Scheduler] Log cleanup skipped: no log target enabled');
        return;
      }
      console.log(
        `[Scheduler] Log cleanup complete: usage=${result.usageLogsDeleted}, program=${result.programLogsDeleted}, cutoff=${result.cutoffUtc}`,
      );
    } catch (err) {
      console.error('[Scheduler] Log cleanup error:', err);
    }
  });
}

export async function startScheduler() {
  const activeCheckinCron = await resolveCronSetting('checkin_cron', config.checkinCron);
  const activeCheckinScheduleMode = await resolveJsonSetting<CheckinScheduleMode>(
    'checkin_schedule_mode',
    (value): value is CheckinScheduleMode => value === 'cron' || value === 'interval' || value === 'spread',
    config.checkinScheduleMode as CheckinScheduleMode,
  );
  const activeCheckinIntervalHours = await resolvePositiveIntegerSetting(
    'checkin_interval_hours',
    config.checkinIntervalHours,
  );
  const activeCheckinSpreadIntervalMinutes = await resolvePositiveIntegerSetting(
    'checkin_spread_interval_minutes',
    config.checkinSpreadIntervalMinutes,
  );
  const activeBalanceCron = await resolveCronSetting('balance_refresh_cron', config.balanceRefreshCron);
  const activeDailySummaryCron = await resolveCronSetting('daily_summary_cron', DAILY_SUMMARY_DEFAULT_CRON);
  const activeLogCleanupCron = await resolveCronSetting('log_cleanup_cron', config.logCleanupCron || LOG_CLEANUP_DEFAULT_CRON);
  const activeLogCleanupUsageLogsEnabled = await resolveBooleanSetting(
    'log_cleanup_usage_logs_enabled',
    config.logCleanupUsageLogsEnabled,
  );
  const activeLogCleanupProgramLogsEnabled = await resolveBooleanSetting(
    'log_cleanup_program_logs_enabled',
    config.logCleanupProgramLogsEnabled,
  );
  const activeLogCleanupRetentionDays = await resolvePositiveIntegerSetting(
    'log_cleanup_retention_days',
    normalizeLogCleanupRetentionDays(config.logCleanupRetentionDays),
  );
  config.checkinScheduleMode = activeCheckinScheduleMode;
  config.checkinCron = config.checkinScheduleMode === 'spread' ? CHECKIN_SPREAD_START_CRON : activeCheckinCron;
  config.checkinIntervalHours = Math.min(24, Math.max(1, activeCheckinIntervalHours));
  config.checkinSpreadIntervalMinutes = Math.min(240, Math.max(1, activeCheckinSpreadIntervalMinutes));
  config.balanceRefreshCron = activeBalanceCron;
  config.logCleanupCron = activeLogCleanupCron;
  config.logCleanupUsageLogsEnabled = activeLogCleanupUsageLogsEnabled;
  config.logCleanupProgramLogsEnabled = activeLogCleanupProgramLogsEnabled;
  config.logCleanupRetentionDays = activeLogCleanupRetentionDays;

  stopCheckinSchedule();
  balanceTask?.stop();
  dailySummaryTask?.stop();
  logCleanupTask?.stop();
  startCheckinSchedule({ resumeSpreadToday: true });
  balanceTask = createBalanceTask(activeBalanceCron);
  dailySummaryTask = createDailySummaryTask(activeDailySummaryCron);
  logCleanupTask = createLogCleanupTask(activeLogCleanupCron);

  const checkinScheduleDetail = config.checkinScheduleMode === 'spread'
    ? `${config.checkinCron}, every ${config.checkinSpreadIntervalMinutes}m`
    : (config.checkinScheduleMode === 'cron' ? activeCheckinCron : `${config.checkinIntervalHours}h`);
  console.log(`[Scheduler] Check-in schedule: ${config.checkinScheduleMode} (${checkinScheduleDetail})`);
  console.log(`[Scheduler] Balance refresh cron: ${activeBalanceCron}`);
  console.log(`[Scheduler] Daily summary cron: ${activeDailySummaryCron}`);
  console.log(
    `[Scheduler] Log cleanup cron: ${activeLogCleanupCron} (configured=${config.logCleanupConfigured}, usage=${activeLogCleanupUsageLogsEnabled}, program=${activeLogCleanupProgramLogsEnabled}, retentionDays=${activeLogCleanupRetentionDays})`,
  );
}

export function updateCheckinCron(cronExpr: string) {
  updateCheckinSchedule({
    mode: 'cron',
    cronExpr,
    intervalHours: config.checkinIntervalHours,
    spreadIntervalMinutes: config.checkinSpreadIntervalMinutes,
  });
}

export function updateCheckinSchedule(input: {
  mode: CheckinScheduleMode;
  cronExpr?: string;
  intervalHours?: number;
  spreadIntervalMinutes?: number;
}) {
  const nextMode = input.mode;
  if (nextMode !== 'cron' && nextMode !== 'interval' && nextMode !== 'spread') {
    throw new Error(`Invalid checkin schedule mode: ${String(nextMode)}`);
  }

  const nextCronExpr = nextMode === 'spread' ? CHECKIN_SPREAD_START_CRON : (input.cronExpr ?? config.checkinCron);
  if (!cron.validate(nextCronExpr)) throw new Error(`Invalid cron: ${nextCronExpr}`);

  const nextIntervalHours = input.intervalHours ?? config.checkinIntervalHours;
  if (!Number.isFinite(nextIntervalHours) || nextIntervalHours < 1 || nextIntervalHours > 24) {
    throw new Error(`Invalid interval hours: ${String(nextIntervalHours)}`);
  }

  const nextSpreadIntervalMinutes = input.spreadIntervalMinutes ?? config.checkinSpreadIntervalMinutes;
  if (!Number.isFinite(nextSpreadIntervalMinutes) || nextSpreadIntervalMinutes < 1 || nextSpreadIntervalMinutes > 240) {
    throw new Error(`Invalid spread interval minutes: ${String(nextSpreadIntervalMinutes)}`);
  }

  config.checkinScheduleMode = nextMode;
  config.checkinCron = nextCronExpr;
  config.checkinIntervalHours = Math.trunc(nextIntervalHours);
  config.checkinSpreadIntervalMinutes = Math.trunc(nextSpreadIntervalMinutes);
  startCheckinSchedule();
}

export function updateBalanceRefreshCron(cronExpr: string) {
  if (!cron.validate(cronExpr)) throw new Error(`Invalid cron: ${cronExpr}`);
  config.balanceRefreshCron = cronExpr;
  balanceTask?.stop();
  balanceTask = createBalanceTask(cronExpr);
}

export function updateLogCleanupSettings(input: {
  cronExpr?: string;
  usageLogsEnabled?: boolean;
  programLogsEnabled?: boolean;
  retentionDays?: number;
}) {
  const cronExpr = input.cronExpr ?? config.logCleanupCron;
  if (!cron.validate(cronExpr)) throw new Error(`Invalid cron: ${cronExpr}`);

  const retentionDays = normalizeLogCleanupRetentionDays(input.retentionDays ?? config.logCleanupRetentionDays);

  config.logCleanupCron = cronExpr;
  if (input.usageLogsEnabled !== undefined) config.logCleanupUsageLogsEnabled = !!input.usageLogsEnabled;
  if (input.programLogsEnabled !== undefined) config.logCleanupProgramLogsEnabled = !!input.programLogsEnabled;
  config.logCleanupRetentionDays = retentionDays;

  logCleanupTask?.stop();
  logCleanupTask = createLogCleanupTask(cronExpr);
}

export function __resetCheckinSchedulerForTests() {
  stopCheckinSchedule();
  balanceTask?.stop();
  dailySummaryTask?.stop();
  logCleanupTask?.stop();
  balanceTask = null;
  dailySummaryTask = null;
  logCleanupTask = null;
  intervalAttemptByAccount.clear();
  spreadAttemptDayByAccount.clear();
  spreadCheckinRunning = false;
  spreadActiveDayKey = null;
  spreadNextRunAt = null;
  spreadCurrentAccountId = null;
  spreadStoppedDayKey = null;
  spreadLastAccountId = null;
  spreadLastResult = null;
}
