import { ApiTokenInfo, BasePlatformAdapter, CheckinResult, BalanceInfo, CreateApiTokenOptions, type UpdateApiTokenOptions } from './base.js';
import { findUpstreamToken, parseTokenGroupNames, resolveTokenGroupErrorMessage } from './tokenManagement.js';

type CreateApiTokenPayload = {
  name: string;
  unlimited_quota: boolean;
  expired_time: number;
  remain_quota: number;
  allow_ips: string;
  model_limits_enabled: boolean;
  model_limits: string;
  group: string;
};

export class OneApiAdapter extends BasePlatformAdapter {
  readonly platformName: string = 'one-api';
  override readonly apiTokenCapabilities = { create: true, update: true, delete: true };

  private normalizeTokenKeyForCompare(value?: string | null): string {
    const trimmed = (value || '').trim();
    return trimmed.replace(/^Bearer\s+/i, '').replace(/^sk-/i, '');
  }

  private buildDefaultTokenPayload(options?: CreateApiTokenOptions): CreateApiTokenPayload {
    const normalizedName = (options?.name || '').trim() || 'metapi';
    const unlimitedQuota = options?.unlimitedQuota ?? true;
    const remainQuota = Number.isFinite(options?.remainQuota)
      ? Math.max(0, Math.trunc(options?.remainQuota as number))
      : 0;
    const expiredTime = Number.isFinite(options?.expiredTime)
      ? Math.trunc(options?.expiredTime as number)
      : -1;
    return {
      name: normalizedName,
      unlimited_quota: unlimitedQuota,
      expired_time: expiredTime,
      remain_quota: remainQuota,
      allow_ips: (options?.allowIps || '').trim(),
      model_limits_enabled: options?.modelLimitsEnabled ?? false,
      model_limits: (options?.modelLimits || '').trim(),
      group: (options?.group || '').trim(),
    };
  }

  async detect(url: string): Promise<boolean> {
    try {
      const res = await this.fetchJson<any>(`${url}/api/status`);
      return res?.success === true && !res?.data?.system_name;
    } catch {
      return false;
    }
  }

