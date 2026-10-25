import type { ApiTokenInfo } from './base.js';

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
