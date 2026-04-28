import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/Toast.js';
import LiteKeys from './LiteKeys.js';

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    getAccountsSnapshot: vi.fn(),
    getAccountTokens: vi.fn(),
    syncAccountTokens: vi.fn(),
  },
}));

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
    apiMock.getAccountsSnapshot.mockResolvedValue({ accounts: [], sites: [] });
    apiMock.getAccountTokens.mockResolvedValue([]);
    apiMock.syncAccountTokens.mockResolvedValue({ success: true });
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
