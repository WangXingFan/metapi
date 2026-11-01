import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import CheckinLog from './CheckinLog.js';

const { apiMock, toast } = vi.hoisted(() => ({
  apiMock: { getCheckinLogs: vi.fn(), getCheckinStatus: vi.fn() },
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));
vi.mock('../api.js', () => ({ api: apiMock }));
vi.mock('../components/Toast.js', () => ({ useToast: () => toast }));
vi.mock('../components/useIsMobile.js', () => ({ useIsMobile: () => false }));

function text(node: ReactTestInstance): string {
  return node.children.map((child) => typeof child === 'string' ? child : text(child)).join('');
}
const response = (username: string, total = 120) => ({
  logs: [{ checkin_logs: { id: 1, status: 'success', createdAt: '2026-01-01 12:00:00' }, accounts: { username }, sites: { name: 'Site' } }],
  total, counts: { all: total, success: total, failed: 0, skipped: 0 },
});

describe('CheckinLog pagination', () => {
  let root: ReactTestRenderer;
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('window', { setInterval: vi.fn(() => 1), clearInterval: vi.fn() });
    apiMock.getCheckinStatus.mockResolvedValue({});
    apiMock.getCheckinLogs.mockImplementation(async (query: string) => response(`offset-${new URLSearchParams(query).get('offset')}`));
  });
  afterEach(() => { act(() => root?.unmount()); vi.unstubAllGlobals(); });
  const button = (label: string) => root.root.find((node) => node.type === 'button' && text(node).trim() === label);
  const lastQuery = () => new URLSearchParams(apiMock.getCheckinLogs.mock.calls.at(-1)?.[0]);

  it('requests older pages from the server and resets pagination when filters change', async () => {
    await act(async () => { root = create(<CheckinLog />); });
    expect(lastQuery().get('limit')).toBe('50');
    expect(lastQuery().get('from')).toBeTruthy();
    await act(async () => { button('下一页').props.onClick(); });
    await act(async () => { button('下一页').props.onClick(); });
    expect(lastQuery().get('offset')).toBe('100');
    expect(text(root.root)).toContain('offset-100');
    expect(button('下一页').props.disabled).toBe(true);
    await act(async () => { button('清空筛选').props.onClick(); });
    expect(lastQuery().get('offset')).toBe('0');
    expect(lastQuery().has('from')).toBe(false);
    expect(lastQuery().has('to')).toBe(false);
    await act(async () => { button('成功 120').props.onClick(); });
    expect(lastQuery().get('status')).toBe('success');
  });

  it('ignores a stale response after the user changes filters', async () => {
    let resolveStale!: (value: ReturnType<typeof response>) => void;
    apiMock.getCheckinLogs.mockImplementationOnce(() => new Promise((resolve) => { resolveStale = resolve; }));
    await act(async () => { root = create(<CheckinLog />); });
    await act(async () => { button('清空筛选').props.onClick(); });
    await act(async () => { resolveStale(response('stale-account')); });
    expect(text(root.root)).toContain('offset-0');
    expect(text(root.root)).not.toContain('stale-account');
  });
});
