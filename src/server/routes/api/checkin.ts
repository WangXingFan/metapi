import { FastifyInstance } from 'fastify';
import { config } from '../../config.js';
import { upsertSetting } from '../../db/upsertSetting.js';
import { checkinAccount } from '../../services/checkinService.js';
import {
  CHECKIN_SPREAD_START_CRON,
  getSpreadCheckinStatus,
  isSpreadCheckinActive,
  startSpreadCheckinNow,
  stopSpreadCheckinToday,
  updateCheckinSchedule,
} from '../../services/checkinScheduler.js';
import { startBackgroundTask } from '../../services/backgroundTaskService.js';
import { listCheckinLogs, parseCheckinLogQuery } from '../../services/checkinLogService.js';

export async function checkinRoutes(app: FastifyInstance) {
  // Start staggered check-in for eligible accounts.
  app.post('/api/checkin/trigger', async (_, reply) => {
    if (isSpreadCheckinActive()) {
      return reply.code(202).send({
        success: true,
        queued: true,
        reused: true,
        status: 'running',
        message: '错峰签到队列执行中，请稍后查看签到日志',
      });
    }

    const { task, reused } = startBackgroundTask(
      {
        type: 'checkin',
        title: '错峰签到',
        dedupeKey: 'checkin-spread',
        notifyOnFailure: true,
        successTitle: () => '错峰签到已启动',
        failureTitle: () => '错峰签到启动失败',
        successMessage: () => `错峰签到已启动：每 ${config.checkinSpreadIntervalMinutes} 分钟随机签到 1 个账号`,
        failureMessage: (currentTask) => `错峰签到启动失败：${currentTask.error || 'unknown error'}`,
      },
      async () => {
        updateCheckinSchedule({
          mode: 'spread',
          cronExpr: CHECKIN_SPREAD_START_CRON,
          intervalHours: config.checkinIntervalHours,
          spreadIntervalMinutes: config.checkinSpreadIntervalMinutes,
        });
        await upsertSetting('checkin_cron', CHECKIN_SPREAD_START_CRON);
        await upsertSetting('checkin_schedule_mode', 'spread');
        await upsertSetting('checkin_spread_interval_minutes', config.checkinSpreadIntervalMinutes);
        const result = await startSpreadCheckinNow();
        return {
          ...result,
          mode: 'spread',
          cron: CHECKIN_SPREAD_START_CRON,
          spreadIntervalMinutes: config.checkinSpreadIntervalMinutes,
        };
      },
    );

    return reply.code(202).send({
      success: true,
      queued: true,
      reused,
      jobId: task.id,
      status: task.status,
      message: reused
        ? '错峰签到队列执行中，请稍后查看签到日志'
        : `已开始错峰签到，每 ${config.checkinSpreadIntervalMinutes} 分钟随机签到 1 个账号`,
    });
  });

  app.get('/api/checkin/status', async () => getSpreadCheckinStatus());

  app.post('/api/checkin/stop', async () => {
    if (config.checkinScheduleMode !== 'spread' || config.checkinCron !== CHECKIN_SPREAD_START_CRON) {
      updateCheckinSchedule({
        mode: 'spread',
        cronExpr: CHECKIN_SPREAD_START_CRON,
        intervalHours: config.checkinIntervalHours,
        spreadIntervalMinutes: config.checkinSpreadIntervalMinutes,
      });
    }
    stopSpreadCheckinToday();
    await upsertSetting('checkin_cron', CHECKIN_SPREAD_START_CRON);
    await upsertSetting('checkin_schedule_mode', 'spread');
    await upsertSetting('checkin_spread_interval_minutes', config.checkinSpreadIntervalMinutes);
    return {
      success: true,
      status: 'stopped',
      mode: 'spread',
      cron: CHECKIN_SPREAD_START_CRON,
      message: '已停止今天的错峰签到队列，明天 8:00 将继续错峰签到',
    };
  });

  // Trigger check-in for a specific account
  app.post<{ Params: { id: string } }>('/api/checkin/trigger/:id', async (request) => {
    const id = parseInt(request.params.id, 10);
    const result = await checkinAccount(id, { scheduleMode: config.checkinScheduleMode });
    return result;
  });

  app.get('/api/checkin/logs', async (request, reply) => {
    const parsed = parseCheckinLogQuery(request.query);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message || 'Invalid query' });
    reply.header('Cache-Control', 'no-store');
    return listCheckinLogs(parsed.data);
  });

  // Update check-in schedule
  app.put<{ Body: { mode?: 'cron' | 'interval' | 'spread'; cron?: string; intervalHours?: number; spreadIntervalMinutes?: number } }>('/api/checkin/schedule', async (request) => {
    try {
      const body = request.body || {};
      const nextMode: 'cron' | 'interval' | 'spread' =
        body.mode === 'interval' || body.mode === 'spread' ? body.mode : 'cron';
      const nextCron = nextMode === 'spread'
        ? CHECKIN_SPREAD_START_CRON
        : (typeof body.cron === 'string' ? body.cron : undefined);
      const nextIntervalHours = body.intervalHours !== undefined ? Number(body.intervalHours) : undefined;
      const normalizedIntervalHours = typeof nextIntervalHours === 'number' && Number.isFinite(nextIntervalHours)
        ? Math.trunc(nextIntervalHours)
        : undefined;
      const nextSpreadIntervalMinutes = body.spreadIntervalMinutes !== undefined ? Number(body.spreadIntervalMinutes) : undefined;
      const normalizedSpreadIntervalMinutes = typeof nextSpreadIntervalMinutes === 'number' && Number.isFinite(nextSpreadIntervalMinutes)
        ? Math.trunc(nextSpreadIntervalMinutes)
        : undefined;

      updateCheckinSchedule({
        mode: nextMode,
        cronExpr: nextCron,
        intervalHours: normalizedIntervalHours,
        spreadIntervalMinutes: normalizedSpreadIntervalMinutes,
      });

      await upsertSetting('checkin_schedule_mode', nextMode);
      if (nextCron !== undefined) await upsertSetting('checkin_cron', nextCron);
      if (normalizedIntervalHours !== undefined) {
        await upsertSetting('checkin_interval_hours', normalizedIntervalHours);
      }
      if (normalizedSpreadIntervalMinutes !== undefined) {
        await upsertSetting('checkin_spread_interval_minutes', normalizedSpreadIntervalMinutes);
      }
      return {
        success: true,
        mode: nextMode,
        cron: nextCron,
        intervalHours: normalizedIntervalHours,
        spreadIntervalMinutes: normalizedSpreadIntervalMinutes,
      };
    } catch (err: any) {
      return { error: err.message };
    }
  });
}
