import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ToastProvider } from '../components/Toast.js';
import LiteSites from './LiteSites.js';

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    getSites: vi.fn(),
    addSite: vi.fn(),
    updateSite: vi.fn(),
  },
}));

vi.mock('../api.js', () => ({
  api: apiMock,
}));

vi.mock('../components/CenteredModal.js', () => ({
  default: ({ open, title, children, footer }: any) => (
    open ? (
      <div data-testid="modal">
        <div>{title}</div>
        {children}
        <div>{footer}</div>
      </div>
    ) : null
  ),
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

function findButton(root: ReactTestInstance, text: string): ReactTestInstance {
  return root.find((node) => (
    node.type === 'button'
    && typeof node.props.onClick === 'function'
    && collectText(node).trim() === text
  ));
}

function findInputByPlaceholder(root: ReactTestInstance, placeholder: string): ReactTestInstance {
  return root.find((node) => (
    node.type === 'input'
    && node.props.placeholder === placeholder
  ));
}

function LocationEcho() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

describe('LiteSites', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.addSite.mockResolvedValue({});
    apiMock.updateSite.mockResolvedValue({});
    apiMock.getSites.mockResolvedValue([
      {
        id: 12,
        name: 'Alpha Site',
        url: 'https://alpha.example',
        platform: 'openai',
        status: 'active',
      },
    ]);
  });

  it('navigates to the account list filtered by the clicked site', async () => {
    let root!: ReactTestRenderer;
    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/sites']}>
            <ToastProvider>
              <Routes>
                <Route path="/sites" element={<LiteSites />} />
                <Route path="/accounts" element={<LocationEcho />} />
              </Routes>
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      const siteButton = root.root.find((node) => (
        node.type === 'button'
        && typeof node.props.onClick === 'function'
        && collectText(node).trim() === 'Alpha Site'
      ));

      await act(async () => {
        siteButton.props.onClick();
      });
      await flushMicrotasks();

      expect(root.root.findByProps({ 'data-testid': 'location' }).children.join('')).toBe('/accounts?siteId=12');
    } finally {
      root?.unmount();
    }
  });

  it('keeps the API site order instead of re-sorting by name', async () => {
    apiMock.getSites.mockResolvedValue([
      {
        id: 21,
        name: 'Zulu Site',
        url: 'https://zulu.example',
        platform: 'openai',
        status: 'active',
      },
      {
        id: 22,
        name: 'Alpha Site',
        url: 'https://alpha.example',
        platform: 'claude',
        status: 'active',
      },
    ]);

    let root!: ReactTestRenderer;
    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/sites']}>
            <ToastProvider>
              <Routes>
                <Route path="/sites" element={<LiteSites />} />
              </Routes>
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      const siteButtons = root.root.findAll((node) => (
        node.type === 'button'
        && ['Zulu Site', 'Alpha Site'].includes(collectText(node).trim())
      ));

      expect(siteButtons.map((node) => collectText(node).trim())).toEqual([
        'Zulu Site',
        'Alpha Site',
      ]);
    } finally {
      root?.unmount();
    }
  });

  it('renders proxy summaries without exposing proxy credentials', async () => {
    apiMock.getSites.mockResolvedValue([
      {
        id: 31,
        name: 'Custom Proxy Site',
        url: 'https://custom.example',
        platform: 'openai',
        status: 'active',
        proxyUrl: 'http://user:secret@proxy.example:8080',
      },
      {
        id: 32,
        name: 'System Proxy Site',
        url: 'https://system.example',
        platform: 'claude',
        status: 'active',
        useSystemProxy: true,
      },
    ]);

    let root!: ReactTestRenderer;
    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/sites']}>
            <ToastProvider>
              <Routes>
                <Route path="/sites" element={<LiteSites />} />
              </Routes>
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      const text = collectText(root.root);
      expect(text).toContain('http://proxy.example:8080');
      expect(text).toContain('系统代理');
      expect(text).not.toContain('user');
      expect(text).not.toContain('secret');
    } finally {
      root?.unmount();
    }
  });

  it('submits a custom proxy when creating a site', async () => {
    let root!: ReactTestRenderer;
    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/sites']}>
            <ToastProvider>
              <Routes>
                <Route path="/sites" element={<LiteSites />} />
              </Routes>
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      await act(async () => {
        findButton(root.root, '添加站点').props.onClick();
      });

      await act(async () => {
        findInputByPlaceholder(root.root, '例如：My New API').props.onChange({ target: { value: 'Proxy Site' } });
        findInputByPlaceholder(root.root, 'https://example.com').props.onChange({ target: { value: 'https://proxy.example' } });
        findButton(root.root, '自定义').props.onClick();
      });

      await act(async () => {
        findInputByPlaceholder(root.root, 'http://127.0.0.1:7890').props.onChange({
          target: { value: 'socks5://127.0.0.1:1080' },
        });
      });

      await act(async () => {
        findButton(root.root, '创建站点').props.onClick();
      });
      await flushMicrotasks();

      expect(apiMock.addSite).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Proxy Site',
        url: 'https://proxy.example',
        proxyUrl: 'socks5://127.0.0.1:1080',
        useSystemProxy: false,
      }));
    } finally {
      root?.unmount();
    }
  });

  it('submits system proxy mode when editing a site', async () => {
    let root!: ReactTestRenderer;
    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/sites']}>
            <ToastProvider>
              <Routes>
                <Route path="/sites" element={<LiteSites />} />
              </Routes>
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      await act(async () => {
        findButton(root.root, '编辑').props.onClick();
      });

      await act(async () => {
        findButton(root.root, '系统代理').props.onClick();
      });

      await act(async () => {
        findButton(root.root, '保存修改').props.onClick();
      });
      await flushMicrotasks();

      expect(apiMock.updateSite).toHaveBeenCalledWith(12, expect.objectContaining({
        proxyUrl: null,
        useSystemProxy: true,
      }));
    } finally {
      root?.unmount();
    }
  });
});