  async checkin(baseUrl: string, accessToken: string, _platformUserId?: number): Promise<CheckinResult> {
    try {
      const res = await this.fetchJson<any>(`${baseUrl}/api/user/checkin`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res?.success) {
        return { success: true, message: res.message || 'Check-in successful', reward: res.data?.reward?.toString() };
      }
      return { success: false, message: res?.message || 'Check-in failed' };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  }

  async getBalance(baseUrl: string, accessToken: string): Promise<BalanceInfo> {
    const res = await this.fetchJson<any>(`${baseUrl}/api/user/self`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = res?.data;
    const quota = (data?.quota || 0) / 500000;
    const used = (data?.used_quota || 0) / 500000;
    const todayIncome = Number.isFinite(data?.today_income) ? (data.today_income / 500000) : undefined;
    const todayQuotaConsumption = Number.isFinite(data?.today_quota_consumption) ? (data.today_quota_consumption / 500000) : undefined;
    return { balance: quota - used, used, quota, todayIncome, todayQuotaConsumption };
  }

  async getModels(baseUrl: string, apiToken: string, _platformUserId?: number): Promise<string[]> {
    const res = await this.fetchJson<any>(`${baseUrl}/v1/models`, {
      headers: { Authorization: `Bearer ${apiToken}` },
    });
    return (res?.data || []).map((m: any) => m.id).filter(Boolean);
  }

  async getApiTokens(baseUrl: string, accessToken: string): Promise<ApiTokenInfo[]> {
    try {
      const res = await this.fetchJson<any>(`${baseUrl}/api/token/?p=0&size=100`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      const items = (() => {
        if (Array.isArray(res?.data)) return res.data;
        if (Array.isArray(res?.data?.items)) return res.data.items;
        if (Array.isArray(res?.data?.data)) return res.data.data;
        if (Array.isArray(res?.items)) return res.items;
        if (Array.isArray(res?.list)) return res.list;
        if (Array.isArray(res?.data?.list)) return res.data.list;
        return [];
      })();

      return items
        .map((item: any, index: number) => {
          const key = typeof item?.key === 'string' ? item.key.trim() : '';
          if (!key) return null;
          const rawName = typeof item?.name === 'string' ? item.name.trim() : '';
          const rawGroup = typeof item?.group === 'string'
            ? item.group.trim()
            : (typeof item?.token_group === 'string' ? item.token_group.trim() : '');
          const status = typeof item?.status === 'number' ? item.status : undefined;
          const tokenInfo: ApiTokenInfo = {
            name: rawName || (index === 0 ? 'default' : `token-${index + 1}`),
            key,
            enabled: status === undefined ? true : status === 1,
          };
          if (rawGroup) tokenInfo.tokenGroup = rawGroup;
          return tokenInfo;
        })
        .filter((item: ApiTokenInfo | null): item is ApiTokenInfo => !!item);
    } catch {
      return [];
    }
  }

  async getApiToken(baseUrl: string, accessToken: string): Promise<string | null> {
    const tokens = await this.getApiTokens(baseUrl, accessToken);
    return tokens.find((token) => token.enabled !== false)?.key || tokens[0]?.key || null;
  }

  async getUserGroups(baseUrl: string, accessToken: string): Promise<string[]> {
    const headers = { Authorization: `Bearer ${accessToken}` };
    let terminalError: string | null = null;
    for (const endpoint of ['/api/user_group_map', '/api/user/self/groups', '/api/user/groups']) {
      try {
        const response = await this.fetchJson<any>(`${baseUrl}${endpoint}`, { headers });
        if (response?.success === false || response?.error) terminalError ||= resolveTokenGroupErrorMessage(response);
        const groups = parseTokenGroupNames(response);
        if (groups.length > 0) return groups;
      } catch (error) {
        if (!(error instanceof Error) || !/HTTP 404\b/.test(error.message)) {
          terminalError ||= resolveTokenGroupErrorMessage(error);
        }
      }
    }
    throw new Error(terminalError || '上游未返回可用分组，请检查账户会话后重试');
  }

  async createApiToken(
    baseUrl: string,
    accessToken: string,
    _platformUserId?: number,
    options?: CreateApiTokenOptions,
  ): Promise<boolean> {
    try {
      const res = await this.fetchJson<any>(`${baseUrl}/api/token/`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(this.buildDefaultTokenPayload(options)),
      });
      return !!res?.success;
    } catch {
      return false;
    }
  }

  async deleteApiToken(
    baseUrl: string,
    accessToken: string,
    tokenKey: string,
  ): Promise<boolean> {
    const targetKey = this.normalizeTokenKeyForCompare(tokenKey);
    if (!targetKey) return false;

    const headers = { Authorization: `Bearer ${accessToken}` };
    let tokenId: number | null = null;
    try {
      const res = await this.fetchJson<any>(`${baseUrl}/api/token/?p=0&size=100`, { headers });
      const items = (() => {
        if (Array.isArray(res?.data)) return res.data;
        if (Array.isArray(res?.data?.items)) return res.data.items;
        if (Array.isArray(res?.items)) return res.items;
        return [];
      })();
      for (const item of items) {
        const key = this.normalizeTokenKeyForCompare(item?.key);
        const id = Number.parseInt(String(item?.id), 10);
        if (key && key === targetKey && Number.isFinite(id)) {
          tokenId = id;
          break;
        }
      }
    } catch {
      return false;
    }

    if (!tokenId) return true;

    try {
      const res = await this.fetchJson<any>(`${baseUrl}/api/token/${tokenId}`, {
        method: 'DELETE',
        headers,
      });
      if (res?.success) return true;
    } catch {}

    try {
      const res = await this.fetchJson<any>(`${baseUrl}/api/token/${tokenId}/`, {
        method: 'DELETE',
        headers,
      });
      return !!res?.success;
    } catch {
      return false;
    }
  }

  override async updateApiToken(
    baseUrl: string,
    accessToken: string,
    token: ApiTokenInfo,
    options: UpdateApiTokenOptions,
    _platformUserId?: number,
  ): Promise<boolean> {
    if (!this.apiTokenCapabilities.update) return false;
    const headers = { Authorization: `Bearer ${accessToken}` };
    const list = await this.fetchJson<any>(`${baseUrl}/api/token/?p=0&size=100`, { headers });
    const items = Array.isArray(list?.data) ? list.data : list?.data?.items || list?.items || [];
    const target = findUpstreamToken(items, token);
    if (!target) return false;
    const detail = await this.fetchJson<any>(`${baseUrl}/api/token/${target.id}`, { headers });
    if (!detail?.success || Number(detail.data?.id) !== Number(target.id)) return false;
    const result = await this.fetchJson<any>(`${baseUrl}/api/token/`, {
      method: 'PUT', headers,
      body: JSON.stringify({ ...detail.data, ...options }),
    });
    return result?.success === true;
  }
}
