import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { getCredentialModeFromExtraConfig, hasOauthProvider, mergeAccountExtraConfig, resolvePlatformUserId, resolveProxyUrlFromExtraConfig } from './accountExtraConfig.js';
import { withAccountProxyOverride, withSiteProxyRequestInit } from './siteProxy.js';

const USAGE_WINDOW_HOURS = 24;
const USAGE_SNAPSHOT_FRESH_MS = 6 * 60 * 60_000;
const USAGE_REQUEST_TIMEOUT_MS = 8_000;
const LOG_PAGE_SIZE = 100;
const LOG_MAX_PAGES = 20;
const USAGE_LOG_PLATFORMS = new Set(['new-api', 'anyrouter', 'one-api', 'one-hub', 'done-hub', 'veloera']);

export type Usage24hSnapshot = {
  spend: number;
  startAt: string;
  endAt: string;
  fetchedAt: string;
};

export type AccountUsage24hResult = {
  supported: boolean;
  spend: number | null;
  startAt: string | null;
  endAt: string | null;
  fetchedAt: string | null;
  cached?: boolean;
  reason?: string;
};

function parseRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function parseNonNegativeNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

function parseIsoDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function resolveQuotaConversionFactor(platform?: string | null): number {
  return (platform || '').trim().toLowerCase() === 'veloera' ? 1_000_000 : 500_000;
}

function extractLogItems(payload: any): unknown[] | null {
  if (Array.isArray(payload?.data?.items)) return payload.data.items;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data)) return payload.data;
  return null;
}

function extractLogTotal(payload: any): number | null {
  const candidates = [payload?.data?.total, payload?.total];
  for (const value of candidates) {
    const parsed = parseNonNegativeNumber(value);
    if (parsed !== null) return Math.trunc(parsed);
  }
  return null;
}

function resolveLogItemSpend(item: unknown, conversionFactor: number): number {
  const record = parseRecord(item);
  const quota = parseNonNegativeNumber(record.quota);
  const cost = parseNonNegativeNumber(record.cost_usd ?? record.costUsd);
  if (cost !== null && cost > 0) return cost;
  if (quota !== null) return quota / conversionFactor;
  return cost ?? 0;
}

function normalizeUsageSnapshot(raw: unknown): Usage24hSnapshot | null {
  const record = parseRecord(raw);
  const spend = parseNonNegativeNumber(record.spend);
  const startAt = parseIsoDate(record.startAt);
  const endAt = parseIsoDate(record.endAt);
  const fetchedAt = parseIsoDate(record.fetchedAt);
  if (spend === null || !startAt || !endAt || !fetchedAt) return null;
  return { spend: round6(spend), startAt, endAt, fetchedAt };
}

export function supportsUpstreamUsageLogs(platform?: string | null): boolean {
  return USAGE_LOG_PLATFORMS.has((platform || '').trim().toLowerCase());
}

export function getStoredUsage24hSnapshot(
  extraConfig?: string | Record<string, unknown> | null,
): Usage24hSnapshot | null {
  if (!extraConfig) return null;
  let parsed: unknown = extraConfig;
  if (typeof extraConfig === 'string') {
    try {
      parsed = JSON.parse(extraConfig);
    } catch {
      return null;
    }
  }
  return normalizeUsageSnapshot(parseRecord(parsed).usage24hSnapshot);
}

export function isUsage24hSnapshotFresh(
  snapshot: Usage24hSnapshot | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (!snapshot) return false;
  const fetchedAtMs = Date.parse(snapshot.fetchedAt);
  return Number.isFinite(fetchedAtMs) && nowMs - fetchedAtMs <= USAGE_SNAPSHOT_FRESH_MS;
}

async function fetchJson(url: string, headers: Record<string, string>): Promise<any | null> {
  const { fetch } = await import('undici');
  const response = await fetch(url, await withSiteProxyRequestInit(url, {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(USAGE_REQUEST_TIMEOUT_MS),
  }));
  if (!response.ok) return null;
  return response.json().catch(() => null);
}

