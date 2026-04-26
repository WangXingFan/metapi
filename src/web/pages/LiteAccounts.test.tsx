import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/Toast.js';
import LiteAccounts from './LiteAccounts.js';

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    getAccountsSnapshot: vi.fn(),
    getRuntimeSettings: vi.fn(),
    updateRuntimeSettings: vi.fn(),
  },
}));

vi.mock('../api.js', () => ({
  api: apiMock,
}));

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function collectText(node: ReactTestInstance): string {
  return (node.children || [])
    .map((child) => (typeof child === 'string' ? child : collectText(child)))
    .join('');
}

describe('LiteAccounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.getAccountsSnapshot.mockResolvedValue({ accounts: [], sites: [] });
    apiMock.getRuntimeSettings.mockResolvedValue({
      checkinScheduleMode: 'cron',
      checkinSpreadIntervalMinutes: 5,
    });
    apiMock.updateRuntimeSettings.mockResolvedValue({ success: true });
  });

  it('saves the global checkin interval from the account page', async () => {
    let root!: ReactTestRenderer;
    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/accounts']}>
            <ToastProvider>
              <LiteAccounts />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      const settingsButton = root.root.find((node) => (
        node.type === 'button'
        && typeof node.props.onClick === 'function'
        && collectText(node).trim() === '签到设置'
      ));

      await act(async () => {
        await settingsButton.props.onClick();
      });
      await flushMicrotasks();

      const intervalSelect = root.root.find((node) => (
        node.type === 'select'
        && node.props.value === '5'
      ));

      await act(async () => {
        intervalSelect.props.onChange({ target: { value: '10' } });
      });

      const saveButton = root.root.find((node) => (
        node.type === 'button'
        && typeof node.props.onClick === 'function'
        && collectText(node).trim() === '保存设置'
      ));

      await act(async () => {
        await saveButton.props.onClick();
      });
      await flushMicrotasks();

      expect(apiMock.updateRuntimeSettings).toHaveBeenCalledWith({
        checkinCron: '0 8 * * *',
        checkinScheduleMode: 'spread',
        checkinSpreadIntervalMinutes: 10,
      });
    } finally {
      root?.unmount();
    }
  });

  it('applies the site filter from the URL before the user manually selects a site', async () => {
    apiMock.getAccountsSnapshot.mockResolvedValue({
      sites: [
        { id: 1, name: 'Alpha Site', platform: 'openai' },
        { id: 2, name: 'Beta Site', platform: 'claude' },
      ],
      accounts: [
        {
          id: 101,
          username: 'Alpha Account',
          credentialMode: 'session',
          site: { id: 1, name: 'Alpha Site', url: 'https://alpha.example' },
        },
        {
          id: 202,
          username: 'Beta Account',
          credentialMode: 'session',
          site: { id: 2, name: 'Beta Site', url: 'https://beta.example' },
        },
      ],
    });

    let root!: ReactTestRenderer;
    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/accounts?siteId=2']}>
            <ToastProvider>
              <LiteAccounts />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      const siteFilterSelect = root.root.find((node) => (
        node.type === 'select'
        && node.props.value === 2
      ));

      expect(siteFilterSelect).toBeTruthy();
      expect(collectText(root.root)).toContain('当前站点');
      expect(collectText(root.root)).toContain('Beta Site (claude)');
      expect(collectText(root.root)).toContain('Beta Account');
      expect(collectText(root.root)).not.toContain('Alpha Account');
    } finally {
      root?.unmount();
    }
  });
});
