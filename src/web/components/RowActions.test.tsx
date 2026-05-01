import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('RowActions component', () => {
  it('renders the action menu through a fixed portal so scroll containers cannot clip it', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/web/components/RowActions.tsx'), 'utf8');

    expect(source).toContain('createPortal');
    expect(source).toContain("position: 'fixed'");
    expect(source).toContain('document.body');
    expect(source).toContain('getBoundingClientRect');
    expect(source).toContain("window.addEventListener('scroll'");
  });
});
