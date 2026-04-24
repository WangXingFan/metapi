import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const checkinAllMock = vi.fn();
const checkinAccountMock = vi.fn();
const isSpreadCheckinActiveMock = vi.fn();
const startSpreadCheckinNowMock = vi.fn();

vi.mock('../../services/checkinService.js', () => ({
  checkinAll: (...args: unknown[]) => checkinAllMock(...args),
  checkinAccount: (...args: unknown[]) => checkinAccountMock(...args),
}));

vi.mock('../../services/checkinScheduler.js', () => ({
  CHECKIN_SPREAD_START_CRON: '0 8 * * *',
  isSpreadCheckinActive: (...args: unknown[]) => isSpreadCheckinActiveMock(...args),
  startSpreadCheckinNow: (...args: unknown[]) => startSpreadCheckinNowMock(...args),
  updateCheckinSchedule: vi.fn(),
}));

vi.mock('../../db/index.js', () => {
  const insertChain = {
    values: () => insertChain,
    onConflictDoUpdate: () => insertChain,
    run: () => ({ changes: 1 }),
  };

  const queryChain = {
    where: () => queryChain,
    all: () => [],
    limit: () => queryChain,
    offset: () => queryChain,
    orderBy: () => queryChain,
    innerJoin: () => queryChain,
    from: () => queryChain,
  };

  return {
    db: {
      insert: () => insertChain,
      select: () => queryChain,
    },
    runtimeDbDialect: 'sqlite',
    hasProxyLogStreamTimingColumns: async () => false,
    schema: {
      settings: { key: 'key' },
      checkinLogs: { accountId: 'accountId', createdAt: 'createdAt' },
      accounts: { id: 'id' },
      events: { id: 'id' },
    },
  };
});

describe('POST /api/checkin/trigger background task dedupe', () => {
  beforeEach(async () => {
    checkinAllMock.mockReset();
    checkinAccountMock.mockReset();
    isSpreadCheckinActiveMock.mockReset();
    startSpreadCheckinNowMock.mockReset();
    checkinAccountMock.mockResolvedValue({ success: true, message: 'ok' });
    isSpreadCheckinActiveMock.mockReturnValue(false);
    startSpreadCheckinNowMock.mockResolvedValue({ started: true, reused: false });
    const { __resetBackgroundTasksForTests } = await import('../../services/backgroundTaskService.js');
    __resetBackgroundTasksForTests();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('reuses the same background task while spread checkin startup is already running', async () => {
    let resolveFirst: (value: { started: boolean; reused: boolean }) => void = () => {};
    const firstRun = new Promise<{ started: boolean; reused: boolean }>((resolve) => {
      resolveFirst = resolve;
    });
    startSpreadCheckinNowMock.mockImplementation(() => firstRun);

    const { checkinRoutes } = await import('./checkin.js');
    const app = Fastify();
    await app.register(checkinRoutes);

    const firstResponse = await app.inject({ method: 'POST', url: '/api/checkin/trigger' });
    expect(firstResponse.statusCode).toBe(202);
    const firstBody = firstResponse.json() as { success: boolean; queued: boolean; jobId: string };
    expect(firstBody.success).toBe(true);
    expect(firstBody.queued).toBe(true);
    expect(typeof firstBody.jobId).toBe('string');
    expect(firstBody.jobId.length).toBeGreaterThan(10);

    const secondResponse = await app.inject({ method: 'POST', url: '/api/checkin/trigger' });
    expect(secondResponse.statusCode).toBe(202);
    const secondBody = secondResponse.json() as { reused: boolean; jobId: string };
    expect(secondBody.reused).toBe(true);
    expect(secondBody.jobId).toBe(firstBody.jobId);
    expect(startSpreadCheckinNowMock).toHaveBeenCalledTimes(1);

    resolveFirst({ started: true, reused: false });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await app.close();
  });

  it('does not restart an active spread checkin queue', async () => {
    isSpreadCheckinActiveMock.mockReturnValue(true);
    const { checkinRoutes } = await import('./checkin.js');
    const app = Fastify();
    await app.register(checkinRoutes);

    const response = await app.inject({ method: 'POST', url: '/api/checkin/trigger' });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual(expect.objectContaining({
      success: true,
      queued: true,
      reused: true,
      message: '错峰签到队列执行中，请稍后查看签到日志',
    }));
    expect(startSpreadCheckinNowMock).not.toHaveBeenCalled();
    await app.close();
  });

  it('accepts the legacy cron-only schedule payload', async () => {
    const { checkinRoutes } = await import('./checkin.js');
    const schedulerModule = await import('../../services/checkinScheduler.js');
    const app = Fastify();
    await app.register(checkinRoutes);

    const response = await app.inject({
      method: 'PUT',
      url: '/api/checkin/schedule',
      payload: { cron: '0 8 * * *' },
    });

    expect(response.statusCode).toBe(200);
    expect((schedulerModule as any).updateCheckinSchedule).toHaveBeenCalledWith({
      mode: 'cron',
      cronExpr: '0 8 * * *',
      intervalHours: undefined,
      spreadIntervalMinutes: undefined,
    });
    await app.close();
  });

  it('accepts spread schedule payload with fixed 08:00 start', async () => {
    const { checkinRoutes } = await import('./checkin.js');
    const schedulerModule = await import('../../services/checkinScheduler.js');
    const app = Fastify();
    await app.register(checkinRoutes);

    const response = await app.inject({
      method: 'PUT',
      url: '/api/checkin/schedule',
      payload: { mode: 'spread', cron: '5 9 * * *', spreadIntervalMinutes: 3 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(expect.objectContaining({
      success: true,
      mode: 'spread',
      cron: '0 8 * * *',
      spreadIntervalMinutes: 3,
    }));
    expect((schedulerModule as any).updateCheckinSchedule).toHaveBeenCalledWith({
      mode: 'spread',
      cronExpr: '0 8 * * *',
      intervalHours: undefined,
      spreadIntervalMinutes: 3,
    });
    await app.close();
  });
});
