import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { classifyFailureReason } from './failureReasonService.js';
import { formatUtcSqlDateTime } from './localTimeService.js';

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  accountId: z.coerce.number().int().positive().optional(),
  status: z.enum(['all', 'success', 'failed', 'skipped']).default('all'),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  paged: z.enum(['0', '1']).optional(),
}).refine((query) => !query.from || !query.to || Date.parse(query.from) < Date.parse(query.to), {
  message: 'Invalid date range',
});

export function parseCheckinLogQuery(input: unknown) {
  return querySchema.safeParse(input);
}

export async function listCheckinLogs(query: z.output<typeof querySchema>) {
  const conditions = [
    query.accountId ? eq(schema.checkinLogs.accountId, query.accountId) : undefined,
    query.from ? gte(schema.checkinLogs.createdAt, formatUtcSqlDateTime(new Date(query.from))) : undefined,
    query.to ? lt(schema.checkinLogs.createdAt, formatUtcSqlDateTime(new Date(query.to))) : undefined,
  ];
  const [rows, counts] = await Promise.all([
    db.select({
      checkin_logs: schema.checkinLogs,
      accounts: { id: schema.accounts.id, username: schema.accounts.username },
      sites: { id: schema.sites.id, name: schema.sites.name, url: schema.sites.url },
    }).from(schema.checkinLogs)
      .innerJoin(schema.accounts, eq(schema.checkinLogs.accountId, schema.accounts.id))
      .innerJoin(schema.sites, eq(schema.accounts.siteId, schema.sites.id))
      .where(and(...conditions, query.status === 'all' ? undefined : eq(schema.checkinLogs.status, query.status)))
      .orderBy(desc(schema.checkinLogs.createdAt), desc(schema.checkinLogs.id))
      .limit(query.limit).offset(query.offset).all(),
    query.paged === '1'
      ? db.select({ status: schema.checkinLogs.status, count: sql<number>`count(*)` })
        .from(schema.checkinLogs).where(and(...conditions)).groupBy(schema.checkinLogs.status).all()
      : Promise.resolve([]),
  ]);
  const logs = rows.map((row) => ({
    ...row,
    failureReason: classifyFailureReason({ message: row.checkin_logs.message, status: row.checkin_logs.status }),
  }));
  if (query.paged !== '1') return logs;
  const totals = { all: 0, success: 0, failed: 0, skipped: 0 };
  for (const row of counts) {
    const count = Number(row.count);
    totals.all += count;
    if (row.status === 'success' || row.status === 'failed' || row.status === 'skipped') totals[row.status] += count;
  }
  return { logs, total: totals[query.status], counts: totals, limit: query.limit, offset: query.offset };
}
