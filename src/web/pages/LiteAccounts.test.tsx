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
    updateAccount: vi.fn(),
    refreshBalance: vi.fn(),
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
    apiMock.updateAccount.mockResolvedValue({ success: true });
    apiMock.refreshBalance.mockResolvedValue({ balance: 88 });
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

  it('updates checkin status locally without reloading the account snapshot', async () => {
    apiMock.getAccountsSnapshot.mockResolvedValue({
      sites: [{ id: 1, name: 'Alpha Site', platform: 'openai' }],
      accounts: [
        {
          id: 101,
          username: 'Alpha Account',
          credentialMode: 'session',
          checkinEnabled: true,
          capabilities: { canCheckin: true },
          site: { id: 1, name: 'Alpha Site', url: 'https://alpha.example' },
        },
      ],
    });

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

      const checkinButton = root.root.find((node) => (
        node.type === 'button'
        && typeof node.props.onClick === 'function'
        && collectText(node).trim() === '已开启'
      ));

      await act(async () => {
        await checkinButton.props.onClick();
      });
      await flushMicrotasks();

      expect(apiMock.updateAccount).toHaveBeenCalledWith(101, {
        checkinEnabled: false,
      });
      expect(apiMock.getAccountsSnapshot).toHaveBeenCalledTimes(1);
      expect(collectText(root.root)).toContain('已关闭');
    } finally {
      root?.unmount();
    }
  });

  it('shows today balance deltas below the account balance', async () => {
    apiMock.getAccountsSnapshot.mockResolvedValue({
      sites: [{ id: 1, name: 'Alpha Site', platform: 'openai' }],
      accounts: [
        {
          id: 101,
          username: 'Alpha Account',
          credentialMode: 'session',
          balance: 42,
          todayReward: 3.5,
          todaySpend: 1.25,
          site: { id: 1, name: 'Alpha Site', url: 'https://alpha.example' },
        },
        {
          id: 202,
          username: 'Beta Account',
          credentialMode: 'session',
          balance: 10,
          todayReward: 0,
          todaySpend: 0,
          site: { id: 1, name: 'Alpha Site', url: 'https://alpha.example' },
        },
      ],
    });

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

      const text = collectText(root.root);
      expect(text).toContain('42.00+3.50-1.25');
      expect(text).toContain('10.00');
      expect(text).not.toContain('+0.00');
      expect(text).not.toContain('-0.00');
    } finally {
      root?.unmount();
    }
  });

  it('refreshes one account balance without reloading the account snapshot', async () => {
    apiMock.getAccountsSnapshot.mockResolvedValue({
      sites: [{ id: 1, name: 'Alpha Site', platform: 'openai' }],
      accounts: [
        {
          id: 101,
          username: 'Alpha Account',
          credentialMode: 'session',
          balance: 42,
          capabilities: { canRefreshBalance: true },
          site: { id: 1, name: 'Alpha Site', url: 'https://alpha.example' },
        },
      ],
    });
    apiMock.refreshBalance.mockResolvedValue({ balance: 88.5, used: 6.25 });

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

      const refreshBalanceButton = root.root.find((node) => (
        node.type === 'button'
        && typeof node.props.onClick === 'function'
        && collectText(node).trim() === '刷新余额'
      ));

      await act(async () => {
        await refreshBalanceButton.props.onClick();
      });
      await flushMicrotasks();

      expect(apiMock.refreshBalance).toHaveBeenCalledWith(101);
      expect(apiMock.getAccountsSnapshot).toHaveBeenCalledTimes(1);
      const text = collectText(root.root);
      expect(text).toContain('88.50');
      expect(text).not.toContain('已用 6.25');
    } finally {
      root?.unmount();
    }
  });
});
