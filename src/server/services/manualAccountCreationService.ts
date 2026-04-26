import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { insertAndGetById } from '../db/insertHelpers.js';
import { startBackgroundTask } from './backgroundTaskService.js';
import { getAdapter } from './platforms/index.js';
import {
  guessPlatformUserIdFromUsername,
  mergeAccountExtraConfig,
  type AccountCredentialMode,
} from './accountExtraConfig.js';
import { type AccountCreatePayload } from '../contracts/accountsRoutePayloads.js';
import { convergeAccountMutation } from './accountMutationWorkflow.js';
import { runWithSiteApiEndpointPool } from './siteApiEndpointService.js';

const ACCOUNT_VERIFY_TIMEOUT_MS = 10_000;

type AccountInitializationParams = {
  accountId: number;
  site: typeof schema.sites.$inferSelect;
  adapter: NonNullable<ReturnType<typeof getAdapter>>;
  tokenType: 'session' | 'apikey' | 'unknown';
  accessToken: string;
  apiToken: string;
  platformUserId?: number;
};

export type CreateManualAccountParams = {
  body: AccountCreatePayload;
  site: typeof schema.sites.$inferSelect;
  adapter: NonNullable<ReturnType<typeof getAdapter>>;
  credentialMode: AccountCredentialMode;
  rawAccessToken: string;
  usernameOverride?: string;
};

export type CreateManualAccountResult = {
  account: typeof schema.accounts.$inferSelect;
  tokenType: 'session' | 'apikey' | 'unknown';
  modelCount: number;
  apiTokenFound: boolean;
  usernameDetected: boolean;
  queued: boolean;
  jobId?: string;
  message?: string;
};

