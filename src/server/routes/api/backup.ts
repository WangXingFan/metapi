import { FastifyInstance } from 'fastify';
import { config } from '../../config.js';
import {
  exportBackup,
  exportBackupToWebdav,
  getBackupWebdavConfig,
  importBackup,
  importBackupFromWebdav,
  reloadBackupWebdavScheduler,
  saveBackupWebdavConfig,
  type BackupExportType,
} from '../../services/backupService.js';
import {
  parseBackupImportPayload,
  parseBackupWebdavConfigPayload,
  parseBackupWebdavExportPayload,
} from '../../contracts/settingsRoutePayloads.js';
import { updateCheckinSchedule } from '../../services/checkinScheduler.js';
import { normalizeSiteProxyUrl } from '../../services/siteProxy.js';

function applyImportedSettingToRuntime(key: string, value: unknown) {
  switch (key) {
    case 'checkin_cron': {
      if (typeof value !== 'string' || !value) return;
      config.checkinCron = value;
      updateCheckinSchedule({
        mode: config.checkinScheduleMode,
        cronExpr: config.checkinCron,
        intervalHours: config.checkinIntervalHours,
        spreadIntervalMinutes: config.checkinSpreadIntervalMinutes,
      });
      return;
    }
    case 'checkin_schedule_mode': {
      if (value !== 'cron' && value !== 'interval' && value !== 'spread') return;
      config.checkinScheduleMode = value;
      updateCheckinSchedule({
        mode: config.checkinScheduleMode,
        cronExpr: config.checkinCron,
        intervalHours: config.checkinIntervalHours,
        spreadIntervalMinutes: config.checkinSpreadIntervalMinutes,
      });
      return;
    }
    case 'checkin_interval_hours': {
      const intervalHours = Number(value);
      if (!Number.isFinite(intervalHours) || intervalHours < 1 || intervalHours > 24) return;
      config.checkinIntervalHours = Math.trunc(intervalHours);
      updateCheckinSchedule({
        mode: config.checkinScheduleMode,
        cronExpr: config.checkinCron,
        intervalHours: config.checkinIntervalHours,
        spreadIntervalMinutes: config.checkinSpreadIntervalMinutes,
      });
      return;
    }
    case 'checkin_spread_interval_minutes': {
      const intervalMinutes = Number(value);
      if (!Number.isFinite(intervalMinutes) || intervalMinutes < 1 || intervalMinutes > 240) return;
      config.checkinSpreadIntervalMinutes = Math.trunc(intervalMinutes);
      updateCheckinSchedule({
        mode: config.checkinScheduleMode,
        cronExpr: config.checkinCron,
        intervalHours: config.checkinIntervalHours,
        spreadIntervalMinutes: config.checkinSpreadIntervalMinutes,
      });
      return;
    }
    case 'system_proxy_url': {
      if (typeof value !== 'string') return;
      config.systemProxyUrl = normalizeSiteProxyUrl(value) || '';
      return;
    }
    default:
      return;
  }
}

export async function backupRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { type?: string } }>('/api/settings/backup/export', async (request, reply) => {
    const rawType = String(request.query.type || 'all').trim().toLowerCase();
    const type: BackupExportType = rawType === 'accounts' || rawType === 'preferences' ? rawType : 'all';
    if (rawType && !['all', 'accounts', 'preferences'].includes(rawType)) {
      return reply.code(400).send({ success: false, message: '导出类型无效，仅支持 all/accounts/preferences' });
    }
    return await exportBackup(type);
  });

  app.post<{ Body: unknown }>('/api/settings/backup/import', async (request, reply) => {
    const parsedBody = parseBackupImportPayload(request.body);
    if (!parsedBody.success) {
      return reply.code(400).send({ success: false, message: '导入数据格式错误：需要 JSON 对象' });
    }

    try {
      const result = await importBackup(parsedBody.data.data);
      for (const item of result.appliedSettings) {
        applyImportedSettingToRuntime(item.key, item.value);
      }
      if (result.appliedSettings.some((item) => item.key === 'backup_webdav_config_v1')) {
        await reloadBackupWebdavScheduler();
      }
      return {
        success: true,
        message: '导入完成',
        ...result,
      };
    } catch (err: any) {
      return reply.code(400).send({
        success: false,
        message: err?.message || '导入失败',
      });
    }
  });

  app.get('/api/settings/backup/webdav', async () => {
    return getBackupWebdavConfig();
  });

  app.put<{ Body: unknown }>('/api/settings/backup/webdav', async (request, reply) => {
    try {
      const parsedBody = parseBackupWebdavConfigPayload(request.body);
      if (!parsedBody.success) {
        return reply.code(400).send({
          success: false,
          message: parsedBody.error,
        });
      }

      const body = parsedBody.data;
      const result = await saveBackupWebdavConfig({
        enabled: body.enabled === undefined ? undefined : body.enabled === true,
        fileUrl: body.fileUrl === undefined ? undefined : String(body.fileUrl || ''),
        username: body.username === undefined ? undefined : String(body.username || ''),
        password: body.password === undefined ? undefined : String(body.password),
        clearPassword: body.clearPassword === true,
        exportType: body.exportType === undefined ? undefined : String(body.exportType || '') as BackupExportType,
        autoSyncEnabled: body.autoSyncEnabled === undefined ? undefined : body.autoSyncEnabled === true,
        autoSyncCron: body.autoSyncCron === undefined ? undefined : String(body.autoSyncCron || ''),
      });
      return result;
    } catch (err: any) {
      return reply.code(400).send({
        success: false,
        message: err?.message || 'WebDAV 配置保存失败',
      });
    }
  });

  app.post<{ Body: unknown }>('/api/settings/backup/webdav/export', async (request, reply) => {
    try {
      const parsedBody = parseBackupWebdavExportPayload(request.body);
      if (!parsedBody.success) {
        return reply.code(400).send({
          success: false,
          message: parsedBody.error,
        });
      }

      const rawType = typeof parsedBody.data.type === 'string' ? parsedBody.data.type.trim().toLowerCase() : '';
      const type: BackupExportType | undefined = rawType === 'all' || rawType === 'accounts' || rawType === 'preferences'
        ? rawType
        : undefined;
      return await exportBackupToWebdav(type);
    } catch (err: any) {
      return reply.code(400).send({
        success: false,
        message: err?.message || 'WebDAV 导出失败',
      });
    }
  });

  app.post('/api/settings/backup/webdav/import', async (_, reply) => {
    try {
      const result = await importBackupFromWebdav();
      for (const item of result.appliedSettings) {
        applyImportedSettingToRuntime(item.key, item.value);
      }
      if (result.appliedSettings.some((item) => item.key === 'backup_webdav_config_v1')) {
        await reloadBackupWebdavScheduler();
      }
      return result;
    } catch (err: any) {
      return reply.code(400).send({
        success: false,
        message: err?.message || 'WebDAV 导入失败',
      });
    }
  });
}
