import { FastifyInstance } from 'fastify';
import { config } from '../../config.js';
import { db, schema } from '../../db/index.js';
import { upsertSetting } from '../../db/upsertSetting.js';
import { eq, desc } from 'drizzle-orm';
import { checkinAccount } from '../../services/checkinService.js';
import {
  CHECKIN_SPREAD_START_CRON,
  isSpreadCheckinActive,
  startSpreadCheckinNow,
  updateCheckinSchedule,
} from '../../services/checkinScheduler.js';
import { startBackgroundTask } from '../../services/backgroundTaskService.js';
import { classifyFailureReason } from '../../services/failureReasonService.js';

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

  // Trigger check-in for a specific account
  app.post<{ Params: { id: string } }>('/api/checkin/trigger/:id', async (request) => {
    const id = parseInt(request.params.id, 10);
    const result = await checkinAccount(id, { scheduleMode: config.checkinScheduleMode });
    return result;
  });

  // Get check-in logs
  app.get<{ Querystring: { limit?: string; offset?: string; accountId?: string } }>('/api/checkin/logs', async (request) => {
    const limit = parseInt(request.query.limit || '50', 10);
    const offset = parseInt(request.query.offset || '0', 10);
    let query = db.select().from(schema.checkinLogs)
      .innerJoin(schema.accounts, eq(schema.checkinLogs.accountId, schema.accounts.id))
      .innerJoin(schema.sites, eq(schema.accounts.siteId, schema.sites.id))
      .orderBy(desc(schema.checkinLogs.createdAt))
      .limit(limit)
      .offset(offset);

    if (request.query.accountId) {
      query = query.where(eq(schema.checkinLogs.accountId, parseInt(request.query.accountId, 10))) as any;
    }

    const rows = await query.all();
    return rows.map((row: any) => {
      const source = row?.checkin_logs || row;
      const failureReason = classifyFailureReason({
        message: source?.message,
        status: source?.status,
      });
      return {
        ...row,
        failureReason,
      };
    });
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
