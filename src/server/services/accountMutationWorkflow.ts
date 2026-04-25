import { refreshBalance } from './balanceService.js';
import {
  ensureDefaultTokenForAccount,
  syncTokensFromUpstream,
} from './accountTokenService.js';

type ModelRefreshResult = {
  accountId: number;
  refreshed: boolean;
  status: 'skipped';
  reason: string;
};

type DisabledRouteRebuildResult = {
  skipped: true;
  reason: string;
};

const MODEL_DISCOVERY_DISABLED_REASON = 'model discovery is disabled in Lite mode';
const ROUTE_REBUILD_DISABLED_REASON = 'proxy routing is disabled in Lite mode';

type UpstreamTokenLike = {
  name?: string | null;
  key?: string | null;
  enabled?: boolean | null;
  tokenGroup?: string | null;
};

export type CoverageBatchRebuildResult =
  | { success: true; result: DisabledRouteRebuildResult }
  | { success: false; error: string };

export async function rebuildRoutesBestEffort(): Promise<boolean> {
  return false;
}

function buildSkippedModelRefreshResult(accountId: number): ModelRefreshResult {
  return {
    accountId,
    refreshed: false,
    status: 'skipped',
    reason: MODEL_DISCOVERY_DISABLED_REASON,
  };
}

function buildDisabledRouteRebuildResult(): DisabledRouteRebuildResult {
  return {
    skipped: true,
    reason: ROUTE_REBUILD_DISABLED_REASON,
  };
}

export async function convergeAccountMutation(input: {
  accountId: number;
  preferredApiToken?: string | null;
  defaultTokenSource?: string;
  ensurePreferredTokenBeforeSync?: boolean;
  upstreamTokens?: UpstreamTokenLike[];
  refreshBalance?: boolean;
  refreshModels?: boolean;
  allowInactiveModelRefresh?: boolean;
  rebuildRoutes?: boolean;
  continueOnError?: boolean;
}): Promise<{
  defaultTokenId: number | null;
  tokenSync: Awaited<ReturnType<typeof syncTokensFromUpstream>> | null;
  refreshedBalance: boolean;
  refreshedModels: boolean;
  rebuiltRoutes: boolean;
  balanceResult: Awaited<ReturnType<typeof refreshBalance>> | null;
  modelRefreshResult: ModelRefreshResult | null;
  rebuildResult: DisabledRouteRebuildResult | null;
}> {
  const result = {
    defaultTokenId: null as number | null,
    tokenSync: null as Awaited<ReturnType<typeof syncTokensFromUpstream>> | null,
    refreshedBalance: false,
    refreshedModels: false,
    rebuiltRoutes: false,
    balanceResult: null as Awaited<ReturnType<typeof refreshBalance>> | null,
    modelRefreshResult: null as ModelRefreshResult | null,
    rebuildResult: null as DisabledRouteRebuildResult | null,
  };

  const runStep = async <T>(fn: () => Promise<T>): Promise<T | null> => {
    if (!input.continueOnError) return fn();
    try {
      return await fn();
    } catch {
      return null;
    }
  };

  if (input.ensurePreferredTokenBeforeSync && input.preferredApiToken?.trim()) {
    const defaultTokenId = await runStep(() => ensureDefaultTokenForAccount(
      input.accountId,
      input.preferredApiToken!,
      { name: 'default', source: input.defaultTokenSource || 'manual' },
    ));
    if (defaultTokenId != null) {
      result.defaultTokenId = defaultTokenId;
    }
  }

  if ((input.upstreamTokens?.length || 0) > 0) {
    const tokenSync = await runStep(() => syncTokensFromUpstream(input.accountId, input.upstreamTokens!));
    if (tokenSync) {
      result.tokenSync = tokenSync;
      result.defaultTokenId = tokenSync.defaultTokenId ?? result.defaultTokenId;
    }
    if (!input.ensurePreferredTokenBeforeSync && input.preferredApiToken?.trim()) {
      const defaultTokenId = await runStep(() => ensureDefaultTokenForAccount(
        input.accountId,
        input.preferredApiToken!,
        { name: 'default', source: input.defaultTokenSource || 'manual' },
      ));
      if (defaultTokenId != null) {
        result.defaultTokenId = defaultTokenId;
      }
    }
  } else if (!input.ensurePreferredTokenBeforeSync && input.preferredApiToken?.trim()) {
    const defaultTokenId = await runStep(() => ensureDefaultTokenForAccount(
      input.accountId,
      input.preferredApiToken!,
      { name: 'default', source: input.defaultTokenSource || 'manual' },
    ));
    if (defaultTokenId != null) {
      result.defaultTokenId = defaultTokenId;
    }
  }

  if (input.refreshBalance) {
    const balanceResult = await runStep(() => refreshBalance(input.accountId));
    if (balanceResult) {
      result.balanceResult = balanceResult;
      result.refreshedBalance = true;
    }
  }

  if (input.refreshModels) {
    result.modelRefreshResult = buildSkippedModelRefreshResult(input.accountId);
  }

  if (input.rebuildRoutes) {
    result.rebuildResult = buildDisabledRouteRebuildResult();
  }

  return result;
}

export async function refreshAccountCoverageBatch<TFailure>(input: {
  accountIds: number[];
  batchSize: number;
  mapFailure: (accountId: number, errorMessage: string) => TFailure;
}): Promise<{
  refresh: Array<ModelRefreshResult | TFailure>;
  rebuild: CoverageBatchRebuildResult | null;
}> {
  if (!Number.isInteger(input.batchSize) || input.batchSize <= 0) {
    throw new Error('batchSize must be a positive integer');
  }

  const uniqueAccountIds = Array.from(new Set(
    input.accountIds.filter((id) => Number.isFinite(id) && id > 0),
  ));

  if (uniqueAccountIds.length === 0) {
    return { refresh: [], rebuild: null };
  }

  return {
    refresh: uniqueAccountIds.map((accountId) => buildSkippedModelRefreshResult(accountId)),
    rebuild: {
      success: true,
      result: buildDisabledRouteRebuildResult(),
    },
  };
}
