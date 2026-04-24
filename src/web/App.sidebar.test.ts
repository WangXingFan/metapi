import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('App sidebar config', () => {
  it('keeps only the five core navigation entries', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/web/App.tsx'), 'utf8');

    expect(source).toContain('to: "/sites", label: "站点"');
    expect(source).toContain('to: "/accounts", label: "账户"');
    expect(source).toContain('to: "/keys", label: "账号 Key"');
    expect(source).toContain('to: "/checkin", label: "签到"');
    expect(source).toContain('to: "/import-export", label: "导入导出"');
    expect(source).not.toContain('to: "/oauth"');
    expect(source).not.toContain('to: "/routes"');
    expect(source).not.toContain('to: "/downstream-keys"');
  });

  it('preserves legacy redirects to lite routes', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/web/App.tsx'), 'utf8');

    expect(source).toContain('function LegacyPathRedirect');
    expect(source).toContain('<Route path="/tokens" element={<LegacyPathRedirect to="/keys" />} />');
    expect(source).toContain('<Route path="/settings/import-export" element={<LegacyPathRedirect to="/import-export" />} />');
  });

  it('does not render the lite guide banner in the main shell', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/web/App.tsx'), 'utf8');

    expect(source).not.toContain('当前实例已收缩为最小运维闭环');
    expect(source).not.toContain('添加站点 -> 添加账户 -> 获取 Key -> 执行签到 -> 导入导出');
    expect(source).not.toContain('{t("精简版")}');
  });
});
