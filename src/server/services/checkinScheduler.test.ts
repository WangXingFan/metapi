import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cronStopMock = vi.fn();
const scheduleMock = vi.fn(() => ({
  stop: cronStopMock,
}));
const validateMock = vi.fn(() => true);
const selectRowsMock = vi.fn(() => []);
const allMock = vi.fn();

vi.mock('node-cron', () => ({
  default: {
    schedule: (...args: unknown[]) => scheduleMock(...args),
    validate: (...args: unknown[]) => validateMock(...args),
  },
}));

vi.mock('../db/index.js', () => {
  const queryChain = {
    where: () => queryChain,
    get: () => undefined,
    all: () => selectRowsMock(),
    from: () => queryChain,
    innerJoin: () => queryChain,
  };

  return {
    db: {
      select: () => queryChain,
    },
    schema: {
      settings: { key: 'key' },
      accounts: {
        id: 'id',
        siteId: 'siteId',
        checkinEnabled: 'checkinEnabled',
        status: 'status',
        lastCheckinAt: 'lastCheckinAt',
        extraConfig: 'extraConfig',
      },
      sites: { id: 'id', status: 'status' },
    },
  };
});

vi.mock('./checkinService.js', () => ({
  checkinAll: (...args: unknown[]) => allMock(...args),
}));

