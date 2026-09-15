import {
  BasePlatformAdapter,
  type BalanceInfo,
  type CheckinResult,
  type UserInfo,
} from './base.js';
import { detectPlatformByUrlHint } from '../../../shared/platformIdentity.js';
import { stripTrailingSlashes } from '../urlNormalization.js';

type FlowRealmResponse = {
  ok?: boolean;
  authenticated?: boolean;
  token?: string;
  message?: string;
  detail?: { code?: string; error?: string } | string;
};

type ProfileResponse = FlowRealmResponse & {
  user?: { email?: string; name?: string; quota?: number; quota_used?: number };
};

type CheckinResponse = FlowRealmResponse & {
  checked_in?: boolean;
  created?: boolean;
  granted_amount?: number;
};

function responseError(response: FlowRealmResponse, fallback: string): string {
  if (typeof response.detail === 'object' && response.detail?.code === 'authentication_required') {
    return 'HTTP 401: 未登录或登录已过期';
  }
  return (typeof response.detail === 'string' ? response.detail : response.detail?.error)
    || response.message || fallback;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function quotaValue(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`FlowRealm 返回无效的 ${field}`);
  }
  return value;
}

export class FlowRealmAdapter extends BasePlatformAdapter {
  readonly platformName = 'flowrealm';

  async detect(url: string): Promise<boolean> {
    if (detectPlatformByUrlHint(url) === this.platformName) return true;
    try {
      const display = await this.fetchJson<{ project_name?: string }>(
        `${stripTrailingSlashes(url)}/public/display`,
        { signal: AbortSignal.timeout(5_000) },
      );
      return typeof display.project_name === 'string'
        && /flowrealm|流光绘境/i.test(display.project_name);
    } catch {
      return false;
    }
  }

  override async login(baseUrl: string, username: string, password: string) {
    try {
      const response = await this.fetchJson<FlowRealmResponse>(`${stripTrailingSlashes(baseUrl)}/auth/login`, {
        method: 'POST',
        body: JSON.stringify({ email: username.trim(), password }),
        headers: this.consoleHeaders(),
        signal: AbortSignal.timeout(30_000),
      });
      if (response.ok === true && response.authenticated === true && response.token?.trim()) {
        return { success: true, accessToken: response.token, username: username.trim() };
      }
      return { success: false, message: responseError(response, 'FlowRealm 登录失败') };
    } catch (error) {
      return { success: false, message: errorMessage(error) };
    }
  }

  override async getUserInfo(baseUrl: string, accessToken: string): Promise<UserInfo | null> {
    try {
      const { user } = await this.getProfile(baseUrl, accessToken);
      if (!user?.email) return null;
      return { username: user.email, email: user.email, displayName: user.name };
    } catch {
      return null;
    }
  }

  async getBalance(baseUrl: string, accessToken: string): Promise<BalanceInfo> {
    const { user } = await this.getProfile(baseUrl, accessToken);
    // FlowRealm quota is the remaining point balance, not a New API USD quota.
    const balance = quotaValue(user?.quota, 'quota');
    const used = quotaValue(user?.quota_used, 'quota_used');
    return { balance, used, quota: balance + used };
  }

  async checkin(baseUrl: string, accessToken: string): Promise<CheckinResult> {
    try {
      const response = await this.fetchJson<CheckinResponse>(`${stripTrailingSlashes(baseUrl)}/api/me/checkin`, {
        method: 'POST',
        body: '{}',
        headers: this.consoleHeaders(accessToken),
        signal: AbortSignal.timeout(30_000),
      });
      if (response.checked_in !== true || typeof response.created !== 'boolean') {
        return { success: false, message: responseError(response, 'FlowRealm 签到响应无效') };
      }
      if (!response.created) {
        // granted_amount still contains today's original award on repeated calls.
        return { success: true, message: '今天已经签到' };
      }
      const reward = quotaValue(response.granted_amount, 'granted_amount');
      return { success: true, message: `签到成功，获得 ${reward} 点额度`, reward: `${reward} 点` };
    } catch (error) {
      return { success: false, message: errorMessage(error) };
    }
  }

  async getModels(baseUrl: string, token: string): Promise<string[]> {
    const response = await this.fetchJson<{ data?: { id?: string }[] }>(`${stripTrailingSlashes(baseUrl)}/v1/models`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!Array.isArray(response.data)) throw new Error('FlowRealm 模型列表响应无效');
    return response.data.flatMap((item) => typeof item?.id === 'string' && item.id.trim() ? [item.id.trim()] : []);
  }

  private async getProfile(baseUrl: string, accessToken: string): Promise<ProfileResponse> {
    const response = await this.fetchJson<ProfileResponse>(`${stripTrailingSlashes(baseUrl)}/api/me/profile`, {
      headers: this.consoleHeaders(accessToken),
      signal: AbortSignal.timeout(30_000),
    });
    if (response.authenticated !== true || !response.user) {
      throw new Error(responseError(response, 'FlowRealm 账户信息响应无效'));
    }
    return response;
  }

  private consoleHeaders(token?: string): Record<string, string> {
    return { 'X-FlowRealm-Console': '1', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  }
}