export async function fetchUpstreamUsage24hSpend(params: {
  baseUrl: string;
  accessToken: string;
  platform?: string | null;
  platformUserId?: number;
  now?: Date;
}): Promise<{ spend: number; startAt: string; endAt: string } | null> {
  const baseUrl = params.baseUrl.trim();
  const accessToken = params.accessToken.trim();
  if (!baseUrl || !accessToken) return null;

  const now = params.now || new Date();
  const endMs = now.getTime();
  const startMs = endMs - USAGE_WINDOW_HOURS * 60 * 60_000;
  const startAt = new Date(startMs).toISOString();
  const endAt = new Date(endMs).toISOString();
  const startTimestamp = Math.floor(startMs / 1000);
  const endTimestamp = Math.floor(endMs / 1000);
  const conversionFactor = resolveQuotaConversionFactor(params.platform);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
  if (typeof params.platformUserId === 'number' && Number.isFinite(params.platformUserId)) {
    const userId = String(Math.trunc(params.platformUserId));
    headers['New-Api-User'] = userId;
    headers['Veloera-User'] = userId;
    headers['User-id'] = userId;
  }

  const statQuery = new URLSearchParams({
    type: '2',
    start_timestamp: String(startTimestamp),
    end_timestamp: String(endTimestamp),
    token_name: '',
    model_name: '',
    group: '',
  });

  try {
    const statPayload = await fetchJson(`${baseUrl}/api/log/self/stat?${statQuery.toString()}`, headers);
    if (statPayload?.success !== false) {
      const data = parseRecord(statPayload?.data);
      const quota = parseNonNegativeNumber(data.quota);
      const cost = parseNonNegativeNumber(data.cost_usd ?? data.costUsd);
      if (cost !== null && cost > 0) return { spend: round6(cost), startAt, endAt };
      if (quota !== null) return { spend: round6(quota / conversionFactor), startAt, endAt };
      if (cost !== null) return { spend: 0, startAt, endAt };
    }
  } catch {}

  let hasAnyLogResponse = false;
  let totalSpend = 0;
  let page = 1;
  while (page <= LOG_MAX_PAGES) {
    const query = new URLSearchParams({
      p: String(page),
      page_size: String(LOG_PAGE_SIZE),
      type: '2',
      start_timestamp: String(startTimestamp),
      end_timestamp: String(endTimestamp),
      token_name: '',
      model_name: '',
      group: '',
    });

    try {
      const payload = await fetchJson(`${baseUrl}/api/log/self?${query.toString()}`, headers);
      if (!payload || payload.success === false) break;
      const items = extractLogItems(payload);
      if (!items) break;
      hasAnyLogResponse = true;
      for (const item of items) totalSpend += resolveLogItemSpend(item, conversionFactor);

      const total = extractLogTotal(payload);
      if (items.length === 0) break;
      if (total !== null && page * LOG_PAGE_SIZE >= total) break;
      if (items.length < LOG_PAGE_SIZE) break;
      page += 1;
    } catch {
      break;
    }
  }

  return hasAnyLogResponse
    ? { spend: round6(totalSpend), startAt, endAt }
    : null;
}

export async function getAccountUsage24h(
  accountId: number,
  options: { forceRefresh?: boolean; now?: Date } = {},
): Promise<AccountUsage24hResult | null> {
  const row = await db
    .select()
    .from(schema.accounts)
    .innerJoin(schema.sites, eq(schema.accounts.siteId, schema.sites.id))
    .where(eq(schema.accounts.id, accountId))
    .get();
  if (!row) return null;

  const account = row.accounts;
  const site = row.sites;
  if (!supportsUpstreamUsageLogs(site.platform)) {
    return {
      supported: false,
      spend: null,
      startAt: null,
      endAt: null,
      fetchedAt: null,
      reason: 'platform_not_supported',
    };
  }
  const credentialMode = getCredentialModeFromExtraConfig(account.extraConfig);
  if (hasOauthProvider(account) || credentialMode === 'apikey' || !account.accessToken?.trim()) {
    return {
      supported: false,
      spend: null,
      startAt: null,
      endAt: null,
      fetchedAt: null,
      reason: 'session_required',
    };
  }

  const cached = getStoredUsage24hSnapshot(account.extraConfig);
  if (!options.forceRefresh && isUsage24hSnapshotFresh(cached, (options.now || new Date()).getTime())) {
    return {
      supported: true,
      ...cached!,
      cached: true,
    };
  }

  const platformUserId = resolvePlatformUserId(account.extraConfig, account.username);
  const summary = await withAccountProxyOverride(
    resolveProxyUrlFromExtraConfig(account.extraConfig),
    () => fetchUpstreamUsage24hSpend({
      baseUrl: site.url,
      accessToken: account.accessToken!,
      platform: site.platform,
      platformUserId,
      now: options.now,
    }),
  ).catch(() => null);

  if (!summary) {
    return {
      supported: true,
      spend: null,
      startAt: null,
      endAt: null,
      fetchedAt: null,
      reason: 'upstream_unavailable',
    };
  }

  const fetchedAt = (options.now || new Date()).toISOString();
  const snapshot: Usage24hSnapshot = { ...summary, fetchedAt };
  await db.update(schema.accounts)
    .set({
      extraConfig: mergeAccountExtraConfig(account.extraConfig, {
        usage24hSnapshot: snapshot,
      }),
    })
    .where(eq(schema.accounts.id, account.id))
    .run();

  return {
    supported: true,
    ...snapshot,
    cached: false,
  };
}
