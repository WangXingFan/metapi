import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { AccountTokenUpdatePayload } from '../contracts/accountTokensRoutePayloads.js';
import {
  ACCOUNT_TOKEN_VALUE_STATUS_MASKED_PENDING,
  ACCOUNT_TOKEN_VALUE_STATUS_READY,
  isMaskedTokenValue,
  isUsableAccountToken,
  repairDefaultToken,
  resolveAccountTokenValueStatus,
  setDefaultToken,
} from './accountTokenService.js';
import { getCredentialModeFromExtraConfig, getProxyUrlFromExtraConfig, resolvePlatformUserId } from './accountExtraConfig.js';
import { getAdapter } from './platforms/index.js';
import { withAccountProxyOverride } from './siteProxy.js';

type MutationResult =
  | { success: true; token: typeof schema.accountTokens.$inferSelect }
  | { success: false; statusCode: number; message: string };

export async function updateAccountToken(tokenId: number, body: AccountTokenUpdatePayload): Promise<MutationResult> {
  const fail = (statusCode: number, message: string): MutationResult => ({ success: false, statusCode, message });
  const existing = await db.select().from(schema.accountTokens).where(eq(schema.accountTokens.id, tokenId)).get();
  if (!existing) return fail(404, '令牌不存在');
  const owner = await db.select().from(schema.accounts).where(eq(schema.accounts.id, existing.accountId)).get();
  if (!owner) return fail(404, '账号不存在');
  const mode = getCredentialModeFromExtraConfig(owner.extraConfig);
  if (mode === 'apikey' || ((!mode || mode === 'auto') && !owner.accessToken?.trim())) {
    return fail(400, 'API Key 连接不支持管理账号令牌');
  }

  const updates: Partial<typeof schema.accountTokens.$inferInsert> = { updatedAt: new Date().toISOString() };
  let nextValueStatus = resolveAccountTokenValueStatus(existing);
  if (body.name !== undefined) updates.name = body.name.trim() || existing.name;
  if (body.group !== undefined) updates.tokenGroup = body.group.trim() || null;
  if (body.token !== undefined) {
    const tokenValue = body.token.trim();
    if (!tokenValue) return fail(400, '令牌不能为空');
    updates.token = tokenValue;
    nextValueStatus = isMaskedTokenValue(tokenValue)
      ? ACCOUNT_TOKEN_VALUE_STATUS_MASKED_PENDING : ACCOUNT_TOKEN_VALUE_STATUS_READY;
    updates.valueStatus = nextValueStatus;
  }
  if (nextValueStatus === ACCOUNT_TOKEN_VALUE_STATUS_MASKED_PENDING) {
    updates.enabled = false;
    updates.isDefault = false;
  } else {
    if (body.enabled !== undefined) updates.enabled = body.enabled;
    if (body.isDefault !== undefined) updates.isDefault = body.isDefault;
  }
  if (body.source !== undefined) updates.source = body.source;

  if (body.syncUpstream && (updates.name !== undefined || updates.tokenGroup !== undefined)) {
    const site = await db.select().from(schema.sites).where(eq(schema.sites.id, owner.siteId)).get();
    if (!site) return fail(404, '站点不存在');
    if (site.status === 'disabled') return fail(400, '站点已禁用，无法修改上游令牌');
    if (!owner.accessToken?.trim()) return fail(400, '账号缺少访问令牌，无法修改上游令牌');
    const adapter = getAdapter(site.platform);
    if (!adapter?.apiTokenCapabilities?.update) return fail(400, '该平台暂不支持修改上游令牌，请在上游修改后同步');
    try {
      const updated = await withAccountProxyOverride(getProxyUrlFromExtraConfig(owner.extraConfig), () => (
        adapter.updateApiToken(site.url, owner.accessToken, {
          name: existing.name, key: existing.token, tokenGroup: existing.tokenGroup,
        }, {
          ...(updates.name !== undefined ? { name: updates.name } : {}),
          ...(updates.tokenGroup !== undefined ? { group: updates.tokenGroup || '' } : {}),
        }, resolvePlatformUserId(owner.extraConfig, owner.username))
      ));
      if (!updated) return fail(502, '上游修改 Key 失败，本地未修改');
    } catch (error: any) {
      return fail(502, `上游修改 Key 失败，本地未修改：${error?.message || '请求失败'}`);
    }
  }

  await db.update(schema.accountTokens).set(updates).where(eq(schema.accountTokens.id, tokenId)).run();
  let latest = await db.select().from(schema.accountTokens).where(eq(schema.accountTokens.id, tokenId)).get();
  if (!latest) return fail(500, '更新失败');
  if ((body.isDefault === true || latest.isDefault) && isUsableAccountToken(latest)) {
    await setDefaultToken(tokenId);
  } else if (existing.isDefault && (!isUsableAccountToken(latest) || body.isDefault === false)) {
    await repairDefaultToken(existing.accountId);
  }
  latest = await db.select().from(schema.accountTokens).where(eq(schema.accountTokens.id, tokenId)).get();
  return latest ? { success: true, token: latest } : fail(500, '更新失败');
}
