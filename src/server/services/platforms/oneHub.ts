import { OneApiAdapter } from './oneApi.js';
import { parseTokenGroups } from './tokenManagement.js';
import type { AccountTokenGroup } from '../../../shared/accountTokenGroupTypes.js';

export class OneHubAdapter extends OneApiAdapter {
  readonly platformName: string = 'one-hub';
  override readonly apiTokenCapabilities = { create: true, update: false, delete: true };

  async detect(url: string): Promise<boolean> {
    const normalized = url.toLowerCase();
    return normalized.includes('onehub') || normalized.includes('one-hub');
  }

  /**
   * OneHub model discovery: try /v1/models first, fall back to /api/available_model.
   * The /api/available_model endpoint returns { data: { model_name: { price: ... }, ... } }
   * where the keys are model names.
   */
  override async getModels(baseUrl: string, apiToken: string, platformUserId?: number): Promise<string[]> {
    let openAiModels: string[] = [];
    try {
      openAiModels = await super.getModels(baseUrl, apiToken, platformUserId);
    } catch {}
    if (openAiModels.length > 0) return openAiModels;

    try {
      const res = await this.fetchJson<any>(`${baseUrl}/api/available_model`, {
        headers: { Authorization: `Bearer ${apiToken}` },
      });
      const payload = res?.data && typeof res.data === 'object' ? res.data : res;
      if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        const models = Object.keys(payload).filter(Boolean);
        if (models.length > 0) return models;
      }
    } catch {}

    return [];
  }

  /**
   * OneHub user groups: /api/user_group_map returns { data: { group_name: ratio, ... } }
   */
  override async getUserGroupOptions(baseUrl: string, accessToken: string): Promise<AccountTokenGroup[]> {
    try {
      const res = await this.fetchJson<any>(`${baseUrl}/api/user_group_map`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const groups = parseTokenGroups(res);
      if (groups.length > 0) return groups;
    } catch {}

    return super.getUserGroupOptions(baseUrl, accessToken);
  }
}