describe('checkinScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    cronStopMock.mockReset();
    scheduleMock.mockClear();
    validateMock.mockClear();
    selectRowsMock.mockReset();
    selectRowsMock.mockReturnValue([]);
    allMock.mockReset();
  });

  afterEach(async () => {
    const scheduler = await import('./checkinScheduler.js');
    scheduler.__resetCheckinSchedulerForTests();
    vi.useRealTimers();
  });

  it('switches from cron mode to interval mode and back', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    const scheduler = await import('./checkinScheduler.js');

    scheduler.updateCheckinSchedule({
      mode: 'cron',
      cronExpr: '0 8 * * *',
      intervalHours: 6,
    });
    expect(scheduleMock).toHaveBeenCalledTimes(1);
    expect(scheduleMock).toHaveBeenCalledWith('0 8 * * *', expect.any(Function));

    scheduler.updateCheckinSchedule({
      mode: 'interval',
      intervalHours: 6,
    });
    expect(cronStopMock).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(scheduleMock).toHaveBeenCalledTimes(1);

    scheduler.updateCheckinSchedule({
      mode: 'cron',
      cronExpr: '5 9 * * *',
      intervalHours: 6,
    });
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
    expect(scheduleMock).toHaveBeenCalledTimes(2);
    expect(scheduleMock).toHaveBeenCalledWith('5 9 * * *', expect.any(Function));
  });

  it('selects due accounts from the last successful checkin time', async () => {
    const scheduler = await import('./checkinScheduler.js');
    const now = new Date('2026-03-20T12:00:00.000Z');

    expect(scheduler.selectDueIntervalCheckinAccountIds([
      { id: 1, lastCheckinAt: null },
      { id: 2, lastCheckinAt: '2026-03-20T05:59:59.000Z' },
      { id: 3, lastCheckinAt: '2026-03-20T06:30:00.000Z' },
    ], 6, now)).toEqual([1, 2]);
  });

  it('switches to spread mode with a daily start cron and timeout spacing', async () => {
    vi.setSystemTime(new Date(2026, 2, 20, 7, 30, 0, 0));
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const scheduler = await import('./checkinScheduler.js');

    scheduler.updateCheckinSchedule({
      mode: 'spread',
      cronExpr: '5 9 * * *',
      intervalHours: 6,
      spreadIntervalMinutes: 10,
    });

    expect(scheduleMock).toHaveBeenCalledTimes(1);
    expect(scheduleMock).toHaveBeenCalledWith('0 8 * * *', expect.any(Function));
    expect(setTimeoutSpy).not.toHaveBeenCalled();
  });

  it('selects one random spread checkin account that has not been tried today', async () => {
    const scheduler = await import('./checkinScheduler.js');
    const now = new Date(2026, 2, 20, 8, 0, 0, 0);
    const sameLocalDay = new Date(2026, 2, 20, 7, 0, 0, 0).toISOString();
    const attemptState = new Map<number, string>([[4, '2026-03-20']]);

    expect(scheduler.selectSpreadCheckinAccountId([
      { id: 1, lastCheckinAt: null, extraConfig: null },
      { id: 2, lastCheckinAt: sameLocalDay, extraConfig: null },
      { id: 3, lastCheckinAt: null, extraConfig: null },
      { id: 4, lastCheckinAt: null, extraConfig: null },
      { id: 5, lastCheckinAt: null, extraConfig: null },
    ], now, attemptState, 0.99)).toBe(5);
  });

  it('stops only the current local day spread queue and allows the next day cron to start again', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    vi.setSystemTime(new Date(2026, 2, 20, 8, 0, 0, 0));
    const scheduler = await import('./checkinScheduler.js');
    scheduler.updateCheckinSchedule({
      mode: 'spread',
      cronExpr: '0 8 * * *',
      intervalHours: 6,
      spreadIntervalMinutes: 5,
    });
    selectRowsMock.mockReturnValue([
      { accounts: { id: 1, checkinEnabled: true, status: 'active', lastCheckinAt: null }, sites: { id: 10, status: 'active' } },
    ]);
    allMock.mockResolvedValue([{ accountId: 1, result: { success: true, status: 'success', message: 'ok' } }]);

    await scheduler.startSpreadCheckinNow();
    expect(scheduler.isSpreadCheckinActive()).toBe(true);

    scheduler.stopSpreadCheckinToday();
    expect(scheduler.isSpreadCheckinActive()).toBe(false);
    const timeoutCountAfterStop = setTimeoutSpy.mock.calls.length;

    await scheduler.startSpreadCheckinNow();
    expect(setTimeoutSpy.mock.calls.length).toBe(timeoutCountAfterStop);
    expect(scheduler.isSpreadCheckinActive()).toBe(false);

    vi.setSystemTime(new Date(2026, 2, 21, 8, 0, 0, 0));
    selectRowsMock.mockReturnValue([
      { accounts: { id: 2, checkinEnabled: true, status: 'active', lastCheckinAt: null }, sites: { id: 10, status: 'active' } },
    ]);
    allMock.mockResolvedValue([{ accountId: 2, result: { success: true, status: 'success', message: 'ok' } }]);

    await scheduler.startSpreadCheckinNow();
    expect(scheduler.isSpreadCheckinActive()).toBe(true);
  });

  it('reports spread checkin progress from eligible accounts and today attempts', async () => {
    vi.setSystemTime(new Date(2026, 2, 20, 8, 0, 0, 0));
    const scheduler = await import('./checkinScheduler.js');
    scheduler.updateCheckinSchedule({
      mode: 'spread',
      cronExpr: '0 8 * * *',
      intervalHours: 6,
      spreadIntervalMinutes: 5,
    });
    selectRowsMock.mockReturnValue([
      {
        accounts: {
          id: 1,
          username: 'done',
          checkinEnabled: true,
          status: 'active',
          lastCheckinAt: new Date(2026, 2, 20, 7, 0, 0, 0).toISOString(),
        },
        sites: { id: 10, name: 'Site A', status: 'active' },
      },
      {
        accounts: {
          id: 2,
          username: 'pending',
          checkinEnabled: true,
          status: 'active',
          lastCheckinAt: null,
        },
        sites: { id: 10, name: 'Site A', status: 'active' },
      },
      {
        accounts: {
          id: 3,
          username: 'account-disabled',
          checkinEnabled: true,
          status: 'disabled',
          lastCheckinAt: null,
        },
        sites: { id: 10, name: 'Site A', status: 'active' },
      },
      {
        accounts: {
          id: 4,
          username: 'checkin-disabled',
          checkinEnabled: false,
          status: 'active',
          lastCheckinAt: null,
        },
        sites: { id: 10, name: 'Site A', status: 'active' },
      },
      {
        accounts: {
          id: 5,
          username: 'site-disabled',
          checkinEnabled: true,
          status: 'active',
          lastCheckinAt: null,
        },
        sites: { id: 11, name: 'Site B', status: 'disabled' },
      },
    ]);

    await expect(scheduler.getSpreadCheckinStatus()).resolves.toEqual(expect.objectContaining({
      mode: 'spread',
      active: false,
      intervalMinutes: 5,
      eligibleCount: 2,
      completedCount: 1,
      pendingCount: 1,
      progressPercent: 50,
    }));
  });
});
