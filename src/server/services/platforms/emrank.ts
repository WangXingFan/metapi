import {
  BasePlatformAdapter,
  type BalanceInfo,
  type CheckinResult,
  type UserInfo,
} from './base.js';
import { detectPlatformByUrlHint } from '../../../shared/platformIdentity.js';
import { stripTrailingSlashes } from '../urlNormalization.js';

const QUOTA_SCALE = 1_000_000;
const DEFAULT_TIMEOUT_MS = 30_000;

type QuotaValue = string | number | null | undefined;

type EmrankSessionResponse = {
  authenticated?: boolean;
  user?: {
    id?: number | string;
    username?: string;
    display_name?: string;
    email?: string;
    role?: number | string;
  };
};

type EmrankAccountResponse = {
  quota?: QuotaValue;
  quota_used?: QuotaValue;
  used_quota?: QuotaValue;
};

type EmrankCheckinRecord = {
  day?: string;
  reward?: QuotaValue;
};

type EmrankCheckinResponse = {
  available?: boolean;
  state?: {
    can_claim?: boolean;
    message?: string;
    status?: string;
    reward?: QuotaValue;
    record?: EmrankCheckinRecord;
  };
  record?: EmrankCheckinRecord;
  reward?: QuotaValue;
  message?: string;
};

function normalizeSessionCookie(token: string): string {
  const trimmed = token.trim().replace(/^cookie\s*:\s*/i, '');
  if (!trimmed) return '';
  return trimmed.includes('=')
    ? trimmed
    : `__Host-gateway_session=${trimmed}`;
}

function parseQuota(value: unknown, field: string): number {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim()
      ? Number(value)
      : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`EMRank 返回无效的 ${field}`);
  }
  return parsed;
}

function parseOptionalQuota(value: unknown, field: string): number {
  if (value === undefined || value === null || value === '') return 0;
  return parseQuota(value, field);
}

function convertQuota(value: number): number {
  return value / QUOTA_SCALE;
}

function extractReward(response: EmrankCheckinResponse): string | undefined {
  const raw = response.state?.record?.reward
    ?? response.state?.reward
    ?? response.record?.reward
    ?? response.reward;
  if (raw === undefined || raw === null || raw === '') return undefined;
  try {
    return String(convertQuota(parseQuota(raw, '奖励')));
  } catch {
    return undefined;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class EmrankAdapter extends BasePlatformAdapter {
  readonly platformName = 'emrank';

  async detect(url: string): Promise<boolean> {
    return detectPlatformByUrlHint(url) === this.platformName;
  }

  override async login(_baseUrl: string, _username: string, _password: string) {
    return {
      success: false as const,
      message: 'EMRank 仅支持 LinuxDo 网页登录，请使用 Session / Cookie 凭证',
    };
  }

  override async getUserInfo(baseUrl: string, accessToken: string): Promise<UserInfo | null> {
    try {
      const { user } = await this.fetchSession(baseUrl, accessToken);
      const username = (user.username || user.display_name || '').trim();
      if (!username) return null;
      const role = Number(user.role);
      return {
        username,
        displayName: user.display_name?.trim() || undefined,
        email: user.email?.trim() || undefined,
        role: Number.isFinite(role) ? role : undefined,
      };
    } catch {
      return null;
    }
  }

  async getBalance(baseUrl: string, accessToken: string): Promise<BalanceInfo> {
    const account = await this.fetchJson<EmrankAccountResponse>(
      `${stripTrailingSlashes(baseUrl)}/api/account`,
      {
        headers: this.authHeaders(accessToken),
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      },
    );
    const balanceQuota = parseQuota(account.quota, '余额');
    const usedQuota = parseOptionalQuota(
      account.quota_used ?? account.used_quota,
      '已用额度',
    );
    const balance = convertQuota(balanceQuota);
    const used = convertQuota(usedQuota);
    return { balance, used, quota: balance + used };
  }

  async checkin(baseUrl: string, accessToken: string): Promise<CheckinResult> {
    try {
      const checkinUrl = `${stripTrailingSlashes(baseUrl)}/api/account/check-ins`;
      const current = await this.fetchJson<EmrankCheckinResponse>(checkinUrl, {
        headers: this.authHeaders(accessToken),
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
      const currentReward = extractReward(current);
      if (current.state?.status === 'already_claimed' || current.state?.can_claim === false) {
        return {
          success: false,
          message: '今日已签到',
          ...(currentReward ? { reward: currentReward } : {}),
        };
      }

      const claimed = await this.fetchJson<EmrankCheckinResponse>(checkinUrl, {
        method: 'POST',
        body: '{}',
        headers: {
          ...this.authHeaders(accessToken),
          'X-Gateway-CSRF': '1',
        },
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
      const reward = extractReward(claimed) ?? currentReward;
      if (claimed.state?.status === 'already_claimed') {
        return {
          success: false,
          message: '今日已签到',
          ...(reward ? { reward } : {}),
        };
      }
      return {
        success: true,
        message: reward ? `签到成功，获得 ${reward} 额度` : '签到成功',
        ...(reward ? { reward } : {}),
      };
    } catch (error) {
      return { success: false, message: errorMessage(error) };
    }
  }

  async getModels(_baseUrl: string, _token: string): Promise<string[]> {
    return [];
  }

  private async fetchSession(baseUrl: string, accessToken: string): Promise<EmrankSessionResponse & {
    user: NonNullable<EmrankSessionResponse['user']>;
  }> {
    const response = await this.fetchJson<EmrankSessionResponse>(
      `${stripTrailingSlashes(baseUrl)}/api/auth/session`,
      {
        headers: this.authHeaders(accessToken),
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      },
    );
    if (response.authenticated !== true || !response.user) {
      throw new Error('EMRank 账户信息响应无效');
    }
    return response as EmrankSessionResponse & {
      user: NonNullable<EmrankSessionResponse['user']>;
    };
  }

  private authHeaders(accessToken: string): Record<string, string> {
    const cookie = normalizeSessionCookie(accessToken);
    if (!cookie) throw new Error('EMRank Session / Cookie 不能为空');
    return { Cookie: cookie };
  }
}
