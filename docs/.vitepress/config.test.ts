import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import config from './config';

const repoRoot = process.cwd();

describe('docs vitepress config', () => {
  it('ships copied main-app favicon assets for docs', () => {
    expect(existsSync(resolve(repoRoot, 'docs/public/favicon.png'))).toBe(true);
    expect(existsSync(resolve(repoRoot, 'docs/public/favicon-64.png'))).toBe(true);
    expect(existsSync(resolve(repoRoot, 'docs/public/favicon.ico'))).toBe(true);
  });

  it('declares the Lite docs navigation only', () => {
    const nav = config.themeConfig?.nav ?? [];
    const navText = JSON.stringify(nav);

    expect(navText).toContain('快速上手');
    expect(navText).toContain('配置');
    expect(navText).toContain('部署');
    expect(navText).not.toContain('OAuth 管理');
    expect(navText).not.toContain('上游接入');
    expect(navText).not.toContain('K3s 更新中心');
  });
});
