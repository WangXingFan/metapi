import type { ApiTokenInfo } from './base.js';

const GROUP_ENVELOPE_KEYS = new Set(['success', 'message', 'code', 'data', 'error', 'status', 'total', 'page', 'page_size']);

export function parseTokenGroupNames(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return [];
  if (Array.isArray(payload)) {
    return Array.from(new Set(payload.flatMap((item) => {
      if (typeof item === 'string') return item.trim() ? [item.trim()] : [];
      if (!item || typeof item !== 'object') return [];
      const record = item as Record<string, unknown>;
      const name = [record.name, record.group, record.group_name, record.groupName, record.value, record.key]
        .find((value) => typeof value === 'string' && value.trim());
      return typeof name === 'string' ? [name.trim()] : [];
    })));
  }
  const record = payload as Record<string, unknown>;
  if (record.success === false || record.error) return [];
  if (typeof record.code === 'number' && record.code !== 0 && record.code !== 200) return [];
  if (record.data !== undefined) return parseTokenGroupNames(record.data);
  for (const collection of ['groups', 'items', 'list']) {
    if (record[collection] && typeof record[collection] === 'object') return parseTokenGroupNames(record[collection]);
  }
  return Object.keys(record).map((key) => key.trim()).filter((key) => key && !GROUP_ENVELOPE_KEYS.has(key.toLowerCase()));
}

export function resolveTokenGroupErrorMessage(payload: unknown): string {
  const raw = payload instanceof Error ? payload.message
    : payload && typeof payload === 'object' ? (payload as Record<string, unknown>).message : '';
  const message = typeof raw === 'string' ? raw.trim() : '';
  if (/expired|invalid token|access token|unauthorized|forbidden|HTTP (401|403)|未登录|登录|过期/i.test(message)) {
    return '账号会话可能已过期，请重新登录后再拉取分组';
  }
  return message || '上游未返回可用分组，请检查账户会话后重试';
}

function normalizeKey(key: string): string {
  return key.trim().replace(/^Bearer\s+/i, '').replace(/^sk-/i, '').replace(/•/g, '*');
}

export function tokenKeysMatch(left: string, right: string): boolean {
  const a = normalizeKey(left);
  const b = normalizeKey(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const masked = a.includes('*') ? a : b;
  const full = a.includes('*') ? b : a;
  if (!masked.includes('*') || full.includes('*')) return false;
  const prefix = masked.slice(0, masked.indexOf('*'));
  const suffix = masked.slice(masked.lastIndexOf('*') + 1);
  return !!(prefix || suffix) && full.length >= prefix.length + suffix.length
    && full.startsWith(prefix) && full.endsWith(suffix);
}

export function findUpstreamToken(items: any[], token: ApiTokenInfo): any | null {
  const matches = items.filter((item) => (
    typeof item?.key === 'string' && tokenKeysMatch(item.key, token.key)
    && (!/[*•]/.test(item.key + token.key) || item.name === token.name)
    && Number.isInteger(Number(item.id)) && Number(item.id) > 0
  ));
  if (matches.length === 1) return matches[0];
  const sameGroup = matches.filter((item) => (item.group ?? item.token_group ?? '') === (token.tokenGroup ?? ''));
  return sameGroup.length === 1 ? sameGroup[0] : null;
}
