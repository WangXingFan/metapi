import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/Toast.js';
import LiteKeys from './LiteKeys.js';

const { apiMock, viewport } = vi.hoisted(() => ({
  viewport: { mobile: false },
  apiMock: {
    getAccountsSnapshot: vi.fn(),
    getAccountTokens: vi.fn(),
    syncAccountTokens: vi.fn(),
    getAccountTokenGroups: vi.fn(),
    addAccountToken: vi.fn(),
    updateAccountToken: vi.fn(),
    deleteAccountToken: vi.fn(),
  },
}));

vi.mock('../components/useIsMobile.js', () => ({ useIsMobile: () => viewport.mobile }));

vi.mock('../api.js', () => ({
  api: apiMock,
}));

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function collectText(node: ReactTestInstance): string {
  return (node.children || [])
    .map((child) => (typeof child === 'string' ? child : collectText(child)))
    .join('');
}

describe('LiteKeys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    viewport.mobile = false;
    apiMock.getAccountsSnapshot.mockResolvedValue({ accounts: [], sites: [] });
    apiMock.getAccountTokens.mockResolvedValue([]);
    apiMock.syncAccountTokens.mockResolvedValue({ success: true });
    apiMock.getAccountTokenGroups.mockResolvedValue({ groups: ['cckcc', 'cckpro'], capabilities: { create: true, update: true, delete: true } });
    apiMock.addAccountToken.mockResolvedValue({ success: true, maskedPending: 0 });
    apiMock.updateAccountToken.mockResolvedValue({ success: true });
    apiMock.deleteAccountToken.mockResolvedValue({ success: true });
  });

  it.each([false, true])('creates, edits groups and deletes upstream keys (mobile: %s)', async (mobile) => {
    viewport.mobile = mobile;
    apiMock.getAccountsSnapshot.mockResolvedValue({ sites: [{ id: 1, name: 'Site' }], accounts: [{ id: 101, username: 'Account', credentialMode: 'session', site: { id: 1, name: 'Site' } }] });
    apiMock.getAccountTokens.mockResolvedValue([{ id: 1, accountId: 101, name: 'key', tokenGroup: 'cckcc', tokenMasked: 'sk-abc***1234', valueStatus: 'ready', enabled: true }]);
    let root!: ReactTestRenderer;
    const button = (label: string) => root.root.find((node) => node.type === 'button' && collectText(node).trim() === label);
    const input = (label: string) => root.root.find((node) => node.type === 'input' && node.props['aria-label'] === label);
    try {
      await act(async () => {
        root = create(<MemoryRouter initialEntries={['/keys?accountId=101']}><ToastProvider><LiteKeys /></ToastProvider></MemoryRouter>);
      });
      await flushMicrotasks();
      await act(async () => { button('新建 Key').props.onClick(); });
      await flushMicrotasks();
      expect(apiMock.getAccountTokenGroups).toHaveBeenCalledWith(101);
      await act(async () => {
        input('Key 名称').props.onChange({ target: { value: 'new-key' } });
        input('分组').props.onChange({ target: { value: 'cckpro' } });
      });
      await act(async () => { button('在上游创建').props.onClick(); });
      await flushMicrotasks();
      expect(apiMock.addAccountToken).toHaveBeenCalledWith({ accountId: 101, name: 'new-key', group: 'cckpro' });
      expect(apiMock.updateAccountToken).not.toHaveBeenCalled();

      await act(async () => { button('编辑 / 分组').props.onClick(); });
      await flushMicrotasks();
      expect(input('分组').props.value).toBe('cckcc');
      await act(async () => { input('分组').props.onChange({ target: { value: 'cckpro' } }); });
      await act(async () => { button('保存并同步上游').props.onClick(); });
      await flushMicrotasks();
      expect(apiMock.updateAccountToken).toHaveBeenCalledWith(1, { name: 'key', group: 'cckpro', syncUpstream: true });

      await act(async () => { button('删除').props.onClick(); });
      await flushMicrotasks();
      expect(apiMock.deleteAccountToken).toHaveBeenCalledWith(1);
    } finally {
      root?.unmount();
    }
  });

  it('allows syncing a selected session account that has no saved keys', async () => {
    apiMock.getAccountsSnapshot.mockResolvedValue({
      sites: [{ id: 1, name: 'Fanxing Site' }],
      accounts: [
        {
          id: 101,
          username: 'fanxing',
          credentialMode: 'session',
          site: { id: 1, name: 'Fanxing Site', url: 'https://fanxing.example' },
        },
      ],
    });

    let root!: ReactTestRenderer;
    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/keys?accountId=101']}>
            <ToastProvider>
              <LiteKeys />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      expect(collectText(root.root)).toContain('fanxing 暂无可用 key');

      const syncButtons = root.root.findAll((node) => (
        node.type === 'button'
        && typeof node.props.onClick === 'function'
        && collectText(node).trim() === '同步当前账户'
      ));

      expect(syncButtons.length).toBeGreaterThan(0);

      await act(async () => {
        syncButtons[0]!.props.onClick();
      });
      await flushMicrotasks();

      expect(apiMock.syncAccountTokens).toHaveBeenCalledWith(101);
      expect(apiMock.getAccountsSnapshot).toHaveBeenCalledTimes(2);
      expect(apiMock.getAccountTokens).toHaveBeenCalledTimes(2);
    } finally {
      root?.unmount();
    }
  });
});
