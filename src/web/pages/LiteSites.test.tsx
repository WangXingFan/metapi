import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ToastProvider } from '../components/Toast.js';
import LiteSites from './LiteSites.js';

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    getSites: vi.fn(),
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

function LocationEcho() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

describe('LiteSites', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
