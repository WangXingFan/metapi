import { beforeEach, describe, expect, it, vi } from 'vitest';

const ensureDefaultTokenForAccountMock = vi.fn();
const syncTokensFromUpstreamMock = vi.fn();
const refreshBalanceMock = vi.fn();

vi.mock('./accountTokenService.js', () => ({
  ensureDefaultTokenForAccount: (...args: unknown[]) => ensureDefaultTokenForAccountMock(...args),
  syncTokensFromUpstream: (...args: unknown[]) => syncTokensFromUpstreamMock(...args),
}));

vi.mock('./balanceService.js', () => ({
  refreshBalance: (...args: unknown[]) => refreshBalanceMock(...args),
}));

describe('accountMutationWorkflow', () => {
  beforeEach(() => {
    ensureDefaultTokenForAccountMock.mockReset();
    syncTokensFromUpstreamMock.mockReset();
    refreshBalanceMock.mockReset();
  });

  it('can ensure a preferred token before syncing upstream tokens without model or route work', async () => {
    ensureDefaultTokenForAccountMock.mockResolvedValue(10);
    syncTokensFromUpstreamMock.mockResolvedValue({ total: 2, created: 1, updated: 1 });
    refreshBalanceMock.mockResolvedValue({ balance: 1 });

    const { convergeAccountMutation } = await import('./accountMutationWorkflow.js');
    const upstreamTokens = [{ name: 'default', key: 'sk-upstream', enabled: true }];
    const result = await convergeAccountMutation({
      accountId: 1,
      preferredApiToken: 'sk-preferred',
      defaultTokenSource: 'manual',
      ensurePreferredTokenBeforeSync: true,
      upstreamTokens,
      refreshBalance: true,
      refreshModels: true,
      rebuildRoutes: true,
    });

    expect(ensureDefaultTokenForAccountMock).toHaveBeenCalledWith(1, 'sk-preferred', {
      name: 'default',
      source: 'manual',
    });
    expect(syncTokensFromUpstreamMock).toHaveBeenCalledWith(1, upstreamTokens);
    expect(refreshBalanceMock).toHaveBeenCalledWith(1);
    expect(ensureDefaultTokenForAccountMock.mock.invocationCallOrder[0]).toBeLessThan(
      syncTokensFromUpstreamMock.mock.invocationCallOrder[0]!,
    );
    expect(result.defaultTokenId).toBe(10);
    expect(result.tokenSync).toEqual({ total: 2, created: 1, updated: 1 });
    expect(result.refreshedBalance).toBe(true);
    expect(result.refreshedModels).toBe(false);
    expect(result.rebuiltRoutes).toBe(false);
    expect(result.modelRefreshResult).toEqual({
      accountId: 1,
      refreshed: false,
      status: 'skipped',
      reason: 'model discovery is disabled in Lite mode',
    });
    expect(result.rebuildResult).toEqual({
      skipped: true,
      reason: 'proxy routing is disabled in Lite mode',
    });
  });

  it('falls back to ensuring the preferred token when upstream tokens are absent', async () => {
    ensureDefaultTokenForAccountMock.mockResolvedValue(22);

    const { convergeAccountMutation } = await import('./accountMutationWorkflow.js');
    const result = await convergeAccountMutation({
      accountId: 2,
      preferredApiToken: 'sk-fallback',
      defaultTokenSource: 'sync',
    });

    expect(syncTokensFromUpstreamMock).not.toHaveBeenCalled();
    expect(ensureDefaultTokenForAccountMock).toHaveBeenCalledWith(2, 'sk-fallback', {
      name: 'default',
      source: 'sync',
    });
    expect(result.defaultTokenId).toBe(22);
    expect(result.tokenSync).toBeNull();
  });

  it('continues through later token steps when continueOnError is enabled', async () => {
    refreshBalanceMock.mockRejectedValue(new Error('balance failed'));

    const { convergeAccountMutation } = await import('./accountMutationWorkflow.js');
    const result = await convergeAccountMutation({
      accountId: 3,
      refreshBalance: true,
      refreshModels: true,
      rebuildRoutes: true,
      continueOnError: true,
    });

    expect(result.refreshedBalance).toBe(false);
    expect(result.refreshedModels).toBe(false);
    expect(result.rebuiltRoutes).toBe(false);
    expect(result.modelRefreshResult).toEqual({
      accountId: 3,
      refreshed: false,
      status: 'skipped',
      reason: 'model discovery is disabled in Lite mode',
    });
    expect(result.rebuildResult).toEqual({
      skipped: true,
      reason: 'proxy routing is disabled in Lite mode',
    });
  });

  it('reports requested model refresh as skipped in Lite mode', async () => {
    const { convergeAccountMutation } = await import('./accountMutationWorkflow.js');
    const result = await convergeAccountMutation({
      accountId: 4,
      refreshModels: true,
    });

    expect(result.modelRefreshResult).toEqual({
      accountId: 4,
      refreshed: false,
      status: 'skipped',
      reason: 'model discovery is disabled in Lite mode',
    });
    expect(result.refreshedModels).toBe(false);
  });

  it('ignores allowInactive model refresh requests in Lite mode', async () => {
    const { convergeAccountMutation } = await import('./accountMutationWorkflow.js');
    const result = await convergeAccountMutation({
      accountId: 5,
      refreshModels: true,
      allowInactiveModelRefresh: true,
    });

    expect(result.modelRefreshResult).toEqual({
      accountId: 5,
      refreshed: false,
      status: 'skipped',
      reason: 'model discovery is disabled in Lite mode',
    });
  });

  it('skips model coverage refresh and route rebuild in Lite mode', async () => {
    const { refreshAccountCoverageBatch } = await import('./accountMutationWorkflow.js');
    const result = await refreshAccountCoverageBatch({
      accountIds: [1, 2],
      batchSize: 1,
      mapFailure: (accountId, errorMessage) => ({ accountId, errorMessage }),
    });

    expect(result.refresh).toEqual([
      { accountId: 1, refreshed: false, status: 'skipped', reason: 'model discovery is disabled in Lite mode' },
      { accountId: 2, refreshed: false, status: 'skipped', reason: 'model discovery is disabled in Lite mode' },
    ]);
    expect(result.rebuild).toEqual({
      success: true,
      result: { skipped: true, reason: 'proxy routing is disabled in Lite mode' },
    });
  });

  it('rejects invalid batch sizes before returning Lite-mode skips', async () => {
    const { refreshAccountCoverageBatch } = await import('./accountMutationWorkflow.js');

    await expect(refreshAccountCoverageBatch({
      accountIds: [1, 2],
      batchSize: 1.5,
      mapFailure: (accountId, errorMessage) => ({ accountId, errorMessage }),
    })).rejects.toThrow('batchSize must be a positive integer');
  });

  it('exposes a disabled best-effort route rebuild helper for controller callers', async () => {
    const { rebuildRoutesBestEffort } = await import('./accountMutationWorkflow.js');
    await expect(rebuildRoutesBestEffort()).resolves.toBe(false);
  });
});