async function withTimeout<T>(fn: () => Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      fn(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function buildAccountVerifyTimeoutMessage(): string {
  return `Token verification timed out (${Math.max(1, Math.round(ACCOUNT_VERIFY_TIMEOUT_MS / 1000))}s)`;
}

async function getNextAccountSortOrder(): Promise<number> {
  const rows = await db.select({ sortOrder: schema.accounts.sortOrder }).from(schema.accounts).all();
  const max = rows.reduce((currentMax, row) => Math.max(currentMax, row.sortOrder || 0), -1);
  return max + 1;
}

async function initializeAccountInBackground({
  accountId,
  site,
  adapter,
  tokenType,
  accessToken,
  apiToken,
  platformUserId,
}: AccountInitializationParams) {
  const summary = {
    accountId,
    syncedTokenCount: 0,
    refreshedBalance: false,
    refreshedModels: false,
    rebuiltRoutes: false,
  };

  let fetchedUpstreamTokens: Array<{ name?: string | null; key?: string | null; enabled?: boolean | null; tokenGroup?: string | null }> = [];
  if (tokenType === 'session' && accessToken) {
    try {
      const syncedTokens = await adapter.getApiTokens(site.url, accessToken, platformUserId);
      summary.syncedTokenCount = Array.isArray(syncedTokens) ? syncedTokens.length : 0;
      fetchedUpstreamTokens = Array.isArray(syncedTokens) ? syncedTokens : [];
    } catch {}
  }

  const convergence = await convergeAccountMutation({
    accountId,
    preferredApiToken: tokenType === 'session' ? apiToken : null,
    defaultTokenSource: 'manual',
    ensurePreferredTokenBeforeSync: tokenType === 'session',
    upstreamTokens: fetchedUpstreamTokens,
    refreshBalance: tokenType === 'session',
    refreshModels: false,
    rebuildRoutes: false,
    continueOnError: true,
  });
  summary.refreshedBalance = convergence.refreshedBalance;

  return summary;
}

function buildQueuedAccountInitializationMessage(tokenType: 'session' | 'apikey' | 'unknown') {
  if (tokenType === 'session') {
    return '账号已添加，后台正在同步令牌和余额信息。';
  }
  return '已添加为 API Key 账号。';
}

export async function createManualAccount({
  body,
  site,
  adapter,
  credentialMode,
  rawAccessToken,
  usernameOverride,
}: CreateManualAccountParams): Promise<CreateManualAccountResult> {
  let username = typeof usernameOverride === 'string'
    ? usernameOverride.trim()
    : (body.username || '').trim();
  let accessToken = rawAccessToken;
  let apiToken = (body.apiToken || '').trim();
  let tokenType: 'session' | 'apikey' | 'unknown' = 'unknown';
  let verifiedModels: string[] = [];

  if (credentialMode === 'apikey') {
    const timeoutMessage = buildAccountVerifyTimeoutMessage();
    const deadline = Date.now() + ACCOUNT_VERIFY_TIMEOUT_MS;
    const models = await runWithSiteApiEndpointPool(site, (target) => {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        throw new Error(timeoutMessage);
      }
      return withTimeout(
        () => adapter.getModels(target.baseUrl, rawAccessToken, body.platformUserId),
        remainingMs,
        timeoutMessage,
      );
    });
    verifiedModels = Array.isArray(models)
      ? models.filter((item) => typeof item === 'string' && item.trim().length > 0)
      : [];
    if (verifiedModels.length === 0) {
      const error = new Error('API Key 验证失败：未获取到可用模型，请确认站点和凭据匹配');
      (error as Error & { requiresVerification?: boolean }).requiresVerification = true;
      throw error;
    }

    tokenType = 'apikey';
    accessToken = '';
    if (!apiToken) apiToken = rawAccessToken;
  } else {
    const verifyResult = await withTimeout(
      () => adapter.verifyToken(site.url, rawAccessToken, body.platformUserId),
      ACCOUNT_VERIFY_TIMEOUT_MS,
      buildAccountVerifyTimeoutMessage(),
    );
    tokenType = verifyResult.tokenType;
    if (tokenType === 'unknown') {
      const error = new Error('Token 验证失败，请确认站点和凭据匹配');
      (error as Error & { requiresVerification?: boolean }).requiresVerification = true;
      throw error;
    }

    if (credentialMode === 'session' && tokenType !== 'session') {
      throw new Error('当前凭证是 API Key，请切换到 API Key 模式，或改用 Session Token');
    }

    if (tokenType === 'session') {
      if (!username && verifyResult.userInfo?.username) username = String(verifyResult.userInfo.username).trim();
      if (!apiToken && verifyResult.apiToken) apiToken = String(verifyResult.apiToken).trim();
    } else if (tokenType === 'apikey') {
      accessToken = '';
      if (!apiToken) apiToken = rawAccessToken;
      verifiedModels = Array.isArray(verifyResult.models)
        ? verifyResult.models.filter((item: unknown) => typeof item === 'string' && item.trim().length > 0)
        : [];
    }
  }

  const resolvedPlatformUserId =
    body.platformUserId || guessPlatformUserIdFromUsername(username) || undefined;
  const resolvedCredentialMode: AccountCredentialMode = tokenType === 'apikey' ? 'apikey' : 'session';
  const extraConfigPatch: Record<string, unknown> = { credentialMode: resolvedCredentialMode };
  if (resolvedPlatformUserId) {
    extraConfigPatch.platformUserId = resolvedPlatformUserId;
  }
  if ((site.platform || '').toLowerCase() === 'sub2api') {
    const managedRefreshToken = typeof body.refreshToken === 'string' ? body.refreshToken.trim() : '';
    const managedTokenExpiresAt = typeof body.tokenExpiresAt === 'number'
      ? Math.trunc(body.tokenExpiresAt)
      : (typeof body.tokenExpiresAt === 'string' ? Number.parseInt(body.tokenExpiresAt.trim(), 10) : undefined);
    if (managedRefreshToken) {
      extraConfigPatch.sub2apiAuth = managedTokenExpiresAt && Number.isFinite(managedTokenExpiresAt) && managedTokenExpiresAt > 0
        ? { refreshToken: managedRefreshToken, tokenExpiresAt: managedTokenExpiresAt }
        : { refreshToken: managedRefreshToken };
    }
  }
  const extraConfig = mergeAccountExtraConfig(undefined, extraConfigPatch);

  const result = await insertAndGetById<typeof schema.accounts.$inferSelect>({
    table: schema.accounts,
    idColumn: schema.accounts.id,
    values: {
      siteId: body.siteId,
      username: username || undefined,
      accessToken,
      apiToken: apiToken || undefined,
      checkinEnabled: tokenType === 'session' ? (body.checkinEnabled ?? true) : false,
      extraConfig,
      isPinned: false,
      sortOrder: await getNextAccountSortOrder(),
    },
    insertErrorMessage: '创建账号失败',
    loadErrorMessage: '创建账号失败',
  });

  const shouldQueueInitialization = tokenType === 'session';
  let queuedTaskId: string | undefined;
  let queuedMessage: string | undefined;
  if (shouldQueueInitialization) {
    const taskTitle = `初始化连接 #${result.id}`;
    const { task } = startBackgroundTask(
      {
        type: 'account-init',
        title: taskTitle,
        dedupeKey: `account-init-${result.id}`,
        notifyOnFailure: true,
        successMessage: () => `${taskTitle}已完成`,
        failureMessage: (currentTask) => `${taskTitle}失败：${currentTask.error || 'unknown error'}`,
      },
      async () => initializeAccountInBackground({
        accountId: result.id,
        site,
        adapter,
        tokenType,
        accessToken,
        apiToken,
        platformUserId: resolvedPlatformUserId,
      }),
    );
    queuedTaskId = task.id;
    queuedMessage = buildQueuedAccountInitializationMessage(tokenType);
  }

  const account = await db.select().from(schema.accounts).where(eq(schema.accounts.id, result.id)).get();
  if (!account) {
    throw new Error('创建账号失败');
  }

  return {
    account,
    tokenType,
    modelCount: verifiedModels.length,
    apiTokenFound: !!apiToken,
    usernameDetected: !!(!body.username && username),
    queued: !!queuedTaskId,
    jobId: queuedTaskId,
    message: queuedMessage,
  };
}
